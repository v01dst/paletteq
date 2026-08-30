#!/usr/bin/env node
// Generates deterministic PNG fixtures for tests + the README demo image.
// This is the inverse of src/png.ts (an encoder); kept in scripts/, not shipped.
// Run: node scripts/make-fixture.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- minimal PNG encoder -----------------------------------------------------

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Encode an 8-bit PNG. `px` is a Uint8Array of w*h*channels bytes (row-major).
 * opts.filters: cycle through all 5 filter types across rows (tests unfiltering).
 * opts.interlace: write a non-zero interlace flag (tests decoder rejection).
 */
function encodePNG(width, height, colorType, px, opts = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = opts.interlace ?? 0;

  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = opts.filters ? y % 5 : 0;
    const rowStart = y * (stride + 1);
    raw[rowStart] = filter;
    for (let x = 0; x < stride; x++) {
      const cur = px[y * stride + x];
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur - a;
      else if (filter === 2) v = cur - b;
      else if (filter === 3) v = cur - ((a + b) >> 1);
      else v = cur - paeth(a, b, c);
      raw[rowStart + 1 + x] = v & 0xff;
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- fixtures -----------------------------------------------------------------

// 32x32, RGB, four solid quadrants (exact k=4 result)
function solidQuadrants() {
  const W = 32;
  const H = 32;
  const px = new Uint8Array(W * H * 3);
  const colors = [
    [236, 72, 153], // pink    (top-left)
    [34, 197, 94], //  green   (top-right)
    [59, 130, 246], // blue    (bottom-left)
    [250, 204, 21], // yellow  (bottom-right)
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = colors[(x < 16 ? 0 : 1) + (y < 16 ? 0 : 2)];
      const o = (y * W + x) * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
  return encodePNG(W, H, 2, px);
}

// 24x24 grayscale: value = (x*9 + y*7) % 256
function grayGradient() {
  const W = 24;
  const H = 24;
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      px[y * W + x] = (x * 9 + y * 7) % 256;
    }
  }
  return encodePNG(W, H, 0, px);
}

// 16x16 gray+alpha: gray = (x*16 + y) % 256, alpha = 255 above y=8 else 0
function grayAlpha() {
  const W = 16;
  const H = 16;
  const px = new Uint8Array(W * H * 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 2;
      px[o] = (x * 16 + y) % 256;
      px[o + 1] = y < 8 ? 255 : 0;
    }
  }
  return encodePNG(W, H, 4, px);
}

// 16x16 RGBA quadrants with varying alpha (decoder must drop alpha)
function rgbaQuadrants() {
  const W = 16;
  const H = 16;
  const px = new Uint8Array(W * H * 4);
  const colors = [
    [255, 0, 0, 255],
    [0, 255, 0, 0],
    [0, 0, 255, 128],
    [255, 255, 0, 0],
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = colors[(x < 8 ? 0 : 1) + (y < 8 ? 0 : 2)];
      const o = (y * W + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = c[3];
    }
  }
  return encodePNG(W, H, 6, px);
}

// 40x40 RGB gradient encoded with ALL five filters cycling per row
function filteredGradient() {
  const W = 40;
  const H = 40;
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      px[o] = (x * 6) % 256;
      px[o + 1] = (y * 6) % 256;
      px[o + 2] = 120;
    }
  }
  return encodePNG(W, H, 2, px, { filters: true });
}

// 8x8 flagged as interlaced — decoder must reject it
function interlaced() {
  const px = new Uint8Array(8 * 8 * 3).fill(200);
  return encodePNG(8, 8, 2, px, { interlace: 1 });
}

// 1x1 RGB edge case
function tiny() {
  return encodePNG(1, 1, 2, new Uint8Array([12, 34, 56]));
}

// IHDR declaring bit depth 16 (valid CRC) — decoder must reject it
function bitDepth16() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 16; // unsupported bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(4 * 9))), chunk('IEND', Buffer.alloc(0))]);
}

// ---- README demo image: layered radial gradients + stripes, 600x400 -----------

function demoImage() {
  const W = 600;
  const H = 400;
  const px = new Uint8Array(W * H * 3);
  const base = [15, 23, 42]; // deep navy
  const blobs = [
    { cx: 170, cy: 150, r: 330, col: [236, 72, 153], a: 0.95 }, // pink
    { cx: 450, cy: 140, r: 300, col: [139, 92, 246], a: 0.9 }, // violet
    { cx: 320, cy: 320, r: 350, col: [34, 211, 238], a: 0.85 }, // cyan
    { cx: 530, cy: 320, r: 230, col: [245, 158, 11], a: 0.8 }, // amber
    { cx: 60, cy: 340, r: 200, col: [52, 211, 153], a: 0.7 }, // emerald
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = base[0];
      let g = base[1];
      let b = base[2];
      for (const bl of blobs) {
        const d = Math.hypot(x - bl.cx, y - bl.cy) / bl.r;
        let t = Math.max(0, 1 - d);
        t = t * t * (3 - 2 * t); // smoothstep falloff
        const m = t * bl.a;
        r += (bl.col[0] - r) * m;
        g += (bl.col[1] - g) * m;
        b += (bl.col[2] - b) * m;
      }
      // diagonal stripe highlights
      if ((x + y) % 140 < 5) {
        r += (255 - r) * 0.22;
        g += (255 - g) * 0.22;
        b += (255 - b) * 0.22;
      }
      // subtle horizontal banding for depth
      if (y % 90 < 3) {
        r *= 0.82;
        g *= 0.82;
        b *= 0.82;
      }
      // gentle vignette
      const edge = Math.max(0, Math.hypot(x - 300, y - 200) / 420 - 0.72) * 2.2;
      if (edge > 0) {
        const k = Math.min(0.45, edge * 0.45);
        r += (base[0] - r) * k;
        g += (base[1] - g) * k;
        b += (base[2] - b) * k;
      }
      const o = (y * W + x) * 3;
      px[o] = Math.max(0, Math.min(255, Math.round(r)));
      px[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      px[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return encodePNG(W, H, 2, px);
}

// ---- write everything -----------------------------------------------------------

const fixtureDir = join(ROOT, 'test', 'fixtures');
mkdirSync(fixtureDir, { recursive: true });

const fixtures = {
  'solid.png': solidQuadrants,
  'gray.png': grayGradient,
  'grayalpha.png': grayAlpha,
  'rgba.png': rgbaQuadrants,
  'filters.png': filteredGradient,
  'interlaced.png': interlaced,
  'bitdepth16.png': bitDepth16,
  'tiny.png': tiny,
};

for (const [name, make] of Object.entries(fixtures)) {
  writeFileSync(join(fixtureDir, name), make());
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
writeFileSync(join(ROOT, 'assets', 'demo-image.png'), demoImage());

console.log(`wrote ${Object.keys(fixtures).length} fixtures in test/fixtures + assets/demo-image.png`);
