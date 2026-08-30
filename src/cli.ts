#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { extractPalette } from './index.js';
import {
  renderTable,
  toCSS,
  toSCSS,
  toTailwind,
  toJSON,
  toSVG,
  resolveUseColor,
  type ColorMode,
} from './render.js';
import { VERSION } from './version.js';

const FORMATS = ['table', 'css', 'scss', 'tailwind', 'json', 'svg'] as const;
type Format = (typeof FORMATS)[number];

const HELP = `paletteq ${VERSION} — extract gorgeous color palettes from any image

USAGE
  paletteq <image.png> [options]

ARGUMENTS
  image.png              path to a PNG file (8-bit, non-interlaced)

OPTIONS
  -n, --count <n>        number of colors to extract (1–24, default: 8)
  -f, --format <fmt>     output format: ${FORMATS.join(', ')} (default: table)
  -o, --out <file>       write output to a file instead of stdout
      --seed <n>         PRNG seed for reproducible palettes (default: 42)
      --color[=MODE]     colored output: always, auto, never (default: auto)
      --no-color         disable colored output
  -V, --version          print version
  -h, --help             show this help

EXAMPLES
  paletteq photo.png
  paletteq photo.png -n 6
  paletteq photo.png -f css > palette.css
  paletteq photo.png -f tailwind -o paletteq.tailwind.js
  paletteq photo.png -f svg -o palette.svg
  paletteq photo.png --seed 7 --no-color | pbcopy

ENV
  FORCE_COLOR            set to 1 to force colored output (0 to disable)
  NO_COLOR               set to disable colored output`;

interface CliOptions {
  image: string;
  count: number;
  format: Format;
  out?: string;
  color: ColorMode;
  seed: number;
}

function fail(message: string): never {
  console.error(`paletteq: ${message}`);
  console.error(`run 'paletteq --help' for usage`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): CliOptions {
  // normalize --flag=value into two tokens
  const args: string[] = [];
  for (const a of argv) {
    const m = /^(--(?:count|format|out|color|seed))=(.*)$/.exec(a);
    if (m) {
      args.push(m[1], m[2]);
    } else {
      args.push(a);
    }
  }

  let image: string | undefined;
  let count = 8;
  let format: Format = 'table';
  let seed = 42;
  let out: string | undefined;
  let color: ColorMode = 'auto';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
      case '-V':
      case '--version':
        console.log(`paletteq ${VERSION}`);
        process.exit(0);
      case '-n':
      case '--count': {
        const raw = args[++i];
        const v = raw === undefined ? NaN : Number(raw);
        if (!Number.isInteger(v) || v < 1 || v > 24) {
          fail(`--count must be an integer between 1 and 24 (got '${raw ?? ''}')`);
        }
        count = v;
        break;
      }
      case '-f':
      case '--format': {
        const raw = args[++i];
        if (raw === undefined || !(FORMATS as readonly string[]).includes(raw)) {
          fail(`--format must be one of: ${FORMATS.join(', ')}${raw === undefined ? '' : ` (got '${raw}')`}`);
        }
        format = raw as Format;
        break;
      }
      case '-o':
      case '--out': {
        const raw = args[++i];
        if (raw === undefined) fail('missing value for --out');
        out = raw;
        break;
      }
      case '--seed': {
        const raw = args[++i];
        const v = raw === undefined ? NaN : Number(raw);
        if (!Number.isInteger(v)) fail(`--seed must be an integer (got '${raw ?? ''}')`);
        seed = v;
        break;
      }
      case '--color': {
        const next = args[i + 1];
        if (next === 'always' || next === 'auto' || next === 'never') {
          color = next;
          i++;
        } else {
          color = 'always';
        }
        break;
      }
      case '--no-color':
        color = 'never';
        break;
      default:
        if (a.startsWith('-') && a !== '-') {
          fail(`unknown option '${a}'`);
        }
        if (image === undefined) {
          image = a;
        } else {
          fail(`unexpected argument '${a}'`);
        }
        break;
    }
  }

  if (image === undefined) fail('missing <image.png> argument');
  return { image, count, format, out, color, seed };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  let buf: Buffer;
  try {
    buf = await readFile(opts.image);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') fail(`file not found: ${opts.image}`);
    if (e.code === 'EISDIR') fail(`${opts.image} is a directory`);
    fail(`cannot read ${opts.image}: ${e.message ?? String(err)}`);
  }

  const palette = await extractPalette(buf, { count: opts.count, seed: opts.seed });

  let text: string;
  switch (opts.format) {
    case 'table':
      text = renderTable(palette, resolveUseColor(opts.color));
      break;
    case 'css':
      text = toCSS(palette);
      break;
    case 'scss':
      text = toSCSS(palette);
      break;
    case 'tailwind':
      text = toTailwind(palette);
      break;
    case 'json':
      text = toJSON(palette);
      break;
    case 'svg':
      text = toSVG(palette);
      break;
  }

  if (opts.out) {
    await writeFile(opts.out, text, 'utf8');
    console.error(`paletteq: wrote ${opts.out} (${Buffer.byteLength(text)} bytes, ${palette.length} colors)`);
  } else {
    process.stdout.write(text);
  }
}

main().catch((err: unknown) => {
  console.error(`paletteq: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
