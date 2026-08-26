/**
 * Verifies the Yosys JSON export by feeding it to real netlistsvg and checking
 * that actual symbols come back — not the generic box it silently falls back
 * to when a cell type does not match a skin alias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toYosysJson, parseSpice } from '../dist/index.js';
import netlistsvg from 'netlistsvg';

const skin = readFileSync('node_modules/netlistsvg/lib/analog.svg', 'utf8');
const read = (f) => readFileSync(`examples/${f}`, 'utf8');
const cellsOf = (r, name = 'circuit') => r.json.modules[name].cells;

test('maps the seven drawable letters onto skin aliases', () => {
  const r = toYosysJson('R1 a b 1k\nC1 b c 1n\nL1 c d 1m\nD1 d e 1N4148\nV1 e f DC 5\nI1 f g 1m\nQ1 h i j 2N3904');
  const types = Object.values(cellsOf(r)).map((c) => c.type);
  assert.deepEqual(types, ['r_h', 'c_h', 'l_h', 'd_h', 'v', 'i', 'q_npn']);
  assert.equal(r.dropped.length, 0);
});

test('selects the pnp symbol from the model name', () => {
  const r = toYosysJson('Q1 c b e 2N3906_PNP');
  assert.equal(cellsOf(r).Q1.type, 'q_pnp');
});

test('vertical orientation picks the vertical symbols', () => {
  const r = toYosysJson('R1 a b 1k', { orientation: 'v' });
  assert.equal(cellsOf(r).R1.type, 'r_v');
});

test('every ground pin becomes its own cell, matching the skin', () => {
  const r = toYosysJson('R1 a 0 1k\nR2 b 0 1k');
  const cells = cellsOf(r);
  const gnds = Object.entries(cells).filter(([, c]) => c.type === 'gnd');
  assert.equal(gnds.length, 2, 'ground pins must not share a cell');
  // Each ground cell sits on its own bit, or netlistsvg would merge them.
  const bits = gnds.map(([, c]) => c.connections.A[0]);
  assert.equal(new Set(bits).size, 2);
});

test('nets become distinct integer bits, skipping the reserved 0 and 1', () => {
  const r = toYosysJson('R1 in out 1k\nR2 out gnd2 1k');
  assert.ok(Object.values(r.bits).every((b) => b >= 2));
  assert.equal(new Set(Object.values(r.bits)).size, Object.keys(r.bits).length);
});

test('undrawable devices are reported, never silently omitted', () => {
  const r = toYosysJson(read('all-elements.cir'));
  const parsed = parseSpice(read('all-elements.cir'));
  const kept = Object.values(cellsOf(r)).filter((c) => c.type !== 'gnd').length;
  assert.equal(kept + r.dropped.length, parsed.components.length, 'a component vanished');
  const droppedTypes = new Set(r.dropped.map((d) => d.type));
  for (const t of ['M', 'J', 'Z', 'E', 'G', 'F', 'H', 'B', 'S', 'W', 'T', 'X', 'K']) {
    assert.ok(droppedTypes.has(t), `${t} should be reported as undrawable`);
  }
});

test('netlistsvg renders real symbols from our output, not generic boxes', async () => {
  const { json, dropped } = toYosysJson(read('common-emitter.cir'), { moduleName: 'ce' });
  assert.equal(dropped.length, 0);
  const svg = await netlistsvg.render(skin, json);
  assert.match(svg, /^<svg|<svg/);
  // The generic fallback prints the cell type as a text label; a real symbol
  // does not. Seeing "r_h" rendered as text means the alias lookup missed.
  assert.ok(!/>r_h</.test(svg), 'resistors fell back to the generic box');
  assert.ok(!/>q_npn</.test(svg), 'transistor fell back to the generic box');
  for (const ref of ['R1', 'R2', 'RC', 'RE', 'Q1', 'C1', 'VCC']) {
    assert.ok(svg.includes(ref), `${ref} missing from netlistsvg output`);
  }
});

test('netlistsvg accepts every example we can express', async () => {
  for (const f of ['rc-lowpass.cir', 'common-emitter.cir']) {
    const { json } = toYosysJson(read(f), { moduleName: f.replace(/\W/g, '_') });
    const svg = await netlistsvg.render(skin, json);
    assert.ok(svg.length > 500, `${f} produced almost nothing`);
  }
});
