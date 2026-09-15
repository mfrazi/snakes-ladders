# AGENTS.md

Working notes for anyone — human or AI — changing this project. The README is
for players; this is the part that explains *why* things are the way they are,
and which of them will bite you if you "clean them up".

## Shape of the project

Plain HTML/CSS/JS. No framework, no bundler, no module system. Four source
files do everything:

| File | What's in it |
|---|---|
| `index.html` | Markup, the SVG icon sprite, SEO/meta, the PWA manifest link |
| `style.css` | Everything visual. One elevation ramp, theme variables at `:root` |
| `data.js` | Content only — questions, surprises, board scenes, board density |
| `script.js` | All behaviour, wrapped in one IIFE |

`data.js` has **no module system and no wrapping IIFE**. Its top-level
`const BOARD_THEMES = …` (and friends) are real globals that `script.js` — a
separate `<script>` tag, loaded after it — reaches by name. This matters for
minification; see "Build" below.

Local dev is `python3 serve.py` (port 8791). `npm run dev` runs the real
Cloudflare Workers runtime instead, which is the only way to exercise
`_headers` and `.assetsignore` as they behave in production.

## Two modes, one content file

Mode is chosen before a game starts and fixed for that game. Each topic in
`QUESTIONS` (`data.js`) splits three ways:

```js
topic: { shared: [...], couples: [...], friends: [...] }
```

The pool for a game is `shared` + the list for the mode in play — so every
topic offers **52 questions per mode** (18 shared + 34 mode-specific), 624 per
mode overall, from 1,020 distinct lines. Questions that read naturally for both
audiences live in `shared` and are written once; only genuinely
partner-specific ones are duplicated.

Surprises work the same way: `friends` on a card is alternate wording (mostly
"your partner" → "another player"), and `only` restricts a card to one mode.
That's what keeps the romantic dares out of a game between friends.

**If you add questions, keep partner-specific wording out of `shared`.** This
catches it:

```bash
node -e "const vm=require('vm'),c={};vm.createContext(c);vm.runInContext(require('fs').readFileSync('data.js','utf8')+';this.Q=QUESTIONS',c);for(const[t,v]of Object.entries(c.Q))for(const q of (v.shared||[]).concat(v.friends||[]))if(/\bpartner\b|\bcouple\b/i.test(q))console.log(t+': '+q)"
```

Mode is stored on the game, not globally, so a game in progress keeps the mode
it started in — **Play again** does too. A game saved before modes existed
loads as Couples.

**The player-facing counts in `index.html` (meta description, JSON-LD
`featureList`) and `manifest.json` are hardcoded.** They have gone stale once
already. If you change the bank size meaningfully, update them.

## Board scenes

Six scenes in `BOARD_THEMES` (`data.js`), one picked at random per game. A
scene styles the page backdrop, board surface, frame, ladders, snakes and
button accents together, so the board always belongs to the background.

Each has a photographic surface (`assets/textures/*.webp`) under a lighter
inline-SVG detail layer, and the two drift on different clocks for parallax.
There are only **two animated layers** (one page, one board) rather than a
texture on each of 100 cells. Each drifts exactly one tile per cycle so the
repeat stays seamless. All of it is off under `prefers-reduced-motion`.

Add a scene by copying an entry and changing the colours.

Everything else recolours from two variables (`--rose` / `--rose-deep`), which
`script.js` repoints on every new game; `--focus`, `--accent-wash` and
`--overlay-tint` are derived from those with `color-mix()`, so most of the app
re-skins with no per-theme rule.

## Interface conventions

The scenes are the personality; the chrome is deliberately quiet.

- **One neutral elevation ramp** (`--lift-1/2/3`), never a coloured glow.
- **Flat fills.** Only the board, pawns and dice look three-dimensional.
- **The accent does three jobs**: primary action, active state, focus ring.
- **Line icons at `currentColor`,** not emoji — emoji can't take the scene's
  colour. Emoji survive only as content: player faces, topic tags, surprises.
- **Left-aligned forms** with small-caps section labels.
- **No `window.confirm`.** Installed as a PWA it announces the origin in its
  title, which reads like a browser security warning rather than a game asking.

Two motion details worth knowing before you touch them:

The `+3` score float **falls** rather than rising — the score cards are pinned
to the top edge, and rising took the number off-screen in about a tenth of a
second. Its keyframes are `linear` overall with easing on the **first segment
only**; a single ease-out across the whole effect drops it to 8% opacity by the
halfway point, so it flashes past unread. The same trap applies to anything
that has to stay legible while it moves.

## AI questions (optional)

With a key configured, every question tile generates a fresh line instead of
drawing from the static bank. Most prompts are theme-only; about a third of the
time (`AI_PERSONALIZE_CHANCE`) it weaves in something already answered.

Two rules the prompts enforce, both aimed at the same failure mode — with 3+
players, "you" and "I" don't identify anyone:

1. **Every prompt names its audience** ("write this for Priya, address Priya as
   you"), and when weaving in someone else's answer it names that person too.
2. **Personalization stays with the same person.** It draws only on *your* past
   answers, unless someone else's answer actually named you. Every question is
   still one standalone line, never a follow-up chained onto a prior answer.

Any API failure falls back to the static bank and is logged to the history
drawer rather than interrupting play.

### Key handling

The key lives in `localStorage` and is sent only to the provider you chose.
**Gemini's key goes in the `x-goog-api-key` header, not the `?key=` query
parameter** Google's docs also show — a secret in a URL leaks into Referer
headers, browser history and any proxy log in between. Don't "simplify" that
back.

The CSP's `connect-src` pins outbound requests to the three provider origins.
If you add a provider, add its origin there too or its calls will be blocked.

## PWA

Requirements that are easy to break:

- **`start_url` is `./`, not `./index.html`.** Cloudflare canonicalises
  `/index.html` to `/` with a 307, and a redirecting start URL is both a
  redirect on every launch and a mismatch with what the service worker caches.
- **`sw.js` precaches `'./'` and never `'./index.html'`,** for the same reason:
  `cache.addAll()` is unreliable for requests that redirect, and one bad entry
  rejects the whole call — which would silently disable offline support.
- **One 512px icon serves both `any` and `maskable`.** The art is full-bleed
  with the subject inside the safe zone, so a separate padded file is just a
  duplicate. (There genuinely was a byte-identical duplicate here once.)
- **`screenshots` in the manifest are what earn Chrome's rich install dialog**
  on Android. Without them you get the minimal one. They're real captures —
  regenerate with headless Chrome if the UI changes materially.

**Installing is not automatic.** Chrome hasn't shown an unprompted install
popup for years — it fires `beforeinstallprompt` and leaves it to the page. So
`initInstall()` in `script.js` captures that event and reveals the **Install
app** button in the setup footer. iOS Safari never fires the event and exposes
no install API at all, so there the same button opens instructions for
Share → Add to Home Screen. Don't remove one branch without the other.

### Service worker caching

**Network-first, not cache-first** — online, every request hits the network and
the cache is only the fallback. This project already spent two rounds fixing a
bug where a static server let browsers serve a stale `script.js` forever; a
cache-first worker reintroduces exactly that bug, one layer deeper.

**If you change any precached file, bump `CACHE_NAME` in `sw.js` and `BUILD` in
`script.js` together.** They can't share a value — `sw.js` runs in a worker
context that never loads `script.js` — so they're kept in sync by eye. Nothing
evicts the old cache except that bump.

Offline mode covers everything except AI calls.

## Security

The app is unusually CSP-friendly and should stay that way: **no inline
`<style>`, no `style=""` attributes, no inline event handlers.** The only
inline `<script>` is the JSON-LD block, which browsers never execute. Runtime
styling goes through `el.style.setProperty()` (CSSOM, outside CSP's scope).

`_headers` therefore ships a strict policy — `default-src 'self'` with an
`img-src` exception for `data:` (the SVG textures are built into data URIs at
runtime), plus `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy:
no-referrer` and a `Permissions-Policy` denying unused device APIs.

The CSP is worth keeping even with no known XSS hole: the AI key is in
`localStorage`, and `connect-src` is what stops an injected script from
shipping it somewhere.

All user-supplied text (player names, typed answers, AI output) reaches the DOM
through `.textContent`. The `innerHTML` assignments in `script.js` are all
static template strings. **Keep it that way** — interpolating a player name
into `innerHTML` would be an XSS hole with an API key sitting next to it.

`_headers` only applies to the deployed site. Test header changes with
`npm run dev`, not `npm start`.

## Build and deploy

`scripts/build.js` minifies `script.js`, `data.js`, `sw.js` and `style.css`
with terser and clean-css into `dist/`, copying everything else byte-for-byte.
`COPY_VERBATIM` in that file is the allowlist of what ships unprocessed — add
new static files there or they won't be deployed at all.

**`wrangler.jsonc`'s `assets.directory` must stay `./dist`.** It was `"."`
once, with the minified path supplied as `--assets=dist` on the command line
from `npm run deploy`. That works only for someone deploying by hand.
Cloudflare's own builds run the configured build command and then a plain
`wrangler deploy`, which reads `wrangler.jsonc`, saw `"."`, and shipped the
raw commented source while discarding the `dist/` it had just built — live
`script.js` was 89KB of unminified source, with nothing failing to signal it.
Keeping the path in the config means every deploy route agrees; don't move it
back to a command-line flag.

The cost is that `dist/` must exist before any deploy or Workers preview,
which is why `npm run dev` builds first. `npm start` (serve.py) is untouched
and still serves plain source — that's the everyday loop.

**Sanity-check a deploy by asking the live site, not by trusting the build
log:** `curl -s https://<domain>/script.js | head -c 80` should be minified,
and should not contain comments.

**`data.js` needs `toplevel: false`.** Mangling top-level names would rename
`BOARD_THEMES` in `data.js` while `script.js` kept asking for that literal
identifier, silently breaking the app the moment mangle ran. It's terser's
default, set explicitly so it can't change by accident.

This has broken before: a rename swept through `package.json` and dropped the
`build` script and its devDependencies, while `wrangler.jsonc`, `scripts/` and
the docs all still assumed it existed. Cloudflare's build then failed with
`Missing script: "build"`. If you touch `package.json`, check `npm run build`
still runs.

**Check `wrangler.jsonc`'s `name` before deploying.** It's the Worker's deploy
identity: changing it and deploying doesn't rename the live Worker, it creates
a second one, and the custom domain stays attached to the original. A mismatch
means you deploy to a Worker nobody is looking at.

The domain is hardcoded in `index.html` (canonical, `og:url`, both image URLs,
JSON-LD `url`), `robots.txt` and `sitemap.xml`. **If it moves, update all three
together** — a canonical naming an origin that no longer serves the page tells
crawlers to index that other origin instead.

`.assetsignore` keeps dev files out of the upload. Don't trust the file count
`wrangler deploy --dry-run` prints; it's a pre-filter scan. Ask the server
instead:

```bash
npm run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/serve.py   # 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/style.css  # 200
```

Deploys are manual. There is no CI workflow watching `main`.

## Tuning

Animation speeds live in `script.js` (`DICE_MS`, `STEP_MS`, `TRAVEL_MS`) and
are pushed into CSS variables at startup, so changing them there changes both
timing and animation. Board density is `BOARD_SETUP` in `data.js`.

Long cache lifetimes in `_headers` apply to `/assets/*` and `/icons/*` only —
30 days, not a year, because these filenames carry no content hash. Code files
deliberately keep Cloudflare's `max-age=0, must-revalidate` default.
