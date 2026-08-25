import type { ComponentType, ParseResult, SkippedLine, SpiceComponent } from './types.js';

/** Ground aliases. These get a ground symbol instead of a rail. */
export const isGround = (net: string): boolean => net === '0' || /^gnd!?$/i.test(net);

/** Node count per element class, by SPICE pin order. */
const PIN_COUNT: Record<Exclude<ComponentType, 'X'>, number> = {
  R: 2, C: 2, L: 2, V: 2, I: 2, D: 2,
  Q: 3, // collector base emitter
  M: 4, // drain gate source bulk
  J: 3, // drain gate source
};

/**
 * Join `+` continuation lines onto the card they extend.
 * A leading `+` is SPICE's line-continuation marker, not a component.
 */
function joinContinuations(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\+/.test(line) && out.length) {
      out[out.length - 1] += ' ' + line.replace(/^\s*\+/, '').trim();
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Parse a SPICE netlist into components and nets.
 *
 * Bodies of `.subckt`/`.ends` and `.control`/`.endc` are skipped — their
 * contents are definitions and commands, not part of the top-level circuit,
 * and treating them as components invents nets that do not exist.
 */
export function parseSpice(text: string): ParseResult {
  const components: SpiceComponent[] = [];
  const skipped: SkippedLine[] = [];
  const nets: string[] = [];
  const seenNet = new Set<string>();
  let title: string | null = null;
  let depth = 0;

  const noteNets = (ns: string[]) => {
    for (const n of ns) {
      if (!isGround(n) && !seenNet.has(n)) {
        seenNet.add(n);
        nets.push(n);
      }
    }
  };

  for (const raw of joinContinuations(text)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('*')) {
      if (title === null) title = line.replace(/^\*+/, '').trim() || null;
      continue;
    }

    const lower = line.toLowerCase();
    if (lower.startsWith('.subckt') || lower.startsWith('.control')) {
      depth++;
      continue;
    }
    // `.ends`/`.endc` must be tested before `.end`, which they both prefix.
    if (lower.startsWith('.ends') || lower.startsWith('.endc')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (line.startsWith('.')) continue;
    if (depth > 0) continue;

    const f = line.split(/[\s,]+/).filter(Boolean);
    if (f.length < 3) {
      skipped.push({ line, reason: 'too few fields to be an element card' });
      continue;
    }

    const refdes = f[0];
    const type = refdes[0].toUpperCase() as ComponentType;

    // Subcircuit call: every field between refdes and the model name is a node.
    if (type === 'X') {
      const nodes = f.slice(1, -1);
      noteNets(nodes);
      components.push({ refdes, type: 'X', nodes, value: f[f.length - 1], raw: line });
      continue;
    }

    if (!(type in PIN_COUNT)) {
      skipped.push({ line, reason: `no symbol for element type "${type}"` });
      continue;
    }

    const want = PIN_COUNT[type as Exclude<ComponentType, 'X'>];
    // MOSFET bulk is optional; `M1 d g s model` is legal shorthand.
    const take = type === 'M' && f.length < 6 ? 3 : want;
    const nodes = f.slice(1, 1 + take);
    const need = type === 'M' ? 3 : want;
    if (nodes.length < need) {
      skipped.push({ line, reason: `expected ${need} nodes, found ${nodes.length}` });
      continue;
    }

    const rest = f.slice(1 + nodes.length);
    const value =
      'RCL'.includes(type) ? (rest[0] ?? '')
      : 'VI'.includes(type) ? rest.join(' ')
      : (rest.find((t) => !t.includes('=')) ?? '');

    noteNets(nodes);
    components.push({ refdes, type, nodes, value, raw: line });
  }

  return { title, components, nets, skipped };
}
