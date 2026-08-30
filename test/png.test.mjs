import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePNG } from '../dist/png.js';

const FIX = 'test/fixtures';

test('decodes solid quadrants to exact RGB values', async () => {
  const img = decodePNG(await readFile(`${FIX}/solid.png`));
  assert.equal(img.width, 32);
  assert.equal(img.height, 32);
  assert.equal(img.data.length, 32 * 32 * 3);
  const px = (x, y) => {
    const o = (y * 32 + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  assert.deepEqual(px(0, 0), [236, 72, 153]);
  assert.deepEqual(px(31, 0), [34, 197, 94]);
  assert.deepEqual(px(0, 31), [59, 130, 246]);
  assert.deepEqual(px(31, 31), [250, 204, 21]);
});

test('converts grayscale (color type 0) to RGB', async () => {
  const img = decodePNG(await readFile(`${FIX}/gray.png`));
  assert.equal(img.width, 24);
  assert.equal(img.height, 24);
  const px = (x, y) => {
    const expected = (x * 9 + y * 7) % 256;
    const o = (y * 24 + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  assert.deepEqual(px(0, 0), [0, 0, 0]);
  assert.deepEqual(px(7, 3), [84, 84, 84]);
  assert.deepEqual(px(23, 23), [(23 * 9 + 23 * 7) % 256, (23 * 9 + 23 * 7) % 256, (23 * 9 + 23 * 7) % 256]);
});

test('converts gray+alpha (color type 4), dropping alpha', async () => {
  const img = decodePNG(await readFile(`${FIX}/grayalpha.png`));
  const px = (x, y) => {
    const expected = (x * 16 + y) % 256;
    const o = (y * 16 + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  // alpha is 0 in the bottom half — RGB must be unaffected
  assert.deepEqual(px(3, 4), [52, 52, 52]);
  assert.deepEqual(px(5, 12), [92, 92, 92]);
  assert.deepEqual(px(15, 15), [255, 255, 255]);
});

test('converts RGBA (color type 6), dropping alpha', async () => {
  const img = decodePNG(await readFile(`${FIX}/rgba.png`));
  const px = (x, y) => {
    const o = (y * 16 + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  assert.deepEqual(px(0, 0), [255, 0, 0]); // alpha 255
  assert.deepEqual(px(15, 0), [0, 255, 0]); // alpha 0 — dropped
  assert.deepEqual(px(0, 15), [0, 0, 255]); // alpha 128 — dropped
  assert.deepEqual(px(15, 15), [255, 255, 0]);
});

test('reverses all five unfilter paths (None/Sub/Up/Average/Paeth)', async () => {
  const img = decodePNG(await readFile(`${FIX}/filters.png`));
  assert.equal(img.width, 40);
  assert.equal(img.height, 40);
  const px = (x, y) => {
    const o = (y * 40 + x) * 3;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  // encoder cycles filters y%5: rows 0..4 hit every filter type
  assert.deepEqual(px(0, 0), [0, 0, 120]);
  assert.deepEqual(px(5, 7), [30, 42, 120]);
  assert.deepEqual(px(39, 39), [234, 234, 120]);
  assert.deepEqual(px(17, 23), [102, 138, 120]);
  assert.deepEqual(px(1, 2), [6, 12, 120]);
});

test('rejects a bad signature', async () => {
  const buf = await readFile(`${FIX}/solid.png`);
  buf[0] = 0;
  assert.throws(() => decodePNG(buf), /bad signature/);
});

test('rejects interlaced PNGs with a clear error', async () => {
  const buf = await readFile(`${FIX}/interlaced.png`);
  assert.throws(() => decodePNG(buf), /interlaced/);
});

test('rejects unsupported bit depths', async () => {
  const buf = await readFile(`${FIX}/bitdepth16.png`); // valid CRC, bit depth 16
  assert.throws(() => decodePNG(buf), /bit depth 16/);
});

test('detects CRC corruption', async () => {
  const buf = await readFile(`${FIX}/solid.png`);
  buf[30] ^= 0xff; // inside the IHDR CRC field
  assert.throws(() => decodePNG(buf), /CRC mismatch/);
});

test('detects truncated files', async () => {
  const buf = await readFile(`${FIX}/solid.png`);
  assert.throws(() => decodePNG(buf.subarray(0, buf.length - 12)), /truncat|past end/);
});

test('decodes a 1x1 image', async () => {
  const img = decodePNG(await readFile(`${FIX}/tiny.png`));
  assert.equal(img.width, 1);
  assert.equal(img.height, 1);
  assert.deepEqual([...img.data], [12, 34, 56]);
});
