import { decodePNG } from './png.js';
import { quantize, DEFAULT_COUNT, DEFAULT_SEED } from './quantize.js';
import type { PaletteColor } from './quantize.js';

export interface ExtractOptions {
  /** Number of colors to extract (1–24, default: 8). */
  count?: number;
  /** Seed for the deterministic PRNG (default: 42). Same seed + image → same palette. */
  seed?: number;
}

export type { PaletteColor } from './quantize.js';
export type { RGBImage, DecodeOptions } from './png.js';
export type { QuantizeOptions, Foreground } from './quantize.js';
export type { ColorMode } from './render.js';

export { decodePNG } from './png.js';
export {
  quantize,
  mulberry32,
  relativeLuminance,
  suggestForeground,
  toHex,
  DEFAULT_COUNT,
  DEFAULT_SEED,
} from './quantize.js';
export {
  renderTable,
  toCSS,
  toSCSS,
  toTailwind,
  toJSON,
  toSVG,
  resolveUseColor,
} from './render.js';

/**
 * Extract a color palette from a PNG image.
 *
 * ```ts
 * import { extractPalette } from 'paletteq';
 * import { readFile } from 'node:fs/promises';
 *
 * const png = await readFile('photo.png');
 * const palette = await extractPalette(png, { count: 8, seed: 42 });
 * palette[0].hex;        // '#ec4899'
 * palette[0].population; // 0.234
 * palette[0].foreground; // '#ffffff'
 * ```
 *
 * @param input  PNG file contents (8-bit, non-interlaced; color types 0/2/4/6)
 * @param opts   `count` colors to extract, `seed` for reproducibility
 * @throws Error with a descriptive message for malformed/unsupported PNGs
 */
export async function extractPalette(
  input: Uint8Array | Buffer,
  opts: ExtractOptions = {}
): Promise<PaletteColor[]> {
  const image = decodePNG(input);
  return quantize(image, {
    count: opts.count ?? DEFAULT_COUNT,
    seed: opts.seed ?? DEFAULT_SEED,
  });
}
