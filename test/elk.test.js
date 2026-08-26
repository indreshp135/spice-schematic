/**
 * The ELK layout is experimental and NOT the default — see README. These tests
 * hold it to the same structural contract as the rail layout, so it stays a
 * usable alternative rather than bit-rotting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseSpice, layout, sceneToSvg } from '../dist/index.js';
import { layoutWithElk } from '../dist/elk.js';

const CIRS = readdirSync('examples').filter((f) => f.endsWith('.cir'));
const read = (f) => readFileSync(`examples/${f}`, 'utf8');

for (const f of CIRS) {
  test(`${f} — ELK produces a valid scene`, async () => {
    const scene = await layoutWithElk(parseSpice(read(f)));
    assert.ok(Number.isFinite(scene.width) && scene.width > 0);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0);
    assert.ok(scene.shapes.length > 0, 'drew nothing');
    const svg = sceneToSvg(scene);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), 'non-finite geometry');
    assert.match(svg, /^<svg /);
  });
}

test('every drawable component reaches the sheet', async () => {
  const parsed = parseSpice(read('common-emitter.cir'));
  const svg = sceneToSvg(await layoutWithElk(parsed));
  for (const c of parsed.components) {
    assert.ok(svg.includes(c.refdes), `${c.refdes} missing from the ELK sheet`);
  }
});

test('both layouts draw a component from the same symbol geometry', async () => {
  // The shared symbol module is the point: a resistor must be the same zigzag
  // in both engines, differing only in where it is placed.
  const deck = 'V1 in 0 DC 5\nR1 in out 1k\nC1 out 0 100n';
  const parsed = parseSpice(deck);
  const rail = layout(parsed);
  const elk = await layoutWithElk(parsed);

  const zig = (scene) =>
    scene.shapes
      .filter((s) => s.kind === 'path' && !s.isHalo && /L .* L .* L .* L .* L .* L .* L/.test(s.d))
      .map((s) => s.d.split(/\s+/).length);
  assert.deepEqual(zig(rail), zig(elk), 'resistor geometry differs between layouts');
});

test('coupled inductors annotate the ELK sheet too', async () => {
  const svg = sceneToSvg(await layoutWithElk(parseSpice(read('transformer.cir'))));
  assert.ok(svg.includes('K1'));
  assert.ok(/L1 .* L2/.test(svg), 'coupling annotation missing');
});

test('the algorithm is selectable', async () => {
  const parsed = parseSpice(read('common-emitter.cir'));
  const layered = await layoutWithElk(parsed, { algorithm: 'layered' });
  const tree = await layoutWithElk(parsed, { algorithm: 'mrtree' });
  assert.notEqual(
    Math.round(layered.width) + 'x' + Math.round(layered.height),
    Math.round(tree.width) + 'x' + Math.round(tree.height),
    'algorithm option had no effect',
  );
});

test('importing the core never pulls in elkjs', async () => {
  const core = readFileSync('dist/index.js', 'utf8');
  assert.ok(!/elkjs/.test(core), 'elkjs leaked into the core bundle');
});
