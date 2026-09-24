# ❤️ Snakes & Ladders: Love & Friends Edition

A Snakes & Ladders game for 2–6 people sharing one device. Every square you land
on starts a conversation — a themed question or a surprise — and the board is
rebuilt from scratch every game.

**[Play it →](https://snakes-ladders.mfrazi.me)**

Pick a mode before you start:

- **Couples** — written for two partners
- **Friends** — nothing romantic in it

624 questions per mode across 12 topics, plus surprise cards, six living board
scenes (drifting petals, falling leaves, bubbles, butterflies, fireflies), and
sound. Play in **English** or **Bahasa Indonesia** — switch any time with the
EN / ID toggle. Installs as an app and works offline. Optionally, bring your own
AI API key (OpenRouter, Claude, OpenAI or Gemini) and every question is written
fresh for the people playing, in the language you're playing in.

## How to play

Add 2–6 players, pick your topics, and take turns tapping **Roll**. Land on a
square and you get a question or a surprise. Type an answer to keep it, or tap
**Another** for a different question. First to land exactly on 100 wins.

Answering earns hearts, and **Powers** lets you spend them before you roll:
**Shield** (4) against your next snake, **Boost** (4) your roll by 3,
**Freeze** (5) a rival's next turn, **Rewind** (6) a rival back 5 squares,
**Heist** (8) to steal up to 4 hearts, a **Loaded die** (8) to pick your roll,
a **Snake charmer** (13) to remove a snake from the board, or **Swap places**
(20) with a rival. A **Re-roll** (2) is offered when a roll would land you on a
snake or overshoot 100.

The history drawer keeps every question and answer, and can download the lot as
a text file.

## Run it locally

```bash
python3 serve.py
```

Then open <http://localhost:8791>. No build step — it's plain HTML, CSS and JS.

Use `serve.py` rather than `python3 -m http.server`: the built-in server sends
no `Cache-Control` header, so browsers serve stale JS and CSS after you edit.

## Deploy

```bash
npm install
npx wrangler login
npm run deploy
```

## Docs

[AGENTS.md](AGENTS.md) covers the architecture, the conventions to follow when
changing things, and the reasoning behind the parts that look odd.

## Licence

[Apache 2.0](LICENSE)
