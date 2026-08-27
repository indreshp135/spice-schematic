/**
 * SPICE language semantics that are easy to get wrong and silent when wrong:
 * a mis-parsed card does not throw, it draws a different circuit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpice, layout } from '../dist/index.js';

const nodesOf = (deck) => parseSpice(deck).components[0];

/* ── in-line comments ─────────────────────────────────────────────────── */

test('a ; comment does not become nodes on a model-based card', () => {
  // Unstripped, "2N3904" lands in the substrate slot and the model becomes
  // the comment text — a silently different device.
  const q = nodesOf('Q1 c b e 2N3904 ; my transistor');
  assert.deepEqual(q.nodes, ['c', 'b', 'e']);
  assert.equal(q.value, '2N3904');

  const m = nodesOf('M1 d g s NMOS ; wide device');
  assert.deepEqual(m.nodes, ['d', 'g', 's']);
  assert.equal(m.value, 'NMOS');
});

test('a ; comment does not become nodes on a subcircuit call', () => {
  const x = nodesOf('X1 a b c opamp ; the amp');
  assert.deepEqual(x.nodes, ['a', 'b', 'c']);
  assert.equal(x.value, 'opamp');
});

test('a ; comment does not end up in a source expression', () => {
  assert.equal(nodesOf('V1 in 0 DC 5 ; supply').value, 'DC 5');
  assert.equal(nodesOf('E1 o 0 i 0 10 ; gain').value, '10');
});

test('$ starts a comment when preceded by whitespace', () => {
  assert.equal(nodesOf('R1 a b 1k $ load').value, '1k');
  // No preceding space means it is part of the value, not a comment.
  assert.equal(nodesOf('R1 a b 1k$x').value, '1k$x');
});

test('a comment on a continuation line cannot swallow the card', () => {
  const r = nodesOf('R1 a b ; note\n+ 1k');
  assert.deepEqual(r.nodes, ['a', 'b']);
  assert.equal(r.value, '1k');
});

test('comments never invent nets', () => {
  const r = parseSpice('* deck\nQ1 c b e 2N3904 ; note\nX1 a b opamp ; amp');
  for (const bad of ['2n3904', ';', 'note', 'amp', 'opamp']) {
    assert.ok(!r.nets.includes(bad), `invented net "${bad}"`);
  }
});

/* ── case insensitivity ───────────────────────────────────────────────── */

test('node names are case-insensitive, as SPICE defines them', () => {
  const r = parseSpice('V1 IN 0 DC 5\nR1 in out 1k\nR2 OUT 0 1k');
  assert.deepEqual(r.nets, ['in', 'out'], 'IN and in must be one node');
  assert.deepEqual(r.components[0].nodes, ['in', '0']);
});

test('case folding actually connects the circuit', () => {
  // Two rails instead of one would draw a circuit that is not connected the
  // way the netlist says it is.
  const scene = layout(parseSpice('V1 IN 0 DC 5\nR1 In Out 1k\nR2 oUt 0 1k'));
  assert.equal(scene.nets.length, 2);
});

test('case folding applies to sense nodes too', () => {
  const e = nodesOf('E1 OUT 0 IN 0 10');
  assert.deepEqual(e.nodes, ['out', '0']);
  assert.deepEqual(e.senseNodes, ['in', '0']);
});

test('refdes and model names keep their original case', () => {
  const q = nodesOf('Q1 C B E 2N3904');
  assert.equal(q.refdes, 'Q1');
  assert.equal(q.value, '2N3904', 'model name must not be folded');
});

/* ── deck structure ───────────────────────────────────────────────────── */

test('.end terminates the deck', () => {
  const r = parseSpice('R1 a 0 1k\n.end\nR2 b 0 2k');
  assert.deepEqual(r.components.map((c) => c.refdes), ['R1']);
});

test('.ends and .endc are not mistaken for .end', () => {
  const r = parseSpice('.subckt S a b\nR9 a b 1\n.ends\nR1 x 0 1k\n.control\nplot v(x)\n.endc\nR2 y 0 2k');
  assert.deepEqual(r.components.map((c) => c.refdes), ['R1', 'R2']);
});

test('a bare first line is the deck title, not a component', () => {
  const r = parseSpice('My Amplifier Circuit\nV1 in 0 DC 5\nR1 in 0 1k');
  assert.equal(r.title, 'My Amplifier Circuit');
  assert.equal(r.skipped.length, 0, 'the title must not be reported as junk');
  assert.equal(r.components.length, 2);
});

test('the title rule never eats a real first component', () => {
  // Pasted fragments start with a card, not a title.
  const r = parseSpice('V1 in 0 DC 5\nR1 in out 1k');
  assert.deepEqual(r.components.map((c) => c.refdes), ['V1', 'R1']);
  assert.equal(r.title, null);
});

test('a * comment still takes precedence as the title', () => {
  assert.equal(parseSpice('* Real Title\nR1 a 0 1k').title, 'Real Title');
});

/* ── layout invariants that a wrong answer would hide ─────────────────── */

test('a net reached only through a control input still gets its own column', () => {
  // Missed during net discovery, its lead falls back to the left margin and
  // lands on whichever net owns that column — drawing a connection that the
  // netlist does not contain.
  const scene = layout(parseSpice('V1 a 0 DC 5\nR1 a b 1k\nE1 out 0 ctrl 0 10\nR2 out 0 1k'));
  assert.ok(scene.nets.includes('ctrl'), 'sense-only net missing from the scene');

  const railX = (net) => {
    const rail = scene.shapes.find((s) => s.net === net && s.kind === 'path' && /^M (\S+) \S+ L \1 /.test(s.d));
    return rail ? Number(rail.d.split(/\s+/)[1]) : null;
  };
  const ctrlLead = scene.shapes.find((s) => s.net === 'ctrl' && s.kind === 'path');
  const endX = Number(ctrlLead.d.trim().split(/\s+/).slice(-2)[0]);
  assert.notEqual(endX, railX('a'), 'control lead terminates on an unrelated net');
});

test('no two nets are drawn on the same column at overlapping rows', () => {
  const decks = [
    'V1 in 0 DC 5\nR1 in out 1k\nC1 out 0 1n',
    Array.from({ length: 24 }, (_, i) => `R${i} n${i}a n${i}b 1k`).join('\n'),
    'V1 a 0 DC 5\nQ1 c b e NPN\nR1 a c 1k\nR2 b 0 1k\nR3 e 0 1k',
  ];
  for (const deck of decks) {
    const scene = layout(parseSpice(deck));
    const rails = scene.shapes
      .filter((s) => s.kind === 'path' && s.net && /^M (\S+) (\S+) L \1 (\S+)$/.test(s.d))
      .map((s) => {
        const [, x, y0, y1] = s.d.match(/^M (\S+) (\S+) L \S+ (\S+)$/);
        return { net: s.net, x: +x, y0: +y0, y1: +y1 };
      });
    for (let i = 0; i < rails.length; i++) {
      for (let j = i + 1; j < rails.length; j++) {
        const a = rails[i];
        const b = rails[j];
        if (a.net === b.net || a.x !== b.x) continue;
        assert.ok(a.y1 < b.y0 || b.y1 < a.y0, `${a.net} and ${b.net} overlap on column ${a.x}`);
      }
    }
  }
});
