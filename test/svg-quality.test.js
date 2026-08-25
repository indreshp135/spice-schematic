/**
 * Audits the rendered SVG itself: well-formedness, valid path data, finite
 * geometry, and that every mark lands inside the declared viewBox.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToSvgString, parseSpice, layout } from '../dist/index.js';

const dir = new URL('../examples/', import.meta.url).pathname;
const CIRS = readdirSync(dir).filter((f) => f.endsWith('.cir'));
const scene = (netlist) => layout(parseSpice(netlist));

/** Parse as XML — SVG is XML, so a stray tag or unescaped & is a hard error. */
function parseXml(svg) {
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const err = dom.window.document.querySelector('parsererror');
  assert.equal(err, null, `XML parse error: ${err?.textContent}`);
  return dom.window.document;
}

/**
 * Walk an SVG path's `d` into [command, numbers] segments, validating as it
 * goes. Arc parameters are `rx ry rot large sweep dx dy` — not coordinate
 * pairs — so callers must not treat every number as an x or a y.
 */
function pathSegments(d) {
  const tokens = d.trim().split(/[\s,]+/);
  const segs = [];
  let cmd = '';
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      assert.match(t, /^[MLACZmlacz]$/, `unexpected path command "${t}" in "${d}"`);
      cmd = t;
      segs.push([cmd, []]);
      continue;
    }
    const n = Number(t);
    assert.ok(Number.isFinite(n), `non-numeric "${t}" in path "${d}"`);
    assert.ok(segs.length, `number before any command in "${d}"`);
    segs[segs.length - 1][1].push(n);
  }
  assert.ok(cmd, `path has no command: "${d}"`);
  return segs;
}

/** Absolute placement coordinates only — M and L, which is where layout lives. */
function absolutePoints(d) {
  const pts = [];
  for (const [cmd, nums] of pathSegments(d)) {
    if (cmd !== 'M' && cmd !== 'L') continue;
    assert.equal(nums.length % 2, 0, `odd coordinate count after ${cmd} in "${d}"`);
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  }
  return pts;
}

for (const f of CIRS) {
  const netlist = readFileSync(join(dir, f), 'utf8');

  test(`${f} — renders well-formed XML`, () => {
    const doc = parseXml(renderToSvgString(netlist));
    const svg = doc.documentElement;
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
    assert.match(svg.getAttribute('viewBox'), /^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
  });

  test(`${f} — every path has valid, finite data`, () => {
    const doc = parseXml(renderToSvgString(netlist));
    const paths = [...doc.querySelectorAll('path')];
    assert.ok(paths.length > 0, 'no paths at all');
    for (const p of paths) {
      const d = p.getAttribute('d');
      assert.ok(d && d.trim(), 'empty path data');
      assert.ok(pathSegments(d).length > 0, `path carries no commands: "${d}"`);
    }
  });

  test(`${f} — no mark strays outside the viewBox`, () => {
    const scene = layout(parseSpice(netlist));
    const slack = 30; // ground symbols and labels legitimately sit near the edge
    for (const s of scene.shapes) {
      const xs = [];
      const ys = [];
      if (s.kind === 'path') {
        for (const [x, y] of absolutePoints(s.d)) { xs.push(x); ys.push(y); }
      } else if (s.kind === 'circle') { xs.push(s.cx); ys.push(s.cy); }
      else if (s.kind === 'rect') { xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h); }
      else { xs.push(s.x); ys.push(s.y); }
      for (const x of xs) assert.ok(x >= -slack && x <= scene.width + slack, `x=${x} outside 0..${scene.width}`);
      for (const y of ys) assert.ok(y >= -slack && y <= scene.height + slack, `y=${y} outside 0..${scene.height}`);
    }
  });

  test(`${f} — text is escaped and non-empty`, () => {
    const doc = parseXml(renderToSvgString(netlist));
    for (const t of [...doc.querySelectorAll('text')]) {
      assert.ok(t.textContent.trim(), 'empty text element');
      assert.ok(!/[<>]/.test(t.textContent), `unescaped markup in "${t.textContent}"`);
    }
  });

  test(`${f} — the halo layer is one contiguous block`, () => {
    // Interleaving halos with symbols makes each halo erase the stroke drawn
    // just before it, which is exactly how the transistor symbols came apart.
    const at = scene(netlist).shapes.flatMap((s, i) => (s.kind !== 'text' && s.isHalo ? [i] : []));
    if (at.length === 0) return;
    assert.ok(
      at.every((v, k) => k === 0 || v === at[k - 1] + 1),
      `halo layer is split across ${at.length} shapes with symbols interleaved`,
    );
  });
}

test('the paper background covers the whole sheet', () => {
  const doc = parseXml(renderToSvgString('R1 a 0 1k'));
  const bg = doc.querySelector('rect');
  const vb = doc.documentElement.getAttribute('viewBox').split(' ').map(Number);
  assert.equal(Number(bg.getAttribute('width')), vb[2]);
  assert.equal(Number(bg.getAttribute('height')), vb[3]);
});

test('committed example SVGs match what the renderer produces now', () => {
  for (const f of CIRS) {
    const committed = readFileSync(join(dir, f.replace('.cir', '.svg')), 'utf8');
    const fresh = renderToSvgString(readFileSync(join(dir, f), 'utf8'));
    assert.equal(committed, fresh, `${f}: committed SVG is stale — run npm run examples`);
  }
});
