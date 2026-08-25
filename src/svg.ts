import { layout } from './layout.js';
import { parseSpice } from './parse.js';
import { defaultTheme } from './types.js';
import type { Scene, Shape, Theme } from './types.js';

export interface SvgOptions {
  theme?: Partial<Theme>;
  /** Draw this net, and everything touching it, in the accent colour. */
  highlightNet?: string;
  /**
   * Emit only a viewBox, letting CSS size the element. Off by default so the
   * output is a valid standalone `.svg` file with intrinsic dimensions.
   */
  responsive?: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Serialise a laid-out scene to standalone SVG markup. */
export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
  const t = { ...defaultTheme, ...options.theme };
  const hot = options.highlightNet;
  const parts: string[] = [];

  const colourOf = (s: Shape, base: string): string =>
    hot && s.net === hot ? t.accent : base;

  const HALO = t.strokeWidth + 5;
  for (const s of scene.shapes) {
    if (s.kind !== 'text' && s.isHalo) {
      if (s.kind === 'path') parts.push(`<path d="${s.d}" fill="none" stroke="${t.paper}" stroke-width="${HALO}" stroke-linecap="round" stroke-linejoin="round"/>`);
      else if (s.kind === 'circle') parts.push(`<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.filled ? t.paper : 'none'}" stroke="${t.paper}" stroke-width="${HALO}"/>`);
      else parts.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" fill="${t.paper}" stroke="${t.paper}" stroke-width="${HALO}"/>`);
      continue;
    }
    switch (s.kind) {
      case 'path':
        parts.push(
          s.filled
            ? `<path d="${s.d}" fill="${colourOf(s, t.ink)}"/>`
            : `<path d="${s.d}" fill="none" stroke="${colourOf(s, t.ink)}" stroke-width="${t.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"` +
              (s.dashed ? ' stroke-dasharray="5 4"' : '') +
              `/>`,
        );
        break;
      case 'circle':
        parts.push(
          s.filled
            ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${colourOf(s, t.ink)}"/>`
            : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="none" stroke="${colourOf(s, t.ink)}" stroke-width="${t.strokeWidth}"/>`,
        );
        break;
      case 'rect':
        parts.push(
          `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" fill="none" stroke="${colourOf(s, t.ink)}" stroke-width="${t.strokeWidth}"/>`,
        );
        break;
      case 'text':
        parts.push(
          // A paper-coloured outline under the glyphs keeps labels readable
          // where a rail happens to pass behind them.
          `<text x="${s.x}" y="${s.y}" text-anchor="${s.anchor}" font-family="${esc(t.fontFamily)}" font-size="${s.size}"` +
            ` stroke="${t.paper}" stroke-width="3" paint-order="stroke" stroke-linejoin="round"` +
            (s.bold ? ' font-weight="600"' : '') +
            (s.tracking ? ` letter-spacing="${s.tracking}em"` : '') +
            ` fill="${colourOf(s, s.dim ? t.dim : t.ink)}">${esc(s.text)}</text>`,
        );
        break;
    }
  }

  const size = options.responsive ? '' : ` width="${scene.width}" height="${scene.height}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${scene.width} ${scene.height}">` +
    `<rect width="${scene.width}" height="${scene.height}" fill="${t.paper}"/>` +
    parts.join('') +
    `</svg>`
  );
}

/**
 * SPICE netlist in, SVG markup out. Runs anywhere — no DOM, no React.
 *
 * ```ts
 * writeFileSync('out.svg', renderToSvgString(netlist));
 * ```
 */
export function renderToSvgString(netlist: string, options: SvgOptions = {}): string {
  return sceneToSvg(layout(parseSpice(netlist)), options);
}
