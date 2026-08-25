import * as React from 'react';
import { layout } from './layout.js';
import { parseSpice } from './parse.js';
import { defaultTheme } from './types.js';
import type { ParseResult, Scene, Shape, Theme } from './types.js';

export interface SchematicProps extends Omit<React.SVGProps<SVGSVGElement>, 'onClick'> {
  /** The SPICE netlist to draw. */
  netlist: string;
  theme?: Partial<Theme>;
  /** Draw this net, and every lead touching it, in the accent colour. */
  highlightNet?: string;
  /** Called with the parse result whenever the netlist changes. */
  onParse?: (result: ParseResult) => void;
  /** Called with a net name on hover, or null on leave. */
  onNetHover?: (net: string | null) => void;
  /** Called with a net name when a mark belonging to it is clicked. */
  onNetClick?: (net: string) => void;
}

/**
 * Renders a SPICE netlist as an inline SVG schematic.
 *
 * ```tsx
 * <Schematic netlist={spice} style={{ width: '100%' }} />
 * ```
 *
 * The SVG scales to its container by default; pass `width`/`height` to pin it.
 */
export const Schematic = React.forwardRef<SVGSVGElement, SchematicProps>(function Schematic(
  { netlist, theme, highlightNet, onParse, onNetHover, onNetClick, ...rest },
  ref,
) {
  const parsed = React.useMemo(() => parseSpice(netlist), [netlist]);
  const scene = React.useMemo(() => layout(parsed), [parsed]);

  React.useEffect(() => { onParse?.(parsed); }, [parsed, onParse]);

  const t = { ...defaultTheme, ...theme };
  const interactive = Boolean(onNetHover || onNetClick);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <rect width={scene.width} height={scene.height} fill={t.paper} />
      {scene.shapes.map((s, i) => {
        const hot = highlightNet !== undefined && s.net === highlightNet;
        const handlers =
          interactive && s.net
            ? {
                onMouseEnter: () => onNetHover?.(s.net!),
                onMouseLeave: () => onNetHover?.(null),
                onClick: () => onNetClick?.(s.net!),
                style: { cursor: onNetClick ? 'pointer' : 'default' } as React.CSSProperties,
              }
            : undefined;
        return <ShapeMark key={i} shape={s} theme={t} hot={hot} handlers={handlers} />;
      })}
    </svg>
  );
});

function ShapeMark({
  shape: s,
  theme: t,
  hot,
  handlers,
}: {
  shape: Shape;
  theme: Theme;
  hot: boolean;
  handlers?: Record<string, unknown>;
}) {
  const stroke = hot ? t.accent : t.ink;

  switch (s.kind) {
    case 'path':
      return s.filled ? (
        <path d={s.d} fill={stroke} {...handlers} />
      ) : (
        <path
          d={s.d}
          fill="none"
          stroke={stroke}
          strokeWidth={t.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...handlers}
        />
      );
    case 'circle':
      return (
        <circle
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          fill={s.filled ? stroke : 'none'}
          stroke={s.filled ? undefined : stroke}
          strokeWidth={s.filled ? undefined : t.strokeWidth}
          {...handlers}
        />
      );
    case 'rect':
      return (
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={2} fill="none" stroke={stroke} strokeWidth={t.strokeWidth} {...handlers} />
      );
    case 'text':
      return (
        <text
          x={s.x}
          y={s.y}
          textAnchor={s.anchor}
          fontFamily={t.fontFamily}
          fontSize={s.size}
          fontWeight={s.bold ? 600 : undefined}
          letterSpacing={s.tracking ? `${s.tracking}em` : undefined}
          fill={hot ? t.accent : s.dim ? t.dim : t.ink}
          /* paper-coloured outline keeps labels readable over crossing rails */
          stroke={t.paper}
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          {...handlers}
        >
          {s.text}
        </text>
      );
  }
}

/** Hook form, for callers that want the scene without the built-in rendering. */
export function useSchematic(netlist: string): { parsed: ParseResult; scene: Scene } {
  const parsed = React.useMemo(() => parseSpice(netlist), [netlist]);
  const scene = React.useMemo(() => layout(parsed), [parsed]);
  return { parsed, scene };
}
