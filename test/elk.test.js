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

test('a sense net never lands on a terminal port', async () => {
  // Hanging control inputs off the terminals joins the sensed net to the
  // output net — a connection the netlist does not contain.
  const parsed = parseSpice('V1 in 0 AC 1\nE1 out 0 in 0 10\nR1 out 0 1k');
  const scene = await layoutWithElk(parsed);
  const dashed = scene.shapes.filter((s) => s.kind === 'path' && s.dashed);
  assert.ok(dashed.length > 0, 'control tap not drawn as a sense connection');
});

test('switches route their control net separately too', async () => {
  const parsed = parseSpice('V1 s 0 DC 5\nVC ctrl 0 DC 1\nS1 s out ctrl 0 swmod\nR1 out 0 1k');
  const scene = await layoutWithElk(parsed);
  assert.ok(scene.shapes.some((s) => s.kind === 'path' && s.dashed), 'switch control not drawn dashed');
  assert.ok(!/NaN/.test(JSON.stringify(scene.shapes)));
});

/* ── property sweep, mirroring the rail layout's invariants ───────────── */

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function deckFor(seed) {
  const r = rng(seed);
  const pool = ['0', ...Array.from({ length: 2 + Math.floor(r() * 6) }, (_, i) => `n${i}`)];
  const pick = () => pool[Math.floor(r() * pool.length)];
  const kinds = [
    (i) => `R${i} ${pick()} ${pick()} 1k`,
    (i) => `C${i} ${pick()} ${pick()} 1n`,
    (i) => `V${i} ${pick()} ${pick()} DC 5`,
    (i) => `Q${i} ${pick()} ${pick()} ${pick()} NPN`,
    (i) => `M${i} ${pick()} ${pick()} ${pick()} ${pick()} NMOS`,
    (i) => `E${i} ${pick()} ${pick()} ${pick()} ${pick()} 10`,
    (i) => `S${i} ${pick()} ${pick()} ${pick()} ${pick()} swmod`,
    (i) => `X${i} ${pick()} ${pick()} ${pick()} sub`,
    (i) => `K${i} L${i}a L${i}b 0.9`,
  ];
  const n = 1 + Math.floor(r() * 8);
  return ['* generated', ...Array.from({ length: n }, (_, i) => kinds[Math.floor(r() * kinds.length)](i))].join('\n');
}

test('ELK holds the same invariants over generated decks', async () => {
  for (const seed of Array.from({ length: 25 }, (_, i) => i * 7919 + 13)) {
    const deck = deckFor(seed);
    const parsed = parseSpice(deck);
    const scene = await layoutWithElk(parsed);
    const where = `seed ${seed}`;

    assert.ok(Number.isFinite(scene.width) && scene.width > 0, `${where}: bad width`);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0, `${where}: bad height`);

    const svg = sceneToSvg(scene);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), `${where}: non-finite geometry`);
    assert.match(svg, /<\/svg>$/, `${where}: truncated svg`);

    // Same promise as the rail layout: a listed net must carry a mark.
    for (const net of scene.nets) {
      assert.ok(scene.shapes.some((s) => s.net === net), `${where}: ${net} listed but never drawn`);
    }
    assert.ok(!scene.nets.includes('0'), `${where}: ground was given a net`);
  }
});

test('ELK draws every component the parser accepted', async () => {
  for (const seed of Array.from({ length: 15 }, (_, i) => i * 104729 + 5)) {
    const deck = deckFor(seed);
    const parsed = parseSpice(deck);
    const svg = sceneToSvg(await layoutWithElk(parsed));
    for (const c of parsed.components) {
      assert.ok(svg.includes(c.refdes), `seed ${seed}: ${c.refdes} (${c.type}) parsed but never drawn`);
    }
  }
});

test('ELK wires carry their net, so highlighting works there too', async () => {
  // Untagged, highlightNet and onNetHover silently do nothing in this layout
  // while working in the other — the Scene contract says a mark carries the
  // net it belongs to.
  const scene = await layoutWithElk(parseSpice('V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k'));
  assert.ok(scene.shapes.filter((s) => s.net).length > 0, 'no shape carries a net');
  assert.ok(sceneToSvg(scene, { highlightNet: 'out' }).includes('#2f5da8'), 'highlight had no effect');
  assert.ok(!sceneToSvg(scene).includes('#2f5da8'), 'accent colour appears without a highlight');
});
