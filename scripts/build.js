#!/usr/bin/env node
/**
 * Deploy-time-only minification. Source files are never touched — this
 * reads them, minifies script.js/data.js/sw.js/style.css, and writes a
 * clean dist/ containing exactly what ships. wrangler.jsonc's
 * assets.directory points at dist/, so this has to have run before any
 * deploy or Workers preview. Everything else (index.html, manifest.json,
 * robots.txt, sitemap.xml, _headers, assets/, icons/) is copied through
 * byte-for-byte; only these four files change.
 *
 * `npm start` (serve.py) never runs this and serves the real, unminified
 * source straight from the repo root — that's the everyday editing loop.
 * `npm run dev` does build first, because it runs the actual Workers
 * runtime and should therefore exercise exactly what gets deployed.
 *
 * data.js is a special case. It has NO module system and NO wrapping
 * IIFE — its top-level `const BOARD_THEMES = ...` etc. are real globals
 * that script.js (a separate <script> tag, loaded after it) reaches by
 * name. Mangling top-level names would rename BOARD_THEMES in data.js but
 * leave script.js still asking for the literal identifier "BOARD_THEMES",
 * silently breaking the entire app the moment mangle ran. `toplevel:
 * false` (terser's own default, set explicitly here so it can never
 * change by accident) keeps every top-level name exactly as written.
 * script.js is IIFE-wrapped — nothing outside it ever sees its internal
 * names — and sw.js runs in its own isolated service-worker scope, so
 * mangling those two fully is safe.
 */
const fs = require('fs');
const path = require('path');
const { minify: minifyJs } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Copied verbatim — nothing here needs a build step, and this list is also
// the whole reason no .assetsignore is needed inside dist/: nothing else
// ever lands there for it to exclude.
const COPY_VERBATIM = [
  'index.html',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  'assets',
  'icons',
];

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const name of COPY_VERBATIM) {
    fs.cpSync(path.join(ROOT, name), path.join(DIST, name), { recursive: true });
  }

  await minifyJsFile('script.js', { toplevel: false });
  await minifyJsFile('data.js', { toplevel: false });
  await minifyJsFile('sw.js', { toplevel: false });
  minifyCssFile('style.css');

  console.log('\nBuilt dist/ — wrangler.jsonc points assets.directory here, so `wrangler deploy` ships it.');
}

async function minifyJsFile(name, mangle) {
  const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
  const result = await minifyJs(src, { compress: true, mangle });
  if (result.error) throw result.error;
  fs.writeFileSync(path.join(DIST, name), result.code);
  report(name, src.length, result.code.length);
}

function minifyCssFile(name) {
  const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
  const result = new CleanCSS({}).minify(src);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  fs.writeFileSync(path.join(DIST, name), result.styles);
  report(name, src.length, result.styles.length);
}

function report(name, before, after) {
  const pct = Math.round((1 - after / before) * 100);
  console.log(`  ${name.padEnd(10)} ${before.toString().padStart(6)} -> ${after.toString().padStart(6)} bytes  (${pct}% smaller)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
