/**
 * Malformed input must degrade, never crash and never emit broken geometry.
 * A netlist is often pasted half-finished, so this is the normal case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpice, layout, renderToSvgString, toYosysJson } from '../dist/index.js';

const TAB = String.fromCharCode(9);

const HOSTILE = [
  '',
  '   ',
  '\n\n\n',
  TAB + TAB,
  '*',
  '**',
  '.end',
  '.ends',
  '.endc',
  '.subckt',                        // opened, never closed
  '.subckt S a b\nR1 a b 1k',       // body runs to EOF
  '.control\nplot v(x)',            // block never closed
  '+ 1k',                           // continuation with nothing to continue
  '+',
  ';',
  '; only a comment',
  '$ only a comment',
  'R1 a b 1k ;',
  'R1 ;',
  'R1 a a 1k',                      // both terminals on one net
  'R1 0 0 1k',                      // both terminals on ground
  'Q1 x x x NPN',                   // every terminal on one net
  'X1 a a a a a sub',
  'R1 a b 1k\nR1 a b 1k',           // duplicate refdes
  'RRRRRRRRRRRRRRRRRRRR a b 1k',
  'R1 ' + 'x'.repeat(500) + ' b 1k',
  'R1 a b ' + '9'.repeat(400),
  'R1 é ü 1k',            // non-ascii net names
  'R1 <a> <b> 1k',                  // characters that must be escaped
  'R1 a&b c 1k',
  ' R1 a b 1k',
  'zzz zzz zzz',
  '!!! ??? ###',
  'V1 in 0 SIN(0 1 1k',             // unbalanced paren
  'B1 o 0 V={',                     // unbalanced brace
  Array.from({ length: 300 }, (_, i) => `R${i} n${i} n${i + 1} 1k`).join('\n'),
  Array.from({ length: 60 }, () => '.subckt S a b').join('\n'),
];

for (const [i, deck] of HOSTILE.entries()) {
  const label = JSON.stringify(deck.length > 40 ? deck.slice(0, 37) + '...' : deck);

  test(`#${i} parses without throwing - ${label}`, () => {
    assert.doesNotThrow(() => parseSpice(deck));
    const r = parseSpice(deck);
    assert.ok(Array.isArray(r.components) && Array.isArray(r.nets) && Array.isArray(r.skipped));
    // Every component must carry the fields the renderers rely on.
    for (const c of r.components) {
      assert.ok(typeof c.refdes === 'string' && c.refdes.length > 0);
      assert.ok(Array.isArray(c.nodes));
      assert.ok(typeof c.value === 'string');
      assert.ok(c.nodes.every((n) => typeof n === 'string' && n.length > 0), 'empty node name');
    }
  });

  test(`#${i} lays out and renders cleanly - ${label}`, () => {
    const scene = layout(parseSpice(deck));
    assert.ok(Number.isFinite(scene.width) && scene.width > 0, `bad width ${scene.width}`);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0, `bad height ${scene.height}`);
    const svg = renderToSvgString(deck);
    assert.ok(!/NaN|Infinity/.test(svg), 'non-finite geometry');
    assert.match(svg, /^<svg /);
    assert.match(svg, /<\/svg>$/);
    // Anything that would break the XML must have been escaped.
    for (const t of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
      assert.ok(!/[<>]/.test(t[1]), `unescaped markup in text: ${t[1]}`);
    }
  });

  test(`#${i} converts to Yosys JSON without throwing - ${label}`, () => {
    assert.doesNotThrow(() => toYosysJson(deck));
    const { json } = toYosysJson(deck);
    assert.ok(json.modules.circuit, 'module missing');
  });
}

test('deeply nested subcircuit blocks unwind correctly', () => {
  const deck = ['.subckt A a b', '.subckt B c d', 'R9 c d 1', '.ends', 'R8 a b 1', '.ends', 'R1 x 0 1k'].join('\n');
  assert.deepEqual(parseSpice(deck).components.map((c) => c.refdes), ['R1']);
});

test('an unclosed subcircuit swallows the rest rather than inventing nets', () => {
  const r = parseSpice('.subckt S a b\nR9 a b 1k\nR8 b c 2k');
  assert.equal(r.components.length, 0);
  assert.equal(r.nets.length, 0);
});

test('a part with both terminals on one net draws nothing but does not break', () => {
  const scene = layout(parseSpice('V1 a 0 DC 5\nR1 a a 1k\nR2 a 0 1k'));
  assert.ok(Number.isFinite(scene.width) && Number.isFinite(scene.height));
  assert.ok(!/NaN/.test(renderToSvgString('R1 a a 1k')));
});
