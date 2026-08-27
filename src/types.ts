import type { ComponentType } from './elements.js';

export type { ComponentType };

/** One element card from the netlist. */
export interface SpiceComponent {
  /** Reference designator as written, e.g. `R1`, `Q2`. */
  refdes: string;
  type: ComponentType;
  /** Connected net names, in SPICE pin order. */
  nodes: string[];
  /** Control nets of a voltage-controlled device (E, G, S). */
  senseNodes?: string[];
  /** Names of other elements this card refers to — a controlling source
   *  (F, H, W) or the two inductors a coupling links (K). */
  refs?: string[];
  /** Value or model name — `1k`, `DC 5`, `2N3904`. May be empty. */
  value: string;
  /** The source line, with continuations already joined. */
  raw: string;
}

/** A line the parser could not turn into a component. */
export interface SkippedLine {
  line: string;
  reason: string;
}

export interface ParseResult {
  /** First comment line, by SPICE convention the circuit title. */
  title: string | null;
  components: SpiceComponent[];
  /** Every net referenced, ground excluded, in discovery order. */
  nets: string[];
  skipped: SkippedLine[];
}

/* ── scene graph ──────────────────────────────────────────────────────────
   layout() emits these; the React component and the string serializer are
   two renderers over the same model, so both produce identical geometry. */

interface Base {
  /** Net this mark belongs to, when it belongs to one. Enables highlighting. */
  net?: string;
}

export type Shape =
  | (Base & { kind: 'path'; d: string; filled?: boolean; dashed?: boolean; isHalo?: boolean })
  | (Base & { kind: 'circle'; cx: number; cy: number; r: number; filled?: boolean; isHalo?: boolean })
  | (Base & { kind: 'rect'; x: number; y: number; w: number; h: number; isHalo?: boolean })
  | (Base & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
      size: number;
      bold?: boolean;
      dim?: boolean;
      tracking?: number;
    });

export interface Scene {
  width: number;
  height: number;
  title: string | null;
  /**
   * Nets actually drawn on this sheet, in reading order. A net the netlist
   * mentions but no symbol has a pin for — a MOSFET bulk terminal, say —
   * is absent, because listing it would promise a mark that is not there.
   * Use `ParseResult.nets` for everything the netlist names.
   */
  nets: string[];
  shapes: Shape[];
}

export interface Theme {
  /** Ink colour for wires, symbols and refdes labels. */
  ink: string;
  /** Background fill. */
  paper: string;
  /** Secondary colour for values and net names. */
  dim: string;
  /** Colour applied to shapes belonging to the highlighted net. */
  accent: string;
  fontFamily: string;
  strokeWidth: number;
}

export const defaultTheme: Theme = {
  ink: '#14161a',
  paper: '#f4f2eb',
  dim: '#8d8877',
  accent: '#2f5da8',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  strokeWidth: 1.7,
};
