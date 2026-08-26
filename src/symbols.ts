/**
 * Symbol geometry, independent of placement.
 *
 * Every function here draws about a given centre and reports where its
 * terminals landed, so any layout engine can position devices without knowing
 * how they are drawn. Both the built-in rail layout and the ELK layout draw
 * from this one source, or the two would drift apart.
 */
import { ELEMENTS } from './elements.js';
import type { Shape, SpiceComponent } from './types.js';

export interface Point {
  x: number;
  y: number;
}

/** Half-width and outline of a horizontal part, authored about the origin. */
export function horizontalBody(type: string, flip: boolean): { half: number; paths: string[]; solid?: string } {
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

/** The ground stack, with its connection point at (x, y). */
export function groundShapes(x: number, y: number, net: string): Shape[] {
  return [
    { kind: 'path', d: `M ${x} ${y} L ${x} ${y + 11}`, net },
    { kind: 'path', d: `M ${x - 10} ${y + 11} L ${x + 10} ${y + 11}`, net },
    { kind: 'path', d: `M ${x - 6} ${y + 15} L ${x + 6} ${y + 15}`, net },
    { kind: 'path', d: `M ${x - 2.5} ${y + 19} L ${x + 2.5} ${y + 19}`, net },
  ];
}

/** An independent source: a circle with polarity marks or a current arrow. */
export function sourceShapes(type: string, cx: number, cy: number, flip: boolean): { shapes: Shape[]; half: number } {
  const r = 17;
  const px = flip ? cx + 8 : cx - 8;
  const mx = flip ? cx - 8 : cx + 8;
  const shapes: Shape[] = [{ kind: 'circle', cx, cy, r }];
  if (type === 'V') {
    shapes.push(
      { kind: 'path', d: `M ${px - 4} ${cy} L ${px + 4} ${cy} M ${px} ${cy - 4} L ${px} ${cy + 4}` },
      { kind: 'path', d: `M ${mx - 4} ${cy} L ${mx + 4} ${cy}` },
    );
  } else {
    shapes.push(
      { kind: 'path', d: `M ${mx + (flip ? 3 : -3)} ${cy} L ${px} ${cy}` },
      { kind: 'path', d: `M ${px} ${cy} l ${flip ? 6 : -6} -4 l 0 8 Z`, filled: true },
    );
  }
  return { shapes, half: r };
}

/** Terminal offsets of a vertical transistor, relative to its centre. */
export const TRANSISTOR_PORTS = {
  drain: { x: 10, y: -32 },
  gate: { x: -24, y: 0 },
  source: { x: 10, y: 32 },
} as const;

/** The transistor body. Drain and source leads stop at TRANSISTOR_PORTS. */
export function transistorShapes(c: SpiceComponent, cx: number, cy: number): Shape[] {
  const isMos = c.type !== 'Q';
  const isP = /pmos|pnp|pch/i.test(c.value);
  const plate = isMos ? -10 : -7; // gate plate
  const chan = isMos ? -2 : -7; // channel / base bar

  const shapes: Shape[] = [
    { kind: 'path', d: `M ${cx - 24} ${cy} L ${cx + plate} ${cy}` },
    { kind: 'path', d: `M ${cx + plate} ${cy - 15} L ${cx + plate} ${cy + 15}` },
  ];
  if (isMos) shapes.push({ kind: 'path', d: `M ${cx + chan} ${cy - 15} L ${cx + chan} ${cy + 15}` });
  shapes.push(
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
  return shapes;
}

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
