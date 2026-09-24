#!/usr/bin/env node
/**
 * Generates the photographic scene backdrops through OpenRouter.
 *
 *   OPENROUTER_API_KEY=sk-or-... node scripts/generate-art.mjs
 *   OPENROUTER_API_KEY=sk-or-... node scripts/generate-art.mjs --only forest,night
 *   OPENROUTER_API_KEY=sk-or-... node scripts/generate-art.mjs --model openai/gpt-5.4-image-2
 *
 * Writes assets/scenes/<scene>-landscape.webp (16:9) and
 * assets/scenes/<scene>-portrait.webp (9:16). Then point the scene at them in
 * data.js:  backdrop: { landscape: 'assets/scenes/forest-landscape.webp',
 *                       portrait: 'assets/scenes/forest-portrait.webp' },
 *
 * Needs `sharp` for the PNG -> WebP step. It isn't a project dependency (the
 * deploy build never needs it), so install it just for this:
 *   npm install --no-save sharp
 *
 * Default model: google/gemini-3-pro-image ("Nano Banana Pro") — the
 * strongest photorealism and prompt-following of the image models OpenRouter
 * lists, and it takes an aspect ratio directly. The key is read from the
 * environment only and never written anywhere.
 *
 * This is a dev tool: it's in scripts/, which build.js never copies into
 * dist/, so it stays off the deployed site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'scenes');

// Everything the backdrops share. The board floats over the middle of the
// page, so the middle has to stay calm; the life is at the edges.
const COMMON =
  'Photorealistic, natural colours, soft natural light from the top left, gentle depth of field. ' +
  'Keep the centre calm and uncluttered — a game board will sit on top of it — with the interesting detail toward the edges. ' +
  'No text, no letters, no watermark, no logos, no people, no hands, no board game, no frames or borders.';

const SCENES = {
  romance:
    'Overhead photograph looking straight down at a soft blush-pink linen tablecloth on a cafe table. ' +
    'Scattered rose petals, a few small pink peonies and two glowing tealight candles near the edges. Warm golden-hour window light.',
  forest:
    'Overhead photograph looking straight down at a mossy forest floor in dappled morning sunlight. ' +
    'Soft green moss, a few ferns, fallen oak leaves and tiny mushrooms near the edges, thin sunbeams through the canopy.',
  ocean:
    'Aerial photograph looking straight down where clear turquoise shallow sea water meets smooth white sand. ' +
    'Gentle foam lines and a few small shells near the edges, sunlight ripples on the water.',
  meadow:
    'Overhead photograph looking straight down at a spring meadow: soft fresh grass with white daisies, buttercups and clover, ' +
    'a couple of butterflies near the edges, bright soft spring sunlight.',
  sunset:
    'Aerial photograph of smooth rolling sand dunes at golden hour, warm peach and apricot tones, ' +
    'long soft shadows raking across the ripples, a hazy warm sky glow at the top edge.',
  night:
    'Photograph of a clear night sky full of stars with the soft band of the Milky Way, deep navy and indigo tones, ' +
    'the dark silhouette of a pine forest ridge along the bottom edge and a few fireflies glowing low in the trees.',
};

const VARIANTS = [
  { name: 'landscape', aspect: '16:9', width: 1920 },
  { name: 'portrait', aspect: '9:16', width: 1080 },
];

function args() {
  const out = { model: 'google/gemini-3-pro-image', only: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--only') out.only = argv[++i].split(',').map((s) => s.trim());
  }
  return out;
}

async function generate(key, model, prompt, aspect) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'x-title': 'Snakes & Ladders art',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: aspect },
      messages: [{ role: 'user', content: `${prompt} ${COMMON} Aspect ratio ${aspect}.` }],
    }),
  });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  const image = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!image) throw new Error(`no image in reply: ${JSON.stringify(data).slice(0, 300)}`);
  const base64 = image.slice(image.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('Set OPENROUTER_API_KEY first.');
    process.exit(1);
  }
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch (e) {
    console.error('Missing sharp. Run: npm install --no-save sharp');
    process.exit(1);
  }

  const { model, only } = args();
  fs.mkdirSync(OUT, { recursive: true });
  const scenes = Object.entries(SCENES).filter(([name]) => !only || only.includes(name));

  for (const [scene, prompt] of scenes) {
    for (const variant of VARIANTS) {
      const file = path.join(OUT, `${scene}-${variant.name}.webp`);
      process.stdout.write(`${scene} ${variant.name} … `);
      try {
        const png = await generate(key, model, prompt, variant.aspect);
        await sharp(png).resize({ width: variant.width, withoutEnlargement: true }).webp({ quality: 74 }).toFile(file);
        console.log(`${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
      } catch (error) {
        console.log(`failed: ${error.message}`);
      }
    }
  }
}

main();
