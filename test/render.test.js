import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToSvgString, layout, parseSpice, sceneToSvg } from '../dist/index.js';

const CIRCUITS = {
  rc: `* RC low pass
V1 in 0 DC 5
R1 in out 1k
C1 out 0 100n`,
  commonEmitter: `* common emitter
VCC vcc 0 DC 12
R1 vcc b 100k
R2 b 0 22k
RC vcc c 4.7k
RE e 0 1k
Q1 c b e 2N3904
C1 in b 10u`,
  cmosInverter: `* CMOS inverter
VDD vdd 0 DC 3.3
M1 out in vdd vdd PMOS
M2 out in 0 0 NMOS
C1 out 0 10f`,
  bridge: `* bridge rectifier
V1 ac1 ac2 SIN(0 12 50)
D1 ac1 dc+ 1N4007
D2 ac2 dc+ 1N4007
D3 dc- ac1 1N4007
D4 dc- ac2 1N4007
C1 dc+ dc- 470u`,
  sallenKey: `* sallen key
.subckt OPAMP non_inv inv out vcc vee
E1 out 0 table {V(non_inv)-V(inv)} = (-15 -15) (15 15)
.ends
VCC vcc 0 DC 15
VEE vee 0 DC -15
VIN in 0 AC 1
R1 in n1 10k
R2 n1 n2 10k
C1 n1 out 10n
C2 n2 0 10n
X1 n2 out out vcc vee OPAMP
.control
ac dec 10 1 100k
plot 'Magnitude' vdb(out)
.endc`,
  jfet: `J1 d g s 2N3819
R1 vdd d 2.2k
V1 vdd 0 DC 9
I1 s 0 DC 1m`,
  inductor: `L1 a b 10m\nR1 b 0 50\nV1 a 0 AC 1`,
};

for (const [name, netlist] of Object.entries(CIRCUITS)) {
  test(`renders ${name} to well-formed SVG`, () => {
    const svg = renderToSvgString(netlist);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    // Tag balance: every element we emit is self-closing except <text>.
    const opens = (svg.match(/<(path|circle|rect|text|svg)\b/g) || []).length;
    assert.ok(opens > 5, 'suspiciously few marks drawn');
    assert.equal((svg.match(/<text\b/g) || []).length, (svg.match(/<\/text>/g) || []).length);
  });

  test(`${name} produces finite geometry`, () => {
    const scene = layout(parseSpice(netlist));
    assert.ok(Number.isFinite(scene.width) && scene.width > 0);
    assert.ok(Number.isFinite(scene.height) && scene.height > 0);
    const svg = renderToSvgString(netlist);
    assert.ok(!/NaN|Infinity|undefined|null/.test(svg), `non-finite value in ${name} output`);
    for (const s of scene.shapes) {
      const nums = s.kind === 'path'
        ? s.d.split(/\s+/).filter((t) => !/^[A-Za-z]$/.test(t)).map(Number)
        : [s.x, s.y, s.cx, s.cy, s.r, s.w, s.h].filter((v) => v !== undefined);
      for (const n of nums) assert.ok(Number.isFinite(n), `non-finite coord in ${s.kind}`);
    }
  });
}

test('the sallen-key deck yields only its real components and nets', () => {
  const p = parseSpice(CIRCUITS.sallenKey);
  assert.equal(p.components.length, 8);
  assert.deepEqual(p.nets, ['vcc', 'vee', 'in', 'n1', 'n2', 'out']);
});

test('every drawn net gets a rail or is flagged dangling', () => {
  const scene = layout(parseSpice(CIRCUITS.commonEmitter));
  for (const net of scene.nets) {
    assert.ok(scene.shapes.some((s) => s.net === net), `net ${net} drew nothing`);
  }
});

test('net ordering starts from a voltage source', () => {
  const scene = layout(parseSpice(CIRCUITS.rc));
  assert.equal(scene.nets[0], 'in');
});

test('empty and junk input render a valid, empty sheet', () => {
  for (const junk of ['', 'hello world', '.end', '*** just a comment']) {
    const svg = renderToSvgString(junk);
    assert.match(svg, /^<svg /);
    assert.match(svg, /<\/svg>$/);
    assert.ok(!/NaN/.test(svg));
  }
});

test('highlightNet recolours only the named net', () => {
  const plain = renderToSvgString(CIRCUITS.rc);
  const lit = renderToSvgString(CIRCUITS.rc, { highlightNet: 'out' });
  assert.notEqual(plain, lit);
  assert.ok(lit.includes('#2f5da8'));
  assert.ok(!plain.includes('#2f5da8'));
});

test('theme overrides reach the output', () => {
  const svg = renderToSvgString(CIRCUITS.rc, { theme: { paper: '#000000', ink: '#00ff00' } });
  assert.ok(svg.includes('#000000') && svg.includes('#00ff00'));
});

test('responsive drops intrinsic size but keeps the viewBox', () => {
  const openTag = (svg) => svg.slice(0, svg.indexOf('>') + 1);
  const plain = openTag(renderToSvgString(CIRCUITS.rc));
  const flex = openTag(renderToSvgString(CIRCUITS.rc, { responsive: true }));
  assert.match(plain, / width="\d+" height="\d+"/);
  assert.ok(!/ width=/.test(flex), 'responsive svg still carries a width');
  assert.match(flex, /viewBox="0 0 \d+ \d+"/);
});

test('text content is XML-escaped', () => {
  const svg = sceneToSvg(layout(parseSpice('* A & B <tag>\nR1 a 0 1k')));
  assert.ok(svg.includes('&amp;'));
  assert.ok(!/<tag>/.test(svg));
});

test('a two-node net with parts on both ends draws a rail', () => {
  const scene = layout(parseSpice('V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k'));
  const rail = scene.shapes.find((s) => s.net === 'out' && s.kind === 'path');
  assert.ok(rail, 'no rail drawn for the middle net');
});
