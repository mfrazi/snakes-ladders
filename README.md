# ❤️ Snakes & Ladders: Love & Friends Edition

A Snakes & Ladders game for 2–6 people sharing one device. Every square you land
on starts a conversation — a themed question or a surprise — and the board is
rebuilt from scratch every game.

**[Play it →](https://snakes-ladders.mfrazi.me)**

Pick a mode before you start:

- **Couples** — written for two partners
- **Friends** — nothing romantic in it

624 questions per mode across 12 topics, plus surprise cards, six board scenes,
and sound. Installs as an app and works offline. Optionally, bring your own AI
API key and every question is written fresh for the people playing.

## How to play

Add 2–6 players, pick your topics, and take turns tapping **Roll**. Land on a
square and you get a question or a surprise. Type an answer to keep it, or tap
**Another** for a different question. First to land exactly on 100 wins.

Answering earns hearts, and **Powers** lets you spend them before you roll:
**Shield** (5) against your next snake, **Freeze** (6) a rival's next turn,
**Boost** (8) your roll by 3, a **Loaded die** (10) to pick your roll, or
**Swap places** (15) with a rival. A **Re-roll** (3) is offered when a roll
would land you on a snake or overshoot 100.

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
