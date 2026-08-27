import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpice, isGround } from '../dist/index.js';

test('parses a plain RC network', () => {
  const r = parseSpice(`* RC low pass
V1 in 0 DC 5
R1 in out 1k
C1 out 0 100n
.end`);
  assert.equal(r.title, 'RC low pass');
  assert.equal(r.components.length, 3);
  assert.deepEqual(r.nets, ['in', 'out']);
  assert.equal(r.skipped.length, 0);
  assert.deepEqual(r.components[1], {
    refdes: 'R1', type: 'R', nodes: ['in', 'out'], value: '1k', raw: 'R1 in out 1k',
  });
});

test('treats 0, gnd and GND! as ground, and gives them no net', () => {
  assert.ok(['0', 'gnd', 'GND', 'gnd!'].every(isGround));
  assert.ok(!isGround('vgnd'));
  const r = parseSpice('R1 a gnd 1k\nR2 a 0 1k');
  assert.deepEqual(r.nets, ['a']);
});

test('joins + continuation lines onto the preceding card', () => {
  const r = parseSpice('V1 in 0 SIN(0 1\n+ 1k)');
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].nodes[0], 'in');
  assert.match(r.components[0].value, /1k/);
});

test('skips .subckt bodies rather than inventing nets from them', () => {
  const r = parseSpice(`* opamp
.subckt OPAMP non_inv inv out vcc vee
E1 out 0 table {V(non_inv)-V(inv)} = (-15 -15) (15 15)
.ends
X1 in n1 out vcc vee OPAMP
R1 in n1 10k`);
  assert.equal(r.components.length, 2);
  assert.deepEqual(r.components.map((c) => c.refdes), ['X1', 'R1']);
  for (const bad of ['table', '=', '(-15', '{V(non_inv)-V(inv)}', '0']) {
    assert.ok(!r.nets.includes(bad), `invented net "${bad}"`);
  }
  assert.deepEqual(r.nets, ['in', 'n1', 'out', 'vcc', 'vee']);
});

test('skips .control blocks', () => {
  const r = parseSpice(`R1 a 0 1k
.control
ac dec 10 1 100k
plot 'Magnitude' vdb(out)
.endc`);
  assert.equal(r.components.length, 1);
  assert.deepEqual(r.nets, ['a']);
});

test('.ends does not terminate the deck the way .end does', () => {
  const r = parseSpice('.subckt S a b\nR9 a b 1\n.ends\nR1 x 0 1k\n.end');
  assert.deepEqual(r.components.map((c) => c.refdes), ['R1']);
});

test('MOSFET bulk terminal is optional', () => {
  const four = parseSpice('M1 d g s b NMOS').components[0];
  const three = parseSpice('M2 d g s NMOS').components[0];
  assert.deepEqual(four.nodes, ['d', 'g', 's', 'b']);
  assert.equal(four.value, 'NMOS');
  assert.deepEqual(three.nodes, ['d', 'g', 's']);
  assert.equal(three.value, 'NMOS');
});

test('subcircuit call takes every field before the model name as a node', () => {
  const x = parseSpice('X1 a b c d e OPAMP').components[0];
  assert.deepEqual(x.nodes, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(x.value, 'OPAMP');
});

test('reports malformed lines instead of dropping them silently', () => {
  // Line 1 is the title by SPICE convention, so the bad cards go below it.
  const r = parseSpice('* deck\n123 a b c\nR1\nR2 a 0 1k');
  assert.equal(r.components.length, 1);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped[0].reason, /not a SPICE element letter/);
  assert.match(r.skipped[1].reason, /resistor: expected 2 nodes/);
});

test('survives garbage without throwing', () => {
  for (const junk of ['', '   ', '\n\n\n', '*', '.end', 'zzzz', '!!! ??? ###', 'R']) {
    assert.doesNotThrow(() => parseSpice(junk));
  }
});
