import { ELEMENTS } from './elements.js';
import { isGround } from './parse.js';
import type { ParseResult, Scene, Shape, SpiceComponent } from './types.js';

/** Horizontal distance between adjacent net rails. */
const COL = 128;
const MARGIN_L = 96;
const MARGIN_R = 190;
const MARGIN_T = 90;
const MARGIN_B = 76;
/** Length of the stub drawn for a part with one leg on ground. */
const STUB = 84;

/**
 * Order nets left to right by breadth-first walk from the first voltage
 * source, so supply sits left and the signal path reads across the page.
 * A netlist carries no coordinates, so this is a heuristic, not a recovery
 * of the author's intended drawing.
 */
function orderNets(components: SpiceComponent[]): string[] {
  const adj = new Map<string, Set<string>>();
  const discovered: string[] = [];

  for (const c of components) {
    const live = c.nodes.filter((n) => !isGround(n));
    for (const n of live) {
      if (!adj.has(n)) {
        adj.set(n, new Set());
        discovered.push(n);
      }
    }
    for (const a of live) for (const b of live) if (a !== b) adj.get(a)!.add(b);
  }
  if (discovered.length === 0) return [];

  const source = components.find((c) => c.type === 'V' && c.nodes.some((n) => !isGround(n)));
  const start = source ? source.nodes.find((n) => !isGround(n))! : discovered[0];

  const queue = [start];
  const seen = new Set(queue);
  const ordered: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    ordered.push(cur);
    for (const n of discovered) {
      if (!seen.has(n) && adj.get(cur)!.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  // Nets in disconnected islands never get reached by the walk.
  for (const n of discovered) if (!seen.has(n)) ordered.push(n);
  return ordered;
}

/** Symbol geometry for a horizontal part, centred on the origin. */
function horizontalBody(type: string, flip: boolean): { half: number; paths: string[]; solid?: string } {
  const kind = ELEMENTS[type as keyof typeof ELEMENTS]?.symbol;

  if (kind === 'dependent') {
    // Dependent sources take a diamond; voltage types carry polarity marks,
    // current types an arrow, following the usual SPICE drawing convention.
    const current = type === 'F' || type === 'G';
    const px = flip ? 6 : -6;
    const mx = flip ? -6 : 6;
    return {
      half: 16,
      paths: [
        'M -16 0 L 0 -13 L 16 0 L 0 13 Z',
        ...(current
          ? [`M ${mx} 0 L ${px} 0`]
          : [`M ${px - 3} 0 L ${px + 3} 0 M ${px} -3 L ${px} 3`, `M ${mx - 3} 0 L ${mx + 3} 0`]),
      ],
      solid: current ? `M ${px} 0 l ${flip ? 5 : -5} -3.5 l 0 7 Z` : undefined,
    };
  }

  if (kind === 'switch') {
    return {
      half: 16,
      paths: [
        'M -16 0 L -10 0',
        'M 10 0 L 16 0',
        'M -9 -1 L 9 -9', // the lever, drawn open
        'M -10 0 a 2.4 2.4 0 1 0 0.1 0',
        'M 9.9 0 a 2.4 2.4 0 1 0 0.1 0',
      ],
    };
  }

  switch (type) {
    case 'R':
      return { half: 24, paths: ['M -24 0 L -19 -9 L -11 9 L -3 -9 L 5 9 L 13 -9 L 19 9 L 24 0'] };
    case 'C':
      return { half: 5, paths: ['M -5 -13 L -5 13', 'M 5 -13 L 5 13'] };
    case 'L':
      return {
        half: 22,
        paths: ['M -22 0 a 5.5 5.5 0 0 1 11 0 a 5.5 5.5 0 0 1 11 0 a 5.5 5.5 0 0 1 11 0 a 5.5 5.5 0 0 1 11 0'],
      };
    default: // diode — bar on the cathode side, which flips with the part
      return {
        half: 9,
        paths: [flip ? 'M -8 -10 L -8 10' : 'M 8 -10 L 8 10'],
        solid: flip ? 'M 8 -10 L 8 10 L -8 0 Z' : 'M -8 -10 L -8 10 L 8 0 Z',
      };
  }
}

/** Row height reserved for a component. */
function rowHeight(c: SpiceComponent): number {
  const kind = ELEMENTS[c.type].symbol;
  if (kind === 'coupling') return 46;
  if (kind === 'block') return Math.max(96, 44 + c.nodes.length * 26);
  if (kind === 'transistor') return 138;
  return c.senseNodes?.length ? 132 : 88; // sense leads need room below the symbol
}

/**
 * Place components on a rail grid: one vertical rail per net, one row per
 * component. Ground is deliberately given no rail — a ground symbol at each
 * pin removes what would otherwise be the most crowded net on the sheet.
 */
export function layout(parsed: ParseResult): Scene {
  const nets = orderNets(parsed.components);
  const colX = new Map(nets.map((n, i) => [n, MARGIN_L + i * COL] as const));
  const xOf = (net: string): number => colX.get(net) ?? MARGIN_L;

  const rails: Shape[] = [];
  const wires: Shape[] = [];
  const dots: Shape[] = [];
  const grounds: Shape[] = [];
  const symbols: Shape[] = [];
  const labels: Shape[] = [];
  const pins: { net: string; x: number; y: number }[] = [];

  const wire = (d: string, net?: string) => wires.push({ kind: 'path', d, net });
  const pin = (net: string, x: number, y: number) => pins.push({ net, x, y });
  const groundSymbol = (x: number, y: number, net: string) => {
    grounds.push(
      { kind: 'path', d: `M ${x} ${y} L ${x} ${y + 11}`, net },
      { kind: 'path', d: `M ${x - 10} ${y + 11} L ${x + 10} ${y + 11}`, net },
      { kind: 'path', d: `M ${x - 6} ${y + 15} L ${x + 6} ${y + 15}`, net },
      { kind: 'path', d: `M ${x - 2.5} ${y + 19} L ${x + 2.5} ${y + 19}`, net },
    );
  };
  const refdesLabel = (x: number, y: number, text: string, anchor: 'start' | 'middle' = 'middle') =>
    labels.push({ kind: 'text', x, y, text, anchor, size: 12, bold: true });
  const valueLabel = (x: number, y: number, text: string, anchor: 'start' | 'middle' = 'middle') =>
    labels.push({ kind: 'text', x, y, text, anchor, size: 11, dim: true });

  let y = MARGIN_T;
  let maxX = MARGIN_L + Math.max(0, nets.length - 1) * COL;

  for (const c of parsed.components) {
    const kind = ELEMENTS[c.type].symbol;
    const h = rowHeight(c);
    const cy = y + h / 2;

    /* ── coupled inductors: no nodes at all, so it gets an annotation row ── */
    if (kind === 'coupling') {
      const [a, b] = c.refs ?? [];
      labels.push({ kind: 'text', x: MARGIN_L - 8, y: cy, text: c.refdes, anchor: 'start', size: 12, bold: true });
      labels.push({
        kind: 'text', x: MARGIN_L + 34, y: cy,
        text: `${a ?? '?'} \u2194 ${b ?? '?'}${c.value ? `  k=${c.value}` : ''}`,
        anchor: 'start', size: 11, dim: true,
      });
      y += h;
      continue;
    }

    /* ── two-terminal, drawn horizontally between its two rails ── */
    if (kind === 'twoTerminal' || kind === 'source' || kind === 'dependent' || kind === 'switch') {
      const [a, b] = c.nodes;
      if (isGround(a) && isGround(b)) { y += h; continue; }

      let xa: number;
      let xb: number;
      if (isGround(a) || isGround(b)) {
        const gx = xOf(isGround(a) ? b : a);
        if (isGround(a)) { xb = gx; xa = gx + STUB; } else { xa = gx; xb = gx + STUB; }
      } else {
        xa = xOf(a);
        xb = xOf(b);
        if (xa === xb) { y += h; continue; } // both legs on one net: nothing to draw
      }

      const flip = xa > xb;
      const lo = Math.min(xa, xb);
      const hi = Math.max(xa, xb);
      const cx = (lo + hi) / 2;
      const isSource = c.type === 'V' || c.type === 'I';

      if (isSource) {
        const r = 17;
        wire(`M ${lo} ${cy} L ${cx - r} ${cy}`);
        wire(`M ${cx + r} ${cy} L ${hi} ${cy}`);
        symbols.push({ kind: 'circle', cx, cy, r });
        // The first node is the + terminal, so polarity follows the flip.
        const px = flip ? cx + 8 : cx - 8;
        const mx = flip ? cx - 8 : cx + 8;
        if (c.type === 'V') {
          symbols.push(
            { kind: 'path', d: `M ${px - 4} ${cy} L ${px + 4} ${cy} M ${px} ${cy - 4} L ${px} ${cy + 4}` },
            { kind: 'path', d: `M ${mx - 4} ${cy} L ${mx + 4} ${cy}` },
          );
        } else {
          symbols.push(
            { kind: 'path', d: `M ${mx + (flip ? 3 : -3)} ${cy} L ${px} ${cy}` },
            { kind: 'path', d: `M ${px} ${cy} l ${flip ? 6 : -6} -4 l 0 8 Z`, filled: true },
          );
        }
      } else {
        const body = horizontalBody(c.type, flip);
        wire(`M ${lo} ${cy} L ${cx - body.half} ${cy}`);
        wire(`M ${cx + body.half} ${cy} L ${hi} ${cy}`);
        if (body.solid) symbols.push({ kind: 'path', d: translate(body.solid, cx, cy), filled: true });
        for (const d of body.paths) symbols.push({ kind: 'path', d: translate(d, cx, cy) });
      }

      if (isGround(a)) groundSymbol(xa, cy, a); else pin(a, xa, cy);
      if (isGround(b)) groundSymbol(xb, cy, b); else pin(b, xb, cy);
      maxX = Math.max(maxX, xa, xb);

      // Voltage-controlled devices sense a second node pair. Drawn dashed so a
      // control connection is never mistaken for a current-carrying wire.
      (c.senseNodes ?? []).forEach((net, i) => {
        const stubX = cx + (i === 0 ? -6 : 6);
        const ry = cy + 32 + i * 12;
        if (isGround(net)) {
          wires.push({ kind: 'path', d: `M ${stubX} ${cy + 14} L ${stubX} ${ry}`, dashed: true, net });
          groundSymbol(stubX, ry, net);
        } else {
          wires.push({
            kind: 'path',
            d: `M ${stubX} ${cy + 14} L ${stubX} ${ry} L ${xOf(net)} ${ry}`,
            dashed: true,
            net,
          });
          pin(net, xOf(net), ry);
          maxX = Math.max(maxX, xOf(net));
        }
      });

      refdesLabel(cx, cy - (isSource ? 26 : 18), c.refdes);
      // A current-controlled device names its controlling source; show it.
      const caption = c.refs?.length ? `${c.refs[0]}${c.value ? ` \u00d7 ${c.value}` : ''}` : c.value;
      if (caption) {
        // Sense leads occupy the space below the symbol, so the value moves
        // out to the right rather than colliding with them.
        if (c.senseNodes?.length) valueLabel(cx + 22, cy + 4, truncate(caption, 16), 'start');
        else valueLabel(cx, cy + (isSource ? 36 : 28), truncate(caption, 22));
      }
      y += h;
      continue;
    }

    /* ── three/four-terminal devices, drawn vertically ── */
    if (kind === 'transistor') {
      const [drain, gate, source] = c.nodes;
      const live = c.nodes.slice(0, 3).filter((n) => !isGround(n)).map(xOf);
      const cx = (live.length ? live.reduce((s, v) => s + v, 0) / live.length : MARGIN_L) + 34;
      const isMos = c.type !== 'Q';
      const isP = /pmos|pnp|pch/i.test(c.value);
      const plate = isMos ? -10 : -7; // gate plate
      const chan = isMos ? -2 : -7;   // channel / base bar

      symbols.push(
        { kind: 'path', d: `M ${cx - 24} ${cy} L ${cx + plate} ${cy}` },
        { kind: 'path', d: `M ${cx + plate} ${cy - 15} L ${cx + plate} ${cy + 15}` },
      );
      if (isMos) symbols.push({ kind: 'path', d: `M ${cx + chan} ${cy - 15} L ${cx + chan} ${cy + 15}` });
      symbols.push(
        { kind: 'path', d: `M ${cx + chan} ${cy + (isMos ? -11 : -6)} L ${cx + 10} ${cy - 22} L ${cx + 10} ${cy - 32}` },
        { kind: 'path', d: `M ${cx + chan} ${cy + (isMos ? 11 : 6)} L ${cx + 10} ${cy + 22} L ${cx + 10} ${cy + 32}` },
        {
          kind: 'path',
          filled: true,
          d: isP
            ? `M ${cx + chan + 2.5} ${cy + (isMos ? 8.5 : 3.5)} l 8 6 l -8.5 2 Z`
            : `M ${cx + 4.5} ${cy + 17} l -1 -8.5 l 7.5 5 Z`,
        },
      );

      // Drain above, source below; each routes out then across to its rail.
      for (const [net, dy] of [[drain, -32], [source, 32]] as const) {
        const px = cx + 10;
        const py = cy + dy;
        if (isGround(net)) {
          const end = py + (dy < 0 ? -14 : 14);
          wire(`M ${px} ${py} L ${px} ${end}`, net);
          groundSymbol(px, end, net);
        } else {
          const ry = py + (dy < 0 ? -12 : 12);
          wire(`M ${px} ${py} L ${px} ${ry} L ${xOf(net)} ${ry}`, net);
          pin(net, xOf(net), ry);
        }
      }

      const gx = cx - 24;
      if (isGround(gate)) {
        wire(`M ${gx} ${cy} L ${gx - 16} ${cy} L ${gx - 16} ${cy + 20}`, gate);
        groundSymbol(gx - 16, cy + 20, gate);
      } else if (xOf(gate) <= gx - 6) {
        wire(`M ${gx} ${cy} L ${xOf(gate)} ${cy}`, gate);
        pin(gate, xOf(gate), cy);
      } else {
        // Gate rail sits to the right of the device: drop below and come back.
        const ry = cy + 56;
        wire(`M ${gx} ${cy} L ${gx - 18} ${cy} L ${gx - 18} ${ry} L ${xOf(gate)} ${ry}`, gate);
        pin(gate, xOf(gate), ry);
      }

      maxX = Math.max(maxX, cx + 40);
      labels.push({ kind: 'text', x: cx + 22, y: cy - 4, text: c.refdes, anchor: 'start', size: 12, bold: true });
      if (c.value) valueLabel(cx + 22, cy + 10, truncate(c.value, 14), 'start');
      y += h;
      continue;
    }

    /* ── subcircuit: a labelled block with pins down the left edge ── */
    const live = c.nodes.filter((n) => !isGround(n)).map(xOf);
    const bx = (live.length ? Math.max(...live) : MARGIN_L) + 96;
    const bh = Math.max(40, c.nodes.length * 22 + 14);
    const top = cy - bh / 2;

    symbols.push({ kind: 'rect', x: bx - 28, y: top, w: 72, h: bh });
    labels.push({ kind: 'text', x: bx + 8, y: cy + 4, text: truncate(c.value, 9), anchor: 'middle', size: 11, dim: true });

    c.nodes.forEach((net, i) => {
      const py = c.nodes.length === 1 ? cy : top + 14 + i * ((bh - 24) / Math.max(1, c.nodes.length - 1));
      if (isGround(net)) {
        wire(`M ${bx - 28} ${py} L ${bx - 50} ${py} L ${bx - 50} ${py + 12}`, net);
        groundSymbol(bx - 50, py + 12, net);
      } else {
        wire(`M ${bx - 28} ${py} L ${xOf(net)} ${py}`, net);
        pin(net, xOf(net), py);
      }
    });

    maxX = Math.max(maxX, bx + 50);
    refdesLabel(bx + 8, top - 8, c.refdes);
    y += h;
  }

  /* ── rails, junction dots and net names ── */
  const byNet = new Map<string, { x: number; y: number }[]>();
  for (const p of pins) {
    const list = byNet.get(p.net);
    if (list) list.push(p); else byNet.set(p.net, [p]);
  }

  for (const [net, ps] of byNet) {
    const x = xOf(net);
    const ys = ps.map((p) => p.y);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    if (y1 > y0) rails.push({ kind: 'path', d: `M ${x} ${y0} L ${x} ${y1}`, net });
    // A dot only where a lead lands mid-rail — a true T. Endpoints are corners.
    for (const p of ps) if (p.y > y0 && p.y < y1) dots.push({ kind: 'circle', cx: x, cy: p.y, r: 3.2, filled: true, net });
    labels.push({
      kind: 'text', x, y: y0 - 18, text: net.toUpperCase(),
      anchor: 'middle', size: 11, dim: true, tracking: 0.08, net,
    });
    // A net touched by one pin is dangling; mark it so it is not mistaken for a rail.
    if (ps.length < 2) symbols.push({ kind: 'circle', cx: x, cy: y0 - 10, r: 3, net });
  }

  if (parsed.title) {
    labels.push({
      kind: 'text', x: 28, y: Math.max(y + MARGIN_B, MARGIN_T + 120) - 26,
      text: parsed.title.toUpperCase(), anchor: 'start', size: 12, dim: true, tracking: 0.1,
    });
  }

  return {
    width: maxX + MARGIN_R,
    height: Math.max(y + MARGIN_B, MARGIN_T + 120),
    title: parsed.title,
    nets,
    shapes: [...rails, ...wires, ...dots, ...grounds, ...symbols, ...labels],
  };
}

/**
 * Shift a body path, authored about the origin, to its placement.
 * Uppercase M/L take coordinate pairs that move; arc radii and lowercase
 * relative deltas must be left exactly as written.
 */
function translate(d: string, dx: number, dy: number): string {
  const tokens = d.split(/\s+/);
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) { cmd = t; out.push(t); i++; continue; }
    if (cmd === 'M' || cmd === 'L') {
      out.push(String(round(Number(tokens[i]) + dx)), String(round(Number(tokens[i + 1]) + dy)));
      i += 2;
      continue;
    }
    out.push(t);
    i++;
  }
  return out.join(' ');
}

const round = (n: number): number => Math.round(n * 100) / 100;
const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
