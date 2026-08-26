import ELK from 'elkjs/lib/elk.bundled.js';
import { ELEMENTS } from './elements.js';
import { isGround } from './parse.js';
import {
  groundShapes,
  horizontalBody,
  sourceShapes,
  transistorShapes,
  truncate,
} from './symbols.js';
import type { ParseResult, Scene, Shape, SpiceComponent } from './types.js';

/**
 * Layout backed by ELK's layered graph algorithm.
 *
 * The built-in rail layout is deterministic and synchronous but arranges
 * everything on a grid. ELK does real graph layout, which reads closer to a
 * drawn schematic — at the cost of being asynchronous, non-deterministic
 * across versions, and needing a direction for edges that analog circuits do
 * not actually have.
 *
 * Symbols come from ./symbols.js, the same source the rail layout draws from.
 */

interface ElkPort { id: string; x?: number; y?: number; width: number; height: number; layoutOptions?: Record<string, string> }
interface ElkNode {
  id: string; width: number; height: number; x?: number; y?: number;
  ports?: ElkPort[]; layoutOptions?: Record<string, string>;
  children?: ElkNode[]; edges?: ElkEdge[];
}
interface ElkPoint { x: number; y: number }
interface ElkEdge {
  id: string; sources: string[]; targets: string[];
  sections?: { startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }[];
}

export interface ElkLayoutOptions {
  /**
   * ELK algorithm. `layered` orders along a direction, which analog circuits
   * do not have; `force` and `stress` ignore direction entirely.
   */
  algorithm?: 'layered' | 'force' | 'stress' | 'mrtree' | 'radial';
  /** Gap between adjacent nodes. */
  spacing?: number;
  /** Gap between layers of the layered algorithm. */
  layerSpacing?: number;
  direction?: 'RIGHT' | 'DOWN';
}

/** Node box and symbol placement for each component class. */
interface Box {
  w: number;
  h: number;
  /** Symbol centre within the box. */
  cx: number;
  cy: number;
  /** Port id, its position on the box, and which node index it carries. */
  ports: { id: string; x: number; y: number; side: 'WEST' | 'EAST' | 'NORTH' | 'SOUTH'; node: number }[];
}

function boxOf(c: SpiceComponent): Box {
  const kind = ELEMENTS[c.type].symbol;

  if (kind === 'transistor') {
    // Sized so the symbol's own terminals land exactly on the box edges:
    // the gate lead ends at cx-24, drain and source at cx+10, cy±32.
    return {
      w: 44, h: 64, cx: 24, cy: 32,
      ports: [
        { id: 'd', x: 34, y: 0, side: 'NORTH', node: 0 },
        { id: 'g', x: 0, y: 32, side: 'WEST', node: 1 },
        { id: 's', x: 34, y: 64, side: 'SOUTH', node: 2 },
      ],
    };
  }

  if (kind === 'block') {
    const h = Math.max(40, c.nodes.length * 22 + 14);
    return {
      w: 72, h, cx: 36, cy: h / 2,
      ports: c.nodes.map((_, i) => ({
        id: `p${i}`,
        x: 0,
        y: c.nodes.length === 1 ? h / 2 : 14 + i * ((h - 24) / Math.max(1, c.nodes.length - 1)),
        side: 'WEST' as const,
        node: i,
      })),
    };
  }

  // Everything else is a horizontal two-terminal part.
  const w = 96;
  return {
    w, h: 44, cx: w / 2, cy: 22,
    ports: [
      { id: 'a', x: 0, y: 22, side: 'WEST', node: 0 },
      { id: 'b', x: w, y: 22, side: 'EAST', node: 1 },
    ],
  };
}

/** Draw one component's symbol and labels at the position ELK gave it. */
function drawComponent(c: SpiceComponent, box: Box, x: number, y: number): { symbols: Shape[]; labels: Shape[] } {
  const kind = ELEMENTS[c.type].symbol;
  const cx = x + box.cx;
  const cy = y + box.cy;
  const symbols: Shape[] = [];
  const labels: Shape[] = [];

  if (kind === 'transistor') {
    symbols.push(...transistorShapes(c, cx, cy));
    labels.push({ kind: 'text', x: cx + 22, y: cy - 4, text: c.refdes, anchor: 'start', size: 12, bold: true });
    if (c.value) labels.push({ kind: 'text', x: cx + 22, y: cy + 10, text: truncate(c.value, 14), anchor: 'start', size: 11, dim: true });
    return { symbols, labels };
  }

  if (kind === 'block') {
    symbols.push({ kind: 'rect', x, y, w: box.w, h: box.h });
    labels.push({ kind: 'text', x: cx, y: cy + 4, text: truncate(c.value, 9), anchor: 'middle', size: 11, dim: true });
    labels.push({ kind: 'text', x: cx, y: y - 8, text: c.refdes, anchor: 'middle', size: 12, bold: true });
    return { symbols, labels };
  }

  const isSource = kind === 'source';
  if (isSource) {
    const src = sourceShapes(c.type, cx, cy, false);
    symbols.push(...src.shapes);
    symbols.push({ kind: 'path', d: `M ${x} ${cy} L ${cx - src.half} ${cy}` });
    symbols.push({ kind: 'path', d: `M ${cx + src.half} ${cy} L ${x + box.w} ${cy}` });
  } else {
    const body = horizontalBody(c.type, false);
    if (body.solid) symbols.push({ kind: 'path', d: shift(body.solid, cx, cy), filled: true });
    for (const d of body.paths) symbols.push({ kind: 'path', d: shift(d, cx, cy) });
    symbols.push({ kind: 'path', d: `M ${x} ${cy} L ${cx - body.half} ${cy}` });
    symbols.push({ kind: 'path', d: `M ${cx + body.half} ${cy} L ${x + box.w} ${cy}` });
  }

  labels.push({ kind: 'text', x: cx, y: cy - (isSource ? 26 : 18), text: c.refdes, anchor: 'middle', size: 12, bold: true });
  const caption = c.refs?.length ? `${c.refs[0]}` : c.value;
  if (caption) labels.push({ kind: 'text', x: cx, y: cy + (isSource ? 34 : 28), text: truncate(caption, 20), anchor: 'middle', size: 11, dim: true });
  return { symbols, labels };
}

/** Move an origin-authored path to an absolute position. */
function shift(d: string, dx: number, dy: number): string {
  const t = d.split(/\s+/);
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) { cmd = t[i]; out.push(t[i]); i++; continue; }
    if (cmd === 'M' || cmd === 'L') {
      out.push(String(Math.round((Number(t[i]) + dx) * 100) / 100), String(Math.round((Number(t[i + 1]) + dy) * 100) / 100));
      i += 2;
      continue;
    }
    out.push(t[i]);
    i++;
  }
  return out.join(' ');
}

const PAD = 40;

export async function layoutWithElk(parsed: ParseResult, options: ElkLayoutOptions = {}): Promise<Scene> {
  const elk = new (ELK as unknown as new () => { layout(g: ElkNode): Promise<ElkNode> })();

  const drawable = parsed.components.filter((c) => ELEMENTS[c.type].symbol !== 'coupling');
  const boxes = new Map<string, Box>();
  const children: ElkNode[] = [];
  const edges: ElkEdge[] = [];

  // Pins per net, so a net with more than two can be given a junction.
  const pins = new Map<string, string[]>();
  const addPin = (net: string, ref: string) => {
    const list = pins.get(net);
    if (list) list.push(ref); else pins.set(net, [ref]);
  };

  let groundCount = 0;
  const groundNodes: string[] = [];

  drawable.forEach((c) => {
    const box = boxOf(c);
    boxes.set(c.refdes, box);
    children.push({
      id: c.refdes,
      width: box.w,
      height: box.h,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: box.ports.map((p) => ({
        id: `${c.refdes}.${p.id}`,
        x: p.x,
        y: p.y,
        width: 1,
        height: 1,
        layoutOptions: { 'elk.port.side': p.side },
      })),
    });

    box.ports.forEach((p) => {
      const net = c.nodes[p.node];
      if (net === undefined) return;
      if (isGround(net)) {
        // Ground is not a net to be routed across the sheet; every ground pin
        // gets its own symbol, exactly as the rail layout does.
        const gid = `gnd${groundCount++}`;
        groundNodes.push(gid);
        children.push({
          id: gid, width: 22, height: 26,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: [{ id: `${gid}.a`, x: 11, y: 0, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'NORTH' } }],
        });
        edges.push({ id: `e_${gid}`, sources: [`${c.refdes}.${p.id}`], targets: [`${gid}.a`] });
      } else {
        addPin(net, `${c.refdes}.${p.id}`);
      }
    });

    // Sense nodes ride along as ordinary connections on the same box.
    (c.senseNodes ?? []).forEach((net, i) => {
      if (!isGround(net)) addPin(net, `${c.refdes}.${box.ports[Math.min(i, box.ports.length - 1)].id}`);
    });
  });

  const junctions: string[] = [];
  let edgeId = 0;
  for (const [net, refs] of pins) {
    if (refs.length < 2) continue;
    if (refs.length === 2) {
      edges.push({ id: `e${edgeId++}`, sources: [refs[0]], targets: [refs[1]] });
    } else {
      // ELK routes edges, not hyperedges, so a shared net becomes a junction
      // node with a spoke to each pin.
      const jid = `j_${net}`;
      junctions.push(jid);
      children.push({ id: jid, width: 6, height: 6 });
      for (const r of refs) edges.push({ id: `e${edgeId++}`, sources: [r], targets: [jid] });
    }
  }

  const graph: ElkNode = {
    id: 'root',
    width: 0,
    height: 0,
    layoutOptions: {
      'elk.algorithm': options.algorithm ?? 'layered',
      'elk.direction': options.direction ?? 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(options.spacing ?? 34),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? 52),
      'elk.spacing.edgeNode': '18',
      'elk.layered.mergeEdges': 'true',
    },
    children,
    edges,
  };

  const laid = await elk.layout(graph);
  const at = new Map((laid.children ?? []).map((n) => [n.id, n]));

  const wires: Shape[] = [];
  const dots: Shape[] = [];
  const grounds: Shape[] = [];
  const symbols: Shape[] = [];
  const labels: Shape[] = [];

  for (const c of drawable) {
    const n = at.get(c.refdes);
    const box = boxes.get(c.refdes);
    if (!n || !box) continue;
    const drawn = drawComponent(c, box, (n.x ?? 0) + PAD, (n.y ?? 0) + PAD);
    symbols.push(...drawn.symbols);
    labels.push(...drawn.labels);
  }

  for (const gid of groundNodes) {
    const n = at.get(gid);
    if (n) grounds.push(...groundShapes((n.x ?? 0) + PAD + 11, (n.y ?? 0) + PAD, '0'));
  }
  for (const jid of junctions) {
    const n = at.get(jid);
    if (n) dots.push({ kind: 'circle', cx: (n.x ?? 0) + PAD + 3, cy: (n.y ?? 0) + PAD + 3, r: 3.2, filled: true, net: jid.slice(2) });
  }

  for (const e of laid.edges ?? []) {
    for (const sec of e.sections ?? []) {
      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x + PAD} ${p.y + PAD}`).join(' ');
      wires.push({ kind: 'path', d });
    }
  }

  // Coupled inductors have no nodes, so they annotate the foot of the sheet.
  const height = (laid.height ?? 0) + PAD * 2;
  let noteY = height;
  for (const c of parsed.components) {
    if (ELEMENTS[c.type].symbol !== 'coupling') continue;
    noteY += 22;
    const [a, b] = c.refs ?? [];
    labels.push({ kind: 'text', x: PAD, y: noteY, text: c.refdes, anchor: 'start', size: 12, bold: true });
    labels.push({ kind: 'text', x: PAD + 34, y: noteY, text: `${a ?? '?'} ↔ ${b ?? '?'}${c.value ? `  k=${c.value}` : ''}`, anchor: 'start', size: 11, dim: true });
  }

  if (parsed.title) {
    noteY += 34;
    labels.push({ kind: 'text', x: PAD, y: noteY, text: parsed.title.toUpperCase(), anchor: 'start', size: 12, dim: true, tracking: 0.1 });
  }

  return {
    width: (laid.width ?? 0) + PAD * 2,
    height: noteY + 24,
    title: parsed.title,
    nets: parsed.nets,
    shapes: [
      ...wires,
      ...dots,
      ...grounds,
      ...symbols.filter((s) => s.kind !== 'text').map((s) => ({ ...s, isHalo: true })),
      ...symbols,
      ...labels,
    ],
  };
}
