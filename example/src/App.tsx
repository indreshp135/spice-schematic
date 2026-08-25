import { useState } from 'react';
import { Schematic, useSchematic } from 'spice-schematic/react';
import { renderToSvgString } from 'spice-schematic';
import { EXAMPLES } from './examples.js';

const PLACEHOLDER = `V1 in 0 DC 5
R1 in out 1k
C1 out 0 100n`;

const ZOOMS = [0.35, 0.5, 0.75, 1, 1.5, 2];

/** `?example=common-emitter` preloads that example, so links are shareable. */
function fromUrl(): string {
  if (typeof window === 'undefined') return '';
  const want = new URLSearchParams(window.location.search).get('example');
  if (!want) return '';
  return EXAMPLES.find((e) => e.file === want || e.file.replace(/\.cir$/, '') === want)?.text ?? '';
}

export function App() {
  const [netlist, setNetlist] = useState(fromUrl);
  const [hot, setHot] = useState<string | null>(null);
  const [zoomIx, setZoomIx] = useState(3);

  // Derived straight from the netlist. Nothing here may depend on state that
  // only the schematic sets — that cycle is what stopped it ever rendering.
  const { parsed, scene } = useSchematic(netlist);
  const empty = parsed.components.length === 0;
  const zoom = ZOOMS[zoomIx];

  const load = (text: string, file?: string) => {
    setNetlist(text);
    setHot(null);
    setZoomIx(3);
    const url = new URL(window.location.href);
    if (file) url.searchParams.set('example', file.replace(/\.cir$/, ''));
    else url.searchParams.delete('example');
    window.history.replaceState(null, '', url);
  };

  const download = () => {
    const blob = new Blob([renderToSvgString(netlist)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schematic.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          spice-schematic <span>· netlist to schematic</span>
        </div>
        <div className="spacer" />
        {!empty && (
          <div className="readout">
            {hot ? (
              <>
                net <span className="net">{hot.toUpperCase()}</span>
              </>
            ) : (
              <>
                <b>{parsed.components.length}</b> parts · <b>{parsed.nets.length}</b> nets ·{' '}
                <b>{new Set(parsed.components.map((c) => c.type)).size}</b> types
              </>
            )}
          </div>
        )}
        <div className="zoom">
          <button onClick={() => setZoomIx((i) => Math.max(0, i - 1))} disabled={empty || zoomIx === 0} title="Zoom out">
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoomIx((i) => Math.min(ZOOMS.length - 1, i + 1))}
            disabled={empty || zoomIx === ZOOMS.length - 1}
            title="Zoom in"
          >
            +
          </button>
        </div>
        <button className="primary" onClick={download} disabled={empty}>
          Download SVG
        </button>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="section-label">Examples</div>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.file}
                className={`example${netlist === ex.text ? ' active' : ''}`}
                onClick={() => load(ex.text, ex.file)}
                title={ex.file}
              >
                <div className="name">{ex.label}</div>
                <div className="meta">
                  <span>{ex.parts} parts</span>
                  <span className="letters">{ex.letters.join(' ')}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="editor-wrap">
            <div className="section-label">Netlist</div>
            <textarea
              value={netlist}
              onChange={(e) => setNetlist(e.target.value)}
              spellCheck={false}
              placeholder={PLACEHOLDER}
            />
            {parsed.skipped.length > 0 && (
              <div className="status">
                <div className="warn">
                  {parsed.skipped.length} line{parsed.skipped.length > 1 ? 's' : ''} not drawn —{' '}
                  <code>{parsed.skipped[0].reason}</code>
                </div>
              </div>
            )}
            <div className="actions">
              <button onClick={() => load('')} disabled={!netlist}>
                Clear
              </button>
            </div>
          </div>
        </aside>

        <main className={`canvas${empty ? ' center' : ''}`}>
          {empty ? (
            <div className="empty">
              Pick an example, or paste a netlist.
              <br />
              Hover any net to trace it — <kbd>R1 in out 1k</kbd>
            </div>
          ) : (
            <Schematic
              netlist={netlist}
              highlightNet={hot ?? undefined}
              onNetHover={setHot}
              width={scene.width * zoom}
              height={scene.height * zoom}
            />
          )}
        </main>
      </div>
    </div>
  );
}
