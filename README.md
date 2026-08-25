# spice-res

Turn a SPICE netlist into a schematic — as a React component, or as a plain SVG string with no DOM in sight.

```bash
npm install spice-res
```

<p align="center">
  <img src="docs/common-emitter.png" alt="Common emitter amplifier rendered from its netlist" width="620">
</p>

## Use it

**As a React component**

```tsx
import { Schematic } from 'spice-res/react';

export default function App() {
  return <Schematic netlist={`
    V1 in 0 DC 5
    R1 in out 1k
    C1 out 0 100n
  `} style={{ width: '100%' }} />;
}
```

**As an SVG string** — works in Node, a worker, a build step, anywhere:

```ts
import { renderToSvgString } from 'spice-res';
import { writeFileSync } from 'node:fs';

writeFileSync('schematic.svg', renderToSvgString(netlist));
```

The React entry is a separate export, so importing `spice-res` on a server never pulls React in.

## What it draws

| Prefix | Element | Symbol |
| --- | --- | --- |
| `R` `C` `L` | resistor, capacitor, inductor | zig-zag, parallel plates, arc coil |
| `V` `I` | independent sources | circle with polarity marks or a current arrow |
| `D` | diode | triangle and bar, oriented by node order |
| `Q` | BJT | vertical, arrow on the emitter, PNP detected from the model name |
| `M` `J` | MOSFET, JFET | vertical, optional bulk terminal |
| `X` | subcircuit call | labelled block, pins down the left edge |

Line continuations (`+`), comments, and `.directives` are handled. `.subckt`/`.ends` and `.control`/`.endc` bodies are skipped — their contents are definitions and commands, not circuit elements, and drawing them invents nets that do not exist. Anything the parser cannot place is reported in `skipped` rather than dropped in silence.

## How the layout works

A netlist records connectivity and nothing else. There are no coordinates in it, so a renderer has to invent a placement:

- every net becomes a **vertical rail**, ordered by breadth-first walk from the first voltage source, so supply sits left and signal reads across the page
- every component gets its **own row**, drawn between the rails it connects
- **ground gets no rail** — just a ground symbol at each pin, which removes what would otherwise be the busiest net on the sheet
- **junction dots** appear only where a lead meets a rail mid-run, never at a rail's endpoints, so a dot always means a real T

<p align="center">
  <img src="docs/sallen-key.png" alt="Sallen-Key low pass with an opamp subcircuit" width="620">
</p>

### What this will not do

It gives you a drawing that is **correct and traceable, not textbook-pretty**. Recognising that a pair of transistors is a differential pair, or that a capacitor is feedback and belongs drawn as an arc over the amplifier, requires inferring the circuit's intent — this library does not attempt it. On densely connected nodes, leads to three-terminal devices can cross rails. `highlightNet` exists partly to make those cases readable.

## API

### `renderToSvgString(netlist, options?): string`

| Option | Type | Effect |
| --- | --- | --- |
| `theme` | `Partial<Theme>` | override `ink`, `paper`, `dim`, `accent`, `fontFamily`, `strokeWidth` |
| `highlightNet` | `string` | draw that net and every lead touching it in the accent colour |
| `responsive` | `boolean` | emit only a `viewBox`, letting CSS size the element |

### `<Schematic />`

Takes everything `renderToSvgString` takes, plus any `<svg>` prop, plus:

| Prop | Type | Effect |
| --- | --- | --- |
| `onParse` | `(r: ParseResult) => void` | fires on netlist change — read `skipped` from it to surface bad lines |
| `onNetHover` | `(net: string \| null) => void` | pair with `highlightNet` for hover-to-trace |
| `onNetClick` | `(net: string) => void` | click any mark belonging to a net |

Hover-to-trace in full:

```tsx
const [hot, setHot] = useState<string | null>(null);
return <Schematic netlist={src} highlightNet={hot ?? undefined} onNetHover={setHot} />;
```

### Lower level

```ts
import { parseSpice, layout, sceneToSvg } from 'spice-res';

const parsed = parseSpice(netlist);  // { title, components, nets, skipped }
const scene = layout(parsed);        // { width, height, nets, shapes }
const svg = sceneToSvg(scene);
```

`layout()` returns a flat list of tagged shapes — `path`, `circle`, `rect`, `text` — each carrying the net it belongs to where it belongs to one. Both renderers are thin passes over that list, so writing a third (canvas, PDF, a different JSX dialect) means walking one array. `useSchematic(netlist)` is the same thing as a hook.

## More examples

`examples/` holds the netlists below and their rendered SVGs. Regenerate with `npm run examples`.

| | |
| --- | --- |
| <img src="docs/rc-lowpass.png" width="380"> | <img src="docs/cmos-inverter.png" width="380"> |
| `rc-lowpass.cir` | `cmos-inverter.cir` |

## Development

```bash
npm install
npm run build
npm test        # 39 tests: parsing, geometry, serialisation, SSR
npm run demo    # Vite playground — paste a netlist, watch it draw
```

## License

MIT
