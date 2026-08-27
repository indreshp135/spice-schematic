/**
 * Property-based checks over generated netlists.
 *
 * Fixed examples only exercise the shapes someone thought to write down.
 * These decks are generated from the element table itself, with a seeded
 * generator so a failure is reproducible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpice, layout, renderToSvgString, ELEMENTS, toYosysJson } from '../dist/index.js';

/** Deterministic PRNG — a failing seed can be replayed exactly. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A representative card for each letter, with nets drawn from a small pool. */
function card(letter, i, pick) {
  const n = () => pick();
  switch (letter) {
    case 'K': return `K${i} L${i}a L${i}b 0.9`;
    case 'F': case 'H': return `${letter}${i} ${n()} ${n()} VS 2`;
    case 'W': return `W${i} ${n()} ${n()} VS swmod`;
    case 'E': case 'G': return `${letter}${i} ${n()} ${n()} ${n()} ${n()} 10`;
    case 'S': return `S${i} ${n()} ${n()} ${n()} ${n()} swmod`;
    case 'Q': case 'J': case 'Z': return `${letter}${i} ${n()} ${n()} ${n()} mod${i}`;
    case 'M': return `M${i} ${n()} ${n()} ${n()} ${n()} NMOS`;
    case 'T': case 'O': case 'Y': return `${letter}${i} ${n()} ${n()} ${n()} ${n()} mod${i}`;
    case 'U': return `U${i} ${n()} ${n()} ${n()} urc L=1m`;
    case 'P': return `P${i} ${n()} ${n()} ${n()} ${n()} ${n()} ${n()} cpl`;
    case 'X': case 'A': case 'N': return `${letter}${i} ${n()} ${n()} ${n()} mod${i}`;
    case 'B': return `B${i} ${n()} ${n()} V=V(x)*2`;
    case 'V': case 'I': return `${letter}${i} ${n()} ${n()} DC 5`;
    default: return `${letter}${i} ${n()} ${n()} 1k`;
  }
}

const LETTERS = Object.keys(ELEMENTS);

function deckFor(seed) {
  const r = rng(seed);
  const poolSize = 2 + Math.floor(r() * 8);
  const pool = ['0', ...Array.from({ length: poolSize }, (_, i) => `n${i}`)];
  const pick = () => pool[Math.floor(r() * pool.length)];
  const count = 1 + Math.floor(r() * 14);
  const lines = ['* generated', 'VS vsn 0 DC 5'];
  for (let i = 0; i < count; i++) {
    lines.push(card(LETTERS[Math.floor(r() * LETTERS.length)], i, pick));
  }
  return lines.join('\n');
}

const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 13);

test('generated decks parse, lay out and render without breaking', () => {
  for (const seed of SEEDS) {
    const deck = deckFor(seed);
    const parsed = parseSpice(deck);
    const scene = layout(parsed);
    const svg = renderToSvgString(deck);
    const where = `seed ${seed}`;

    assert.ok(Number.isFinite(scene.width) && scene.width > 0, `${where}: bad width`);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0, `${where}: bad height`);
    assert.ok(!/NaN|Infinity/.test(svg), `${where}: non-finite geometry`);
    assert.match(svg, /<\/svg>$/, `${where}: truncated svg`);
  }
});

test('a card the parser accepted is never silently undrawn', () => {
  for (const seed of SEEDS) {
    const deck = deckFor(seed);
    const parsed = parseSpice(deck);
    const svg = renderToSvgString(deck);
    for (const c of parsed.components) {
      // A part with both terminals on one net is legitimately not drawable.
      const live = new Set(c.nodes);
      if (c.nodes.length === 2 && live.size === 1) continue;
      assert.ok(svg.includes(c.refdes), `seed ${seed}: ${c.refdes} (${c.type}) parsed but never drawn`);
    }
  }
});

test('every net Scene.nets lists carries at least one mark', () => {
  for (const seed of SEEDS) {
    const scene = layout(parseSpice(deckFor(seed)));
    for (const net of scene.nets) {
      assert.ok(scene.shapes.some((s) => s.net === net), `seed ${seed}: ${net} listed but never drawn`);
    }
  }
});

test('two nets never share a column at overlapping rows', () => {
  for (const seed of SEEDS) {
    const scene = layout(parseSpice(deckFor(seed)));
    const rails = scene.shapes
      .filter((s) => s.kind === 'path' && s.net && /^M (\S+) (\S+) L \1 (\S+)$/.test(s.d))
      .map((s) => {
        const [, x, y0, y1] = s.d.match(/^M (\S+) (\S+) L \S+ (\S+)$/);
        return { net: s.net, x: +x, y0: +y0, y1: +y1 };
      });
    for (let i = 0; i < rails.length; i++) {
      for (let j = i + 1; j < rails.length; j++) {
        const a = rails[i];
        const b = rails[j];
        if (a.net === b.net || a.x !== b.x) continue;
        assert.ok(a.y1 < b.y0 || b.y1 < a.y0, `seed ${seed}: ${a.net}/${b.net} overlap on column ${a.x}`);
      }
    }
  }
});

test('ground never claims a rail', () => {
  for (const seed of SEEDS) {
    const scene = layout(parseSpice(deckFor(seed)));
    assert.ok(!scene.nets.includes('0'), `seed ${seed}: ground was given a rail`);
  }
});

test('no mark strays outside the declared viewBox', () => {
  const slack = 30; // ground stacks and labels legitimately sit near the edge
  for (const seed of SEEDS) {
    const scene = layout(parseSpice(deckFor(seed)));
    for (const s of scene.shapes) {
      if (s.kind !== 'path') continue;
      const t = s.d.trim().split(/[\s,]+/);
      let cmd = '';
      for (let i = 0; i < t.length; i++) {
        if (/^[A-Za-z]$/.test(t[i])) { cmd = t[i]; continue; }
        if (cmd !== 'M' && cmd !== 'L') continue;
        const x = Number(t[i]);
        const y = Number(t[i + 1]);
        i++;
        assert.ok(x >= -slack && x <= scene.width + slack, `seed ${seed}: x=${x} outside 0..${scene.width}`);
        assert.ok(y >= -slack && y <= scene.height + slack, `seed ${seed}: y=${y} outside 0..${scene.height}`);
      }
    }
  }
});

test('the Yosys export never loses a component without reporting it', () => {
  for (const seed of SEEDS) {
    const deck = deckFor(seed);
    const parsed = parseSpice(deck);
    const r = toYosysJson(deck);
    const cells = r.json.modules.circuit.cells;
    const kept = new Set(Object.keys(cells).filter((k) => cells[k].type !== 'gnd'));
    const reported = new Set(r.dropped.map((d) => d.refdes));
    for (const c of parsed.components) {
      assert.ok(kept.has(c.refdes) || reported.has(c.refdes), `seed ${seed}: ${c.refdes} vanished unreported`);
    }
  }
});

test('parsing is idempotent — re-parsing the same deck gives the same result', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const deck = deckFor(seed);
    assert.deepEqual(parseSpice(deck), parseSpice(deck), `seed ${seed}`);
    assert.equal(renderToSvgString(deck), renderToSvgString(deck), `seed ${seed}: rendering is not deterministic`);
  }
});
