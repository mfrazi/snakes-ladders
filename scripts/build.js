#!/usr/bin/env node
/**
 * Deploy-time-only minification. Source files are never touched — this
 * reads them, minifies the scripts and style.css, and writes a clean dist/
 * containing exactly what ships. wrangler.jsonc's assets.directory points at
 * dist/, so this has to have run before any deploy or Workers preview.
 * Everything else (index.html, manifest.json, robots.txt, sitemap.xml,
 * _headers, assets/, icons/) is copied through byte-for-byte.
 *
 * It also writes the Indonesian landing page, dist/id.html (served at /id),
 * and its install manifest, dist/manifest-id.json, from index.html and
 * manifest.json plus the Indonesian text in scripts/seo-id.js. See
 * buildIndonesianPage() below.
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
const vm = require('vm');
const { minify: minifyJs } = require('terser');
const CleanCSS = require('clean-css');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Copied verbatim — nothing here needs a build step. This list is also what
// keeps dev files (serve.py, scripts/, package.json) off the deployed site:
// nothing else ever lands in dist/, so there's nothing to exclude.
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
  // Same rule as data.js: plain globals (I18N, LANGUAGES, QUESTIONS_ID) that
  // script.js reaches by name, so top-level names must survive untouched.
  await minifyJsFile('i18n.js', { toplevel: false });
  await minifyJsFile('data-id.js', { toplevel: false });
  await minifyJsFile('sw.js', { toplevel: false });
  minifyCssFile('style.css');

  buildIndonesianPage();
  buildIndonesianManifest();

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

// The Indonesian landing page. A page ranks in the language it's written in,
// so Indonesian search needs a URL of its own: /id is index.html with its
// head (title, description, link previews, structured data), its <noscript>
// text and every static data-i18n string in Indonesian. The hreflang links in
// index.html pair the two. The app is the same one; it opens in Indonesian
// because the page says lang="id" (loadLanguage() in script.js), unless the
// player has already chosen a language.
//
// It's dist/id.html, which Cloudflare serves at /id (assets.html_handling in
// wrangler.jsonc). It sits at the root, not in an id/ folder, so style.css,
// sw.js and assets/ resolve exactly as they do from / — the other fix, a
// <base> tag, is blocked by the CSP's base-uri 'none'.
function buildIndonesianPage() {
  const seo = require('./seo-id.js');
  const strings = readGlobal('i18n.js', 'I18N').id;
  const pick = (key) => {
    const value = strings[key];
    if (typeof value !== 'string' || value.includes('{')) {
      throw new Error(`id.html: no plain Indonesian string for "${key}"`);
    }
    return value;
  };
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const url = new URL('id', once(html, /<link rel="canonical" href="([^"]+)"/)[1]).href;
  const meta = (key, name, content) =>
    (html = swap(html, new RegExp(`(<meta\\s+${key}="${name}"\\s+content=")[^"]*(")`), content));

  html = swap(html, /(<html lang=")en(")/, 'id');
  html = swap(html, /(<title>)[^<]*(<\/title>)/, seo.title, text);
  html = swap(html, /(<link rel="canonical" href=")[^"]*(")/, url);
  html = swap(html, /(<link rel="manifest" href=")manifest\.json(")/, 'manifest-id.json');
  meta('name', 'description', seo.description);
  meta('property', 'og:site_name', seo.siteName);
  meta('property', 'og:title', seo.ogTitle);
  meta('property', 'og:description', seo.ogDescription);
  meta('property', 'og:url', url);
  meta('property', 'og:image:alt', seo.imageAlt);
  meta('property', 'og:locale', 'id_ID');
  meta('property', 'og:locale:alternate', 'en_US');
  meta('name', 'twitter:title', seo.ogTitle);
  meta('name', 'twitter:description', seo.twitterDescription);
  meta('name', 'apple-mobile-web-app-title', seo.appleTitle);

  const ldPattern = /(<script type="application\/ld\+json">\n)([\s\S]*?)(\n<\/script>)/;
  const ld = { ...JSON.parse(once(html, ldPattern)[2]), ...seo.jsonLd, url };
  // "<" escaped, so no string in it can ever close the <script>.
  html = swap(html, ldPattern, JSON.stringify(ld, null, 2).replace(/</g, '\\u003c'), (s) => s);
  html = swap(html, /()<noscript>[\s\S]*?<\/noscript>()/, seo.noscript, (s) => s);

  // Static strings, the same two hooks applyLanguage() fills at runtime.
  // Every data-i18n element holds plain text (applyLanguage sets
  // textContent), which is what lets a pattern stand in for a parser; the
  // count check catches one that doesn't.
  let filled = 0;
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g, (m, open, tag, key, close) => {
    filled++;
    return open + text(pick(key)) + close;
  });
  const hooks = (html.match(/\sdata-i18n="/g) || []).length;
  if (filled !== hooks) throw new Error(`id.html: filled ${filled} of ${hooks} data-i18n elements`);
  html = html.replace(/<[a-z0-9]+\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec) =>
    spec.split(';').reduce((out, pair) => {
      const [name, key] = pair.split(':');
      const value = attr(pick(key));
      const existing = new RegExp(`(\\s${name}=")[^"]*(")`);
      return existing.test(out)
        ? out.replace(existing, (m, a, b) => a + value + b)
        : out.replace(/\sdata-i18n-attr=/, (m) => ` ${name}="${value}"${m}`);
    }, tag)
  );

  fs.writeFileSync(path.join(DIST, 'id.html'), html);
  console.log(`  id.html    written from index.html in Indonesian, for ${url}`);
}

// manifest.json with Indonesian names and a start_url of the Indonesian page,
// so an app installed from /id keeps opening in Indonesian. The id is left as
// it is: both manifests describe one app.
function buildIndonesianManifest() {
  const { screenshots, ...fields } = require('./seo-id.js').manifest;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  Object.assign(manifest, fields);
  if (screenshots.length !== manifest.screenshots.length) throw new Error('manifest-id.json: screenshot count differs');
  manifest.screenshots = manifest.screenshots.map((shot, i) => ({ ...shot, ...screenshots[i] }));
  manifest.screenshots.forEach((shot) => {
    if (!fs.existsSync(path.join(ROOT, shot.src))) throw new Error(`manifest-id.json: missing ${shot.src}`);
  });
  fs.writeFileSync(path.join(DIST, 'manifest-id.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('  manifest-id.json written from manifest.json in Indonesian');
}

// Exactly one match of `re`, or the build fails: a pattern that stops
// matching after an edit to index.html must not quietly ship English at /id.
function once(html, re) {
  const all = html.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) || [];
  if (all.length !== 1) throw new Error(`id.html: expected one match for ${re}, found ${all.length}`);
  return html.match(re);
}

// Replaces the one match of `re` with its first and last capture groups
// around `value`, escaped for an attribute unless `escape` says otherwise.
function swap(html, re, value, escape = attr) {
  once(html, re);
  return html.replace(re, (...m) => {
    const groups = m.slice(1, -2);
    return groups[0] + escape(value) + groups[groups.length - 1];
  });
}

function text(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(s) {
  return text(s).replace(/"/g, '&quot;');
}

// i18n.js is a plain script, not a module, so it runs in a sandbox and the
// global is read back — the same way the content checks in AGENTS.md do it.
function readGlobal(file, name) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, file), 'utf8')};this.${name} = ${name};`, sandbox);
  return sandbox[name];
}

function report(name, before, after) {
  const pct = Math.round((1 - after / before) * 100);
  console.log(`  ${name.padEnd(10)} ${before.toString().padStart(6)} -> ${after.toString().padStart(6)} bytes  (${pct}% smaller)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
