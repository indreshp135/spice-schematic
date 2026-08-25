/**
 * Mounts the actual demo app in jsdom and drives it.
 *
 * This exists because a previous version shipped a UI that could never render:
 * `empty` was derived from state that only the schematic set, and the schematic
 * only mounted when `!empty`. Every string was present in the bundle and every
 * unit test passed. Only clicking it would have caught it — so this clicks it.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

let App;
let React;
let createRoot;
let act;

before(async () => {
  // Written to a real file inside the project so that the bare `react` import
  // resolves against node_modules; a data: URL cannot resolve bare specifiers.
  await esbuild.build({
    entryPoints: ['example/src/App.tsx'],
    bundle: true,
    format: 'esm',
    outfile: 'test/.app.bundle.mjs',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    alias: {
      'spice-schematic/react': new URL('../dist/react.js', import.meta.url).pathname,
      'spice-schematic': new URL('../dist/index.js', import.meta.url).pathname,
    },
    loader: { '.css': 'empty' },
  });

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  // `navigator` is a getter-only global on modern Node, so it needs defining
  // rather than assigning.
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event']) {
    Object.defineProperty(global, key, {
      value: key === 'window' ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  act = React.act ?? (await import('react-dom/test-utils')).act;

  ({ App } = await import('./.app.bundle.mjs'));
});

function mount() {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const root = createRoot(host);
  act(() => root.render(React.createElement(App)));
  return host;
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

test('starts on the placeholder with no schematic', () => {
  const host = mount();
  assert.match(host.textContent, /Pick an example/);
  assert.equal(host.querySelector('svg'), null);
});

test('lists every example with its part count and element letters', () => {
  const host = mount();
  const cards = [...host.querySelectorAll('button.example')];
  assert.ok(cards.length >= 9, `expected the full example set, got ${cards.length}`);
  for (const c of cards) {
    assert.ok(c.querySelector('.name').textContent.trim(), 'example has no name');
    assert.match(c.querySelector('.meta').textContent, /\d+ parts/);
  }
});

test('clicking an example draws its schematic', () => {
  const host = mount();
  const first = host.querySelector('button.example');
  const name = first.querySelector('.name').textContent;

  click(first);

  const svg = host.querySelector('svg');
  assert.ok(svg, `clicking "${name}" rendered no <svg> at all`);
  assert.ok(
    svg.querySelectorAll('path').length > 5,
    `"${name}" drew only ${svg.querySelectorAll('path').length} paths`,
  );
  assert.doesNotMatch(host.textContent, /Pick an example/, 'placeholder still showing');
  assert.ok(first.className.includes('active'), 'clicked example not marked active');
});

test('every example draws when clicked', () => {
  const host = mount();
  for (const card of [...host.querySelectorAll('button.example')]) {
    const name = card.querySelector('.name').textContent;
    click(card);
    const svg = host.querySelector('svg');
    assert.ok(svg, `"${name}" rendered no svg`);
    assert.ok(svg.querySelectorAll('path').length > 3, `"${name}" drew almost nothing`);
    assert.ok(!/NaN/.test(svg.outerHTML), `"${name}" produced NaN geometry`);
  }
});

test('typing a netlist draws it, and clearing goes back to the placeholder', () => {
  const host = mount();
  const ta = host.querySelector('textarea');

  const setValue = (v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    act(() => {
      setter.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  setValue('V1 in 0 DC 5\nR1 in out 1k\nC1 out 0 100n');
  assert.ok(host.querySelector('svg'), 'typed netlist did not draw');
  assert.match(host.textContent, /3 parts/);

  click([...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear'));
  assert.equal(host.querySelector('svg'), null);
  assert.match(host.textContent, /Pick an example/);
});

test('malformed lines are surfaced, not swallowed', () => {
  const host = mount();
  const ta = host.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  act(() => {
    setter.call(ta, 'R1 a 0 1k\n123 nonsense here');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.match(host.textContent, /1 line not drawn/);
});
