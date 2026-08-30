import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join('dist', 'cli.js');

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('table format: plain list without color, ANSI with FORCE_COLOR=1', () => {
  const plain = run(['assets/demo-image.png', '-n', '6', '--no-color']);
  assert.equal(plain.status, 0);
  assert.doesNotMatch(plain.stdout, /\x1b\[/);
  assert.match(plain.stdout, /#?[0-9a-f]{6}/i);
  assert.match(plain.stdout, /#ec|#[0-9a-f]{6}/i);

  const colored = run(['assets/demo-image.png', '-n', '6'], { FORCE_COLOR: '1' });
  assert.equal(colored.status, 0);
  assert.match(colored.stdout, /\x1b\[38;2;\d+;\d+;\d+m/);
});

test('css format: valid custom properties on stdout', () => {
  const r = run(['assets/demo-image.png', '-n', '4', '-f', 'css']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /:root \{/);
  assert.match(r.stdout, /--palette-1: #[0-9a-f]{6};/);
});

test('json format: parseable, correct count', () => {
  const r = run(['test/fixtures/solid.png', '-n', '4', '-f', 'json']);
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.count, 4);
  assert.equal(doc.colors.length, 4);
  assert.ok(doc.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
});

test('svg format: emits an SVG document', () => {
  const r = run(['assets/demo-image.png', '-n', '4', '-f', 'svg']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(r.stdout.match(/<rect /g).length, 4);
});

test('--out writes a file and reports to stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paletteq-test-'));
  const file = join(dir, 'palette.css');
  try {
    const r = run(['test/fixtures/solid.png', '-n', '4', '-f', 'css', '-o', file]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /wrote/);
    assert.equal(r.stdout, '');
    const written = readFileSync(file, 'utf8');
    assert.match(written, /:root/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('determinism across CLI invocations with --seed', () => {
  const a = run(['assets/demo-image.png', '-n', '5', '-f', 'json', '--seed', '11']);
  const b = run(['assets/demo-image.png', '-n', '5', '-f', 'json', '--seed', '11']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout, b.stdout);
});

test('missing file exits 1 with a stderr message', () => {
  const r = run(['no-such-file.png']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /paletteq/);
  assert.match(r.stderr, /not found/);
});

test('unknown option exits 1', () => {
  const r = run(['assets/demo-image.png', '--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown option/);
});

test('invalid count exits 1', () => {
  const r = run(['assets/demo-image.png', '-n', '0']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--count/);
});

test('--help and --version work', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /USAGE/);
  assert.match(help.stdout, /--format/);

  const ver = run(['--version']);
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /0\.1\.0/);
});
