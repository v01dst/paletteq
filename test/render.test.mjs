import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTable, toCSS, toSCSS, toTailwind, toJSON, toSVG, resolveUseColor } from '../dist/render.js';

const palette = [
  { hex: '#ec4899', rgb: [236, 72, 153], population: 0.5, foreground: '#000000' },
  { hex: '#8b5cf6', rgb: [139, 92, 246], population: 0.3, foreground: '#ffffff' },
  { hex: '#22c55e', rgb: [34, 197, 94], population: 0.2, foreground: '#000000' },
];

test('css exporter emits :root custom properties', () => {
  const css = toCSS(palette);
  assert.match(css, /:root/);
  assert.match(css, /--palette-1: #ec4899;/);
  assert.match(css, /--palette-3: #22c55e;/);
});

test('scss exporter emits $variables', () => {
  const scss = toSCSS(palette);
  assert.match(scss, /\$palette-1: #ec4899;/);
  assert.match(scss, /50\.0%/);
});

test('tailwind exporter emits theme.extend.colors snippet', () => {
  const tw = toTailwind(palette);
  assert.match(tw, /module\.exports/);
  assert.match(tw, /theme/);
  assert.match(tw, /extend/);
  assert.match(tw, /colors/);
  assert.match(tw, /'palette-2': '#8b5cf6'/);
});

test('json exporter produces valid JSON', () => {
  const doc = JSON.parse(toJSON(palette));
  assert.equal(doc.count, 3);
  assert.equal(doc.colors.length, 3);
  assert.equal(doc.colors[0].hex, '#ec4899');
  assert.equal(doc.colors[1].population, 0.3);
  assert.deepEqual(doc.colors[2].rgb, [34, 197, 94]);
});

test('svg exporter emits a rect grid with hex labels', () => {
  const svg = toSVG(palette);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(svg.match(/<rect /g).length, 3);
  assert.match(svg, /fill="#ec4899"/);
  assert.match(svg, />#8b5cf6</);
  assert.match(svg, /<\/svg>\s*$/);
});

test('table renderer: colored output contains ANSI truecolor codes', () => {
  const out = renderTable(palette, true);
  assert.match(out, /\x1b\[38;2;236;72;153m/);
  assert.match(out, /█{12}/);
  assert.match(out, /#ec4899/);
  assert.match(out, /50\.0%/);
});

test('table renderer: plain mode strips all ANSI escapes', () => {
  const out = renderTable(palette, false);
  assert.doesNotMatch(out, /\x1b\[/);
  assert.match(out, /#ec4899/);
  assert.match(out, /#22c55e/);
});

test('resolveUseColor honors --color/--no-color, FORCE_COLOR and NO_COLOR', () => {
  const env = process.env;
  const set = (k, v) => (v === undefined ? delete env[k] : (env[k] = v));
  try {
    set('FORCE_COLOR', undefined);
    set('NO_COLOR', undefined);
    assert.equal(resolveUseColor('always'), true);
    assert.equal(resolveUseColor('never'), false);

    set('FORCE_COLOR', '1');
    assert.equal(resolveUseColor('auto'), true);
    set('FORCE_COLOR', '0');
    assert.equal(resolveUseColor('auto'), false);
    set('FORCE_COLOR', 'false');
    assert.equal(resolveUseColor('auto'), false);

    set('FORCE_COLOR', undefined);
    set('NO_COLOR', '1');
    assert.equal(resolveUseColor('auto'), false);
  } finally {
    set('FORCE_COLOR', env.FORCE_COLOR);
    set('NO_COLOR', env.NO_COLOR);
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
  }
});
