/**
 * Effect behaviour needs a real DOM: server rendering never runs effects, so
 * onParse cannot be verified there.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let React, createRoot, act, Schematic;

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event']) {
    Object.defineProperty(global, k, { value: k === 'window' ? dom.window : dom.window[k], configurable: true, writable: true });
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  act = React.act ?? (await import('react-dom/test-utils')).act;
  ({ Schematic } = await import('../dist/react.js'));
});

test('onParse fires once per netlist, not once per render', () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const root = createRoot(host);
  let calls = 0;

  // A fresh inline closure every render is the common usage and the one that
  // would loop if onParse sat in the effect's dependency list.
  const render = (netlist) =>
    act(() => root.render(React.createElement(Schematic, { netlist, onParse: () => { calls++; } })));

  render('R1 a 0 1k');
  assert.equal(calls, 1, 'should fire once on mount');

  render('R1 a 0 1k');
  render('R1 a 0 1k');
  assert.equal(calls, 1, 're-rendering the same netlist must not re-fire onParse');

  render('R1 a 0 2k');
  assert.equal(calls, 2, 'a changed netlist must fire onParse again');
});

test('onParse receives the parse result, including skipped lines', () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const root = createRoot(host);
  let seen = null;
  act(() =>
    root.render(React.createElement(Schematic, { netlist: '* deck\nR1 a 0 1k\n123 junk here', onParse: (r) => { seen = r; } })),
  );
  assert.ok(seen, 'onParse never fired');
  assert.equal(seen.components.length, 1);
  assert.equal(seen.skipped.length, 1);
});

test('hovering a net reports it folded to lower case', () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const root = createRoot(host);
  const seen = [];
  act(() => root.render(React.createElement(Schematic, {
    netlist: 'V1 IN 0 DC 5\nR1 IN OUT 1k\nR2 OUT 0 1k',
    onNetHover: (n) => seen.push(n),
  })));
  const marked = host.querySelector('svg').querySelector('path[stroke]');
  act(() => marked.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  // Whatever fires, the reported name must be usable as highlightNet.
  assert.ok(seen.every((n) => n === null || n === n.toLowerCase()), `got ${JSON.stringify(seen)}`);
});
