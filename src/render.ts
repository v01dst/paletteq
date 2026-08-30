import type { PaletteColor } from './quantize.js';

export type ColorMode = 'auto' | 'always' | 'never';

export type { PaletteColor } from './quantize.js';

const RESET = '\x1b[0m';
const SWATCH_BLOCKS = 12;

function truecolor(rgb: readonly [number, number, number]): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/**
 * Decide whether ANSI color should be used.
 *
 * Precedence: explicit mode > FORCE_COLOR > NO_COLOR > TTY detection.
 * `FORCE_COLOR=0|false` disables; any other value (including empty) enables.
 */
export function resolveUseColor(mode: ColorMode = 'auto'): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  const fc = process.env.FORCE_COLOR;
  if (fc !== undefined) return fc !== '0' && fc !== 'false';
  if (process.env.NO_COLOR !== undefined) return false;
  return Boolean(process.stdout.isTTY);
}

/**
 * ANSI truecolor swatch table — one ranked row per color with hex label,
 * population share and suggested text color. When `useColor` is false,
 * a plain list is printed instead.
 */
export function renderTable(palette: readonly PaletteColor[], useColor: boolean): string {
  const lines: string[] = [];
  lines.push(`palette — ${palette.length} color${palette.length === 1 ? '' : 's'} (ranked by share)`);
  lines.push('');
  palette.forEach((c, i) => {
    const rank = String(i + 1).padStart(2, ' ');
    const pct = `${(c.population * 100).toFixed(1)}%`.padStart(6, ' ');
    if (useColor) {
      const swatch = `${truecolor(c.rgb)}${'█'.repeat(SWATCH_BLOCKS)}${RESET}`;
      lines.push(`  ${rank}  ${swatch}  ${c.hex}  ${pct}   text ${c.foreground}`);
    } else {
      lines.push(`  ${rank}  ${c.hex}  ${pct}   text ${c.foreground}`);
    }
  });
  return lines.join('\n') + '\n';
}

/** CSS custom properties on `:root`. */
export function toCSS(palette: readonly PaletteColor[]): string {
  const lines = palette.map((c, i) => `  --palette-${i + 1}: ${c.hex};`);
  return `/* paletteq — ${palette.length} colors */\n:root {\n${lines.join('\n')}\n}\n`;
}

/** SCSS variables, annotated with population share. */
export function toSCSS(palette: readonly PaletteColor[]): string {
  const lines = palette.map(
    (c, i) => `$palette-${i + 1}: ${c.hex}; // ${(c.population * 100).toFixed(1)}%`
  );
  return `// paletteq — ${palette.length} colors\n${lines.join('\n')}\n`;
}

/** Tailwind CSS `theme.extend.colors` snippet. */
export function toTailwind(palette: readonly PaletteColor[]): string {
  const colors = palette
    .map((c, i) => `        'palette-${i + 1}': '${c.hex}',`)
    .join('\n');
  return `// paletteq — merge into your tailwind.config.js under theme.extend\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${colors}\n      },\n    },\n  },\n};\n`;
}

/** JSON document with metadata + colors. */
export function toJSON(palette: readonly PaletteColor[]): string {
  const doc = {
    count: palette.length,
    colors: palette.map((c) => ({
      hex: c.hex,
      rgb: c.rgb,
      population: c.population,
      foreground: c.foreground,
    })),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** SVG swatch grid (4 columns) with hex + share labels. */
export function toSVG(palette: readonly PaletteColor[]): string {
  const n = Math.max(palette.length, 1);
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const cell = 140;
  const w = cols * cell;
  const h = rows * cell;
  const font = `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];
  palette.forEach((c, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * cell;
    const tx = x + cell / 2;
    const ty = y + cell / 2;
    parts.push(`  <rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${c.hex}"/>`);
    parts.push(
      `  <text x="${tx}" y="${ty - 2}" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="600" fill="${c.foreground}" ${font}>${c.hex}</text>`
    );
    parts.push(
      `  <text x="${tx}" y="${ty + 22}" text-anchor="middle" font-size="11" opacity="0.75" fill="${c.foreground}" ${font}>${(c.population * 100).toFixed(1)}%</text>`
    );
  });
  parts.push('</svg>');
  parts.push('');
  return parts.join('\n');
}
