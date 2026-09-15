# ❤️ Snake & Ladder: Love & Friends Edition

A Snake & Ladder game for 2–6 people sharing one device. Every square you land
on starts a conversation — a themed question or a surprise — and the board is
rebuilt from scratch every game.

It plays in one of two modes, picked on the setup screen: **Couples**, written
for two partners, or **Friends**, which has nothing romantic in it.

## How to run

Plain HTML/CSS/JS, no build step:

```bash
python3 serve.py
```

Then open `http://localhost:8791`.

Use `serve.py`, not `python3 -m http.server`. The built-in server sends no
`Cache-Control` header, so browsers cache the JS and CSS heuristically and
reuse old copies **without revalidating** — you edit a file, reload, and still
see the previous version. `serve.py` is the same static server with caching
turned off.

If you have already been served stale files, one hard reload clears them
(`Cmd+Shift+R` on macOS, `Ctrl+Shift+R` elsewhere).

## How to play

1. Pick **Couples** or **Friends** (see below). Then add **2 to 6 players** —
   tap the face or the colour dot on a row to change it, ✕ to remove a player,
   **+ Add player** to add one. Every player always gets a different face and
   colour: the taps skip anything already taken. Pick your topics, then
   **Start game**.
2. Take turns tapping **Roll** (or pressing Space / Enter on a keyboard). The
   pawn hops one box at a time, then climbs any ladder or slides down any
   snake it lands on. Surprises that target "your partner" pick a random rival
   when more than two are playing.
3. Every landing gives you something — a question or a surprise. There's a
   short beat after the pawn lands before the card appears, so you can see
   where you ended up first. Nothing is marked on the board, so you find out
   when you get there, and the same square gives something different next time.
4. Type an answer if you want to keep it (optional), or tap **Another** for a
   different question. First to land exactly on 100 wins.

All twelve topics start selected. **Clear all** turns them off in one tap so
you can pick up just the two or three you want, instead of tapping ten off —
one topic always stays on, since the game needs something to draw from.

The dice throw can be cut short by tapping anywhere on it. The number is
already decided by the time the die is in the air, so skipping changes nothing
except how long you wait for it.

The only squares with no content are the foot of a ladder and the head of a
snake — you never rest there.

## Couples and Friends

The mode is chosen before the game starts and fixed for that game. It decides
three things:

| | Couples | Friends |
|---|---|---|
| Questions | 197 | 180 |
| Surprises | 25 | 24 |
| "Love" topic | ❤️ Love | 💛 Closeness |
| Romantic dares | in | out |
| The AI is told | "two partners" | "a group of friends", plus an explicit instruction never to imply romance |

The two banks are **not** two copies of the same file. Each topic in `QUESTIONS`
(`data.js`) is split into `shared`, `couples` and `friends`, and the pool for a
game is `shared` plus the list for the mode in play. About 60% of the questions
were already neutral — "What does it mean to forgive someone, to you?" needs no
variant — so those are written once. Only the genuinely partner-specific ones
are duplicated.

Surprises work the same way: `friends` on a card is alternate wording (mostly
swapping "your partner" for "another player"), and `only` restricts a card to
one mode. That's what keeps *Kiss your partner on the cheek*, *Hold hands in
silence*, and *Close your eyes and describe your partner's face* out of a game
between friends, and adds two cards that only make sense with a group.

Mode is stored on the game, not globally, so a game in progress keeps the mode
it started in — **Play again** does too. A game saved before modes existed
loads as Couples.

If you add questions, keep partner-specific wording out of `shared`. This
catches it:

```bash
node -e "const vm=require('vm'),c={};vm.createContext(c);vm.runInContext(require('fs').readFileSync('data.js','utf8')+';this.Q=QUESTIONS',c);for(const[t,v]of Object.entries(c.Q))for(const q of (v.shared||[]).concat(v.friends||[]))if(/\bpartner\b|\bcouple\b/i.test(q))console.log(t+': '+q)"
```

**Content:** 12 topics. Couples mode draws on 197 questions and 25 surprises;
Friends mode on 180 questions and 24.

## Board scenery

Every new game picks one of six scenes at random — **Romance, Forest, Ocean,
Meadow, Sunset, Night**. Each one styles the page backdrop, the board surface
and frame, the ladders, the snakes and the button accents together, so the
board always belongs to the background behind it (wooden ladders and green
snakes in the forest, rope-and-sand ladders with teal eels at sea, silver
ladders and glowing violet snakes at night).

Each scene has a **real photographic surface** under a drawn detail layer, so
the board looks like it's sitting on an actual material:

| Scene | Surface |
|---|---|
| Romance | blush woven linen |
| Forest | oak wood grain |
| Ocean | turquoise water with caustics |
| Meadow | fresh lawn grass |
| Sunset | rippled golden sand |
| Night | deep starfield |

The photos live in `assets/textures/` (~1 MB total, 640px seamless JPEGs). Over
each one sits a lighter inline-SVG detail layer — hearts, leaves, waves, grass
blades, cloud bands, stars — and the two drift on slightly different clocks, so
there's a small parallax between them rather than flat wallpaper.

The textures **move**, slowly. Waves and clouds drift sideways, leaves drift on
a diagonal like wind, and the Romance hearts and Night stars also breathe in and
out. Each layer drifts by exactly one tile per cycle so the repeat stays
seamless, over 26s to 190s depending on the scene — slow enough to feel alive
rather than distracting. Turned off automatically if your system asks for
reduced motion.

There are only two animated layers (one for the page, one for the board) rather
than a texture on each of the 100 cells, and they're driven from `script.js`
with the Web Animations API.

The scene is shown on the setup screen before you start, so you can see which
one you're about to play in.

Every surface in the app matches that scene, not just the board and backdrop —
the dice, the score cards' active border, the fullscreen dice overlay, the
question and surprise cards, and the history drawer all recolor from the same
two accent variables (`--rose` / `--rose-deep`), which `script.js` repoints to
the scene's own colors on every new game. A handful of shared CSS variables
(`--border`, `--overlay-tint`) are *derived* from those two with `color-mix()`,
so most of the app re-skins automatically without needing a per-theme rule for
every component.

Scenes live in `BOARD_THEMES` in `data.js` — add one by copying an entry and
changing the colours.

## The interface

The scenes are the personality. Everything that *isn't* the board — cards,
buttons, modals, the drawer — is deliberately quiet, so the scene reads as the
subject and the chrome as a frame around it. Concretely:

- **One neutral elevation ramp** (`--lift-1/2/3`), never a coloured glow under
  a button. Tinted shadows are what make a UI look like it was assembled from
  defaults rather than designed.
- **Flat fills.** No decorative gradients on interface surfaces — the board,
  the pawns and the dice are the only things allowed to look three-dimensional.
- **The scene accent does three jobs and no others**: the primary action, the
  active state, the focus ring. Everything else is a desaturated neutral, so
  the accent is the only real colour in the chrome and always means something.
- **Line icons at `currentColor`,** not emoji. Emoji render at the mercy of
  whichever font the device ships, can't take the scene's colour, and read as
  placeholder art sitting next to real UI. Emoji survive only where they're
  content rather than controls: player faces, topic tags, surprise cards.
- **Left-aligned forms with small caps section labels.** A stack of centred
  labels is the single thing that most makes a form look generic.

Both of the game's own dialogs are in-app now. The "start a new game?" prompt
used to be `window.confirm`, which was the only piece of OS chrome in an app
that otherwise draws its own surface — and installed as a PWA it announces the
page's origin in its title bar, so it reads like a browser security warning
rather than a game asking a question.

## Motion

Beyond the drifting scenery, the things that happen on a turn are animated:

| When | What |
|---|---|
| New board | The grid deals itself out, square by square from 1 upward |
| Hop | Squash on take-off and landing, stretch over the top of the arc |
| Ladder | The pawn bounces as it climbs |
| Snake | The pawn tumbles as it slides |
| Landing | A ripple on the square you actually stop on |
| Points | A `+3` drifts off the score card, which bumps |
| Win | Confetti in the players' own colours |
| Waiting | The Roll button breathes while it's your turn |

Two details worth knowing if you change any of this:

The `+3` **falls** rather than rising. The usual "points float up" idiom
assumes there's room above the thing that scored; here the score cards are
pinned to the top edge of the window, and rising took the number off-screen in
about a tenth of a second.

Its keyframes are `linear` overall with the easing on the **first segment
only**. A single ease-out curve across the whole effect front-loads it so hard
that the number is down to 8% opacity by the halfway point — it flashes past
before you can read it. The same trap applies to anything that needs to be
legible while it moves.

Every one of these is switched off by `prefers-reduced-motion`.

## Sound

Dice clatter, a landing thud, a hop per square, a rising chime up ladders and a
falling slide down snakes, plus a small fanfare on a win. Everything is
synthesised with Web Audio — there are no sound files to load. Toggle it with
the speaker button; the choice is remembered.

Browsers only allow audio to start from a real interaction, so the first sound
arrives with your first tap of **Roll**.

**Buttons:** sound · history · AI questions · new game.

The history drawer keeps the move log plus **every question that came up** — who got
it, which theme, and their typed answer (or "Skipped" / "Answered out loud") —
and a **Download** button that saves the whole thing as a `.txt` file, in
play order, so a couple can keep what they told each other.

## AI-generated questions (optional)

With a key configured, **every question tile generates a brand-new line from
the model, every turn** — not the fixed 192-question bank.

Most of those are fresh, theme-only prompts with no reference to anything
you've said — variety, not one long follow-up chain. About a third of the
time (`AI_PERSONALIZE_CHANCE` in `script.js`) it weaves in something you
actually answered instead, sampled from anywhere in the game so far, not just
the last answer — so a callback can land on something from several turns
ago, not only what just happened. It's also told what's already been used for
that theme so it doesn't repeat itself.

That personalization stays with the same person: it only draws on **your own**
past answers, unless someone else's answer actually named you — say your
partner's, or a friend's — in which case that's fair game too. It never
reaches for a random stranger's answer that has nothing to do with you.

The same rule decides who a background follow-up goes to. After you type an
answer, the model is asked for two on-topic follow-ups, and those stay
reserved for **you specifically** — held until your own next turn, however
many turns that takes, rather than being handed to whoever else happens to
land on a question tile first. The one exception: if your answer named
someone else at the table, the follow-up is about them now, so it's held for
*their* turn instead. Either way, it's still down to chance whether that
turn actually uses it, or draws something fresh instead — reserved isn't the
same as guaranteed.

Two things the model is told explicitly, both aimed at the same failure
mode: with 3+ players in the game, "you" and "I" alone don't say who they
mean. So every prompt names its actual audience — "write this for Priya,
address Priya as you" — and when it's weaving in something someone else
said, it's told to name that person too, never "I" or "you" for them. And a
follow-up's own source material is scoped just as tightly: it's built only
from the one answer it's actually about (plus that same person's own recent
history, when nobody else was named) — never diluted with an unrelated third
player's answer that happened to be recent, which the model would have no
reason not to use otherwise.

Open **AI questions**, pick **Claude**, **OpenAI**, or **Gemini**, paste your
own API key, and hit **Save & test**. From then on, landing on a question tile
shows a brief pulsing "✨ …" while the model writes that turn's line (well
under a second for most calls), then swaps in the real question with an **AI**
tag on its topic badge. **Another** also asks the model for a fresh one rather
than just reshuffling the static bank.

If a call fails — bad key, rate limit, the provider is down — that turn falls
back to the static question bank instead of stalling the game, and the reason
is written to the 📜 history log (e.g. "✨ AI unavailable, used a saved question
instead (529: …)") so you can see what happened without it interrupting play.
A background pre-fetch still runs after a typed answer too: if it's already
delivered a follow-up by the time its target's next tile is hit, that one is
used instantly with no wait, since it's already paid for.

Notes:

- The key is stored in this browser's `localStorage` only — it is never sent
  anywhere except directly to the provider you chose. Anyone with access to
  this browser profile can read it, so use a key you're comfortable with and
  hit **Clear** when you're done.
- Requests go straight from the page to the provider. This works because all
  three allow direct browser calls (Claude needs the
  `anthropic-dangerous-direct-browser-access` header, which the game sends).
- The game is fully playable without a key — AI questions simply stay off, and
  any API failure is logged as a small note without interrupting play.

## Installing as an app (PWA)

Open the game in a browser and use "Add to Home Screen" (mobile) or the
install icon in the address bar (desktop Chrome/Edge) to add it as its own
app — its own icon, its own window, no browser chrome. It also works fully
offline once installed: `sw.js` precaches the whole app shell (every file
plus all six board-scene textures) and serves it when there's no connection.

The one thing offline mode can't do is call an AI provider — that always
needs a live connection regardless of PWA status. Everything else (rolling,
moving, the 108×12-theme question bank, surprises, sound) works with no
network at all.

**How the offline caching works, and why it's safe:** the service worker is
**network-first, not cache-first** — online, every request goes to the real
network first and the cache is only the fallback for when that fails. This
project already spent two rounds fixing a bug where a plain static server let
browsers cache `script.js` forever and silently serve a stale copy; a
cache-first service worker would have reintroduced exactly that bug, one
layer deeper and harder to notice. Network-first means a player who's online
always gets the current build.

I verified this for real rather than trusting the code: registered the
service worker, confirmed it precached all 13 core files, then **killed the
actual dev server** so requests to it would genuinely fail — and confirmed
`fetch()` for `style.css`, `script.js`, an image, and `index.html` all still
resolved with the correct byte counts, served from the service worker's
cache. If you change any precached file, bump `CACHE_NAME` in `sw.js` (e.g.
`snakes-ladders-v6`) — that's what evicts the old cache on the next visit.

## Tuning

Animation speeds are set in one place, `script.js` (`DICE_MS`, `STEP_MS`,
`TRAVEL_MS`); they are pushed into CSS variables at startup, so changing them
there changes both the timing and the animation.

Board density lives in `BOARD_SETUP` in `data.js` (`ladders`, `snakes`,
`surpriseChance`).

## Page performance

Response to a Lighthouse/PageSpeed audit against the live site. What each
finding turned out to be, and what was actually done about it:

- **Render-blocking requests.** `style.css`'s `<link>` sat at the very
  bottom of `<head>`, discovered only after the browser's preload scanner
  parsed through ~15 meta tags and a large inline JSON-LD block. It's now
  the first thing in `<head>`, right after charset/viewport — the only
  render-blocking request on the page, so it should be the first thing
  discovered, not the last.
- **Improve image delivery.** The six board-scene photos were JPEG at
  113–266 KB each; the two 512×512 manifest icons were PNG at **293 KB
  each** — absurdly heavy for a 512px icon. Converted everything to WebP
  with `cwebp`: the textures to 59–190 KB (29–48% smaller), the icons to
  16 KB each (a 95% reduction). Verified visually before committing to it —
  read both back as images, no visible artifacting or color shift — and
  confirmed nothing else still referenced the deleted originals before
  removing them. `icon-192.png`/`icon-32.png`/`icon-180.png` stay PNG
  deliberately: they're favicons and the `apple-touch-icon`, where format
  compatibility matters more than the (already small) file size, and Apple
  ignores the web manifest's own icons for "Add to Home Screen" anyway, so
  changing `icon-512`/`icon-maskable-512` in `manifest.json` to WebP has no
  effect on iOS.
- **Use efficient cache lifetimes.** Every response — HTML, JS, CSS,
  textures, icons, all of it — was served `Cache-Control: public,
  max-age=0, must-revalidate`, Cloudflare's blanket default. Fine for code
  that changes on every feature; wasteful for a texture that's never
  touched again after launch. Added `_headers` (Cloudflare's per-path
  header config, confirmed working for a Workers static-assets deploy, not
  just Pages, via a real `wrangler dev` run — its log line literally said
  "Parsed 2 valid header rules") giving `/assets/*` and `/icons/*` a 30-day
  cache. **Deliberately not 30 days for anything else, and deliberately not
  a full year for those either** — this project already spent real
  debugging time on the exact bug a long, un-revalidated cache causes (see
  "On the caching bug from earlier in this project" below); `script.js`,
  `style.css`, `data.js`, `sw.js`, `index.html`, and `manifest.json` keep
  Cloudflare's default untouched.
- **Legacy JavaScript / 3rd parties.** Not this project's code. The live
  page has zero third-party scripts by design — no CDN libraries, no
  analytics, nothing. What Lighthouse is actually seeing is a script
  Cloudflare itself injects at the edge (`/cdn-cgi/challenge-platform/...`),
  tied to a security feature on the Cloudflare zone (something like Browser
  Integrity Check or a JS challenge), confirmed by literally reading the
  response body of the live page. No source change here can touch that —
  it's a Cloudflare dashboard setting, and this repo has no login to check
  or change it.
- **Minify CSS / Minify JavaScript.** Done, but deliberately kept out of
  the editing path. `npm run build` (`scripts/build.js`) reads `script.js`,
  `data.js`, `sw.js`, and `style.css`, minifies them with `terser` and
  `clean-css`, and writes a `dist/` containing exactly what ships — every
  other file (`index.html`, `manifest.json`, `robots.txt`, `sitemap.xml`,
  `_headers`, `assets/`, `icons/`) copied through byte-for-byte. `npm run
  deploy` runs the build automatically, then points `wrangler deploy` at
  `dist/` with `--assets`. Editing and local preview
  (`npm start`/`npm run dev`) never touch `dist/` and never run the
  minifier — the source you edit is always the real, plain, unminified
  file it always was.

  `data.js` needed care: it has no module system and no wrapping IIFE, so
  its top-level `const BOARD_THEMES = ...` (and friends) are real globals
  that `script.js` — a separate `<script>` tag, loaded after it — reaches
  by name. Mangling top-level names would rename `BOARD_THEMES` in
  `data.js` while `script.js` kept asking for that exact literal
  identifier, silently breaking the whole app the moment mangle ran.
  `toplevel: false` (terser's own default — set explicitly here so it can
  never change by accident) keeps every top-level name exactly as written.

  Verified with more than a syntax check: built `dist/`, swapped the four
  minified files into the real project root, played an actual turn through
  it — rolled, moved, landed on a tile, answered a question, watched the
  score update and the turn advance — then registered `sw.js` from that
  same minified build and confirmed all 13 core files precached correctly,
  before restoring the originals byte-for-byte. `dist/` itself is
  build output, not source — gitignored, never committed.

## Search and sharing

The interface is built entirely by `script.js`, so a crawler arriving at the
raw HTML would otherwise find an empty `<body>`. What's there for it:

- A **`<title>` and meta description** aimed at what people actually search
  for ("conversation game for couples", "questions game for friends") rather
  than just restating the product name.
- **Open Graph and Twitter tags**, so a pasted link unfurls with a real card
  instead of a bare URL — `assets/og-cover.jpg`, 1200×630.
- **JSON-LD structured data** (`WebApplication`, free, with a feature list).
  This is the part search engines read *instead of* the UI, so it carries the
  description the page itself only shows once JavaScript has run.
- A **`<noscript>` block** with a genuine description of the game. It is real
  content that a person with JavaScript off can read — not an off-screen
  keyword block, which is worth less than nothing.
- **`robots.txt`** and a one-entry **`sitemap.xml`**.

Those absolute URLs are hardcoded to the real, live domain,
`https://snakes-ladders.mfrazi.me` — see "Why the domain is hardcoded" below for
why that's a deliberate choice rather than an oversight, and where all three
have to be updated together if the domain ever changes. A canonical tag
naming an origin that no longer serves the page tells crawlers to index that
other origin instead, which is worse than having no canonical at all — that's
the failure mode to watch for if this domain ever moves.

## Deploying to Cloudflare

**Cloudflare Workers is the only deploy target**, as a pure static-assets
Worker — no custom Worker script. One command runs the minify step below and
deploys the result:

```bash
npm install
npx wrangler login
npm run deploy
```

The bare Worker address would be
`https://snakes-ladders.<your-subdomain>.workers.dev`. This project's real front
door is a custom domain attached to that Worker in the Cloudflare dashboard,
`https://snakes-ladders.mfrazi.me`; both resolve to the same deployment.

**Check what `wrangler.jsonc`'s `name` currently matches before your next
deploy.** That field is the Worker's deploy identity — changing it and running
`wrangler deploy` doesn't rename the Worker that's live, it creates a
*second*, separate one under the new name. A custom domain stays bound to
whichever Worker it was attached to in the dashboard; it does not follow a
name change in this file. If `name` here doesn't match the Worker your custom
domain actually points at, deploying will update an invisible Worker nobody
is looking at while the live site keeps serving whatever was deployed last.
Fixing that mismatch means either moving the custom domain to the
newly-deployed Worker in the dashboard, or matching `name` back to whatever
the live Worker is actually called — a Cloudflare-side check, not something
this repo can confirm on its own (there was no Cloudflare login available
while writing this).

To run the real Workers runtime locally — the asset server and
`.assetsignore` behaving as they will in production — use:

```bash
npm run dev
```

That needs no Cloudflare login. (`npm start` is still the plain `serve.py`
static server, which is lighter for ordinary UI work but does *not* exercise
the same asset pipeline Cloudflare uses.) One thing worth knowing while
testing locally this way: `index.html`, `robots.txt`, and `sitemap.xml` all
hardcode the real production domain (see below), so a local `curl` against
`localhost:8787` will show `snakes-ladders.mfrazi.me` in the canonical tag and
sitemap, not `localhost` — that's expected, not a bug.

### Why the domain is hardcoded

`index.html`'s canonical tag, `og:url`, both image URLs, and the JSON-LD
`url`, plus `robots.txt`'s `Sitemap:` line and `sitemap.xml`'s `<loc>`, all
name the site's own address directly: `https://snakes-ladders.mfrazi.me`. If you
change domains, update all three files together.

This used to be dynamic — a tiny Worker script rewrote a placeholder origin to
whatever host the request actually arrived on, because at the time the
eventual workers.dev subdomain wasn't knowable from the repo. Now that the
real, permanent custom domain is settled, that indirection has no job left to
do: hardcoding is simpler, needs no Worker invocation on every request, and
is what the placeholder mechanism was always going to resolve to anyway. If
this site ever moves to a different domain, hardcoding is still the right
call — just update the three files above with the new one.

### What actually ships

`.assetsignore` (same syntax as `.gitignore`) skips everything that isn't part
of the deployed site — `serve.py`, `wrangler.jsonc`, `package.json`, docs,
`LICENSE`, and `.claude/`.

Don't trust the file count Wrangler prints. `wrangler deploy --dry-run` says
it "Read 158 files" here, which is more files than exist in the repo — that
number is a pre-filter scan, not the upload set. The only reliable check is to
ask the running server:

```bash
npm run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/serve.py   # 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/style.css  # 200
```

`/index.html` returns a **307 to `/`**. That is Cloudflare's default
`html_handling` canonicalising the URL, and it's wanted — it keeps one
indexable URL instead of two. But it is why `sw.js` precaches `'./'` and never
`'./index.html'`: `cache.addAll()` is unreliable for requests that redirect,
and one bad entry rejects the whole call, which would silently disable offline
support.

**On the caching bug from earlier in this project:** the reason `serve.py`
exists is that Python's plain `http.server` sends no `Cache-Control` header,
so browsers cache `script.js`/`style.css` indefinitely and never notice an
update. Cloudflare doesn't have that problem — its default header for static
assets is `Cache-Control: public, max-age=0, must-revalidate` with an ETag,
which is the same "always check, rarely re-download" behavior `serve.py`
forces locally. So no `_headers` file is needed for this; a normal reload
after any future deploy is enough.

Deploys are manual — run `npm run deploy` yourself when you want to ship.
There is no CI workflow watching `main`.
