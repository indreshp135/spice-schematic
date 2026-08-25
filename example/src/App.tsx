import { useCallback, useRef, useState } from 'react';
import { Schematic } from 'spice-res/react';
import { renderToSvgString } from 'spice-res';
import type { ParseResult } from 'spice-res';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const PLACEHOLDER = `paste a SPICE netlist

V1 in 0 DC 5
R1 in out 1k
C1 out 0 100n`;

export function App() {
  const [netlist, setNetlist] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onParse = useCallback((r: ParseResult) => setParsed(r), []);
  const empty = !parsed?.components.length;

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
    <div style={{ display: 'flex', height: '100vh', fontFamily: MONO, margin: 0 }}>
      <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#1e2126' }}>
        <textarea
          value={netlist}
          onChange={(e) => setNetlist(e.target.value)}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          style={{
            flex: 1, resize: 'none', padding: 16, fontSize: 12, lineHeight: 1.7,
            outline: 'none', border: 'none', background: 'transparent', color: '#d5d2c8', fontFamily: MONO,
          }}
        />
        {parsed && parsed.skipped.length > 0 && (
          <div style={{ padding: '0 16px 8px', fontSize: 11, color: '#8a7f66' }}>
            {parsed.skipped.length} line{parsed.skipped.length > 1 ? 's' : ''} not drawn:{' '}
            {parsed.skipped[0].reason}
          </div>
        )}
        <button
          onClick={download}
          disabled={empty}
          style={{
            margin: 12, padding: '8px 0', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
            border: 'none', borderRadius: 2, background: '#2f5da8', color: '#fff',
            opacity: empty ? 0.3 : 1, cursor: empty ? 'default' : 'pointer', fontFamily: MONO,
          }}
        >
          Download SVG
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, background: '#f4f2eb', overflow: 'auto' }}>
        {empty ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 12, color: '#8d8877' }}>
            the schematic appears here
          </div>
        ) : (
          <Schematic
            ref={svgRef}
            netlist={netlist}
            onParse={onParse}
            highlightNet={hot ?? undefined}
            onNetHover={setHot}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
