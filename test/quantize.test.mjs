import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extractPalette } from '../dist/index.js';
import { quantize, suggestForeground } from '../dist/quantize.js';
import { decodePNG } from '../dist/png.js';

test('same seed produces an identical palette (determinism)', async () => {
  const solid = await readFile('test/fixtures/solid.png');
  const a = await extractPalette(solid, { count: 4, seed: 123 });
  const b = await extractPalette(solid, { count: 4, seed: 123 });
  assert.deepEqual(a, b);

  const demo = await readFile('assets/demo-image.png');
  const c = await extractPalette(demo, { count: 6, seed: 7 });
  const d = await extractPalette(demo, { count: 6, seed: 7 });
  assert.deepEqual(c, d);
});

test('k=4 on four solid quadrants yields exactly those colors', async () => {
  const buf = await readFile('test/fixtures/solid.png');
  const palette = await extractPalette(buf, { count: 4, seed: 99 });
  const hexes = palette.map((c) => c.hex).sort();
  assert.deepEqual(hexes, ['#22c55e', '#3b82f6', '#ec4899', '#facc15'].sort());
  for (const c of palette) {
    assert.ok(Math.abs(c.population - 0.25) < 1e-9, `population ${c.population} should be ~0.25`);
  }
  const sum = palette.reduce((s, c) => s + c.population, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `populations should sum to 1, got ${sum}`);
});

test('palette is sorted by population descending', async () => {
  const demo = await readFile('assets/demo-image.png');
  const palette = await extractPalette(demo, { count: 8, seed: 42 });
  assert.equal(palette.length, 8);
  for (let i = 1; i < palette.length; i++) {
    assert.ok(palette[i - 1].population >= palette[i].population);
  }
  for (const c of palette) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.equal(c.rgb.length, 3);
    assert.ok(c.population > 0 && c.population <= 1);
  }
});

test('hex matches rgb', async () => {
  const demo = await readFile('assets/demo-image.png');
  const palette = await extractPalette(demo, { count: 5, seed: 1 });
  for (const c of palette) {
    const hex = '#' + c.rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    assert.equal(c.hex, hex);
  }
});

test('contrast suggestion follows WCAG relative luminance', () => {
  assert.equal(suggestForeground([255, 255, 255]), '#000000');
  assert.equal(suggestForeground([0, 0, 0]), '#ffffff');
  assert.equal(suggestForeground([250, 204, 21]), '#000000'); // bright yellow
  assert.equal(suggestForeground([30, 30, 30]), '#ffffff'); // near-black
  assert.equal(suggestForeground([128, 128, 128]), '#000000'); // above 0.1791 crossover → black wins
  assert.equal(suggestForeground([200, 200, 200]), '#000000');
});

test('every palette color carries a valid foreground suggestion', async () => {
  const demo = await readFile('assets/demo-image.png');
  const palette = await extractPalette(demo, { count: 8, seed: 3 });
  for (const c of palette) {
    assert.equal(c.foreground, suggestForeground(c.rgb));
    assert.ok(['#000000', '#ffffff'].includes(c.foreground));
  }
});

test('count=1 returns a single color; invalid counts throw', async () => {
  const buf = await readFile('test/fixtures/solid.png');
  const single = await extractPalette(buf, { count: 1, seed: 5 });
  assert.equal(single.length, 1);
  assert.ok(single[0].population > 0.99);

  await assert.rejects(extractPalette(buf, { count: 0 }), /count/);
  await assert.rejects(extractPalette(buf, { count: 2.5 }), /count/);
  await assert.rejects(extractPalette(buf, { count: -3 }), /count/);
});

test('quantize works on a directly decoded image (library path)', () => {
  const img = decodePNG(readFileSync('test/fixtures/solid.png'));
  const palette = quantize(img, { count: 4, seed: 42 });
  assert.equal(palette.length, 4);
});
