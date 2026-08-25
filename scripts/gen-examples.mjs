// Regenerate examples/*.svg from examples/*.cir — run with `npm run examples`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToSvgString } from '../dist/index.js';

const dir = new URL('../examples/', import.meta.url).pathname;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.cir'))) {
  const svg = renderToSvgString(readFileSync(join(dir, f), 'utf8'));
  writeFileSync(join(dir, f.replace(/\.cir$/, '.svg')), svg);
  console.log('wrote', f.replace(/\.cir$/, '.svg'));
}
