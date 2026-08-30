import { inflateSync } from 'node:zlib';

/**
 * A decoded image in flat RGB form: 3 bytes per pixel, row-major,
 * top-left origin. Alpha, when present in the source PNG, is discarded.
 */
export interface RGBImage {
  width: number;
  height: number;
  /** RGB triples, `width * height * 3` bytes. */
  data: Uint8Array;
}

export interface DecodeOptions {
  /** Verify chunk CRCs (default: true). */
  validateCrc?: boolean;
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Supported color types -> channels per pixel. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const COLOR_NAMES: Record<number, string> = {
  0: 'grayscale',
  2: 'RGB',
  3: 'indexed/palette',
  4: 'grayscale + alpha',
  6: 'RGBA',
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG Paeth predictor (spec 6.1). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filterMethod: number;
  interlace: number;
}

/**
 * Decode a PNG file into flat RGB pixels.
 *
 * Supports 8-bit, non-interlaced PNGs of color type 0 (grayscale),
 * 2 (RGB), 4 (grayscale + alpha) and 6 (RGBA). Alpha is discarded.
 * Throws `Error` with a clear message on any structural deviation.
 */
export function decodePNG(input: Uint8Array | Buffer, options: DecodeOptions = {}): RGBImage {
  const validateCrc = options.validateCrc ?? true;
  const buf = input;

  if (buf.length < SIGNATURE.length || !SIGNATURE.every((b, i) => buf[i] === b)) {
    throw new Error('not a PNG file (bad signature)');
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let ihdr: Ihdr | undefined;
  const idat: Uint8Array[] = [];
  let seenIEND = false;
  let offset = SIGNATURE.length;

  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error('corrupt PNG: truncated chunk header');
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) throw new Error(`corrupt PNG: chunk ${type} extends past end of file`);
    const data = buf.subarray(dataStart, dataEnd);

    if (validateCrc) {
      const expected = dv.getUint32(dataEnd);
      const actual = crc32(buf.subarray(offset + 4, dataEnd));
      if (expected !== actual) throw new Error(`corrupt PNG: CRC mismatch in ${type} chunk`);
    }

    switch (type) {
      case 'IHDR': {
        if (length !== 13) throw new Error('corrupt PNG: IHDR must be exactly 13 bytes');
        ihdr = {
          width: dv.getUint32(dataStart),
          height: dv.getUint32(dataStart + 4),
          bitDepth: buf[dataStart + 8],
          colorType: buf[dataStart + 9],
          compression: buf[dataStart + 10],
          filterMethod: buf[dataStart + 11],
          interlace: buf[dataStart + 12],
        };
        break;
      }
      case 'IDAT':
        idat.push(data);
        break;
      case 'IEND':
        seenIEND = true;
        break;
      default:
        break; // ancillary chunks (PLTE, tRNS, gAMA, ...) are ignored
    }

    offset = dataEnd + 4;
    if (seenIEND) break;
  }

  if (!ihdr) throw new Error('corrupt PNG: missing IHDR chunk');
  if (!seenIEND) throw new Error('corrupt PNG: truncated file (missing IEND chunk)');
  const { width, height, bitDepth, colorType, compression, filterMethod, interlace } = ihdr;

  if (width === 0 || height === 0) throw new Error('corrupt PNG: zero-sized image');
  if (compression !== 0) throw new Error(`unsupported PNG compression method ${compression} (only 0 is valid)`);
  if (filterMethod !== 0) throw new Error(`unsupported PNG filter method ${filterMethod} (only 0 is valid)`);
  if (interlace === 1) throw new Error('interlaced PNG (Adam7) is not supported — re-export the image without interlacing');
  if (interlace !== 0) throw new Error(`corrupt PNG: unknown interlace method ${interlace}`);
  if (bitDepth !== 8) {
    throw new Error(`unsupported bit depth ${bitDepth} — only 8-bit PNGs are supported`);
  }
  if (!(colorType in CHANNELS)) {
    throw new Error(
      `unsupported color type ${colorType} (${COLOR_NAMES[colorType] ?? 'unknown'}) — supported: 0 (gray), 2 (RGB), 4 (gray+alpha), 6 (RGBA)`
    );
  }

  if (idat.length === 0) throw new Error('corrupt PNG: no IDAT chunks');

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (err) {
    throw new Error(`corrupt PNG: decompression failed (${err instanceof Error ? err.message : String(err)})`);
  }

  return unfilterAndConvert(raw, width, height, colorType);
}

function unfilterAndConvert(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number
): RGBImage {
  const channels = CHANNELS[colorType];
  const stride = width * channels;
  const scanline = stride + 1;
  if (raw.length < height * scanline) {
    throw new Error(`corrupt PNG: not enough pixel data (${raw.length} bytes, need ${height * scanline})`);
  }

  const out = new Uint8Array(width * height * 3);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * scanline];
    if (filter > 4) throw new Error(`corrupt PNG: invalid filter type ${filter} on scanline ${y}`);
    const rowStart = y * scanline + 1;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = rawByte;
          break;
        case 1:
          v = rawByte + a;
          break;
        case 2:
          v = rawByte + b;
          break;
        case 3:
          v = rawByte + ((a + b) >> 1);
          break;
        default:
          v = rawByte + paeth(a, b, c);
          break;
      }
      cur[x] = v & 0xff;
    }

    let o = y * width * 3;
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      if (colorType === 2 || colorType === 6) {
        out[o] = cur[s];
        out[o + 1] = cur[s + 1];
        out[o + 2] = cur[s + 2];
      } else {
        // color type 0 (gray) and 4 (gray + alpha): replicate the sample
        const g = cur[s];
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
      }
      o += 3;
    }

    prev.set(cur);
  }

  return { width, height, data: out };
}
