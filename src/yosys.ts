import { isGround, parseSpice } from './parse.js';
import type { ComponentType } from './elements.js';
import type { ParseResult } from './types.js';

/**
 * Yosys JSON emitter, targeting netlistsvg's analog skin.
 *
 * Yosys JSON is a digital netlist format, so the fit is partial by nature:
 * only the seven SPICE letters the analog skin has symbols for survive, and
 * analog pins have no direction, so one has to be invented for every port.
 * That invented direction is not cosmetic — netlistsvg lays out along it.
 */

/** A cell in a Yosys JSON module. */
export interface YosysCell {
  type: string;
  port_directions: Record<string, 'input' | 'output'>;
  connections: Record<string, number[]>;
}

export interface YosysJson {
  modules: Record<string, { ports: Record<string, never>; cells: Record<string, YosysCell> }>;
}

export interface YosysDropped {
  refdes: string;
  type: ComponentType;
  reason: string;
}

export interface YosysResult {
  json: YosysJson;
  /**
   * Everything the analog skin could not represent — whole components with no
   * symbol, and individual terminals with no pin on the symbol used. Nothing
   * is ever lost without an entry here.
   */
  dropped: YosysDropped[];
  /** Net name to the integer "bit" it was assigned. */
  bits: Record<string, number>;
}

export interface YosysOptions {
  moduleName?: string;
  /**
   * Symbol orientation. The skin ships separate horizontal and vertical
   * symbols and the choice is the caller's — it is a layout hint, not a
   * property of the netlist.
   */
  orientation?: 'h' | 'v';
}

/**
 * Skin symbols are addressed by their `<s:alias val="...">` child, not by the
 * `s:type` attribute. netlistsvg falls back to a generic box on a miss, with
 * no warning, so getting these wrong looks like a rendering bug.
 */
const ALIAS: Partial<Record<ComponentType, { h: string; v: string; ports: string[] }>> = {
  R: { h: 'r_h', v: 'r_v', ports: ['A', 'B'] },
  C: { h: 'c_h', v: 'c_v', ports: ['A', 'B'] },
  L: { h: 'l_h', v: 'l_v', ports: ['A', 'B'] },
  D: { h: 'd_h', v: 'd_v', ports: ['+', '-'] },
  V: { h: 'v', v: 'v', ports: ['+', '-'] },
  I: { h: 'i', v: 'i', ports: ['+', '-'] },
  Q: { h: 'q_npn', v: 'q_npn', ports: ['C', 'B', 'E'] },
};

/**
 * Convert a SPICE netlist to Yosys JSON for netlistsvg or any Yosys-JSON tool.
 *
 * ```ts
 * const { json, dropped } = toYosysJson(netlist);
 * const svg = await netlistsvg.render(analogSkin, json);
 * ```
 *
 * Check `dropped` — the analog skin has no symbol for FETs, dependent sources,
 * switches, transmission lines or subcircuits, so those cannot be represented.
 */
export function toYosysJson(input: string | ParseResult, options: YosysOptions = {}): YosysResult {
  const parsed = typeof input === 'string' ? parseSpice(input) : input;
  const moduleName = options.moduleName ?? 'circuit';
  const orient = options.orientation ?? 'h';

  const bits: Record<string, number> = {};
  let next = 2; // 0 and 1 are reserved for constant values
  const bitOf = (net: string): number => (bits[net] ??= next++);

  const cells: Record<string, YosysCell> = {};
  const dropped: YosysDropped[] = [];
  let grounds = 0;

  for (const c of parsed.components) {
    const skin = ALIAS[c.type];
    if (!skin) {
      dropped.push({ refdes: c.refdes, type: c.type, reason: 'no symbol in the analog skin' });
      continue;
    }

    const connections: Record<string, number[]> = {};
    const port_directions: Record<string, 'input' | 'output'> = {};

    // A symbol may have fewer pins than the card has terminals — the skin's
    // BJT carries C, B and E but no substrate. Report the loss rather than
    // letting a connection disappear.
    for (const extra of c.nodes.slice(skin.ports.length)) {
      dropped.push({
        refdes: c.refdes,
        type: c.type,
        reason: `terminal "${extra}" has no pin on the ${skin[orient]} symbol`,
      });
    }

    c.nodes.slice(0, skin.ports.length).forEach((net, i) => {
      const port = skin.ports[i];
      if (isGround(net)) {
        // The skin has no shared ground rail, so each ground pin gets its own
        // cell — the same choice this library's own renderer makes.
        const b = next++;
        cells[`gnd${grounds++}`] = {
          type: 'gnd',
          port_directions: { A: 'input' },
          connections: { A: [b] },
        };
        connections[port] = [b];
      } else {
        connections[port] = [bitOf(net)];
      }
      port_directions[port] = i === 0 ? 'input' : 'output';
    });

    const type = c.type === 'Q' && /pnp/i.test(c.value) ? 'q_pnp' : skin[orient];
    cells[c.refdes] = { type, port_directions, connections };
  }

  return { json: { modules: { [moduleName]: { ports: {}, cells } } }, dropped, bits };
}
