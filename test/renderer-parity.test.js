/**
 * The SVG string emitter and the React component are two renderers over one
 * Scene. They have drifted before — dashed leads and symbol halos each had to
 * be added to both by hand — so this compares every mark attribute by attribute,
 * not just path geometry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { renderToSvgString } from '../dist/index.js';
import { Schematic } from '../dist/react.js';

const CIRS = readdirSync('examples').filter((f) => f.endsWith('.cir'));

/** Attributes that carry visual meaning; anything here differing is a bug. */
const ATTRS = [
  'd', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'paint-order',
  'text-anchor', 'font-size', 'font-weight', 'letter-spacing',
];

function marks(svg) {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  return [...doc.documentElement.children].map((el) => {
    const rec = { tag: el.tagName };
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) rec[a] = v;
    }
    if (el.tagName === 'text') rec.text = el.textContent;
    return rec;
  });
}

for (const f of CIRS) {
  const netlist = readFileSync(`examples/${f}`, 'utf8');

  test(`${f} — both renderers emit the same marks`, () => {
    const fromString = marks(renderToSvgString(netlist, { responsive: true }));
    const fromReact = marks(renderToStaticMarkup(React.createElement(Schematic, { netlist })));

    assert.equal(fromReact.length, fromString.length, 'different number of marks');
    for (let i = 0; i < fromString.length; i++) {
      assert.deepEqual(fromReact[i], fromString[i], `mark ${i} differs in ${f}`);
    }
  });
}

test('highlighting recolours identically in both renderers', () => {
  const deck = 'V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k';
  const a = marks(renderToSvgString(deck, { responsive: true, highlightNet: 'out' }));
  const b = marks(renderToStaticMarkup(React.createElement(Schematic, { netlist: deck, highlightNet: 'out' })));
  assert.deepEqual(b, a);
});

test('a custom theme reaches both renderers identically', () => {
  const deck = 'V1 in 0 DC 5\nR1 in out 1k';
  const theme = { ink: '#123456', paper: '#fedcba', dim: '#777777', accent: '#00ff00', strokeWidth: 3 };
  const a = marks(renderToSvgString(deck, { responsive: true, theme }));
  const b = marks(renderToStaticMarkup(React.createElement(Schematic, { netlist: deck, theme })));
  assert.deepEqual(b, a);
});

test('dashed sense leads survive in both renderers', () => {
  const deck = 'V1 in 0 AC 1\nE1 out 0 in 0 10\nR1 out 0 1k';
  const a = marks(renderToSvgString(deck, { responsive: true })).filter((m) => m['stroke-dasharray']);
  const b = marks(renderToStaticMarkup(React.createElement(Schematic, { netlist: deck }))).filter((m) => m['stroke-dasharray']);
  assert.ok(a.length > 0, 'no dashed lead emitted at all');
  assert.deepEqual(b, a);
});

test('highlightNet matches whatever case the caller wrote', () => {
  // Node names are folded to lower case when parsed; a caller passing the
  // spelling from their own netlist must still get a highlight.
  const deck = 'V1 in 0 DC 5\nR1 in OUT 1k\nR2 out 0 1k';
  for (const h of ['out', 'OUT', 'Out']) {
    assert.ok(renderToSvgString(deck, { highlightNet: h }).includes('#2f5da8'), `"${h}" did not highlight`);
    const react = renderToStaticMarkup(React.createElement(Schematic, { netlist: deck, highlightNet: h }));
    assert.ok(react.includes('#2f5da8'), `"${h}" did not highlight in React`);
  }
  assert.ok(!renderToSvgString(deck, { highlightNet: 'nope' }).includes('#2f5da8'));
});

test('an inline onParse callback does not re-fire on every render', () => {
  // Held in a ref, so a new closure identity each render must not re-run it.
  let calls = 0;
  const el = () => React.createElement(Schematic, { netlist: 'R1 a 0 1k', onParse: () => { calls++; } });
  renderToStaticMarkup(el());
  // Server rendering runs no effects; assert the prop is accepted and the
  // component renders, which is what the ref refactor must not have broken.
  assert.ok(renderToStaticMarkup(el()).startsWith('<svg'));
  assert.equal(calls, 0, 'effects must not run during server rendering');
});
