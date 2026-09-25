# AGENTS.md

Working notes for anyone — human or AI — changing this project. The README is
for players; this is the part that explains *why* things are the way they are,
and which of them will bite you if you "clean them up".

## Shape of the project

Plain HTML/CSS/JS. No framework, no bundler, no module system. Six source
files do everything:

| File | What's in it |
|---|---|
| `index.html` | Markup, the SVG icon sprite, SEO/meta, the PWA manifest link |
| `style.css` | Everything visual. One elevation ramp, theme variables at `:root` |
| `i18n.js` | Interface strings, English and Indonesian (`I18N`, `LANGUAGES`) |
| `data.js` | Content only — questions, surprises, board scenes, board density |
| `data-id.js` | The Indonesian question bank (`QUESTIONS_ID`) |
| `script.js` | All behaviour, wrapped in one IIFE |

Plus one build-time file, `scripts/seo-id.js`: the Indonesian landing page's
title, description and structured data (see "Languages").

`i18n.js`, `data.js` and `data-id.js` have **no module system and no wrapping
IIFE**. Their top-level `const BOARD_THEMES = …` (and friends) are real globals
that `script.js` — a separate `<script>` tag, loaded after them — reaches by
name. This matters for minification; see "Build" below.

Local dev is `python3 serve.py` (port 8791). `npm run dev` runs the real
Cloudflare Workers runtime instead, which is the only way to exercise
`_headers` and the Indonesian page at `/id` as they behave in production.

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
`featureList`), `manifest.json` and `scripts/seo-id.js` are hardcoded.** They
have gone stale once already. If you change the bank size meaningfully, update
all three.

## Languages

English and Indonesian. The choice is a device preference (`LANG_KEY` in
`localStorage`), not part of the game, so it can change mid-game: the EN / ID
switch sits beside the mode choice at the top of the setup card, and the
two-letter button in the game header cycles it. Until the player picks one,
the Indonesian landing page (`/id`) opens in Indonesian and `/` follows
`navigator.language`.

Where each kind of text lives:

- **Interface strings:** `I18N` in `i18n.js`, read through `t(key, vars)`.
  Static markup carries `data-i18n="key"` (textContent) or
  `data-i18n-attr="title:key;aria-label:key"`; `applyLanguage()` walks both and
  re-runs the render functions for everything drawn in JS. `{name}`
  placeholders are filled by `t()` and still reach the DOM through
  textContent, so a player name can't inject markup.
- **Content labels** (modes, topics, surprises): an `_id` twin next to the
  English field (`label_id`, `hint_id`, `text_id`, `friends_id`), read through
  `loc(obj, field)`, which falls back to English.
- **Questions:** `QUESTIONS_ID` in `data-id.js` mirrors `QUESTIONS` **line for
  line** — same topics, same lists, same length, same order. `state.usedQuestions`
  stores indexes, and this is what keeps them valid across a switch (and lets
  an open question card change language in place). Add or remove a question in
  one bank and you must do the same, at the same position, in the other. This
  checks it:

```bash
node -e "const vm=require('vm'),fs=require('fs'),c={};vm.createContext(c);vm.runInContext(fs.readFileSync('data.js','utf8')+fs.readFileSync('data-id.js','utf8')+';this.Q=QUESTIONS;this.I=QUESTIONS_ID',c);for(const[t,v]of Object.entries(c.Q))for(const k of['shared','couples','friends'])if(v[k].length!==c.I[t][k].length)console.log('MISMATCH',t,k)"
```

The Indonesian partner-word check is the same as the English one with
`/pasangan/i`.

**Tone.** Every question is written the way friends talk — contractions,
"be honest", "go", no survey or therapist phrasing. All the Indonesian —
questions, interface, surprise cards, the SEO copy — follows one brief:
*"Tulis ulang teks ini pakai bahasa Indonesia yang santai, asyik dibaca, dan
nggak kaku, kayak lagi ngobrol sama teman."* So it's everyday spoken
Indonesian (`kamu`, `nggak`, `udah`, `bareng`, `banget`, `-in` verbs), never
the formal `Anda` register, with the game words people actually say (skip,
turbo, jurus, deep talk) over dictionary ones. It's adapted rather than
translated word for word (a "$500" becomes "5 juta", friends are a "geng").
Keep new lines in that voice.

Log lines are translated when they're written, so a game's history keeps the
language each move happened in. Recorded answers keep the question text as it
was asked.

### The Indonesian landing page

A page ranks in the language it's written in, so one URL can't serve both
markets. `/` is English; `/id` is the same app with an Indonesian head, for
Indonesian search. There is no second source file: `scripts/build.js`
(`buildIndonesianPage`) writes `dist/id.html` from `index.html`, swapping in
the title, description, link previews, JSON-LD and `<noscript>` text from
`scripts/seo-id.js`, and every `data-i18n` / `data-i18n-attr` string from
`I18N.id`. It serves as `lang="id"`, which is what makes the app open in
Indonesian. The copy targets what people type here: "ular tangga" is the
game's own name in Indonesia, plus "online", "game pasangan", "deep talk".

- **hreflang** pairs the two, in `index.html` and in `sitemap.xml`, and each
  page lists both plus `x-default`. Google ignores a pair that isn't
  reciprocal, so keep the sets identical.
- **The build fails rather than ship English at `/id`.** Every swap must match
  exactly once, and every `data-i18n` element must be filled. If you
  restructure the `<head>` and the build complains, fix the pattern in
  `build.js`; don't loosen the check.
- **It sits at the root as `id.html`, not in `id/`,** so `style.css`, `sw.js`
  and `assets/` resolve exactly as they do from `/`. A `<base>` tag would
  have been the other fix, and the CSP's `base-uri 'none'` blocks it.
  Cloudflare serves it at `/id` (`html_handling: "auto-trailing-slash"` in
  `wrangler.jsonc`); `/id.html` and `/id/` redirect there.
- **`manifest-id.json`** is built the same way: Indonesian names, and
  `start_url` `./id`, so an app installed from `/id` keeps opening in
  Indonesian. Its `id` is unchanged, so both manifests are one app. Its
  screenshots are Indonesian captures (`assets/screenshot-*-id.webp`).
- `serve.py` has no `/id`. Test it with `npm run dev`.

## Board scenes

Six scenes in `BOARD_THEMES` (`data.js`). A scene styles the page backdrop,
board surface, frame, ladders, snakes and button accents together, so the
board always belongs to the background.

**The setup card opens with a scene picker:** one swatch per scene (its
`swatch` gradient, with the accent as a dot) plus **Random**. Like the
language, it's a device preference (`SCENE_KEY`), so it sticks between games.
Picking a scene shows it behind the card straight away and starts its
ambience. Random draws a new scene every game, never the one just played, so
**Play again** always changes the view; tapping Random again deals another.
`pendingBoardTheme` is the scene the next game will use, decided ahead so the
setup screen can already show it.

Each has a photographic surface (`assets/textures/*.webp`) under a lighter
inline-SVG detail layer, and the two drift on different clocks for parallax.
There are only **two animated layers** (one page, one board) rather than a
texture on each of 100 cells. Each drifts exactly one tile per cycle so the
repeat stays seamless. All of it is off under `prefers-reduced-motion`.

Add a scene by copying an entry and changing the colours.

**Living layers.** On top of the textures, each scene has:

- `events` — the scene's set pieces, from `SCENE_EVENTS` in `script.js`, in
  `#scene-events`: candle bokeh and glints (romance), swaying sun shafts and a
  bird's shadow crossing (forest), caustic light over the shallows and a
  passing fish (ocean), cloud shadows and dandelion seeds (meadow), a
  breathing sun flare and gusts of sand (sunset), twinkling stars and
  shooting stars (night). `standing()` loops an element forever; `every()`
  fires one-offs on a random clock. The caustics are two tiled SVG
  `feTurbulence` layers, each sliding exactly one tile per loop.

- `life` — ambient wildlife drawn by `buildSceneLife()`: petals (romance),
  leaves (forest), bubbles (ocean), butterflies (meadow), dust motes (sunset),
  fireflies (night). Small inline SVGs on the Web Animations API, each on its
  own random clock, 40% fewer under 640px wide. Glows are stacked translucent
  discs, **not** CSS `filter`s — two dozen moving filtered layers are real work
  for a phone's compositor.
- `sunlight` — the colour of a slow soft-light wash from the top left
  (`.scene-light`), breathing over 14s.
- `backdrop` (optional) — `{ landscape, portrait }` full-bleed photographs.
  `applyBackdrop()` decodes the image off-screen and only then sets
  `data-backdrop="on"` on `<html>`, which fades it in with a slow push-in and
  hides the tiled photo. A missing file just leaves the tiled texture, so a
  scene without one looks exactly as before. They are **not** precached
  (~1.5 MB for all twelve); the network-first worker caches whichever ones get
  played. All six scenes have them, in `assets/scenes/`.
  `scripts/generate-art.mjs` makes them through OpenRouter (default model
  `google/gemini-3-pro-image`); see its header. Gemini returns ~1376×768 /
  768×1376, below the script's 1920 cap, and the script never upscales. The
  meadow portrait is from `openai/gpt-5.4-image-2`: Gemini twice drew a
  flower wreath round a flat green panel, which reads as a border, not a
  meadow. Reject anything with text, people, a border or a busy centre.
  **If you add or replace backdrops, re-run the glass contrast check against
  them** (see "Interface conventions"). The knob is the veil in
  `.scene-backdrop::after`: the `--backdrop-veil-*` tokens.

**Parallax.** With a fine pointer, the backdrop, events and life layers
shift against the pointer by 10, 22 and 36px (`initParallax`), the nearer
ones more. Set on the layers themselves through the `translate` property, so
it composes with their own animations and restyles nothing else.

On the board, snakes stir: the head sways from the neck (`.snake-head`), the
tongue flicks (`.snake-tongue`) and a glint runs down the back
(`.snake-sheen`); a ladder's rails catch the light (`.ladder-sheen`). Pivots
are set per snake in board units, hence `transform-box: view-box`.
**One piece at a time, now and then, never on a loop** (`stirBoard`: every
2–5s on desktop, 4.5–8.5s on touch screens). `#board-lines` is one detailed
SVG under a `drop-shadow` filter, and while anything inside it moves, the
whole board is re-rasterised and re-shadowed every frame. With every snake
and ladder idling on endless loops that was ~250ms of main-thread work per
second on a 4×-throttled phone profile, most of each frame's budget; stirring
one piece at a time brought it to ~80. Don't put an infinite animation
inside that SVG. Ornaments sway on per-cell clocks from the same hash that
places them, except on touch screens, where they hold still (a style pass
per frame for a detail too small to see there). Pawns have a radial gloss
and a rim light.

The board itself moves too, quietly: a slow sheen sweeps across it
(`.board-sheen`), glints wink on random squares (`startBoardMotion`), the
finish square glows, the current player's square breathes (`.cell-active`),
a walking pawn leaves a fading trail (`.stepped`), a landing sends a ripple
over two rings of squares (`.rippled`), and a light runs up each ladder
(`.ladder-sheen`). The ripple's delay and strength follow each square's true
distance from the landing (`--ripple-delay`, `--ripple-amp`), on one
sine-shaped swell, so the front is round and smooth. It only tints the
squares, with no transform (see "Performance on phones"). Everything here stops under `prefers-reduced-motion` (the
tongue then rests out).

**The die** is thrown rather than spun: `diceToss` (style.css) arcs it up and
bounces it three times, each lower, with a glow and a matching shadow, then a
ring and dust burst out as it settles (`burstDice`). `DICE_IMPACTS` in
`script.js` lists the bounce times as shares of `DICE_MS` so each thud lands
on its bounce. Change the keyframes and you must change that list.

**Ornaments.** `decorateBoard` scatters the scene's `ornaments` (six glyphs
each) over roughly a third of the free squares, capped by `ORNAMENT_MAX`. A
hash of the square number picks the squares and gives each its corner, size and
tilt, so it looks scattered but a reloaded game shows the same board. They're
desaturated and faint on purpose: a texture, not stickers. Start and finish
flags are separate (`startIcon`, `finishIcon`).

**Grain and trim.** `.board::before` is a static paper grain (an SVG noise
tile; a light-speck version for the dark scene) and `.board::after` is a thin
printed line with corner studs over the frame, coloured by `--cell-ink` through
a CSS mask.

**Snakes and ladders are drawn in `script.js`** (`drawSnake`, `drawLadder`),
lit from the top left (`LIGHT`). They were flat shapes with a heavy outline,
big white eyes and red tongues, which read as a cartoon; the fix was detail
rather than colour. A snake is a stack of nested ribbons, each lighter and
slid toward the light so the body looks round, then fish-scale texture, saddle
markings and flank flecks, a glint along the back and only a thin dark edge.
The head has slit-pupil eyes and nostrils. A ladder has lit and shaded rail
edges, grain, a knot and nails where rungs meet rails. Both take their colours
from the scene: keep `snake` palettes muted and natural (olive, copper, slate),
not saturated. `snake.body` is the main tone, `outline` the darkest, `belly`
the highlight. Each snake is tagged `data-snake` because the charmer fades it
out by that tag.

The UI chrome takes only one thing from the scene: its accent, via `--rose` /
`--rose-deep`, which `script.js` repoints on every new game. Paper and ink are
fixed across all six scenes.

## Interface conventions

Designed with the Hallmark skill (`.claude/skills/hallmark`), editorial type
system with frosted liquid-glass surfaces. The board is the object on the
table; the UI is panes of frosted glass floating over the moving scene. The
stamp at the top of `style.css` records the choices.

- **Glass is deliberate, and Hallmark bans it by default.** Every genre rules
  out decorative glassmorphism; it's allowed where glass shows depth over
  content, and every glass surface here floats over the live scene. Keep it to
  surfaces that overlay something — don't add glass for looks.
- **Tokens only.** Every colour and font in `style.css` comes from the `:root`
  block (`--color-ink`, `--glass-panel`, `--font-display`, `--space-*`…). Add
  a token rather than a one-off hex.
- **Contrast is measured through the glass, not against a flat colour.** Text
  sits on a tint composited over whatever the scene's photo texture is doing.
  The numbers came from decoding each texture (`dwebp -ppm`), blurring it over
  the area the frost mixes, and compositing the tint over its darkest patch:
  - light frost, panels: 50% tint, muted text worst 4.54:1 (meadow)
  - modals: 70% tint over a 28% veil, muted text 4.69:1
  - control borders: 55% ink for 3:1
  If you change a tint, an opacity or a texture, re-run that check.
- **Photographic backdrops need a shaped veil.** The photos keep their detail
  at the edges, which is exactly where the score cards and dock float. So a
  flat veil didn't work: at the original 30% the forest dock fell to 2.8:1
  and the romance one to 2.7:1 (a dark chair leg under the portrait). Even
  55% still left 3.7:1. The veil is now a vertical gradient of the scene's base
  colour: `--backdrop-veil-edge` (85%) over the top `--backdrop-veil-top`
  (110px) and bottom `--backdrop-veil-bottom` (170px), easing over
  `--backdrop-veil-ramp` (90px) to `--backdrop-veil-mid` (30%) through the
  middle, where only the board sits. The bands are in pixels, not percent,
  because on a 428px-tall landscape phone the dock starts at 68% height.
  The setup screen has no board; its card is a column down the middle, over
  the scene its picker is choosing. So there the veil keeps the mid stop at
  the sides and lays a column of `--backdrop-veil-setup` (85%) behind the
  card only — full strength within 240px of the centre line, easing out by
  310px — via `:has(#setup-screen:not(.hidden))`. A full-width 85% veil hid
  the very scene being picked, and a lighter full-width one dropped muted
  text to 4.12:1 (forest, phone). The check was measured in Chromium on
  screenshots: hide the panel's contents, take the darkest 2% of pixels
  behind the glass (brightest 2% on dark glass) and compare with
  `--color-muted`. On the tiled textures, this method gives 4.64–5.74. With
  the backdrops the worst muted-text cases are:
  - score cards and dock, at 1280×800, 390×844 and 926×428: 4.69:1 (night
    score cards, under the moon glow); every light scene ≥ 5.07
  - setup card, at 1280×800, 390×844 and 926×428: 5.01:1 (night, phone);
    every light scene ≥ 5.55
  Visible dock and score text is ink, not muted, so it clears these by a wide
  margin; muted text appears there only in the power status line.
- **Night gets dark glass.** Its backdrop is nearly black, and white frost over
  it turned muted text into 2.8:1 grey. `BOARD_THEMES.night.glass = 'dark'`
  sets `data-glass="dark"` on `<html>`, which swaps the tokens: dark tint,
  light text, bright accent. Any new dark scene needs the same flag.
- **The die is cut from the scene; the veil isn't.** The die takes the board
  tile (`--die-face`), frame (`--die-edge`), cell texture (`--die-tex`) and
  pips in the deep accent (`--die-pip`), all set in `applyBoardTheme`. On the
  dark scene the pips use the light ladder tone, because the accent sinks into
  the navy face. The veil behind it stays dark in every scene, so
  `--color-veil` and `--color-on-veil` are fixed. `--color-die` and
  `--color-pip` only cover the moment before the scene is applied.
- **No glass inside glass-blurred ancestors.** An element with
  `backdrop-filter` becomes the backdrop root for its descendants, so a glass
  card inside a blurred veil only frosts the veil. Modal backdrops and the
  drawer veil are tint only; the frost lives on the card.
- **Fallbacks.** `prefers-reduced-transparency` and browsers without
  `backdrop-filter` get near-opaque panes.
- **Square.** Controls are `--radius-control` (2px), panes `--radius-sheet`
  (4px), the board 0. Hairline rules separate things, not cards inside cards.
- **Primary actions are ink-filled and opaque**, so the main action never
  depends on what the scene is doing behind it. The scene accent is a
  highlighter: active marks, the heart icon, the ready ring on Roll.
- **On light glass use `--rose-deep` (`--color-accent`), not `--rose`.** The
  brighter accent falls under 3:1 on meadow and sunset even as a thin marker.
  Dark glass uses `--rose`. Heart counts are ink; the accent stays on icons.
- **Two faces.** Fraunces 700 for display (headings, questions, numerals),
  Geist (variable) for everything else. Both self-hosted in `assets/fonts/`.
  Headings are never italic.
- **No emoji as UI icons.** Line icons at `currentColor` from the sprite in
  `index.html`. Emoji survive only as content: surprise cards and board
  ornaments. Topics and players are marked with a colour swatch, not an
  emoji: a player is a name and a colour, picked from the chip in their row,
  and no two players share one. Topic chips are a grid of equal boxes, as
  many columns as fit the longest label (two on a phone, three on desktop).
- **Clickable text never wraps.** Buttons and links are `white-space: nowrap`;
  every touch target is at least 44px (small icons expand with `::before`).
- **Hover styles live in `@media (hover: hover)`** so taps don't leave sticky
  states, and no UI easing overshoots.
- **No `window.confirm`.** Installed as a PWA it announces the origin in its
  title, which reads like a browser security warning rather than a game asking.

The setup screen has no visible title or tagline: it opens straight onto the
mode choice. The `<h1>` is still there, visually hidden, so the page keeps a
heading for screen readers.

Checked at 320, 375, 414 and 768px plus 1280×800 and a 926×428 landscape
phone: no horizontal scroll, no wrapped labels, and the tilted board stays
inside the screen. That last one is why the desktop board is `min(88vw, 78vh)`:
at a 16° tilt the near edge projects ~7% wider than the layout box.

### Performance on phones

Measure on a throttled phone profile (390×844 at 3×, `isMobile`, CDP
`Emulation.setCPUThrottlingRate` 4) and read main-thread time from CDP
`Performance.getMetrics` (`TaskDuration`, `RecalcStyleDuration`) over a few
seconds of the game screen, switching one feature off at a time. Headless
frame rates are too noisy to judge by, because it rasterises in software. The rules this
produced:

- **The board is flat: no `transform-style: preserve-3d` on `.board`.** It
  tilts with `rotateX` as one plane. With preserve-3d, every square and every
  square's number became its own compositor layer (285 layers on the game
  screen, 58 without), and each effect starting or stopping reshuffled them.
  On phones that flickered the whole board on every roll. Count layers with
  CDP `LayerTree.enable` if you touch the board.
- **Anything on the board that ever animates a transform keeps a standing
  layer** (`will-change: transform`): `#board-lines`, the snake heads and
  tongues, the pawns. Without it the browser promoted `#board-lines` when a
  snake began to stir and flattened it back when the stir ended, redrawing
  the whole board each time: a flicker every few seconds, at random. Watch
  for it by logging which layers appear and vanish (`LayerTree` events,
  owners from `DOM.describeNode`); at rest the list should not change at all.
- **No backdrop blur over the board on touch screens where it can be
  avoided.** The dice veil drops its blur under `(pointer: coarse)` for a
  deeper tint (`--dice-tint-solid`): a backdrop-filter fading in over the
  tilted board is a known flicker on Android Chrome, and every roll opens it.
- **Inside the board, prefer a small repaint to a layer that comes and
  goes.** A transform or opacity animation promotes its element to a layer,
  so the active square breathes with `box-shadow` and the ripple is a tint,
  not a scale. Layers that live as long as the board are fine (the sheen,
  the glints, which keep `will-change`).
- **Elsewhere, endless animations are transform or opacity only.** The Roll
  button's ring is drawn once on `::after` and scaled and faded, because a
  looping `box-shadow` repaints every frame.
- **Nothing loops inside `#board-lines`** (see "Board scenes").
- **Touch screens drop what they can't show:** ornaments hold still, stirs
  rest longer, and wildlife is already 40% fewer under 640px.

## Sound

Everything is synthesised with the Web Audio API: no audio files, so nothing
to download, cache or license. One button cycles three modes (`SOUND_KEY`):
**all** (effects and ambience), **fx** (effects only) and **off**. It sits in
the setup footer and in the game header, and both copies stay in sync
(`.sound-toggle`). An old saved `'on'` reads as all.

**The mix** (`buildMix`): effects feed `sfxOut`, each scene's ambience feeds
its own fader, and both can send to one shared room — a convolver fed with a
decaying burst of noise, darkened so the tail never hisses. A gentle
compressor sits on the way out so a pile of effects can't clip. `voice()` is
one oscillator with a percussive envelope; `burst()` is a filtered noise hit.

**Effects** are timed to what's on screen: the dice rattle, whoosh, then thud
and clack on each bounce (`DICE_IMPACTS`, above); each step of a walk climbs
the pentatonic scale; ladders arpeggiate up and snakes hiss and slide down.
A question card arrives with a whoosh and a chime, answering rises, skipping
falls, and **Another** riffles like a deck. A surprise card shimmers as it
turns and then plays its verdict (`surpriseMood`): a ta-da, a sad trombone,
or a playful whoop for the ones that could go either way. Hearts gained or
lost chime or drop, whatever caused it, and buying a power sweeps up.

**Ambience** (`AMBIENCES`, keyed by each scene's `ambience` in `data.js`):
a candlelit café with slow chords and a music box (romance), wind in the
trees with songbirds, a wood pigeon and a woodpecker (forest), surf with
lapping water (ocean), a breeze with skylarks, bees and grasshoppers
(meadow), desert wind over a warm drone with wind chimes and sand gusts
(sunset), crickets and a distant owl (night). Each recipe has a `bed`
(continuous filtered noise, slowly swelling) and `events` placed at random a
few seconds ahead on the audio clock — the lookahead pattern: `setInterval`
only wakes the scheduler, it never times a sound itself. So nothing repeats
audibly.

- **It never starts on page load.** Browsers block audio until a gesture, and
  a page that starts making noise uninvited is rude anyway. It starts when
  there's a reason to expect sound — picking a scene, starting a game,
  pressing the sound button — and a game restored from a reload picks it back
  up on the first tap. It stops, and the context suspends, while the page is
  hidden.
- **Levels are measured, not judged by ear.** Each recipe's `level` is set so
  all six average about -34 LUFS (K-weighted, ITU-R BS.1770; night a touch
  lower on purpose), and `SFX_LEVEL` puts a dice roll's loudest moment near
  -19 LUFS, about 15 dB over the scene. Capture the output in Chromium
  (a tap on the destination feeding a `ScriptProcessorNode`), then measure;
  a scene that sounds right on laptop speakers can be 10 dB off on a phone.
  If you change a layer's gain, re-measure and reset `level`.

## Installing the app

`initInstall()` in `script.js` decides who asks the player to install.

- **Android:** Chrome does, with its own prompt (name, icon, the manifest's
  screenshots). That only happens if the page *doesn't* cancel
  `beforeinstallprompt`, so on Android the event is left uncancelled. Cancelling
  it is what suppressed the prompt, and it's why nothing appeared until the
  player found the "Install app" link. Chrome owns the timing and the position
  (usually a bar at the bottom), and stays quiet for a while after someone
  dismisses it. The page can't force, move or restyle it.
- **Elsewhere:** the event is cancelled and held for the setup screen's link,
  the documented pattern. Desktop Chrome has an address-bar icon and shows no
  prompt of its own.
- **The link** calls `prompt()` on the held event. If Chrome refuses (undefined
  when the event wasn't cancelled), or on iOS where no event ever fires, it
  opens the instructions instead: Share > Add to Home Screen on iOS, the
  browser menu elsewhere.

Don't add a hand-built install banner on top of this. It was tried and
removed: the goal was Chrome's own prompt, not a look-alike.

To test the event handling, dispatch one from the console (the embedded browser
won't fire a real one; a viewport under 768px reports an Android user agent):
`const e = new Event('beforeinstallprompt', {cancelable: true});
e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({outcome:
'accepted'}); dispatchEvent(e); e.defaultPrevented` should be `false` on
Android and `true` elsewhere.

## Heart powers

Hearts come from answering (+2) and some surprises. The **Powers** button in
the dock opens a sheet where the current player spends them before rolling:

| Power | Cost | Effect |
|---|---|---|
| Re-roll | 2 | Not in the sheet. Offered only when a roll would land on a snake or overshoot 100. |
| Shield | 4 | Blocks the next snake, however many turns later. |
| Boost | 4 | Adds 3 to the next roll, re-roll included. |
| Freeze | 5 | A chosen rival skips their next turn (uses `skipNext`). |
| Rewind | 6 | Move a chosen rival back 5 squares immediately. |
| Heist | 8 | Steal up to 4 hearts from a chosen rival. Needs a rival holding at least 3. |
| Loaded die | 8 | Pick the face (1–6) your next roll shows. No re-roll offer on it. |
| Snake charmer | 13 | Remove a chosen snake ahead of you from the board, for everyone. |
| Swap places | 20 | Trade squares with a chosen rival immediately. |

Costs, names and descriptions live in `POWERS` in `script.js`, and every label
is filled from there — change them in one place. `SHOP` sets the sheet order,
which is also ascending cost, so a new power slots in where its price puts it.

- **Refunds:** Shield, Boost, Loaded die and Freeze can be cancelled for a full
  refund until the dice are thrown (`armedThisTurn`); then they're committed.
  Rewind, Swap, Heist and Snake charmer can't be refunded, because a pawn,
  the hearts or the board have already changed.
- **Targets** live in one table, `TARGETS` in `script.js`, which `powerState`,
  the picker and every buy function read. With exactly one valid target a power
  acts straight away; with more, the row opens a picker. Freeze skips rivals
  already due to skip; Rewind skips anyone still on start (square 1); Swap skips
  anyone on your square; Heist skips rivals under `HEIST_MIN` (3) hearts and
  takes `min(4, their hearts)`; the charmer lists snakes whose head is past
  your square. A new target power adds one line there and one to `buyOn`.
- **Heist costs more than it takes** (8 for at most 4), on purpose. At 4 for 4
  a player could strip a rival of everything they earn, every turn, for free.
  At 8 for 4 both players lose the same 4 hearts, so it only pays against a
  rival who is hoarding for something big.
- **A charmed snake is gone for good.** It is deleted from `state.snakes`
  *before* `spend()` saves, so a reload mid-fade can't bring it back, and its
  `<g data-snake>` fades out over `CHARM_FADE_MS`. Ornaments are derived from
  the layout, so after a reload a few can move onto the freed squares.
- **Stacking is allowed.** A loaded 4 with Boost moves 7.
- A shield stops the pawn on the snake's head, and nothing further down a
  ladder/snake chain applies. Shield isn't consulted by the `swapPositions` /
  `joinPartner` surprises or by Swap, which move pawns directly rather than
  through `movePlayerTo`.
- Score chips show a shield icon for an active shield and a snowflake for
  anyone due to skip a turn, whether frozen or from a surprise card.

### Pricing a power

Price by measured value, not by feel. The unit is **expected turns saved**:
generate boards the way `generateBoard` does (7 ladders, 7 snakes, spans 8–26),
value-iterate the expected turns to finish from every square, and compare with
and without the power. Averaged over squares 1–95:

| Power | Turns saved | Per heart |
|---|---|---|
| Shield | 4.96 | 1.24 |
| Swap places | ~10 relative swing, only when behind | ~0.5 |
| Re-roll | 0.70 | 0.35 |
| Loaded die | 2.69 | 0.34 |
| Rewind | 1.48 | 0.25 |
| Freeze (2 players) | 1.00 | 0.20 |
| Boost | 0.93 | 0.23 |
| Snake charmer | 4.4 for you; net of a rival 1.3 if they lead by 15, 0 if level | 0–0.34 |
| Heist | swing of 0 hearts (take 4, pay 8): denial only | ~0 |

Most powers cluster at 0.2–0.35 turns per heart. **Shield is the outlier**:
it saves about a whole snake slide (~17 squares) for the price of two answers,
and is left as it was; if you retune, raise its price. Boost started at 6
(0.16 per heart) and was lowered to 4.

Two things that look fine and aren't:

- **Check every power at 2 players as well as 3+.** An "extra turn" power
  (Encore) was added and removed: with two players, "a rival skips a turn"
  *is* an extra turn, so Freeze already did the same for less. Couples mode is
  capped at 2, so that case decides.
- **Don't add cheap "can't be targeted" defence.** The leader can always afford
  it, and it switches off the trailing player's only comeback tools (Freeze,
  Rewind, Swap) at the moment they matter.

Two motion details worth knowing before you touch them:

The `+2` score float **falls** rather than rising — the score cards are pinned
to the top edge, and rising took the number off-screen in about a tenth of a
second. Its keyframes are `linear` overall with easing on the **first segment
only**; a single ease-out across the whole effect drops it to 8% opacity by the
halfway point, so it flashes past unread. The same trap applies to anything
that has to stay legible while it moves.

## AI questions (optional)

With a key configured, every question tile generates a fresh line instead of
drawing from the static bank. Providers: **OpenRouter** (the default for a new
setup — one key, any model; default `anthropic/claude-sonnet-5`), Claude,
OpenAI and Gemini.

The prompt itself stays in English (models follow English instructions most
reliably); one line from `AI_VOICE` sets the output language and register —
casual English, or casual spoken Indonesian with `kamu`, never `Anda`. The
topic name is sent in English whatever the interface language. Most prompts are theme-only; about a third of the
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

The CSP's `connect-src` pins outbound requests to the four provider origins.
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
  regenerate with headless Chrome if the UI changes materially: a game a few
  turns in, no dialog open, 360×640 at 3× and 1280×720 at 1.5×, in English
  and again in Indonesian for `manifest-id.json` (`*-id.webp`).

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

`scripts/build.js` minifies the scripts and `style.css` with terser and
clean-css into `dist/`, copying everything else byte-for-byte, and writes the
Indonesian page and manifest (`id.html`, `manifest-id.json`; see
"Languages"). `COPY_VERBATIM` in that file is the allowlist of what ships
unprocessed — add new static files there or they won't be deployed at all.

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

**`data.js`, `data-id.js` and `i18n.js` need `toplevel: false`.** Mangling
top-level names would rename `BOARD_THEMES` in `data.js` while `script.js`
kept asking for that literal identifier, silently breaking the app the moment
mangle ran. It's terser's default, set explicitly so it can't change by
accident.

This has broken before: a rename swept through `package.json` and dropped the
`build` script and its devDependencies, while `wrangler.jsonc`, `scripts/` and
the docs all still assumed it existed. Cloudflare's build then failed with
`Missing script: "build"`. If you touch `package.json`, check `npm run build`
still runs.

**Check `wrangler.jsonc`'s `name` before deploying.** It's the Worker's deploy
identity: changing it and deploying doesn't rename the live Worker, it creates
a second one, and the custom domain stays attached to the original. A mismatch
means you deploy to a Worker nobody is looking at.

The domain is hardcoded in `index.html` (canonical, hreflang, `og:url`, both
image URLs, JSON-LD `url`), `robots.txt` and `sitemap.xml`. **If it moves,
update all three together** — a canonical naming an origin that no longer
serves the page tells crawlers to index that other origin instead. The
Indonesian page takes its addresses from `index.html`'s canonical, so it
follows.

Dev files never ship because `dist/` holds only what `build.js` puts there.
(An `.assetsignore` used to guard the repo root; with the assets directory
at `dist/` nothing read it, so it's gone.) Don't trust the file count
`wrangler deploy --dry-run` prints; ask the server instead:

```bash
npm run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/serve.py   # 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/style.css  # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/id         # 200
```

Deploys are manual. There is no CI workflow watching `main`.

## Tuning

Animation speeds live in `script.js` (`DICE_MS`, `STEP_MS`, `TRAVEL_MS`) and
are pushed into CSS variables at startup, so changing them there changes both
timing and animation. Board density is `BOARD_SETUP` in `data.js`. Loudness
is `SFX_LEVEL` for effects and each ambience recipe's `level` (see "Sound").

Long cache lifetimes in `_headers` apply to `/assets/*` and `/icons/*` only —
30 days, not a year, because these filenames carry no content hash. Code files
deliberately keep Cloudflare's `max-age=0, must-revalidate` default.
