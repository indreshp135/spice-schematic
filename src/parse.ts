import { ELEMENTS, EXPRESSION_KEYWORDS, isElementType } from './elements.js';
import type { ComponentType, ElementSpec } from './elements.js';
import type { ParseResult, SkippedLine, SpiceComponent } from './types.js';

/** Ground aliases. These get a ground symbol instead of a rail. */
export const isGround = (net: string): boolean => net === '0' || /^gnd!?$/i.test(net);

/** A field that names a parameter or an expression, never a net. */
const isParam = (t: string): boolean => t.includes('=') || t.startsWith('{') || t.startsWith('(');

/**
 * Strip an in-line comment. ngspice ends a card at `;` or at `$` preceded by
 * whitespace; everything after is prose. Left unstripped it is split into
 * fields like any other text, which invents nets — `Q1 c b e 2N3904 ; note`
 * otherwise reads 2N3904 as the substrate terminal.
 *
 * Full-line `*` comments are handled by the caller and must not pass here,
 * since their text is the deck title.
 */
function stripInlineComment(line: string): string {
  return line.replace(/;.*$/, '').replace(/\s\$.*$/, '');
}

/**
 * Join `+` continuation lines onto the card they extend.
 * A leading `+` is SPICE's line-continuation marker, not a component.
 */
function joinContinuations(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Comments are stripped per physical line, before joining, so a comment on
    // a continuation cannot swallow the card it continues.
    const line = raw.trimStart().startsWith('*') ? raw : stripInlineComment(raw);
    if (/^\s*\+/.test(line) && out.length) {
      out[out.length - 1] += ' ' + line.replace(/^\s*\+/, '').trim();
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Fields before the first parameter assignment — i.e. nodes and a model name. */
const headFields = (fields: string[]): string[] => {
  const at = fields.findIndex(isParam);
  return at >= 0 ? fields.slice(0, at) : fields;
};

interface Split {
  nodes: string[];
  sense: string[];
  refs: string[];
  value: string;
  error?: string;
}

/** Divide an element card's fields according to its device's card shape. */
function splitCard(type: ComponentType, spec: ElementSpec, fields: string[]): Split {
  const empty = { nodes: [], sense: [], refs: [], value: '' };
  const need = (n: number): string | undefined =>
    fields.length < n ? `expected ${n} nodes, found ${fields.length}` : undefined;

  switch (spec.shape) {
    case 'value2':
      return { ...empty, error: need(2), nodes: fields.slice(0, 2), value: fields[2] ?? '' };

    case 'expr2':
      return { ...empty, error: need(2), nodes: fields.slice(0, 2), value: fields.slice(2).join(' ') };

    case 'controlled4': {
      const nodes = fields.slice(0, 2);
      const next = fields[2];
      // `E1 out 0 VALUE={...}` and friends carry an expression, not sense nodes.
      const expr = !next || EXPRESSION_KEYWORDS.test(next) || isParam(next);
      return expr
        ? { ...empty, error: need(2), nodes, value: fields.slice(2).join(' ') }
        : { ...empty, error: need(4), nodes, sense: fields.slice(2, 4), value: fields.slice(4).join(' ') };
    }

    case 'ctrl2ref':
      return {
        ...empty,
        error: need(3),
        nodes: fields.slice(0, 2),
        refs: fields.slice(2, 3),
        value: fields.slice(3).join(' '),
      };

    case 'fixed': {
      const n = spec.nodes ?? 2;
      return { ...empty, error: need(n), nodes: fields.slice(0, n), value: fields.slice(n).join(' ') };
    }

    case 'model': {
      const head = headFields(fields);
      const req = spec.nodes ?? 2;
      const max = req + (spec.optional ?? 0);
      // The last head field is the model name — unless dropping it would leave
      // too few nodes, in which case the card simply has no model.
      let n = Math.min(head.length - 1, max);
      if (n < req) n = Math.min(head.length, req);
      if (n < req) return { ...empty, error: `expected ${req} nodes, found ${n}` };
      return { ...empty, nodes: head.slice(0, n), value: head.slice(n).join(' ') };
    }

    case 'variable': {
      // XSPICE port syntax (%v, %i, %vd) marks types, not nets.
      const head = headFields(fields).filter((t) => !t.startsWith('%'));
      if (head.length < 2) return { ...empty, error: 'expected at least one node and a model name' };
      return { ...empty, nodes: head.slice(0, -1), value: head[head.length - 1] };
    }

    case 'coupling': {
      if (fields.length < 2) return { ...empty, error: 'expected two inductor names' };
      return { ...empty, refs: fields.slice(0, 2), value: fields.slice(2).join(' ') };
    }
  }
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
  let firstCard = true;

  const noteNets = (ns: string[]) => {
    for (const n of ns) {
      if (!isGround(n) && !seenNet.has(n)) {
        seenNet.add(n);
        nets.push(n);
      }
    }
  };

  /**
   * SPICE node names are case-insensitive, so `IN` and `in` are one node.
   * Folding case here is what stops them becoming two rails and drawing a
   * circuit that is not connected the way the netlist says it is.
   */
  const foldNets = (ns: string[]): string[] => ns.map((n) => n.toLowerCase());

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
    // `.end` closes the deck — anything after it is not part of the circuit.
    // Checked after `.ends`/`.endc`, which it prefixes.
    if (lower === '.end' || lower.startsWith('.end ')) break;
    if (line.startsWith('.')) continue;
    if (depth > 0) continue;

    const f = line.split(/[\s,]+/).filter(Boolean);
    const refdes = f[0];
    const type = refdes[0]?.toUpperCase() ?? '';

    if (!isElementType(type)) {
      if (firstCard && title === null) {
        title = line;
        firstCard = false;
        continue;
      }
      skipped.push({ line, reason: `"${type}" is not a SPICE element letter` });
      firstCard = false;
      continue;
    }

    const spec = ELEMENTS[type];
    const split = splitCard(type, spec, f.slice(1));
    if (split.error) {
      // By SPICE convention the first line of a deck is its title. Claiming it
      // unconditionally would eat the first component of a pasted fragment, so
      // it is only taken when the line cannot be read as an element card.
      if (firstCard && title === null) {
        title = line;
        firstCard = false;
        continue;
      }
      skipped.push({ line, reason: `${spec.name}: ${split.error}` });
      firstCard = false;
      continue;
    }
    firstCard = false;

    const nodes = foldNets(split.nodes);
    const sense = foldNets(split.sense);
    noteNets(nodes);
    noteNets(sense);
    components.push({
      refdes,
      type,
      nodes,
      ...(sense.length ? { senseNodes: sense } : {}),
      ...(split.refs.length ? { refs: split.refs } : {}),
      value: split.value,
      raw: line,
    });
  }

  return { title, components, nets, skipped };
}
