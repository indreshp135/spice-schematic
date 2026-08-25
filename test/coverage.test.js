import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpice, layout, renderToSvgString, ELEMENTS } from '../dist/index.js';

/**
 * One representative card per SPICE element letter. A device's type is the
 * first character of its refdes, so this list is the entire element universe —
 * if every entry here draws, the renderer covers all of SPICE.
 */
const CARDS = {
  A: 'A1 in out amp',
  B: 'B1 out 0 V=V(in)*2',
  C: 'C1 a b 100n',
  D: 'D1 a b 1N4148',
  E: 'E1 out 0 in 0 10',
  F: 'F1 out 0 Vsense 2',
  G: 'G1 out 0 in 0 1m',
  H: 'H1 out 0 Vsense 100',
  I: 'I1 a 0 DC 1m',
  J: 'J1 d g s 2N3819',
  K: 'K1 L1 L2 0.99',
  L: 'L1 a b 10m',
  M: 'M1 d g s b NMOS',
  N: 'N1 a b mynum',
  O: 'O1 a 0 b 0 lossyline',
  P: 'P1 in1 in2 0 out1 out2 0 cplmod',
  Q: 'Q1 c b e 2N3904',
  R: 'R1 a b 1k',
  S: 'S1 out 0 ctrl 0 swmod',
  T: 'T1 a 0 b 0 Z0=50 TD=1n',
  U: 'U1 a b 0 urcmod L=1m',
  V: 'V1 a 0 DC 5',
  W: 'W1 out 0 Vsense swmod',
  X: 'X1 a b c opamp',
  Y: 'Y1 a 0 b 0 txlmod',
  Z: 'Z1 d g s mesmod',
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

test('the element table covers every letter A-Z', () => {
  assert.deepEqual(Object.keys(ELEMENTS).sort(), ALPHABET);
  assert.deepEqual(Object.keys(CARDS).sort(), ALPHABET);
});

test('every element has a name and a symbol to draw it with', () => {
  for (const [letter, spec] of Object.entries(ELEMENTS)) {
    assert.ok(spec.name, `${letter} has no device name`);
    assert.ok(spec.symbol, `${letter} has no symbol kind`);
    assert.ok(spec.shape, `${letter} has no card shape`);
  }
});

for (const letter of ALPHABET) {
  const card = CARDS[letter];

  test(`${letter} — ${ELEMENTS[letter].name} — parses`, () => {
    const r = parseSpice(card);
    assert.equal(r.skipped.length, 0, `skipped: ${r.skipped[0]?.reason}`);
    assert.equal(r.components.length, 1, 'expected exactly one component');
    assert.equal(r.components[0].type, letter);
    assert.equal(r.components[0].refdes, card.split(' ')[0]);
  });

  test(`${letter} — ${ELEMENTS[letter].name} — draws`, () => {
    const scene = layout(parseSpice(card));
    assert.ok(scene.shapes.length > 0, 'drew nothing at all');
    assert.ok(Number.isFinite(scene.width) && scene.width > 0);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0);
    const svg = renderToSvgString(card);
    assert.ok(!/NaN|Infinity|undefined/.test(svg), 'non-finite geometry');
    assert.ok(svg.includes(card.split(' ')[0]), 'refdes missing from the drawing');
  });
}

test('voltage-controlled devices keep their sense nodes separate from their terminals', () => {
  const e = parseSpice('E1 out 0 inp inm 10').components[0];
  assert.deepEqual(e.nodes, ['out', '0']);
  assert.deepEqual(e.senseNodes, ['inp', 'inm']);

  const s = parseSpice('S1 out 0 ctrl 0 swmod').components[0];
  assert.deepEqual(s.nodes, ['out', '0']);
  assert.deepEqual(s.senseNodes, ['ctrl', '0']);
});

test('sense nodes are drawn as dashed leads, not solid wire', () => {
  const scene = layout(parseSpice('V1 in 0 AC 1\nE1 out 0 in 0 10\nR1 out 0 1k'));
  const dashed = scene.shapes.filter((s) => s.kind === 'path' && s.dashed);
  assert.ok(dashed.length > 0, 'no dashed control lead drawn');
  assert.ok(renderToSvgString('V1 in 0 AC 1\nE1 out 0 in 0 10').includes('stroke-dasharray'));
});

test('current-controlled devices record the source they sense', () => {
  for (const [card, type] of [['F1 out 0 Vs 2', 'F'], ['H1 out 0 Vs 100', 'H'], ['W1 out 0 Vs swmod', 'W']]) {
    const c = parseSpice(card).components[0];
    assert.equal(c.type, type);
    assert.deepEqual(c.refs, ['Vs']);
    assert.deepEqual(c.nodes, ['out', '0']);
  }
});

test('controlled sources accept the expression forms too', () => {
  const e = parseSpice('E1 out 0 VALUE={V(a)*V(b)}').components[0];
  assert.deepEqual(e.nodes, ['out', '0']);
  assert.equal(e.senseNodes, undefined, 'VALUE form has no sense nodes');

  const g = parseSpice('G1 out 0 TABLE {V(in)} = (0 0) (1 1)').components[0];
  assert.deepEqual(g.nodes, ['out', '0']);
});

test('coupled inductors carry no nodes, only the pair they link', () => {
  const k = parseSpice('K1 L1 L2 0.99').components[0];
  assert.deepEqual(k.nodes, []);
  assert.deepEqual(k.refs, ['L1', 'L2']);
  assert.equal(k.value, '0.99');
  assert.equal(parseSpice('K1 L1 L2 0.99').nets.length, 0, 'coupling must not invent nets');
});

test('a deck using all 26 letters at once renders as one sheet', () => {
  const deck = ['* every element', ...ALPHABET.map((l) => CARDS[l])].join('\n');
  const r = parseSpice(deck);
  assert.equal(r.skipped.length, 0, `skipped: ${JSON.stringify(r.skipped)}`);
  assert.equal(r.components.length, 26);
  const svg = renderToSvgString(deck);
  assert.ok(!/NaN/.test(svg));
  for (const l of ALPHABET) assert.ok(svg.includes(`${l}1`), `${l}1 missing from the sheet`);
});
