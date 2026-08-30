# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-30

### Added

- Pure TypeScript PNG decoder (8-bit, color types 0/2/4/6, filters 0–4, CRC validation, non-interlaced).
- Palette extraction via k-means++ with seeded PRNG (mulberry32) — fully deterministic.
- WCAG relative-luminance contrast suggestion (`#000000` / `#ffffff` text) per color.
- ANSI truecolor swatch table renderer with `--color` / `--no-color` / `FORCE_COLOR` / `NO_COLOR` support.
- Exporters: CSS custom properties, SCSS variables, Tailwind theme snippet, JSON, SVG swatch grid.
- CLI: `paletteq <image.png> [-n count] [-f format] [-o file] [--seed n] [--color|--no-color] [-V] [-h]`.
- Zero runtime dependencies.
