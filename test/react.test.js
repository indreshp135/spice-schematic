import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Schematic } from '../dist/react.js';
import { renderToSvgString } from '../dist/index.js';

const DECK = `* divider
V1 in 0 DC 5
R1 in out 1k
R2 out 0 1k`;

const html = (props) => renderToStaticMarkup(React.createElement(Schematic, props));

test('the component renders to markup without a DOM', () => {
  const out = html({ netlist: DECK });
  assert.match(out, /^<svg /);
  assert.match(out, /<\/svg>$/);
  assert.ok(!/NaN|undefined/.test(out));
  assert.ok(out.includes('R1') && out.includes('R2') && out.includes('V1'));
});

test('component and string renderer agree on geometry', () => {
  const fromComponent = html({ netlist: DECK });
  const fromString = renderToSvgString(DECK, { responsive: true });
  const paths = (s) => (s.match(/ d="[^"]+"/g) || []).sort();
  assert.deepEqual(paths(fromComponent), paths(fromString));
});

test('the react entry exposes the component and the hook', async () => {
  const mod = await import('../dist/react.js');
  assert.equal(typeof mod.Schematic, 'object'); // forwardRef object
  assert.equal(typeof mod.useSchematic, 'function');
});

test('highlightNet recolours through the component too', () => {
  assert.ok(html({ netlist: DECK, highlightNet: 'out' }).includes('#2f5da8'));
  assert.ok(!html({ netlist: DECK }).includes('#2f5da8'));
});

test('theme and svg passthrough props both apply', () => {
  const out = html({ netlist: DECK, theme: { paper: '#101010' }, className: 'sheet', 'aria-label': 'circuit' });
  assert.ok(out.includes('#101010'));
  assert.ok(out.includes('class="sheet"'));
  assert.ok(out.includes('aria-label="circuit"'));
});

test('an empty netlist still renders a valid svg', () => {
  const out = html({ netlist: '' });
  assert.match(out, /^<svg /);
  assert.ok(!/NaN/.test(out));
});
