import type { RGBImage } from './png.js';

export type Foreground = '#000000' | '#ffffff';

export interface PaletteColor {
  /** Color as `#rrggbb` (lowercase). */
  hex: string;
  /** Color as `[r, g, b]`, each 0–255. */
  rgb: [number, number, number];
  /** Share of sampled pixels (0–1). Clusters are sorted by this, descending. */
  population: number;
  /** Suggested text color for maximum WCAG contrast on top of this color. */
  foreground: Foreground;
}

export interface QuantizeOptions {
  /** Number of colors to extract (default: 8). */
  count?: number;
  /** Seed for the deterministic PRNG (default: 42). */
  seed?: number;
}

export const DEFAULT_COUNT = 8;
export const DEFAULT_SEED = 42;

const MAX_SAMPLES = 20000;
const MAX_ITERATIONS = 25;
const MAX_COUNT = 24;

/**
 * Deterministic 32-bit PRNG (mulberry32). Same seed -> same sequence.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toHex(rgb: readonly [number, number, number]): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/**
 * Pick black or white text for best WCAG contrast on `rgb`.
 */
export function suggestForeground(rgb: readonly [number, number, number]): Foreground {
  const lum = relativeLuminance(rgb);
  const contrastWithWhite = 1.05 / (lum + 0.05);
  const contrastWithBlack = (lum + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#000000';
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Extract a palette from a decoded RGB image.
 *
 * Pixels are uniformly sampled (capped at ~20k samples), clustered with
 * k-means++ initialization + Lloyd iterations (max 25, converges early),
 * then merged, sorted by population (descending) and returned.
 * Fully deterministic for a given image + seed.
 */
export function quantize(image: RGBImage, options: QuantizeOptions = {}): PaletteColor[] {
  const count = options.count ?? DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer (got ${count})`);
  }
  const seed = options.seed ?? DEFAULT_SEED;

  const { width, height, data } = image;
  const total = width * height;
  if (total === 0) throw new Error('image has no pixels');

  // ---- uniform sampling (cap ~MAX_SAMPLES points) --------------------------
  const step = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const start = Math.floor(step / 2);
  const samples: number[] = [];
  for (let i = start; i < total; i += step) {
    const o = i * 3;
    samples.push(data[o], data[o + 1], data[o + 2]);
  }
  const n = samples.length / 3;
  if (n === 0) throw new Error('image has no pixels to sample');
  const pts = Float64Array.from(samples);

  const k = Math.min(count, MAX_COUNT, n);
  const rng = mulberry32(seed);

  // ---- k-means++ seeding ----------------------------------------------------
  const centers = new Float64Array(k * 3);
  const d2 = new Float64Array(n).fill(Infinity);
  const pickCenter = (slot: number, index: number): void => {
    centers[slot * 3] = pts[index * 3];
    centers[slot * 3 + 1] = pts[index * 3 + 1];
    centers[slot * 3 + 2] = pts[index * 3 + 2];
  };

  pickCenter(0, Math.floor(rng() * n));
  for (let c = 1; c < k; c++) {
    const cr = centers[(c - 1) * 3];
    const cg = centers[(c - 1) * 3 + 1];
    const cb = centers[(c - 1) * 3 + 2];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dr = pts[i * 3] - cr;
      const dg = pts[i * 3 + 1] - cg;
      const db = pts[i * 3 + 2] - cb;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < d2[i]) d2[i] = dist;
      sum += d2[i];
    }
    if (sum <= 0) {
      pickCenter(c, Math.floor(rng() * n));
    } else {
      const target = rng() * sum;
      let acc = 0;
      let pick = n - 1;
      for (let i = 0; i < n; i++) {
        acc += d2[i];
        if (acc >= target) {
          pick = i;
          break;
        }
      }
      pickCenter(c, pick);
    }
  }

  // ---- Lloyd iterations ------------------------------------------------------
  const assign = new Int32Array(n).fill(-1);
  const counts = new Int32Array(k);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    let farIndex = 0;
    let farDist = -1;
    counts.fill(0);
    const sums = new Float64Array(k * 3);

    for (let i = 0; i < n; i++) {
      const pr = pts[i * 3];
      const pg = pts[i * 3 + 1];
      const pb = pts[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pr - centers[c * 3];
        const dg = pg - centers[c * 3 + 1];
        const db = pb - centers[c * 3 + 2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      if (best !== assign[i]) {
        changed = true;
        assign[i] = best;
      }
      counts[best]++;
      sums[best * 3] += pr;
      sums[best * 3 + 1] += pg;
      sums[best * 3 + 2] += pb;
      if (bestD > farDist) {
        farDist = bestD;
        farIndex = i;
      }
    }

    if (!changed) break;

    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // re-seed empty cluster at the point farthest from its center
        pickCenter(c, farIndex);
      } else {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
  }

  // ---- final assignment pass for accurate populations ------------------------
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const pr = pts[i * 3];
    const pg = pts[i * 3 + 1];
    const pb = pts[i * 3 + 2];
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = pr - centers[c * 3];
      const dg = pg - centers[c * 3 + 1];
      const db = pb - centers[c * 3 + 2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    counts[best]++;
  }

  // ---- merge identical colors, sort, build result -----------------------------
  interface Bucket {
    r: number;
    g: number;
    b: number;
    count: number;
  }
  const buckets = new Map<string, Bucket>();
  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) continue;
    const r = clamp255(centers[c * 3]);
    const g = clamp255(centers[c * 3 + 1]);
    const b = clamp255(centers[c * 3 + 2]);
    const rgb: [number, number, number] = [r, g, b];
    const hex = toHex(rgb);
    const existing = buckets.get(hex);
    if (existing) {
      existing.count += counts[c];
    } else {
      buckets.set(hex, { r, g, b, count: counts[c] });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.r !== b.r) return a.r - b.r;
    if (a.g !== b.g) return a.g - b.g;
    return a.b - b.b;
  });

  return sorted.map((bucket) => {
    const rgb: [number, number, number] = [bucket.r, bucket.g, bucket.b];
    return {
      hex: toHex(rgb),
      rgb,
      population: bucket.count / n,
      foreground: suggestForeground(rgb),
    };
  });
}
