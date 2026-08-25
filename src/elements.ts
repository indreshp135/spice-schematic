/**
 * The complete SPICE element table.
 *
 * A device's type is the first character of its refdes, so A-Z is the entire
 * universe of element cards — this table is exhaustive by construction, not
 * by best effort. Letters and device names follow the ngspice manual, Table 2.1.
 */

export type ComponentType =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

/** How the fields after the refdes are divided into nodes, references and a value. */
export type CardShape =
  /** Two nodes, then a value: `R1 a b 1k`. */
  | 'value2'
  /** Two nodes, then a source expression: `V1 a b SIN(0 1 1k)`. */
  | 'expr2'
  /** Two output nodes, two sense nodes, then a gain: `E1 a b nc+ nc- 10`. */
  | 'controlled4'
  /** Two output nodes, the name of a controlling source, then a gain. */
  | 'ctrl2ref'
  /** Nodes run up to the model name, which is the last non-parameter field. */
  | 'model'
  /** A fixed node count, then a model or parameters. */
  | 'fixed'
  /** Every field up to the model name is a node, with no fixed count. */
  | 'variable'
  /** No nodes at all — names two inductors and a coupling coefficient. */
  | 'coupling';

/** Which symbol the renderer draws for this device. */
export type SymbolKind =
  | 'twoTerminal'  // R C L D
  | 'source'       // V I
  | 'dependent'    // B E F G H
  | 'switch'       // S W
  | 'transistor'   // Q M J Z
  | 'block'        // A N O P T U X Y
  | 'coupling';    // K

export interface ElementSpec {
  /** Device name, as the ngspice manual calls it. */
  name: string;
  shape: CardShape;
  symbol: SymbolKind;
  /** Node count for 'fixed'; minimum node count for 'model'. */
  nodes?: number;
  /** Extra nodes accepted beyond `nodes` (BJT substrate, MOSFET bulk). */
  optional?: number;
}

export const ELEMENTS: Record<ComponentType, ElementSpec> = {
  A: { name: 'XSPICE code model',        shape: 'variable',    symbol: 'block' },
  B: { name: 'behavioural source',       shape: 'expr2',       symbol: 'dependent' },
  C: { name: 'capacitor',                shape: 'value2',      symbol: 'twoTerminal' },
  D: { name: 'diode',                    shape: 'model',       symbol: 'twoTerminal', nodes: 2 },
  E: { name: 'VCVS',                     shape: 'controlled4', symbol: 'dependent' },
  F: { name: 'CCCS',                     shape: 'ctrl2ref',    symbol: 'dependent' },
  G: { name: 'VCCS',                     shape: 'controlled4', symbol: 'dependent' },
  H: { name: 'CCVS',                     shape: 'ctrl2ref',    symbol: 'dependent' },
  I: { name: 'current source',           shape: 'expr2',       symbol: 'source' },
  J: { name: 'JFET',                     shape: 'model',       symbol: 'transistor', nodes: 3 },
  K: { name: 'coupled inductors',        shape: 'coupling',    symbol: 'coupling' },
  L: { name: 'inductor',                 shape: 'value2',      symbol: 'twoTerminal' },
  M: { name: 'MOSFET',                   shape: 'model',       symbol: 'transistor', nodes: 3, optional: 1 },
  N: { name: 'numerical device',         shape: 'variable',    symbol: 'block' },
  O: { name: 'lossy transmission line',  shape: 'fixed',       symbol: 'block', nodes: 4 },
  P: { name: 'coupled multiconductor',   shape: 'variable',    symbol: 'block' },
  Q: { name: 'BJT',                      shape: 'model',       symbol: 'transistor', nodes: 3, optional: 1 },
  R: { name: 'resistor',                 shape: 'value2',      symbol: 'twoTerminal' },
  S: { name: 'voltage-controlled switch', shape: 'controlled4', symbol: 'switch' },
  T: { name: 'lossless transmission line', shape: 'fixed',     symbol: 'block', nodes: 4 },
  U: { name: 'distributed RC line',      shape: 'fixed',       symbol: 'block', nodes: 3 },
  V: { name: 'voltage source',           shape: 'expr2',       symbol: 'source' },
  W: { name: 'current-controlled switch', shape: 'ctrl2ref',   symbol: 'switch' },
  X: { name: 'subcircuit call',          shape: 'variable',    symbol: 'block' },
  Y: { name: 'lossy line (TXL)',         shape: 'fixed',       symbol: 'block', nodes: 4 },
  Z: { name: 'MESFET',                   shape: 'model',       symbol: 'transistor', nodes: 3 },
};

export const isElementType = (c: string): c is ComponentType => c in ELEMENTS;

/**
 * Controlled sources also accept expression forms — `E1 out 0 VALUE={...}`,
 * `POLY`, `TABLE` — which carry two nodes rather than four.
 */
export const EXPRESSION_KEYWORDS = /^(value|poly|table|laplace|cur|vol)\b/i;
