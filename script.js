(function () {
  'use strict';

  // Bump when shipping changes — lets you confirm the browser isn't serving a
  // stale cached copy (check the console line on startup).
  const BUILD = '2026-09-25e';

  const STORAGE_KEY = 'snakeLoveGame_v5';
  const AI_KEY = 'snakeLoveAI_v1';
  const SOUND_KEY = 'snakeLoveSound_v1';
  const MODE_KEY = 'snakeLoveMode_v1';
  const LANG_KEY = 'snakeLoveLang_v1';
  const SCENE_KEY = 'snakeLoveScene_v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // A player is a name and a colour — the colour is their only mark on the
  // board. Kept comfortably longer than MAX_PLAYERS so there is always a free
  // colour to cycle to, and every player ends up visually distinct.
  const COLOR_CHOICES = [
    '#d6336c',
    '#3b7dd8',
    '#2f9e5b',
    '#8b5fbf',
    '#e08a2c',
    '#2c7a7b',
    '#c0392b',
    '#4a5b9e',
    '#7a8b2a',
    '#9c5a2c',
  ];
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6;

  const DICE_ORIENTATION = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const PIP_LAYOUT = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DICE_MS = REDUCED_MOTION ? 220 : 1800;
  const STEP_MS = REDUCED_MOTION ? 60 : 320;
  const TRAVEL_MS = REDUCED_MOTION ? 200 : 1200;
  // Beat between the pawn landing and the question appearing, so you get to
  // see where you actually landed before the modal takes over the screen.
  const LANDING_PAUSE_MS = REDUCED_MOTION ? 150 : 900;
  // How long a charmed snake takes to fade off the board.
  const CHARM_FADE_MS = 700;
  // Cap on scattered scene motifs, so a lucky hash can't crowd the board.
  const ORNAMENT_MAX = 30;

  // Heart powers. An answered question pays 2, so a re-roll costs one answer.
  // `target` powers ask what to act on first (a rival, or a snake); `pick`
  // powers ask for a die face.
  const POWERS = {
    reroll: { cost: 2 },
    shield: { cost: 4, icon: 'i-shield' },
    boost: { cost: 4, steps: 3, icon: 'i-bolt' },
    freeze: { cost: 5, icon: 'i-snow', target: true },
    rewind: { cost: 6, icon: 'i-history', target: true },
    heist: { cost: 8, take: 4, icon: 'i-mask', target: true },
    loaded: { cost: 8, icon: 'i-dice', pick: true },
    charm: { cost: 13, icon: 'i-charm', target: true },
    swap: { cost: 20, icon: 'i-swap', target: true },
  };
  // Names and descriptions live in i18n.js as `power.<kind>.name` / `.desc`,
  // so they follow the chosen language.
  const powerName = (kind) => t(`power.${kind}.name`);
  // Ascending cost, so a new power slots in where its price puts it.
  const SHOP = ['shield', 'boost', 'freeze', 'rewind', 'heist', 'loaded', 'charm', 'swap'];
  // A steal is capped by the price (8 for at most 4), so a thief always loses
  // hearts by stealing and can't farm a rival. It also needs something worth
  // taking — stealing one heart for eight is never a real choice.
  const HEIST_MIN = 3;

  const $ = (id) => document.getElementById(id);

  // ---------- Language ----------
  // Interface strings come from I18N (i18n.js); content carries its own
  // translations as `<field>_<lang>` (see loc) or, for questions, a parallel
  // bank (QUESTIONS_ID in data-id.js). Language is a device preference rather
  // than part of the game, so switching mid-game just re-labels everything.
  let lang = 'en';

  function t(key, vars) {
    const table = I18N[lang] || I18N.en;
    let text = key in table ? table[key] : key in I18N.en ? I18N.en[key] : key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
    return text;
  }

  // A content object's field in the active language, falling back to English.
  const loc = (obj, field) => (lang !== 'en' && obj[`${field}_${lang}`]) || obj[field];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- Board geometry ----------
  const CELL_ORDER = (() => {
    const rows = [];
    for (let r = 0; r < 10; r++) {
      const nums = [];
      for (let c = 0; c < 10; c++) nums.push(r * 10 + 1 + c);
      if (r % 2 === 1) nums.reverse();
      rows.push(nums);
    }
    return rows.reverse().flat();
  })();

  const CELL_INDEX = {};
  CELL_ORDER.forEach((num, i) => {
    CELL_INDEX[num] = i;
  });

  const rowOf = (cell) => Math.floor((cell - 1) / 10);
  const colOf = (cell) => CELL_INDEX[cell] % 10;

  let state = null;
  let aiConfig = null;
  let cellEls = {};
  let tokenEls = [];
  // Two different questions, deliberately kept apart:
  //   animating  — something is physically moving (dice, pawn). Drives visuals.
  //   turnBusy   — this turn has begun and hasn't been handed over yet. Drives
  //                input locking, and stays true across the quiet beat between
  //                the pawn landing and the question appearing.
  let animating = false;
  let turnBusy = false;
  // Powers bought since the current player last rolled. Only these can be
  // refunded — once the dice leave the hand, a purchase is committed.
  let armedThisTurn = freshArmed();
  // Which power in the sheet is waiting on a choice (a rival, or a die face).
  let pickingPower = null;

  function freshArmed() {
    return { shield: false, boost: false, loaded: false, freeze: null };
  }
  let pendingSurprise = null;
  let currentQuestion = null;
  let diceSpins = 0;

  // ---------- Persistence ----------
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !parsed.started || !Array.isArray(parsed.players)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function loadAiConfig() {
    try {
      return JSON.parse(localStorage.getItem(AI_KEY)) || { provider: 'openrouter', key: '', model: '' };
    } catch (e) {
      return { provider: 'openrouter', key: '', model: '' };
    }
  }

  function saveAiConfig() {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(aiConfig));
    } catch (e) {
      /* storage unavailable */
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Mode ----------
  // Couples or Friends. This decides which questions, dares and surprises are
  // in play and what the model is told about who is at the table — a group of
  // friends should never be dealt "give your partner a shoulder massage".
  //
  // During a game state.mode is authoritative, so a game in progress keeps the
  // mode it was started in. On the setup screen there is no state yet, so the
  // pending choice stands in.
  let pendingMode = 'couples';

  const activeMode = () => (state && state.mode) || pendingMode;

  function loadMode() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved && MODES[saved]) pendingMode = saved;
    } catch (e) {
      /* storage unavailable */
    }
  }

  function setPendingMode(mode) {
    if (!MODES[mode] || mode === pendingMode) return;
    pendingMode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch (e) {
      /* storage unavailable */
    }
    
    if (mode === 'couples' && roster.length > 2) {
      roster.length = 2;
    }
    
    renderModeChoice();
    // Topic names change with the mode ("Love" reads wrong for friends), so
    // the chips are redrawn — keeping whatever was already selected.
    renderThemeChips();
    renderRoster();
  }

  // ---------- Language picker ----------
  // The player's own choice sticks. Before there is one, the Indonesian
  // landing page (/id, served as lang="id" — see scripts/build.js) opens in
  // Indonesian, and / follows the browser: Indonesian if it asks for id/in,
  // else English.
  function loadLanguage() {
    let saved = null;
    try {
      saved = localStorage.getItem(LANG_KEY);
    } catch (e) {
      /* storage unavailable */
    }
    if (saved && I18N[saved]) lang = saved;
    else if (document.documentElement.lang === 'id') lang = 'id';
    else lang = /^(id|in)\b/i.test(navigator.language || '') ? 'id' : 'en';
  }

  function setLanguage(next) {
    if (!I18N[next] || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch (e) {
      /* storage unavailable */
    }
    applyLanguage();
  }

  function nextLanguage() {
    const keys = Object.keys(LANGUAGES);
    return keys[(keys.indexOf(lang) + 1) % keys.length];
  }

  function renderLanguageChoice() {
    const container = $('lang-choice');
    container.innerHTML = '';
    Object.entries(LANGUAGES).forEach(([key, language]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = language.short;
      btn.title = language.label;
      btn.setAttribute('aria-label', language.label);
      btn.setAttribute('lang', language.htmlLang);
      btn.classList.toggle('selected', lang === key);
      btn.setAttribute('aria-pressed', lang === key);
      btn.addEventListener('click', () => setLanguage(key));
      container.appendChild(btn);
    });
    $('lang-btn-label').textContent = LANGUAGES[lang].short;
  }

  // Re-labels everything already on screen. Static markup carries
  // data-i18n (textContent) or data-i18n-attr ("attr:key;attr:key"); the
  // rest is rebuilt by the same render functions that drew it.
  function applyLanguage() {
    document.documentElement.lang = LANGUAGES[lang].htmlLang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, t(key));
      });
    });
    $('powers-sub').textContent = t('powersSub', { cost: POWERS.reroll.cost });
    renderLanguageChoice();
    renderModeChoice();
    renderThemeChips();
    renderRoster();
    syncScenePicker();
    syncSoundButtons();
    if (!state) return;

    renderAll();
    if (!$('log-drawer').classList.contains('hidden')) renderLog();
    if (pendingSurprise) $('surprise-text').textContent = surpriseText(pendingSurprise);
    // A saved question sits at the same index in both banks, so the card on
    // screen can follow the switch. An AI line stays as it was written.
    if (currentQuestion && !$('question-modal').classList.contains('hidden')) {
      setQuestionBadge(currentQuestion.theme, currentQuestion.ai);
      if (typeof currentQuestion.index === 'number') {
        const text = questionPool(currentQuestion.theme)[currentQuestion.index];
        if (text) {
          currentQuestion.text = text;
          $('question-text').textContent = text;
        }
      }
    }
  }

  const themeOf = (key) => QUESTION_THEMES[key] || QUESTION_THEMES.general;

  function themeLabel(key) {
    const theme = themeOf(key);
    return (activeMode() === 'friends' && loc(theme, 'friendsLabel')) || loc(theme, 'label');
  }

  // English, whatever the interface language: it's what the model is told.
  function themeLabelEn(key) {
    const theme = themeOf(key);
    return (activeMode() === 'friends' && theme.friendsLabel) || theme.label;
  }

  // A theme's pool is its shared questions plus the ones written for the mode
  // in play. pickUnused() records indexes into this, which is safe because the
  // composition can't change mid-game — mode is fixed when the game starts.
  function questionPool(themeKey) {
    // The Indonesian bank mirrors the English one line for line, so indexes
    // in state.usedQuestions stay valid across a language switch.
    const bank = lang === 'id' && typeof QUESTIONS_ID !== 'undefined' ? QUESTIONS_ID : QUESTIONS;
    const entry = bank[themeKey] || QUESTIONS[themeKey] || {};
    return (entry.shared || []).concat(entry[activeMode()] || []);
  }

  // Cards carrying `only` drop out of the other mode. This is what keeps the
  // romantic surprises out of a game between friends.
  function surprisePool() {
    const mode = activeMode();
    return SURPRISES.filter((surprise) => !surprise.only || surprise.only === mode);
  }

  const surpriseText = (surprise) =>
    (activeMode() === 'friends' && surprise.friends && loc(surprise, 'friends')) || loc(surprise, 'text');

  // ---------- New game ----------
  function freshState(playerSetups, themes, mode) {
    const usedQuestions = {};
    Object.keys(QUESTION_THEMES).forEach((key) => {
      usedQuestions[key] = [];
    });

    return {
      players: playerSetups.map((p) => ({
        name: p.name,
        color: p.color,
        pos: 1,
        love: 0,
        skipNext: false,
      })),
      current: 0,
      started: true,
      finished: false,
      mode: MODES[mode] ? mode : 'couples',
      themes,
      boardTheme: takeBoardTheme(),
      ...generateBoard(),
      usedQuestions,
      usedSurprises: [],
      answers: [],
      log: [],
      lastRoll: 1,
    };
  }

  // ---------- Sound ----------
  // Everything is synthesised with Web Audio: no sound files, nothing to
  // download or precache, and it all works offline. The header button cycles
  // three settings: everything (effects plus the scene's ambience), effects
  // only, and off.
  //
  // Browsers only let audio start from a user gesture. The context is created
  // (or resumed) by the first tap or key press — see unlockAudio — and every
  // effect below is itself set off by one.
  const SOUND_MODES = ['all', 'fx', 'off'];
  const SOUND_ICONS = { all: '#i-sound-on', fx: '#i-sound-fx', off: '#i-sound-off' };
  let soundMode = 'all';
  let audioCtx = null;
  // Effects feed sfxOut, each ambience feeds master through its own fader, and
  // anything that wants a little room around it also feeds roomIn — one
  // shared synthetic reverb, which effects reach through sfxRoom.
  let master = null;
  let sfxOut = null;
  let sfxRoom = null;
  let roomIn = null;
  // Effects run 6 dB hot, so every roll and card lands on top of the scene
  // rather than inside it. Measured, not guessed: a roll peaks around -19 LUFS
  // (momentary) and -8 dBFS, while the scenes average -34 LUFS.
  const SFX_LEVEL = 2;
  const noiseBuffers = {};

  const soundOn = () => soundMode !== 'off';

  function ensureAudio() {
    if (!soundOn()) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
      buildMix(audioCtx);
    }
    if (audioCtx.state === 'suspended' && !document.hidden) audioCtx.resume();
    return audioCtx;
  }

  function buildMix(ctx) {
    // A gentle compressor on the way out, so a pile of effects on top of the
    // ambience can't clip.
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -16;
    master.knee.value = 10;
    master.ratio.value = 3;
    master.attack.value = 0.004;
    master.release.value = 0.3;
    master.connect(ctx.destination);

    sfxOut = ctx.createGain();
    sfxOut.gain.value = SFX_LEVEL;
    sfxOut.connect(master);

    // The room: a decaying burst of stereo noise as the impulse response,
    // darkened on the way out so the tail never hisses.
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx, 2.4, 3);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    roomIn = ctx.createGain();
    roomIn.gain.value = 0.5;
    roomIn.connect(room).connect(tone).connect(master);
    sfxRoom = ctx.createGain();
    sfxRoom.gain.value = SFX_LEVEL;
    sfxRoom.connect(roomIn);
  }

  function roomImpulse(ctx, seconds, decay) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
    return buffer;
  }

  // Looping stereo noise, made once per colour: white is flat, pink (Paul
  // Kellet's filter) is softer, brown (integrated white) is the deep rumble
  // under surf and wind. The loop point is crossfaded so it never clicks.
  function noiseBuffer(ctx, color) {
    if (noiseBuffers[color]) return noiseBuffers[color];
    const rate = ctx.sampleRate;
    const length = rate * 6;
    const fade = Math.floor(rate * 0.25);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(length + fade);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let last = 0;
      for (let i = 0; i < raw.length; i++) {
        const white = Math.random() * 2 - 1;
        if (color === 'pink') {
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.963 * b1 + white * 0.2965164;
          b2 = 0.57 * b2 + white * 1.0526913;
          raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
        } else if (color === 'brown') {
          last = (last + 0.02 * white) / 1.02;
          raw[i] = last * 3.5;
        } else {
          raw[i] = white * 0.5;
        }
      }
      const data = buffer.getChannelData(ch);
      data.set(raw.subarray(0, length));
      // The first samples blend from what would have followed the last one.
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[i] = raw[i] * k + raw[length + i] * (1 - k);
      }
    }
    noiseBuffers[color] = buffer;
    return buffer;
  }

  // Sends a node on to dest ({ dry, wet }), panned, with a share to the room.
  function route(ctx, node, dest, pan, room) {
    let out = node;
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      out = panner;
    }
    out.connect(dest.dry);
    if (room && dest.wet) {
      const send = ctx.createGain();
      send.gain.value = room;
      out.connect(send).connect(dest.wet);
    }
  }

  // One oscillator with a percussive envelope, at an absolute audio time.
  // `vibrato` is [rate Hz, depth Hz]; `lowpass` softens a bright waveform.
  function voice(ctx, dest, opts) {
    const { at, freq, endFreq, type = 'sine', duration = 0.12, gain = 0.1, attack = 0.012 } = opts;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    let head = osc;
    if (opts.lowpass) {
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = opts.lowpass;
      head = head.connect(soft);
    }
    head.connect(amp);
    if (opts.vibrato) {
      const wobble = ctx.createOscillator();
      wobble.frequency.value = opts.vibrato[0];
      const depth = ctx.createGain();
      depth.gain.value = opts.vibrato[1];
      wobble.connect(depth).connect(osc.frequency);
      wobble.start(at);
      wobble.stop(at + duration + 0.05);
    }
    route(ctx, amp, dest, opts.pan, opts.room);
    osc.start(at);
    osc.stop(at + duration + 0.05);
    return osc;
  }

  // A filtered noise hit: dice, crackles, rustles, whooshes.
  function burst(ctx, dest, opts) {
    const { at, duration = 0.06, gain = 0.1, freq = 1800, q = 1, type = 'bandpass', color = 'white', attack = 0.002 } = opts;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, color);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter).connect(amp);
    route(ctx, amp, dest, opts.pan, opts.room);
    src.start(at, Math.random() * 5);
    src.stop(at + duration + 0.05);
    return { src, filter, amp };
  }

  // The effects' context, or null when sound is off or unsupported.
  function fx() {
    const ctx = ensureAudio();
    return ctx ? { ctx, dest: { dry: sfxOut, wet: sfxRoom }, now: ctx.currentTime } : null;
  }

  // A few quick high glints: the magic in a ladder, a good surprise, a win.
  function sparkle(a, delay, count, gain = 0.03) {
    for (let i = 0; i < count; i++) {
      const f = 2400 + Math.random() * 2600;
      voice(a.ctx, a.dest, {
        at: a.now + delay + i * 0.045 + Math.random() * 0.02,
        freq: f,
        endFreq: f * 1.06,
        duration: 0.12,
        gain,
        attack: 0.004,
        pan: Math.random() * 1.4 - 0.7,
        room: 0.4,
      });
    }
  }

  // Timings of the bounces diceToss (style.css) draws, as a share of DICE_MS.
  const DICE_IMPACTS = [0.58, 0.79, 0.9];

  // A rattle in the hand, a whoosh through the air, then a thud and a clack
  // for every bounce, softer each time.
  function soundDice() {
    const a = fx();
    if (!a) return;
    const { ctx, dest, now } = a;
    const T = DICE_MS / 1000;
    for (let i = 0; i < 4; i++) {
      burst(ctx, dest, { at: now + i * 0.035, duration: 0.03, gain: 0.05, freq: 2200 + Math.random() * 900, q: 2 });
    }
    const air = burst(ctx, dest, { at: now + 0.06, duration: T * 0.5, gain: 0.02, freq: 500, q: 0.8, color: 'pink', attack: T * 0.2 });
    air.filter.frequency.exponentialRampToValueAtTime(1400, now + T * 0.3);
    air.filter.frequency.exponentialRampToValueAtTime(600, now + T * 0.56);
    DICE_IMPACTS.forEach((when, i) => {
      const at = now + T * when;
      const force = [1, 0.55, 0.3][i];
      voice(ctx, dest, { at, freq: 170, endFreq: 70, type: 'triangle', duration: 0.2, gain: 0.13 * force, attack: 0.004 });
      burst(ctx, dest, { at, duration: 0.05, gain: 0.11 * force, freq: 1900 + Math.random() * 700, q: 1.4, room: 0.15 });
      if (i === 0) {
        [0.05, 0.1, 0.17].forEach((d) =>
          burst(ctx, dest, { at: at + d, duration: 0.03, gain: 0.04, freq: 2400 + Math.random() * 1200, q: 2 })
        );
      }
    });
  }

  // Each step of a walk climbs the pentatonic scale, so a long roll sings.
  const STEP_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

  function soundStep(n = 0) {
    const a = fx();
    if (!a) return;
    const f = STEP_NOTES[n % STEP_NOTES.length];
    voice(a.ctx, a.dest, { at: a.now, freq: f, endFreq: f * 1.12, type: 'triangle', duration: 0.09, gain: 0.07 });
  }

  function soundLadder() {
    const a = fx();
    if (!a) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) =>
      voice(a.ctx, a.dest, { at: a.now + i * 0.09, freq, type: 'triangle', duration: 0.22, gain: 0.08, room: 0.3 })
    );
    sparkle(a, 0.35, 6);
  }

  // A hiss, then the long slide down.
  function soundSnake() {
    const a = fx();
    if (!a) return;
    burst(a.ctx, a.dest, { at: a.now, duration: 0.45, gain: 0.05, freq: 5200, q: 0.7, type: 'highpass', attack: 0.06 });
    voice(a.ctx, a.dest, { at: a.now + 0.12, freq: 720, endFreq: 140, type: 'sawtooth', duration: 0.8, gain: 0.06, attack: 0.03, lowpass: 1600 });
  }

  function soundWin() {
    const a = fx();
    if (!a) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      voice(a.ctx, a.dest, { at: a.now + i * 0.12, freq, type: 'triangle', duration: 0.35, gain: 0.1, room: 0.3 })
    );
    [523.25, 659.25, 783.99, 1046.5].forEach((freq) =>
      voice(a.ctx, a.dest, { at: a.now + 0.55, freq, duration: 1.6, gain: 0.05, attack: 0.03, room: 0.5 })
    );
    sparkle(a, 0.5, 10);
  }

  // A light tick for picking a scene or a colour.
  function soundPick() {
    const a = fx();
    if (!a) return;
    voice(a.ctx, a.dest, { at: a.now, freq: 1320, endFreq: 1500, type: 'triangle', duration: 0.07, gain: 0.04 });
  }

  // A question card: a whoosh as it arrives, then a two-note chime.
  function soundCardOpen() {
    const a = fx();
    if (!a) return;
    const whoosh = burst(a.ctx, a.dest, { at: a.now, duration: 0.28, gain: 0.04, freq: 500, q: 0.9, color: 'pink', attack: 0.12 });
    whoosh.filter.frequency.exponentialRampToValueAtTime(2600, a.now + 0.26);
    voice(a.ctx, a.dest, { at: a.now + 0.16, freq: 880, duration: 0.5, gain: 0.06, room: 0.45 });
    voice(a.ctx, a.dest, { at: a.now + 0.27, freq: 1318.51, duration: 0.6, gain: 0.05, room: 0.45 });
  }

  // "Answered": a bright little rise.
  function soundAnswer() {
    const a = fx();
    if (!a) return;
    [659.25, 830.61, 987.77].forEach((freq, i) =>
      voice(a.ctx, a.dest, { at: a.now + i * 0.07, freq, type: 'triangle', duration: 0.25, gain: 0.07, room: 0.3 })
    );
  }

  function soundSkip() {
    const a = fx();
    if (!a) return;
    voice(a.ctx, a.dest, { at: a.now, freq: 587.33, type: 'triangle', duration: 0.16, gain: 0.05 });
    voice(a.ctx, a.dest, { at: a.now + 0.12, freq: 440, endFreq: 415.3, type: 'triangle', duration: 0.24, gain: 0.045 });
  }

  // "Another": a quick riffle, like thumbing through a deck.
  function soundShuffle() {
    const a = fx();
    if (!a) return;
    for (let i = 0; i < 6; i++) {
      burst(a.ctx, a.dest, {
        at: a.now + i * 0.028,
        duration: 0.025,
        gain: 0.035,
        freq: 3000 + Math.random() * 1500,
        q: 1.5,
        pan: i % 2 ? 0.25 : -0.25,
      });
    }
  }

  // Hearts gained or lost, whatever caused it: a coin-bright ding, or a soft
  // drop.
  function soundHearts(delta) {
    const a = fx();
    if (!a) return;
    if (delta > 0) {
      voice(a.ctx, a.dest, { at: a.now, freq: 987.77, duration: 0.14, gain: 0.05, room: 0.3 });
      voice(a.ctx, a.dest, { at: a.now + 0.08, freq: 1318.51, duration: 0.4, gain: 0.05, room: 0.35 });
    } else {
      voice(a.ctx, a.dest, { at: a.now, freq: 300, endFreq: 170, duration: 0.3, gain: 0.07, attack: 0.02 });
    }
  }

  // A heart power bought: a rising, wobbling sweep with a glint on top.
  function soundPower() {
    const a = fx();
    if (!a) return;
    voice(a.ctx, a.dest, { at: a.now, freq: 330, endFreq: 990, type: 'triangle', duration: 0.35, gain: 0.06, vibrato: [12, 20] });
    sparkle(a, 0.2, 5, 0.025);
  }

  // How a surprise card lands for the player who drew it.
  function surpriseMood(surprise) {
    switch (surprise.type) {
      case 'moveSelf':
        return surprise.value >= 0 ? 'good' : 'bad';
      case 'lovePoints':
        if (surprise.target === 'opponent') return 'neutral';
        return surprise.value >= 0 ? 'good' : 'bad';
      case 'skipTurn':
        return surprise.target === 'opponent' ? 'good' : 'bad';
      case 'extraTurn':
      case 'bothPoints':
      case 'action':
        return 'good';
      default:
        return 'neutral';
    }
  }

  // A shimmer as the card turns over, then the verdict: a "ta-da", a sad
  // trombone, or a playful whoop for the swaps that could go either way.
  function soundSurprise(mood) {
    const a = fx();
    if (!a) return;
    const { ctx, dest, now } = a;
    for (let i = 0; i < 8; i++) {
      voice(ctx, dest, { at: now + i * 0.04, freq: 800 * 2 ** (i / 6), duration: 0.14, gain: 0.028, pan: (i % 2 ? 0.3 : -0.3), room: 0.35 });
    }
    const at = now + 0.38;
    if (mood === 'good') {
      [[523.25, 0], [783.99, 0], [1046.5, 0.08], [1318.51, 0.08]].forEach(([freq, d]) =>
        voice(ctx, dest, { at: at + d, freq, type: 'triangle', duration: 0.55, gain: 0.06, room: 0.4 })
      );
      sparkle(a, 0.5, 6);
    } else if (mood === 'bad') {
      [392, 369.99, 349.23].forEach((freq, i) =>
        voice(ctx, dest, { at: at + i * 0.22, freq, endFreq: freq * 0.97, type: 'sawtooth', duration: 0.24, gain: 0.05, lowpass: 900 })
      );
      voice(ctx, dest, { at: at + 0.66, freq: 329.63, endFreq: 311.13, type: 'sawtooth', duration: 0.7, gain: 0.05, lowpass: 900, vibrato: [6, 7] });
    } else {
      voice(ctx, dest, { at, freq: 440, endFreq: 880, type: 'triangle', duration: 0.22, gain: 0.06 });
      voice(ctx, dest, { at: at + 0.2, freq: 660, endFreq: 1320, type: 'triangle', duration: 0.26, gain: 0.05 });
    }
  }

  function loadSoundMode() {
    let saved = null;
    try {
      saved = localStorage.getItem(SOUND_KEY);
    } catch (e) {
      /* storage unavailable */
    }
    // 'on' is what the old two-way switch saved; it meant "all sound".
    soundMode = SOUND_MODES.includes(saved) ? saved : 'all';
  }

  function setSoundMode(mode) {
    soundMode = SOUND_MODES.includes(mode) ? mode : 'all';
    try {
      localStorage.setItem(SOUND_KEY, soundMode);
    } catch (e) {
      /* storage unavailable */
    }
    syncSoundButtons();
    if (audioCtx) {
      if (!soundOn()) audioCtx.suspend();
      else if (!document.hidden) audioCtx.resume();
    }
    updateAmbience();
  }

  // Pressing the button is a clear yes to sound, so it may start the ambience.
  function cycleSound() {
    ambienceWanted = true;
    setSoundMode(SOUND_MODES[(SOUND_MODES.indexOf(soundMode) + 1) % SOUND_MODES.length]);
    soundPick();
    updateAmbience();
  }

  function syncSoundButtons() {
    document.querySelectorAll('.sound-toggle').forEach((btn) => {
      btn.querySelector('use').setAttribute('href', SOUND_ICONS[soundMode]);
      const label = t(`sound.${soundMode}`);
      btn.title = label;
      btn.setAttribute('aria-label', label);
    });
  }

  // The first tap or key press anywhere: the moment audio may start. A game
  // restored from a reload picks its ambience back up here.
  function unlockAudio() {
    if (!soundOn()) return;
    ensureAudio();
    if (state && !state.finished) ambienceWanted = true;
    updateAmbience();
  }

  // ---------- Ambience ----------
  // Each scene's soundscape, synthesised on the spot: wind and surf from
  // filtered noise; birds, crickets, an owl, chimes and a candlelit café pad
  // from oscillators. Nothing repeats audibly, because events are placed at
  // random on the audio clock a few seconds ahead — the lookahead pattern:
  // setInterval only wakes the scheduler, it never times a sound itself.
  //
  // It starts once there's a reason to expect sound — picking a scene,
  // starting a game, pressing the sound button — never on page load, and it
  // stops while the page is hidden.
  let ambience = null;
  let ambienceWanted = false;
  let shownScene = null;

  function updateAmbience() {
    const theme = BOARD_THEMES[shownScene];
    const running = audioCtx && audioCtx.state !== 'closed';
    const key =
      ambienceWanted && soundMode === 'all' && running && !document.hidden && theme ? theme.ambience : null;
    if (ambience && ambience.key === key) return;
    if (ambience) ambience.stop();
    ambience = key && AMBIENCES[key] ? { key, stop: playAmbience(audioCtx, key) } : null;
  }

  function playAmbience(ctx, key) {
    const recipe = AMBIENCES[key];
    const scene = {
      ctx,
      dry: ctx.createGain(),
      wet: ctx.createGain(),
      sources: [],
      rand: (min, max) => min + Math.random() * (max - min),
    };
    scene.dest = { dry: scene.dry, wet: scene.wet };
    scene.dry.connect(master);
    scene.wet.connect(roomIn);
    recipe.bed(scene);

    // Fades in over a few seconds, so it arrives rather than switches on, to
    // the recipe's own level — set so every scene sits at the same loudness.
    const now = ctx.currentTime;
    [scene.dry, scene.wet].forEach((fader) => {
      fader.gain.setValueAtTime(0, now);
      fader.gain.linearRampToValueAtTime(recipe.level || 1, now + 3);
    });

    const events = recipe.events(scene).map((ev) => ({ ...ev, next: now + (ev.first || 0.5) }));
    const gap = (ev) => (typeof ev.every === 'function' ? ev.every(scene) : scene.rand(ev.every[0], ev.every[1]));
    const tick = () => {
      const horizon = ctx.currentTime + 2.5;
      events.forEach((ev) => {
        while (ev.next < horizon) {
          ev.play(scene, Math.max(ev.next, ctx.currentTime + 0.05));
          ev.next += gap(ev);
        }
      });
    };
    tick();
    const timer = setInterval(tick, 1000);

    return () => {
      clearInterval(timer);
      const t0 = ctx.currentTime;
      [scene.dry, scene.wet].forEach((fader) => {
        fader.gain.cancelScheduledValues(t0);
        fader.gain.setValueAtTime(fader.gain.value, t0);
        fader.gain.linearRampToValueAtTime(0, t0 + 1.5);
      });
      setTimeout(() => {
        scene.sources.forEach((src) => {
          try {
            src.stop();
          } catch (e) {
            /* already stopped */
          }
        });
        scene.dry.disconnect();
        scene.wet.disconnect();
      }, 1800);
    };
  }

  // A slow sine wobble on a parameter, around whatever value it already has.
  function lfo(scene, param, rate, depth) {
    const osc = scene.ctx.createOscillator();
    osc.frequency.value = rate * scene.rand(0.85, 1.15);
    const amount = scene.ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(param);
    osc.start();
    scene.sources.push(osc);
  }

  // A continuous layer of filtered noise. `swell` is a list of [rate, depth as
  // a share of gain] — gusts and lulls; `sweep` is [rate, depth in Hz].
  function noiseBed(scene, opts) {
    const { ctx } = scene;
    const { color = 'pink', type = 'bandpass', freq, q = 0.7, gain } = opts;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, color);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp);
    route(ctx, amp, scene.dest, opts.pan, opts.room);
    (opts.swell || []).forEach(([rate, share]) => lfo(scene, amp.gain, rate, gain * share));
    if (opts.sweep) lfo(scene, filter.frequency, opts.sweep[0], opts.sweep[1]);
    src.start(ctx.currentTime, Math.random() * src.buffer.duration);
    scene.sources.push(src);
    return { filter, amp };
  }

  // A one-off stretch of noise with its own filter, for waves and gusts.
  function noiseSwell(scene, at, length, opts) {
    const { ctx } = scene;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, opts.color || 'pink');
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type || 'lowpass';
    filter.frequency.value = opts.freq || 800;
    filter.Q.value = opts.q || 0.5;
    const amp = ctx.createGain();
    amp.gain.value = 0.0001;
    src.connect(filter).connect(amp);
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = opts.pan || 0;
      amp.connect(panner);
    }
    const out = panner || amp;
    out.connect(scene.dry);
    if (opts.room) {
      const send = ctx.createGain();
      send.gain.value = opts.room;
      out.connect(send).connect(scene.wet);
    }
    src.start(at, Math.random() * 5);
    src.stop(at + length + 0.1);
    return { filter, amp, panner };
  }

  // Points on a gain curve, as [value, seconds after `at`].
  function shape(param, at, points) {
    param.setValueAtTime(points[0][0], at + points[0][1]);
    points.slice(1).forEach(([value, when]) => param.exponentialRampToValueAtTime(Math.max(value, 0.0001), at + when));
  }

  // ---- Calls and cries, shared by the scenes.

  // A songbird's phrase: a run of quick gliding chirps. Some birds sit
  // further off, quieter and wetter.
  function songbird(scene, at, low, high) {
    const notes = 3 + Math.floor(Math.random() * 5);
    const pan = scene.rand(-0.8, 0.8);
    const far = Math.random() < 0.4;
    let t = at;
    for (let i = 0; i < notes; i++) {
      const f = scene.rand(low, high);
      const len = scene.rand(0.05, 0.13);
      const rising = Math.random() < 0.5;
      voice(scene.ctx, scene.dest, {
        at: t,
        freq: rising ? f * 0.85 : f * 1.15,
        endFreq: f,
        duration: len,
        gain: far ? 0.018 : 0.04,
        attack: 0.008,
        pan,
        room: far ? 0.5 : 0.2,
      });
      t += len + scene.rand(0.02, 0.07);
    }
  }

  // Two falling notes, "tee-oo", once to three times.
  function whistleBird(scene, at) {
    const pan = scene.rand(-0.7, 0.7);
    const calls = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      const t = at + i * 0.42;
      voice(scene.ctx, scene.dest, { at: t, freq: 4300, endFreq: 4100, duration: 0.16, gain: 0.03, pan, room: 0.25 });
      voice(scene.ctx, scene.dest, { at: t + 0.18, freq: 3300, endFreq: 3000, duration: 0.2, gain: 0.026, pan, room: 0.25 });
    }
  }

  // "Coo-COO-coo, coo-coo" from somewhere in the canopy.
  function woodPigeon(scene, at) {
    const pan = scene.rand(-0.6, 0.6);
    [[0, 0.32, 1], [0.42, 0.5, 1.15], [1, 0.3, 0.9], [1.5, 0.28, 1], [1.85, 0.28, 0.95]].forEach(([d, len, k]) =>
      voice(scene.ctx, scene.dest, { at: at + d, freq: 540 * k, endFreq: 480 * k, duration: len, gain: 0.026, attack: 0.06, pan, room: 0.5, lowpass: 900 })
    );
  }

  function woodpecker(scene, at) {
    const hits = 10 + Math.floor(Math.random() * 6);
    const pan = scene.rand(-0.8, 0.8);
    for (let i = 0; i < hits; i++) {
      burst(scene.ctx, scene.dest, { at: at + i * 0.055, duration: 0.03, gain: 0.03 * (1 - (i / hits) * 0.5), freq: 1100, q: 3, pan, room: 0.5 });
    }
  }

  // A skylark's trill: fast alternating notes, high and light.
  function lark(scene, at) {
    const n = 10 + Math.floor(Math.random() * 12);
    const base = scene.rand(3800, 5000);
    const pan = scene.rand(-0.6, 0.6);
    for (let i = 0; i < n; i++) {
      voice(scene.ctx, scene.dest, {
        at: at + i * 0.045,
        freq: base * (i % 2 ? 1.18 : 1),
        endFreq: base * (i % 2 ? 1.1 : 1.06),
        duration: 0.04,
        gain: 0.02,
        attack: 0.004,
        pan,
        room: 0.3,
      });
    }
  }

  // A bee drifting past from one side to the other.
  function bee(scene, at) {
    const { ctx } = scene;
    const length = scene.rand(3, 5);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = scene.rand(190, 240);
    const buzz = ctx.createOscillator();
    buzz.frequency.value = scene.rand(7, 11);
    const buzzDepth = ctx.createGain();
    buzzDepth.gain.value = 6;
    buzz.connect(buzzDepth).connect(osc.frequency);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 520;
    band.Q.value = 1.4;
    const amp = ctx.createGain();
    shape(amp.gain, at, [[0.0001, 0], [0.03, length * 0.45], [0.0001, length]]);
    osc.connect(band).connect(amp);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      const from = Math.random() < 0.5 ? -0.9 : 0.9;
      pan.pan.setValueAtTime(from, at);
      pan.pan.linearRampToValueAtTime(-from, at + length);
      amp.connect(pan).connect(scene.dry);
    } else {
      amp.connect(scene.dry);
    }
    osc.start(at);
    buzz.start(at);
    osc.stop(at + length + 0.1);
    buzz.stop(at + length + 0.1);
  }

  function grasshopper(scene, at) {
    const n = 5 + Math.floor(Math.random() * 6);
    const pan = scene.rand(-0.7, 0.7);
    for (let i = 0; i < n; i++) {
      burst(scene.ctx, scene.dest, { at: at + i * 0.09, duration: 0.035, gain: 0.012, freq: 6800, q: 4, pan });
    }
  }

  // A wave: dark noise that swells and opens up as it breaks, then foam
  // fizzing back down the sand.
  function wave(scene, at) {
    const rise = scene.rand(1.8, 2.8);
    const fall = scene.rand(3.2, 4.8);
    const size = scene.rand(0.7, 1.1);
    const pan = scene.rand(-0.35, 0.35);
    const body = noiseSwell(scene, at, rise + fall, { color: 'pink', type: 'lowpass', q: 0.5, pan, room: 0.15 });
    body.filter.frequency.setValueAtTime(260, at);
    body.filter.frequency.exponentialRampToValueAtTime(1500 * size, at + rise);
    body.filter.frequency.exponentialRampToValueAtTime(320, at + rise + fall);
    shape(body.amp.gain, at, [[0.0001, 0], [0.12 * size, rise], [0.04 * size, rise + fall * 0.5], [0.0001, rise + fall]]);
    const foam = noiseSwell(scene, at, rise + fall, { color: 'white', type: 'highpass', freq: 2600, q: 0.4, pan: -pan, room: 0.2 });
    shape(foam.amp.gain, at, [[0.0001, 0], [0.0001, rise * 0.8], [0.035 * size, rise + 0.4], [0.0001, rise + fall]]);
  }

  // Water lapping close by: a small splash and a few droplets.
  function lap(scene, at) {
    const splash = noiseSwell(scene, at, 0.6, { color: 'white', type: 'bandpass', freq: 1300, q: 0.8, pan: scene.rand(-0.6, 0.6) });
    splash.filter.frequency.exponentialRampToValueAtTime(500, at + 0.5);
    shape(splash.amp.gain, at, [[0.0001, 0], [0.02, 0.05], [0.0001, 0.5]]);
    const drops = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < drops; i++) {
      const f = scene.rand(700, 1300);
      voice(scene.ctx, scene.dest, { at: at + 0.15 + i * scene.rand(0.08, 0.18), freq: f, endFreq: f * 1.9, duration: 0.05, gain: 0.01, attack: 0.003, room: 0.3 });
    }
  }

  // Crickets: each one a pure high tone gated into a few quick pulses per
  // chirp, on its own steady beat, now and then falling silent.
  function crickets(scene) {
    return [0, 1, 2].map((i) => {
      const cricket = {
        freq: scene.rand(4200, 5200),
        pan: [-0.7, 0.1, 0.75][i],
        period: scene.rand(0.55, 0.95),
        pulses: 3 + Math.floor(Math.random() * 2),
        gain: scene.rand(0.006, 0.011),
      };
      return {
        first: scene.rand(0.2, 1.5),
        every: () => (Math.random() < 0.05 ? scene.rand(2, 5) : cricket.period * scene.rand(0.96, 1.04)),
        play: (s, at) => {
          for (let p = 0; p < cricket.pulses; p++) {
            voice(s.ctx, s.dest, { at: at + p * 0.04, freq: cricket.freq, duration: 0.022, gain: cricket.gain, attack: 0.003, pan: cricket.pan, room: 0.15 });
          }
        },
      };
    });
  }

  // A tawny owl in the distance: "hoo… hoo-hooo".
  function owl(scene, at) {
    const pan = scene.rand(-0.7, 0.7);
    const base = scene.rand(300, 360);
    [[0, 0.5, 1], [0.95, 0.22, 1.04], [1.3, 0.62, 0.98]].forEach(([d, len, k]) =>
      voice(scene.ctx, scene.dest, {
        at: at + d,
        freq: base * k * 1.04,
        endFreq: base * k * 0.94,
        duration: len,
        gain: 0.035,
        attack: 0.07,
        pan,
        room: 0.6,
        lowpass: 700,
        vibrato: [5, 4],
      })
    );
  }

  // Wind chimes, one to four strikes. Each is a few inharmonic partials that
  // ring out at different rates, which is what makes metal sound like metal.
  const CHIME_NOTES = [587.33, 659.25, 783.99, 880, 987.77, 1174.66];

  function windChimes(scene, at) {
    const strikes = 1 + Math.floor(Math.random() * 4);
    let t = at;
    for (let i = 0; i < strikes; i++) {
      const f = CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)];
      const gain = scene.rand(0.012, 0.02);
      const pan = scene.rand(-0.5, 0.5);
      [[1, 1, 3.2], [2.76, 0.4, 1.6], [5.4, 0.2, 0.9], [8.93, 0.1, 0.5]].forEach(([k, g, d]) =>
        voice(scene.ctx, scene.dest, { at: t, freq: f * k, duration: d, gain: gain * g, attack: 0.003, pan, room: 0.6 })
      );
      t += scene.rand(0.12, 0.5);
    }
  }

  // Sand lifted by a gust, hissing across from one side.
  function sandGust(scene, at) {
    const length = scene.rand(2, 3);
    const from = Math.random() < 0.5 ? -0.8 : 0.8;
    const gust = noiseSwell(scene, at, length, { color: 'white', type: 'highpass', freq: 4000, q: 0.5, pan: from, room: 0.1 });
    shape(gust.amp.gain, at, [[0.0001, 0], [0.018, length * 0.4], [0.0001, length]]);
    if (gust.panner) gust.panner.pan.linearRampToValueAtTime(-from, at + length);
  }

  // The café: slow chords, a music-box tune wandering over them, and the odd
  // crackle of a candle wick.
  const CAFE_CHORDS = [
    [174.61, 261.63, 329.63, 440],
    [164.81, 246.94, 293.66, 392],
    [146.83, 220, 261.63, 329.63, 349.23],
    [130.81, 196, 246.94, 329.63],
  ];
  const CAFE_BELLS = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

  function cafeChord(scene, at) {
    const { ctx } = scene;
    const notes = CAFE_CHORDS[scene.chord++ % CAFE_CHORDS.length];
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, at);
    bus.gain.linearRampToValueAtTime(1, at + 2.5);
    bus.gain.setValueAtTime(1, at + 7.5);
    bus.gain.linearRampToValueAtTime(0, at + 10.5);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 950;
    tone.Q.value = 0.3;
    bus.connect(tone);
    route(ctx, tone, scene.dest, 0, 0.6);
    notes.forEach((freq, i) => {
      const spread = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (spread.pan) spread.pan.value = (i / (notes.length - 1)) * 0.6 - 0.3;
      spread.connect(bus);
      [-6, 6].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        const level = ctx.createGain();
        level.gain.value = 0.011;
        osc.connect(level).connect(spread);
        osc.start(at);
        osc.stop(at + 10.6);
      });
    });
  }

  function musicBox(scene, at) {
    const pick = () => CAFE_BELLS[Math.floor(Math.random() * CAFE_BELLS.length)];
    const tine = (t, f, gain) => {
      const pan = scene.rand(-0.5, 0.5);
      voice(scene.ctx, scene.dest, { at: t, freq: f, duration: 1.8, gain, attack: 0.005, pan, room: 0.6 });
      voice(scene.ctx, scene.dest, { at: t, freq: f * 3.01, duration: 0.5, gain: gain * 0.22, attack: 0.003, pan, room: 0.6 });
    };
    tine(at, pick(), 0.02);
    if (Math.random() < 0.3) tine(at + 0.28, pick(), 0.015);
  }

  function candleCrackle(scene, at) {
    const pops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pops; i++) {
      burst(scene.ctx, scene.dest, {
        at: at + i * scene.rand(0.04, 0.12),
        duration: 0.014,
        gain: scene.rand(0.004, 0.008),
        freq: scene.rand(1500, 3000),
        q: 2.5,
        attack: 0.003,
        pan: scene.rand(-0.4, 0.4),
        room: 0.1,
      });
    }
  }

  // Keyed by each scene's `ambience` in data.js. `bed` builds the continuous
  // layers; `events` lists what happens now and then ([min, max] seconds
  // apart, or a function for anything with its own rhythm). `level` is the
  // scene's fader, measured (K-weighted, as LUFS) so all six average about
  // -34 LUFS; night sits a touch lower on purpose. Re-measure if you change a
  // layer's gain, rather than judging by ear on one pair of speakers.
  const AMBIENCES = {
    cafe: {
      level: 0.7,
      bed(scene) {
        scene.chord = 0;
        noiseBed(scene, { color: 'pink', type: 'lowpass', freq: 700, q: 0.4, gain: 0.018, swell: [[0.05, 0.3]] });
      },
      events: () => [
        { every: [8, 8], first: 0.1, play: cafeChord },
        { every: [1.4, 3.6], first: 2, play: musicBox },
        { every: [1.5, 5], first: 1, play: candleCrackle },
      ],
    },
    forest: {
      level: 1.4,
      bed(scene) {
        noiseBed(scene, { color: 'pink', freq: 520, q: 0.8, gain: 0.05, swell: [[0.07, 0.5], [0.17, 0.25]], sweep: [0.05, 180] });
        noiseBed(scene, { color: 'white', type: 'highpass', freq: 3200, q: 0.5, gain: 0.0025, swell: [[0.11, 0.8]] });
        noiseBed(scene, { color: 'brown', type: 'lowpass', freq: 260, q: 0.5, gain: 0.02 });
      },
      events: () => [
        { every: [2.2, 6.5], first: 1, play: (scene, at) => songbird(scene, at, 2400, 3900) },
        { every: [6, 14], first: 4, play: whistleBird },
        { every: [16, 32], first: 10, play: woodPigeon },
        { every: [28, 55], first: 20, play: woodpecker },
      ],
    },
    meadow: {
      level: 2.35,
      bed(scene) {
        noiseBed(scene, { color: 'pink', freq: 800, q: 0.8, gain: 0.025, swell: [[0.09, 0.5], [0.23, 0.2]], sweep: [0.06, 240] });
        noiseBed(scene, { color: 'white', type: 'highpass', freq: 5500, q: 0.5, gain: 0.002, swell: [[0.13, 0.6]] });
      },
      events: () => [
        { every: [1.8, 5], first: 0.8, play: (scene, at) => songbird(scene, at, 3000, 4800) },
        { every: [4, 9], first: 3, play: lark },
        { every: [14, 26], first: 6, play: bee },
        { every: [9, 18], first: 5, play: grasshopper },
      ],
    },
    shore: {
      level: 1.08,
      bed(scene) {
        noiseBed(scene, { color: 'brown', type: 'lowpass', freq: 380, q: 0.4, gain: 0.035, swell: [[0.06, 0.35]] });
      },
      events: () => [
        { every: [5.5, 9], first: 0.3, play: wave },
        { every: [6, 14], first: 4, play: lap },
      ],
    },
    dunes: {
      level: 1.1,
      bed(scene) {
        noiseBed(scene, { color: 'pink', freq: 420, q: 0.7, gain: 0.045, swell: [[0.05, 0.6], [0.13, 0.3]], sweep: [0.03, 180] });
        // The wind singing over a ridge: one narrow band of noise, wandering.
        noiseBed(scene, { color: 'white', freq: 1150, q: 14, gain: 0.12, swell: [[0.07, 0.9]], sweep: [0.04, 320] });
        // A low, warm drone under it all: the heat of the hour.
        [110, 164.81, 220.5].forEach((freq) => {
          const osc = scene.ctx.createOscillator();
          osc.frequency.value = freq;
          const level = scene.ctx.createGain();
          level.gain.value = 0.0045;
          osc.connect(level);
          route(scene.ctx, level, scene.dest, 0, 0.3);
          lfo(scene, level.gain, 0.08, 0.002);
          osc.start();
          scene.sources.push(osc);
        });
      },
      events: () => [
        { every: [7, 15], first: 3, play: windChimes },
        { every: [9, 16], first: 6, play: sandGust },
      ],
    },
    night: {
      level: 2.2,
      bed(scene) {
        noiseBed(scene, { color: 'brown', type: 'lowpass', freq: 450, q: 0.4, gain: 0.025, swell: [[0.05, 0.5]] });
        noiseBed(scene, { color: 'pink', freq: 900, q: 0.5, gain: 0.008, swell: [[0.07, 0.8]] });
      },
      events: (scene) => crickets(scene).concat([{ every: [22, 40], first: 8, play: owl }]),
    },
  };

  // ---------- Board theme ----------
  // The scene is picked on the setup screen: one of BOARD_THEMES, or Random.
  // Like the language it's a device preference, so it sticks between games.
  // Random draws a new scene for every game, never the one just played, so
  // Play again always changes the view.
  //
  // pendingBoardTheme is the scene the next game will use. It's decided ahead
  // of time so the setup screen already shows it behind the card.
  const SCENE_RANDOM = 'random';
  let scenePref = SCENE_RANDOM;
  let pendingBoardTheme = null;

  function loadScenePref() {
    try {
      const saved = localStorage.getItem(SCENE_KEY);
      if (saved === SCENE_RANDOM || BOARD_THEMES[saved]) scenePref = saved;
    } catch (e) {
      /* storage unavailable */
    }
  }

  function randomBoardTheme(avoid) {
    const keys = Object.keys(BOARD_THEMES).filter((key) => key !== avoid);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  function takeBoardTheme() {
    if (BOARD_THEMES[scenePref]) {
      pendingBoardTheme = scenePref;
      return scenePref;
    }
    const chosen = pendingBoardTheme || randomBoardTheme();
    pendingBoardTheme = randomBoardTheme(chosen);
    return chosen;
  }

  // Previews the pick behind the card straight away. Tapping Random again
  // deals another scene, so the button visibly does something every time.
  function setScenePref(pref) {
    if (pref !== SCENE_RANDOM && !BOARD_THEMES[pref]) return;
    scenePref = pref;
    try {
      localStorage.setItem(SCENE_KEY, pref);
    } catch (e) {
      /* storage unavailable */
    }
    pendingBoardTheme = pref === SCENE_RANDOM ? randomBoardTheme(pendingBoardTheme) : pref;
    // Picking a scene is a tap and a clear interest in it: its soundscape may
    // come in to preview it too.
    ambienceWanted = true;
    ensureAudio();
    applyBoardTheme(pendingBoardTheme);
    syncScenePicker();
    soundPick();
    updateAmbience();
  }

  const sceneLabel = (key) => (key === SCENE_RANDOM ? t('sceneRandom') : loc(BOARD_THEMES[key], 'label'));

  function renderScenePicker() {
    const container = $('scene-choice');
    container.innerHTML = '';
    // The Random swatch is a wheel of every scene's own colours.
    const wheel = Object.values(BOARD_THEMES).map((theme) => theme.accent);
    [SCENE_RANDOM].concat(Object.keys(BOARD_THEMES)).forEach((key) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scene-swatch';
      btn.dataset.scene = key;
      btn.setAttribute('role', 'radio');
      if (key === SCENE_RANDOM) {
        btn.style.setProperty('--swatch', `conic-gradient(from 200deg, ${wheel.concat(wheel[0]).join(', ')})`);
        btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-shuffle" /></svg>';
      } else {
        btn.style.setProperty('--swatch', BOARD_THEMES[key].swatch);
        btn.style.setProperty('--swatch-accent', BOARD_THEMES[key].accent);
      }
      container.appendChild(btn);
    });
    syncScenePicker();
  }

  // Labels and the checked state, without rebuilding the buttons — a rebuild
  // would drop keyboard focus from the swatch that was just pressed.
  function syncScenePicker() {
    $('scene-choice').querySelectorAll('.scene-swatch').forEach((btn) => {
      const label = sceneLabel(btn.dataset.scene);
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-checked', String(btn.dataset.scene === scenePref));
    });
    $('scene-name').textContent = sceneLabel(scenePref);
  }

  function initScenePicker() {
    renderScenePicker();
    $('scene-choice').addEventListener('click', (e) => {
      const btn = e.target.closest('.scene-swatch');
      if (!btn) return;
      setScenePref(btn.dataset.scene);
      pulse(btn, 'picked');
    });
  }

  function boardTheme(key) {
    return BOARD_THEMES[key || (state && state.boardTheme)] || BOARD_THEMES.romance;
  }

  function applyBoardTheme(key) {
    const theme = boardTheme(key);
    const root = document.documentElement.style;

    // Stacked flat shadows fake the board's physical thickness, then two soft
    // ones drop it onto the background.
    const depth = theme.edge
      .map((color, i) => `0 ${[2, 5, 9, 14, 19][i]}px 0 ${color}`)
      .join(', ');
    root.setProperty(
      '--board-edge',
      `${depth}, 0 26px 30px ${theme.dropShadow}, 0 50px 70px ${theme.dropShadow}`
    );

    root.setProperty('--page-bg', theme.page);
    root.setProperty('--page-base', theme.pageBase);
    root.setProperty('--board-bg', theme.boardBg);
    root.setProperty('--board-frame', theme.frame);
    root.setProperty('--cell-bg', theme.cell);
    root.setProperty('--cell-alt-bg', theme.cellAlt);
    applyTextures(theme);
    root.setProperty('--cell-border', theme.cellBorder);
    root.setProperty('--cell-ink', theme.cellInk);
    root.setProperty('--rose', theme.accent);
    root.setProperty('--rose-deep', theme.accentDeep);
    // The die is cut from the board: the same tile, frame and texture, with
    // pips in the scene's deep accent (its light ladder tone on the dark scene,
    // where the accent would sink into the face).
    root.setProperty('--die-face', theme.cell);
    root.setProperty('--die-edge', theme.frame);
    root.setProperty('--die-pip', theme.glass === 'dark' ? theme.ladder.light : theme.accentDeep);
    document.documentElement.dataset.glass = theme.glass || 'light';
    root.setProperty('--sunlight', theme.sunlight || 'rgba(255, 245, 225, 0.8)');
    applyBackdrop(theme);
    const sceneKey = BOARD_THEMES[key] ? key : state && BOARD_THEMES[state.boardTheme] ? state.boardTheme : 'romance';
    if (sceneKey !== shownScene) {
      shownScene = sceneKey;
      buildSceneLife(theme);
      buildSceneEvents(theme);
      updateAmbience();
    }

    // Installed as a PWA, this tints the OS status bar / title bar to match
    // whichever scene is live, same as everything else in the app already does.
    const meta = $('theme-color-meta');
    if (meta) meta.setAttribute('content', theme.accent);
  }

  // ---------- Living scene ----------
  // A full-bleed photographic backdrop, when the scene has one. It's loaded
  // off-screen first and only swapped in once it has decoded, so a missing or
  // slow file just leaves the tiled photo texture in place — nothing flashes.
  let backdropToken = 0;

  function applyBackdrop(theme) {
    const layer = $('scene-backdrop');
    const html = document.documentElement;
    const token = ++backdropToken;
    const art = theme.backdrop;
    if (!layer || !art) {
      delete html.dataset.backdrop;
      return;
    }
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const src = (portrait && art.portrait) || art.landscape || art.portrait;
    const probe = new Image();
    probe.onload = () => {
      if (token !== backdropToken) return;
      layer.style.setProperty('--scene-backdrop', `url("${src}")`);
      html.dataset.backdrop = 'on';
    };
    probe.onerror = () => {
      if (token === backdropToken) delete html.dataset.backdrop;
    };
    probe.src = src;
  }

  // The scene's ambient life: petals, leaves, bubbles, butterflies, dust or
  // fireflies drifting over the backdrop. Each is a tiny inline SVG moved by
  // the Web Animations API on its own random clock, so nothing lines up or
  // visibly loops. Few enough (6–22) to stay cheap on a phone, and none at
  // all under reduced motion.
  const LIFE_SHAPES = {
    petal: (color) => [
      svgEl('path', { d: 'M12 2C17 6 18 14 12 22 6 14 7 6 12 2z', fill: color }),
      svgEl('path', { d: 'M12 5v14', stroke: '#ffffff', 'stroke-opacity': 0.45, 'stroke-width': 0.8, fill: 'none' }),
    ],
    leaf: (color) => [
      svgEl('path', { d: 'M3 21C3 10 10 3 21 3 21 14 14 21 3 21z', fill: color }),
      svgEl('path', { d: 'M4 20 18 6', stroke: '#000000', 'stroke-opacity': 0.25, 'stroke-width': 0.9, fill: 'none' }),
    ],
    bubble: () => [
      svgEl('circle', { cx: 12, cy: 12, r: 9, fill: '#ffffff', 'fill-opacity': 0.12, stroke: '#ffffff', 'stroke-opacity': 0.75, 'stroke-width': 1.2 }),
      svgEl('ellipse', { cx: 8.5, cy: 8, rx: 2.6, ry: 1.6, fill: '#ffffff', 'fill-opacity': 0.8, transform: 'rotate(-35 8.5 8)' }),
    ],
    // Glow is drawn as stacked translucent discs rather than a CSS blur:
    // twenty filtered, moving layers is real work for a phone's compositor.
    mote: (color) => [
      svgEl('circle', { cx: 12, cy: 12, r: 11, fill: color, 'fill-opacity': 0.14 }),
      svgEl('circle', { cx: 12, cy: 12, r: 6, fill: color, 'fill-opacity': 0.35 }),
      svgEl('circle', { cx: 12, cy: 12, r: 3, fill: '#fff8ea' }),
    ],
    firefly: (color) => [
      svgEl('circle', { cx: 12, cy: 12, r: 12, fill: color, 'fill-opacity': 0.12 }),
      svgEl('circle', { cx: 12, cy: 12, r: 6.5, fill: color, 'fill-opacity': 0.4 }),
      svgEl('circle', { cx: 12, cy: 12, r: 2.8, fill: '#fffde8' }),
    ],
    butterfly: (color) => {
      const wing = (side) => {
        const g = svgEl('g', { class: `wing wing-${side}` });
        const flip = side === 'l' ? '' : 'translate(24 0) scale(-1 1)';
        g.appendChild(svgEl('path', { d: 'M12 11C8 3 1 3 2 9s6 5 10 3z', fill: color, transform: flip }));
        g.appendChild(svgEl('path', { d: 'M12 13C7 13 3 17 6 20s6-2 6-6z', fill: color, 'fill-opacity': 0.85, transform: flip }));
        return g;
      };
      return [wing('l'), wing('r'), svgEl('ellipse', { cx: 12, cy: 12.5, rx: 0.9, ry: 4, fill: '#3a2a1a' })];
    },
  };

  function buildSceneLife(theme) {
    const host = $('scene-life');
    if (!host) return;
    host.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    host.innerHTML = '';
    host.dataset.kind = '';
    const life = theme.life;
    if (!life || REDUCED_MOTION || !LIFE_SHAPES[life.kind]) return;
    host.dataset.kind = life.kind;

    const small = window.innerWidth < 640;
    const count = Math.round(life.count * (small ? 0.6 : 1));
    const rand = (min, max) => min + Math.random() * (max - min);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (let i = 0; i < count; i++) {
      const color = life.colors[i % life.colors.length];
      const size = life.kind === 'butterfly' ? rand(16, 26) : life.kind === 'bubble' ? rand(8, 22)
        : life.kind === 'mote' || life.kind === 'firefly' ? rand(12, 22) : rand(10, 18);
      const holder = document.createElement('div');
      holder.className = 'life-bit';
      const svg = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' });
      LIFE_SHAPES[life.kind](color).forEach((node) => svg.appendChild(node));
      holder.appendChild(svg);
      host.appendChild(holder);

      const x0 = rand(-0.05, 1.05) * vw;
      const duration = rand(14000, 30000);
      const delay = -rand(0, duration);
      const sway = rand(30, 90) * (Math.random() < 0.5 ? -1 : 1);
      let frames;
      switch (life.kind) {
        case 'petal':
        case 'leaf': {
          // Falls from above the top edge, rocking side to side as it tumbles.
          const spin = rand(180, 540) * (Math.random() < 0.5 ? -1 : 1);
          frames = [0, 0.25, 0.5, 0.75, 1].map((f, k) => ({
            transform: `translate(${x0 + sway * Math.sin(f * Math.PI * 3) + f * sway}px, ${-40 + f * (vh + 80)}px) rotate(${spin * f}deg) rotateY(${k % 2 ? 60 : 0}deg)`,
            opacity: k === 0 || k === 4 ? 0 : 0.85,
          }));
          break;
        }
        case 'bubble':
          frames = [0, 0.33, 0.66, 1].map((f, k) => ({
            transform: `translate(${x0 + Math.sin(f * Math.PI * 4) * 14}px, ${vh + 30 - f * (vh + 60)}px) scale(${0.8 + f * 0.4})`,
            opacity: k === 0 ? 0 : k === 3 ? 0 : 0.8,
          }));
          break;
        case 'butterfly': {
          // Wanders across in lazy loops rather than a straight line.
          const y0 = rand(0.1, 0.85) * vh;
          const dir = Math.random() < 0.5 ? 1 : -1;
          frames = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f, k) => ({
            transform: `translate(${(dir > 0 ? -40 : vw + 40) + dir * f * (vw + 80)}px, ${y0 + Math.sin(f * Math.PI * 4) * rand(30, 70)}px) rotate(${dir * (10 + Math.sin(f * 9) * 12)}deg)`,
            opacity: k === 0 || k === 5 ? 0 : 0.95,
          }));
          holder.style.setProperty('--flap', `${rand(0.18, 0.3).toFixed(2)}s`);
          break;
        }
        default: {
          // Motes and fireflies drift and hang in the air, glowing on and off.
          const y0 = rand(0.05, 0.95) * vh;
          frames = [0, 0.25, 0.5, 0.75, 1].map((f, k) => ({
            transform: `translate(${x0 + Math.sin(f * Math.PI * 2 + i) * rand(20, 60)}px, ${y0 - f * rand(40, 140)}px)`,
            opacity: [0, 0.9, 0.35, 1, 0][k],
          }));
        }
      }
      holder.animate(frames, { duration, delay, iterations: Infinity, easing: 'linear' });
    }
  }

  // ---------- Scene events ----------
  // Set pieces over the living layer, keyed by each scene's `events` in
  // data.js: stars and meteors at night, shafts of sun through the canopy,
  // caustics on the shallows, cloud shadows over the meadow, sand blowing off
  // the dunes, candlelight bokeh at the café. Standing pieces are a handful of
  // elements on their own clocks; passing ones are made, flown once and
  // removed. Transforms and opacity only, and nothing under reduced motion.
  let eventLoops = [];

  function buildSceneEvents(theme) {
    const host = $('scene-events');
    if (!host) return;
    eventLoops.forEach(clearTimeout);
    eventLoops = [];
    host.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    host.replaceChildren();
    host.dataset.kind = '';
    const kind = theme.events;
    if (!kind || REDUCED_MOTION || !SCENE_EVENTS[kind]) return;
    host.dataset.kind = kind;
    SCENE_EVENTS[kind](host, window.innerWidth, window.innerHeight);
  }

  // Calls fn at random intervals for as long as the scene lasts, skipping
  // while the page is hidden (a burst of catch-up on return would be odd).
  function every(min, max, fn, first) {
    const slot = eventLoops.length;
    const next = (delay) => {
      eventLoops[slot] = setTimeout(() => {
        if (!document.hidden) fn();
        next(min + Math.random() * (max - min));
      }, delay);
    };
    next(first === undefined ? min + Math.random() * (max - min) : first);
  }

  // One element, animated once and removed.
  function flyOnce(host, className, frames, options, setup) {
    const el = document.createElement('div');
    el.className = className;
    if (setup) setup(el);
    host.appendChild(el);
    const remove = () => el.remove();
    el.animate(frames, { fill: 'forwards', ...options }).finished.then(remove, remove);
    return el;
  }

  // A standing element that loops forever on its own random clock.
  function standing(host, className, frames, duration, setup) {
    const el = document.createElement('div');
    el.className = className;
    if (setup) setup(el);
    host.appendChild(el);
    el.animate(frames, { duration, delay: -Math.random() * duration, iterations: Infinity, easing: 'ease-in-out' });
    return el;
  }

  const rand = (min, max) => min + Math.random() * (max - min);

  // A shadow crossing the scene along a straight line, facing the way it goes.
  function crossing(host, className, vw, vh, duration, setup) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = vh * rand(0.1, 0.8);
    const y1 = y0 + vh * rand(-0.25, 0.25);
    const x0 = dir > 0 ? -120 : vw + 120;
    const x1 = dir > 0 ? vw + 120 : -120;
    const heading = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    flyOnce(
      host,
      className,
      [
        { transform: `translate(${x0}px, ${y0}px) rotate(${heading}deg)` },
        { transform: `translate(${(x0 + x1) / 2}px, ${(y0 + y1) / 2 + vh * rand(-0.05, 0.05)}px) rotate(${heading}deg)`, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px) rotate(${heading}deg)` },
      ],
      { duration, easing: 'linear' },
      setup
    );
  }

  // Drawn pointing along +x, so `crossing` can turn them to face their way.
  const BIRD_SHADOW =
    '<svg viewBox="0 0 40 40" aria-hidden="true"><g class="ev-wings"><path d="M22 20 C18 12 12 5 4 2 C10 9 13 15 15 20 C13 25 10 31 4 38 C12 35 18 28 22 20 Z"/></g>' +
    '<path d="M12 20 C16 17 26 17 34 19.4 L38 20 L34 20.6 C26 23 16 23 12 20 Z"/><path d="M13 20 L6 17 L8 20 L6 23 Z"/></svg>';
  const FISH_SHADOW =
    '<svg viewBox="0 0 60 24" aria-hidden="true"><g class="ev-tail"><path d="M14 12 L2 4 L5 12 L2 20 Z"/></g>' +
    '<path d="M12 12 C18 4 40 3 56 11 C57 11.6 57 12.4 56 13 C40 21 18 20 12 12 Z"/></svg>';

  const SCENE_EVENTS = {
    // Night: stars twinkling on their own clocks, and every so often one falls.
    stars(host, vw, vh) {
      const count = vw < 640 ? 10 : 16;
      for (let i = 0; i < count; i++) {
        standing(
          host,
          'ev-star',
          [
            { opacity: 0.15, transform: 'scale(0.55)' },
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0.15, transform: 'scale(0.55)' },
          ],
          rand(2200, 5200),
          (el) => {
            el.style.left = `${rand(0, 100)}%`;
            el.style.top = `${rand(0, 55)}%`;
            el.style.setProperty('--size', `${rand(4, 10).toFixed(1)}px`);
          }
        );
      }
      every(
        4500,
        11000,
        () => {
          const right = Math.random() < 0.5;
          const x0 = vw * (right ? rand(0.05, 0.5) : rand(0.5, 0.95));
          const y0 = vh * rand(0, 0.3);
          const dist = vw * rand(0.22, 0.42);
          const fall = (rand(22, 42) * Math.PI) / 180;
          const dx = Math.cos(fall) * dist * (right ? 1 : -1);
          const dy = Math.sin(fall) * dist;
          const turn = (Math.atan2(dy, dx) * 180) / Math.PI;
          flyOnce(
            host,
            'ev-meteor',
            [
              { transform: `translate(${x0}px, ${y0}px) rotate(${turn}deg) scaleX(0.2)`, opacity: 0 },
              { transform: `translate(${x0 + dx * 0.3}px, ${y0 + dy * 0.3}px) rotate(${turn}deg) scaleX(1)`, opacity: 1, offset: 0.3 },
              { transform: `translate(${x0 + dx}px, ${y0 + dy}px) rotate(${turn}deg) scaleX(0.5)`, opacity: 0 },
            ],
            { duration: rand(900, 1500), easing: 'cubic-bezier(0.3, 0.1, 0.6, 1)' }
          );
        },
        2500
      );
    },

    // Forest: shafts of sun through the canopy, slowly swaying, and now and
    // then the shadow of a bird crossing the floor.
    rays(host, vw, vh) {
      const count = vw < 640 ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const tilt = rand(24, 32);
        standing(
          host,
          'ev-ray',
          [
            { opacity: 0.2, transform: `rotate(${tilt}deg) scaleX(0.85)` },
            { opacity: 0.7, transform: `rotate(${tilt + 3}deg) scaleX(1.1)` },
            { opacity: 0.2, transform: `rotate(${tilt}deg) scaleX(0.85)` },
          ],
          rand(9000, 16000),
          (el) => {
            el.style.left = `${-8 + i * (72 / count) + rand(0, 8)}%`;
            el.style.setProperty('--ray-w', `${rand(7, 16).toFixed(1)}vmax`);
          }
        );
      }
      every(15000, 28000, () => crossing(host, 'ev-bird', vw, vh, rand(4500, 7000), (el) => (el.innerHTML = BIRD_SHADOW)), 6000);
    },

    // Ocean: caustic light rippling over the shallows — two tiled layers
    // sliding against each other — and now and then a fish's shadow.
    caustics(host, vw, vh) {
      standing(host, 'ev-caustics', [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(400px, 400px, 0)' }], 46000);
      standing(host, 'ev-caustics ev-caustics-b', [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(-560px, 560px, 0)' }], 61000);
      every(10000, 20000, () => crossing(host, 'ev-fish', vw, vh, rand(7000, 11000), (el) => (el.innerHTML = FISH_SHADOW)), 3500);
    },

    // Meadow: big soft cloud shadows drifting over, and dandelion seeds
    // floating by.
    clouds(host, vw, vh) {
      const cloud = (startAt) =>
        flyOnce(
          host,
          'ev-cloud',
          [
            { transform: `translate(${-vw * 0.9}px, ${vh * rand(-0.2, 0.5)}px) scale(${rand(0.8, 1.2).toFixed(2)})` },
            { transform: `translate(${vw * 1.05}px, ${vh * rand(-0.2, 0.5)}px) scale(${rand(0.8, 1.2).toFixed(2)})` },
          ],
          { duration: rand(26000, 38000), delay: startAt || 0, easing: 'linear' }
        );
      cloud(-rand(6000, 14000));
      every(13000, 24000, () => cloud());
      const seeds = vw < 640 ? 4 : 7;
      for (let i = 0; i < seeds; i++) {
        const y = vh * rand(0.1, 0.9);
        const x = vw * rand(0, 1);
        standing(
          host,
          'ev-seed',
          [
            { transform: `translate(${x - 60}px, ${y + 40}px) rotate(0deg)`, opacity: 0 },
            { transform: `translate(${x}px, ${y}px) rotate(120deg)`, opacity: 0.9, offset: 0.3 },
            { transform: `translate(${x + 90}px, ${y - 50}px) rotate(260deg)`, opacity: 0.9, offset: 0.7 },
            { transform: `translate(${x + 150}px, ${y - 80}px) rotate(360deg)`, opacity: 0 },
          ],
          rand(14000, 24000)
        );
      }
    },

    // Sunset: a warm flare breathing at the top of the sky, and gusts lifting
    // streaks of sand off the dunes.
    sand(host, vw, vh) {
      standing(
        host,
        'ev-flare',
        [
          { opacity: 0.45, transform: 'scale(0.92)' },
          { opacity: 0.9, transform: 'scale(1.06)' },
          { opacity: 0.45, transform: 'scale(0.92)' },
        ],
        9000
      );
      every(
        6000,
        12000,
        () => {
          const streaks = vw < 640 ? 9 : 16;
          const lane = vh * rand(0.35, 0.75);
          for (let i = 0; i < streaks; i++) {
            const y = lane + vh * rand(-0.18, 0.18);
            const lift = vh * rand(0.02, 0.08);
            flyOnce(
              host,
              'ev-streak',
              [
                { transform: `translate(${-rand(40, 160)}px, ${y}px) scaleX(0.4)`, opacity: 0 },
                { transform: `translate(${vw * 0.45}px, ${y - lift * 0.5}px) scaleX(1)`, opacity: 0.9, offset: 0.4 },
                { transform: `translate(${vw + 60}px, ${y - lift}px) scaleX(0.6)`, opacity: 0 },
              ],
              { duration: rand(1300, 2300), delay: rand(0, 700), easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
              (el) => el.style.setProperty('--len', `${rand(30, 90).toFixed(0)}px`)
            );
          }
        },
        2000
      );
    },

    // Romance: soft, out-of-focus candle bokeh drifting, and small sparkles
    // winking in the light.
    bokeh(host, vw, vh) {
      const discs = vw < 640 ? 6 : 10;
      for (let i = 0; i < discs; i++) {
        const x = vw * rand(0, 1);
        const y = vh * rand(0, 1);
        const dx = rand(-50, 50);
        const dy = rand(-40, 40);
        standing(
          host,
          'ev-bokeh',
          [
            { transform: `translate(${x}px, ${y}px) scale(0.9)`, opacity: 0.35 },
            { transform: `translate(${x + dx}px, ${y + dy}px) scale(1.1)`, opacity: 0.9 },
            { transform: `translate(${x}px, ${y}px) scale(0.9)`, opacity: 0.35 },
          ],
          rand(12000, 26000),
          (el) => el.style.setProperty('--size', `${rand(36, 120).toFixed(0)}px`)
        );
      }
      for (let i = 0; i < (vw < 640 ? 4 : 7); i++) {
        standing(
          host,
          'ev-star ev-glint',
          [
            { opacity: 0, transform: 'scale(0.3) rotate(0deg)' },
            { opacity: 0, transform: 'scale(0.3) rotate(0deg)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1) rotate(45deg)', offset: 0.8 },
            { opacity: 0, transform: 'scale(0.3) rotate(90deg)' },
          ],
          rand(3500, 7000),
          (el) => {
            el.style.left = `${rand(2, 98)}%`;
            el.style.top = `${rand(2, 98)}%`;
            el.style.setProperty('--size', `${rand(8, 14).toFixed(1)}px`);
          }
        );
      }
    },
  };

  // Desktop only: the scene's layers shift a little against the pointer, the
  // nearer ones more, so the backdrop has depth. Set on the three layers
  // themselves (not :root), so only they restyle.
  function initParallax() {
    if (REDUCED_MOTION || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const layers = [
      [$('scene-backdrop'), 10],
      [$('scene-events'), 22],
      [$('scene-life'), 36],
    ];
    let frame = 0;
    let px = 0;
    let py = 0;
    window.addEventListener(
      'pointermove',
      (e) => {
        px = e.clientX / window.innerWidth - 0.5;
        py = e.clientY / window.innerHeight - 0.5;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          layers.forEach(([el, depth]) => {
            if (el) el.style.setProperty('translate', `${(-px * depth).toFixed(1)}px ${(-py * depth * 0.7).toFixed(1)}px`);
          });
        });
      },
      { passive: true }
    );
  }

  // Everything drawn from the window's size — the photo's orientation, where
  // the wildlife and set pieces fly — is redone after a real resize, such as
  // a phone turning on its side.
  function initResize() {
    let timer = 0;
    let last = [window.innerWidth, window.innerHeight];
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const [w, h] = [window.innerWidth, window.innerHeight];
        const turned = (w > h) !== (last[0] > last[1]);
        if (!turned && Math.abs(w - last[0]) / last[0] < 0.15 && Math.abs(h - last[1]) / last[1] < 0.15) return;
        last = [w, h];
        const theme = BOARD_THEMES[shownScene];
        if (!theme) return;
        if (turned) applyBackdrop(theme);
        buildSceneLife(theme);
        buildSceneEvents(theme);
      }, 300);
    });
  }

  // Inline SVG textures on their own layers, each drifting or twinkling.
  function applyTextures(theme) {
    const url = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const seconds = (value) => parseFloat(value) * 1000;
    // Drifting by exactly one tile keeps the repeat seamless, so the shift
    // distance has to come from that layer's own tile size.
    const oneTile = (size) => {
      const [w, h] = size.split(/\s+/);
      return theme.driftAxis === 'x' ? `${w} 0px` : `${w} ${h}`;
    };

    const run = (el, drift, duration) => {
      el.getAnimations().forEach((animation) => animation.cancel());

      // The layer must overhang its container by at least as far as it's
      // about to travel, or its trailing edge slides into view mid-cycle and
      // exposes bare background. Size the overhang from the real drift
      // distance instead of a fixed guess, since photo tiles (400px+) drift
      // much further than the small SVG detail tiles (16-60px) ever did.
      const [dx, dy] = drift.split(/\s+/);
      const overhang = Math.ceil(Math.max(Math.abs(parseFloat(dx)), Math.abs(parseFloat(dy)))) + 40;
      el.style.inset = `-${overhang}px`;

      if (REDUCED_MOTION) return;

      el.animate(
        [
          { transform: 'translate3d(0px, 0px, 0)' },
          { transform: `translate3d(${dx}, ${dy}, 0)` },
        ],
        { duration: seconds(duration), iterations: Infinity, easing: 'linear' }
      );

      if (theme.motion === 'twinkle') {
        el.animate([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], {
          duration: seconds(theme.twinkleDuration || '6s'),
          iterations: Infinity,
          easing: 'ease-in-out',
        });
      }
    };

    const page = $('scene-texture');
    page.style.setProperty('--page-texture', url(theme.pageTexture));
    page.style.setProperty('--page-tex-size', theme.pageTextureSize);
    run(page, oneTile(theme.pageTextureSize), theme.driftDuration);

    const photo = $('scene-photo');
    photo.style.setProperty('--page-photo', `url("${theme.photo}")`);
    photo.style.setProperty('--page-photo-size', theme.photoPageSize);
    photo.style.setProperty('--page-photo-opacity', theme.photoPageOpacity);
    // Drifts one photo tile, on its own slower clock than the drawn detail —
    // the slight parallax is what stops it looking like flat wallpaper.
    run(photo, oneTile(`${theme.photoPageSize} ${theme.photoPageSize}`), theme.driftDuration);

    document.documentElement.style.setProperty('--die-tex', url(theme.cellTexture));
    document.documentElement.style.setProperty('--die-tex-size', theme.cellTextureSize);

    // On touch screens the board's surface holds still, so it paints into
    // the board instead of being two more full-density layers (see the
    // touch-screen block at the end of style.css).
    const boardDrifts = !window.matchMedia('(pointer: coarse)').matches;
    const board = document.querySelector('.board-texture');
    if (board) {
      board.style.setProperty('--cell-texture', url(theme.cellTexture));
      board.style.setProperty('--cell-tex-size', theme.cellTextureSize);
      if (boardDrifts) run(board, oneTile(theme.cellTextureSize), theme.boardDriftDuration);
    }

    const boardPhoto = document.querySelector('.board-photo');
    if (boardPhoto) {
      boardPhoto.style.setProperty('--board-photo', `url("${theme.photo}")`);
      boardPhoto.style.setProperty('--board-photo-size', theme.photoBoardSize);
      boardPhoto.style.setProperty('--board-photo-opacity', theme.photoBoardOpacity);
      if (boardDrifts) {
        run(
          boardPhoto,
          oneTile(`${theme.photoBoardSize} ${theme.photoBoardSize}`),
          theme.boardDriftDuration
        );
      }
    }

    console.info(
      `[snakes-ladders ${BUILD}] scene "${theme.label}" · motion ${theme.motion} · ` +
        `${REDUCED_MOTION ? 'DISABLED (system reduced-motion is on)' : `${page.getAnimations().length} animation(s) on backdrop`}`
    );
  }

  // ---------- Multi-player helpers ----------
  const playerCount = () => state.players.length;

  function otherIndexes() {
    return state.players.map((_, i) => i).filter((i) => i !== state.current);
  }

  function randomOtherIndex() {
    const others = otherIndexes();
    return others[Math.floor(Math.random() * others.length)];
  }

  // Fresh snakes and ladders every game. Content is not placed here — every
  // cell that isn't a ladder foot or snake head gets content when landed on.
  function generateBoard() {
    const ladders = {};
    const snakes = {};
    const taken = new Set([1, 100]);
    const perRow = {};
    const { minSpan, maxSpan, maxEndpointsPerRow } = BOARD_SETUP;

    function place(isLadder) {
      for (let attempt = 0; attempt < 300; attempt++) {
        const span = minSpan + Math.floor(Math.random() * (maxSpan - minSpan + 1));
        const start = isLadder
          ? 2 + Math.floor(Math.random() * (98 - span))
          : 2 + span + Math.floor(Math.random() * (98 - span));
        const end = isLadder ? start + span : start - span;

        if (end < 2 || end > 99) continue;
        if (taken.has(start) || taken.has(end)) continue;
        if (rowOf(start) === rowOf(end)) continue;
        if (Math.abs(colOf(start) - colOf(end)) > 4) continue;
        if ((perRow[rowOf(start)] || 0) >= maxEndpointsPerRow) continue;
        if ((perRow[rowOf(end)] || 0) >= maxEndpointsPerRow) continue;

        taken.add(start);
        taken.add(end);
        perRow[rowOf(start)] = (perRow[rowOf(start)] || 0) + 1;
        perRow[rowOf(end)] = (perRow[rowOf(end)] || 0) + 1;
        (isLadder ? ladders : snakes)[start] = end;
        return;
      }
    }

    for (let i = 0; i < BOARD_SETUP.ladders; i++) place(true);
    for (let i = 0; i < BOARD_SETUP.snakes; i++) place(false);
    return { ladders, snakes };
  }

  // ---------- Setup screen ----------
  // Draft roster the setup screen edits before the game starts.
  let roster = [];

  const takenColors = (exclude) =>
    roster.filter((player) => player !== exclude).map((player) => player.color);

  // Steps to the next colour nobody else is using, so two players can never
  // share one — the colour is all that tells their pawns apart.
  function nextFreeColor(current, taken) {
    const start = COLOR_CHOICES.indexOf(current);
    for (let step = 1; step <= COLOR_CHOICES.length; step++) {
      const candidate = COLOR_CHOICES[(start + step) % COLOR_CHOICES.length];
      if (!taken.includes(candidate)) return candidate;
    }
    return current;
  }

  function defaultPlayer() {
    const taken = takenColors();
    return { name: '', color: COLOR_CHOICES.find((color) => !taken.includes(color)) };
  }

  function initRoster() {
    roster = [];
    roster.push(defaultPlayer());
    roster.push(defaultPlayer());
    renderRoster();
  }

  // Replays on every trigger, not just the first — an animation class that is
  // already present does nothing until the browser is made to notice it.
  // Callers are responsible for taking the class off again.
  function replayAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  // Same, but clears up after itself. Without this the class stays on the
  // element for the rest of the game — harmless to look at, but it means any
  // later reflow can fire the animation again out of nowhere.
  function pulse(el, className) {
    replayAnimation(el, className);
    el.addEventListener('animationend', function done(e) {
      // animationend bubbles, so an animation on a child would otherwise strip
      // the class off the parent mid-flight.
      if (e.target !== el) return;
      el.classList.remove(className);
      el.removeEventListener('animationend', done);
    });
  }

  function renderRoster() {
    const list = $('player-list');
    list.innerHTML = '';

    roster.forEach((player, index) => {
      const row = document.createElement('div');
      row.className = 'player-row';

      // Tapping the swatch steps to the next free colour.
      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'chip-btn color-chip';
      colorBtn.style.setProperty('--player-color', player.color);
      colorBtn.title = t('changeColour', { n: index + 1 });
      colorBtn.setAttribute('aria-label', t('changeColour', { n: index + 1 }));
      colorBtn.addEventListener('click', () => {
        player.color = nextFreeColor(player.color, takenColors(player));
        colorBtn.style.setProperty('--player-color', player.color);
        pulse(colorBtn, 'cycled');
        soundPick();
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = t('playerN', { n: index + 1 });
      input.setAttribute('aria-label', t('playerName', { n: index + 1 }));
      input.value = player.name;
      input.addEventListener('input', () => {
        player.name = input.value;
      });

      row.appendChild(colorBtn);
      row.appendChild(input);

      if (roster.length > MIN_PLAYERS) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'chip-btn remove-chip';
        removeBtn.title = t('removePlayer');
        removeBtn.setAttribute('aria-label', t('removePlayerN', { n: index + 1 }));
        removeBtn.innerHTML = '<svg class="icon icon-sm"><use href="#i-close" /></svg>';
        removeBtn.addEventListener('click', () => {
          roster.splice(index, 1);
          renderRoster();
        });
        row.appendChild(removeBtn);
      }

      list.appendChild(row);
    });

    const maxAllowed = pendingMode === 'couples' ? 2 : MAX_PLAYERS;
    $('add-player-btn').classList.toggle('hidden', roster.length >= maxAllowed);
  }

  function addPlayer() {
    const maxAllowed = pendingMode === 'couples' ? 2 : MAX_PLAYERS;
    if (roster.length >= maxAllowed) return;
    roster.push(defaultPlayer(roster.length));
    renderRoster();
  }

  function renderModeChoice() {
    const container = $('mode-choice');
    container.innerHTML = '';

    Object.entries(MODES).forEach(([key, mode]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.mode = key;
      btn.textContent = loc(mode, 'label');
      btn.classList.toggle('selected', pendingMode === key);
      btn.setAttribute('aria-pressed', pendingMode === key);
      // The one-line description that used to sit under the switch now
      // rides along as the tooltip and accessible description.
      btn.title = loc(mode, 'hint');
      btn.addEventListener('click', () => setPendingMode(key));
      container.appendChild(btn);
    });
  }

  // Split from initThemeChips so a mode switch can redraw the chips (the
  // labels change) without stacking a second copy of the click handlers.
  function renderThemeChips() {
    const container = $('theme-chips');
    const existing = container.querySelectorAll('.theme-chip');
    // First draw starts with everything on; after that, carry the selection
    // across so switching mode doesn't silently reset your topics.
    const keep = new Set(
      Array.from(container.querySelectorAll('.theme-chip.selected')).map((chip) => chip.dataset.theme)
    );
    const firstDraw = existing.length === 0;
    container.innerHTML = '';

    Object.keys(QUESTION_THEMES).forEach((key) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'theme-chip';
      chip.classList.toggle('selected', firstDraw || keep.has(key));
      chip.dataset.theme = key;
      chip.style.setProperty('--chip-color', themeOf(key).color);
      chip.innerHTML = '<span class="chip-swatch" aria-hidden="true"></span><span class="chip-label"></span>';
      chip.querySelector('.chip-label').textContent = themeLabel(key);
      container.appendChild(chip);
    });

    syncThemeToggle();
  }

  function initThemeChips() {
    const container = $('theme-chips');
    renderThemeChips();

    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.theme-chip');
      if (!chip) return;
      const selected = container.querySelectorAll('.theme-chip.selected');
      if (chip.classList.contains('selected') && selected.length === 1) return;
      chip.classList.toggle('selected');
      syncThemeToggle();
    });

    // Narrowing 12 topics down to the two you want meant 10 taps. One button
    // clears the lot so you can pick up from nothing instead.
    $('theme-toggle-all').addEventListener('click', () => {
      const chips = Array.from(container.querySelectorAll('.theme-chip'));
      const selectAll = chips.some((chip) => !chip.classList.contains('selected'));
      chips.forEach((chip, i) => {
        // The first chip stays on when clearing: the game needs at least one
        // topic, and leaving zero selected would make Start do nothing.
        chip.classList.toggle('selected', selectAll || i === 0);
      });
      syncThemeToggle();
    });

    syncThemeToggle();
  }

  function syncThemeToggle() {
    const container = $('theme-chips');
    container.querySelectorAll('.theme-chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', chip.classList.contains('selected'));
    });
    const total = container.querySelectorAll('.theme-chip').length;
    const on = container.querySelectorAll('.theme-chip.selected').length;
    $('theme-toggle-all').textContent = on === total ? t('clearAll') : t('selectAll', { n: total - on });
  }

  function startGame() {
    const themes = Array.from($('theme-chips').querySelectorAll('.theme-chip.selected')).map(
      (chip) => chip.dataset.theme
    );
    const setups = roster.map((player, i) => ({
      name: player.name.trim() || t('playerN', { n: i + 1 }),
      color: player.color,
    }));

    state = freshState(setups, themes, pendingMode);
    logMessage(`🎉 ${setups.map((p) => p.name).join(' · ')}`);
    saveState();
    // Start is a real tap: the moment the table's soundscape can come in.
    ambienceWanted = true;
    ensureAudio();
    showGameScreen();
    updateAmbience();
  }

  function showSetupScreen() {
    if (!pendingBoardTheme) pendingBoardTheme = BOARD_THEMES[scenePref] ? scenePref : randomBoardTheme();
    applyBoardTheme(pendingBoardTheme);
    renderModeChoice();
    renderThemeChips();
    syncScenePicker();
    $('setup-screen').classList.remove('hidden');
    $('game-screen').classList.add('hidden');
    stopBoardMotion();
  }

  function showGameScreen() {
    $('setup-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    applyBoardTheme();
    buildBoard();
    renderAll();
  }

  // ---------- Board rendering ----------
  let dealTimer = null;

  function buildBoard() {
    const board = $('board');
    stopBoardMotion();
    board.innerHTML = '';
    cellEls = {};
    tokenEls = [];

    CELL_ORDER.forEach((num, index) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      // Staggers this cell's entrance — the board deals itself out from square
      // 1 upward instead of the whole grid appearing at once.
      cell.style.setProperty('--i', CELL_ORDER.length - index);
      if ((Math.floor(index / 10) + (index % 10)) % 2 === 1) cell.classList.add('alt');

      const numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = num;
      cell.appendChild(numSpan);

      board.appendChild(cell);
      cellEls[num] = cell;
    });

    decorateBoard(boardTheme());

    cellEls[100].classList.add('cell-finish');

    const clip = document.createElement('div');
    clip.className = 'board-texture-clip';
    const boardPhoto = document.createElement('div');
    boardPhoto.className = 'board-photo';
    const texture = document.createElement('div');
    texture.className = 'board-texture';
    const sheen = document.createElement('div');
    sheen.className = 'board-sheen';
    clip.appendChild(boardPhoto);
    clip.appendChild(texture);
    clip.appendChild(sheen);
    board.appendChild(clip);
    board.appendChild(buildConnections());
    applyTextures(boardTheme());
    startBoardMotion();

    // Dropped once the deal has played out, so later re-renders (a restored
    // game, a resize) don't replay the whole board arriving.
    replayAnimation(board, 'dealing');
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => board.classList.remove('dealing'), 1100);
  }

  // Purely cosmetic dressing on top of the plain numbered grid: a
  // start/finish flag on 1 and 100, and a sprinkle of the scene's own
  // motifs (a heart, a leaf, a star…) on a handful of otherwise-empty
  // cells. Placement is derived from this board's own ladder/snake layout
  // rather than Math.random(), so reloading the same saved game shows the
  // same decoration instead of it reshuffling on you — and it never lands
  // on a cell a game rule actually cares about.
  function decorateBoard(theme) {
    const taken = new Set([1, 100]);
    Object.entries(state.ladders).forEach(([from, to]) => {
      taken.add(Number(from));
      taken.add(Number(to));
    });
    Object.entries(state.snakes).forEach(([from, to]) => {
      taken.add(Number(from));
      taken.add(Number(to));
    });

    const flag = (num, icon) => {
      const cell = cellEls[num];
      if (!cell || !icon) return;
      const span = document.createElement('span');
      span.className = 'cell-flag';
      span.textContent = icon;
      cell.appendChild(span);
    };
    flag(1, theme.startIcon);
    flag(100, theme.finishIcon);

    const ornaments = theme.ornaments;
    if (!ornaments || !ornaments.length) return;

    // A hash of the square number decides which cells get one and how it sits,
    // so the scatter looks organic but a reloaded game shows the same board.
    // Roughly a third of the free squares get a motif.
    const hash = (num) => Math.imul(num * 2654435761, 1597334677) >>> 0;
    const corners = ['br', 'bl', 'tr'];
    let placed = 0;
    CELL_ORDER.forEach((num) => {
      if (taken.has(num) || placed >= ORNAMENT_MAX) return;
      const h = hash(num);
      if (h % 100 >= 34) return;
      const cell = cellEls[num];
      if (!cell) return;
      const span = document.createElement('span');
      span.className = `cell-ornament orn-${corners[(h >>> 8) % corners.length]}`;
      span.textContent = ornaments[(h >>> 12) % ornaments.length];
      span.style.setProperty('--orn-rot', `${((h >>> 16) % 50) - 25}deg`);
      span.style.setProperty('--orn-scale', (0.8 + ((h >>> 20) % 45) / 100).toFixed(2));
      // Each motif sways on its own clock, so the board breathes rather than
      // pulsing in step.
      span.style.setProperty('--orn-dur', `${5 + ((h >>> 4) % 5)}s`);
      span.style.setProperty('--orn-delay', `-${(h >>> 6) % 7}s`);
      cell.appendChild(span);
      placed++;
    });
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function cellCenter(num) {
    const index = CELL_INDEX[num];
    return { x: (index % 10) * 10 + 5, y: Math.floor(index / 10) * 10 + 5 };
  }

  function buildConnections() {
    const svg = svgEl('svg', { id: 'board-lines', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });

    // Shared by every snake: a soft edge for the shading, and a fish-scale
    // texture in the scene's own dark tone.
    const defs = svgEl('defs', {});
    const soft = svgEl('filter', { id: 'snake-soft', x: '-10%', y: '-10%', width: '120%', height: '120%' });
    soft.appendChild(svgEl('feGaussianBlur', { stdDeviation: 0.16 }));
    defs.appendChild(soft);
    const scales = svgEl('pattern', {
      id: 'snake-scales',
      width: 0.9,
      height: 0.9,
      patternUnits: 'userSpaceOnUse',
    });
    [[0.45, 0.45], [0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]].forEach(([cx, cy]) => {
      scales.appendChild(
        svgEl('circle', {
          cx,
          cy,
          r: 0.45,
          fill: 'none',
          stroke: boardTheme().snake.outline,
          'stroke-opacity': 0.28,
          'stroke-width': 0.06,
        })
      );
    });
    defs.appendChild(scales);
    svg.appendChild(defs);

    Object.entries(state.ladders).forEach(([from, to]) => drawLadder(svg, Number(from), Number(to)));
    Object.entries(state.snakes).forEach(([from, to]) => drawSnake(svg, Number(from), Number(to)));
    return svg;
  }

  function geometry(from, to) {
    const a = cellCenter(from);
    const b = cellCenter(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return { a, b, dx, dy, len, px: -dy / len, py: dx / len };
  }

  // Both are drawn as if lit from the top left, which is also where the board's
  // cast shadow falls away from.
  const LIGHT = { x: -0.55, y: -0.83 };

  const mixHex = (a, b, t) => {
    const channel = (i) => {
      const x = parseInt(a.slice(i, i + 2), 16);
      const y = parseInt(b.slice(i, i + 2), 16);
      return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    };
    return `#${channel(1)}${channel(3)}${channel(5)}`;
  };

  // Wooden ladder lying on the board: two rails and rungs with a lit edge, a
  // little grain and nailed joints, in the scene's own wood colours.
  function drawLadder(svg, from, to) {
    const { a, dx, dy, len, px, py } = geometry(from, to);
    const palette = boardTheme().ladder;
    const ux = dx / len;
    const uy = dy / len;
    const half = 1.75; // middle of the ladder to the middle of a rail
    const railW = 0.52;
    const rungH = 0.3;
    const dark = mixHex(palette.dark, '#000000', 0.32);
    const group = svgEl('g', {});

    // A board from p to q, `w` wide either side of its centreline.
    const board = (p, q, w, attrs) => {
      const pts = [
        [p.x + px * w, p.y + py * w],
        [q.x + px * w, q.y + py * w],
        [q.x - px * w, q.y - py * w],
        [p.x - px * w, p.y - py * w],
      ]
        .map((c) => c.join(' '))
        .join(' L ');
      return svgEl('path', { d: `M ${pts} Z`, ...attrs });
    };
    const along = (t, side, offset = 0) => ({
      x: a.x + dx * t + px * (half * side + offset),
      y: a.y + dy * t + py * (half * side + offset),
    });
    const lightSide = Math.sign(px * LIGHT.x + py * LIGHT.y) || 1;
    const lightAlong = Math.sign(ux * LIGHT.x + uy * LIGHT.y) || 1;

    const rungCount = Math.max(2, Math.round(len / 4.2));
    for (let i = 1; i < rungCount; i++) {
      const t = i / rungCount;
      const c = { x: a.x + dx * t, y: a.y + dy * t };
      const l = half + 0.05;
      const rung = (offset, w, attrs) =>
        group.appendChild(
          svgEl('path', {
            d:
              `M ${c.x + px * l + ux * offset + ux * w} ${c.y + py * l + uy * offset + uy * w} ` +
              `L ${c.x - px * l + ux * offset + ux * w} ${c.y - py * l + uy * offset + uy * w} ` +
              `L ${c.x - px * l + ux * offset - ux * w} ${c.y - py * l + uy * offset - uy * w} ` +
              `L ${c.x + px * l + ux * offset - ux * w} ${c.y + py * l + uy * offset - uy * w} Z`,
            ...attrs,
          })
        );
      rung(0, rungH, { fill: palette.light, stroke: dark, 'stroke-width': 0.1, 'stroke-linejoin': 'round' });
      rung(lightAlong * (rungH - 0.1), 0.08, { fill: '#ffffff', 'fill-opacity': 0.4 });
      rung(-lightAlong * (rungH - 0.09), 0.09, { fill: '#000000', 'fill-opacity': 0.14 });
    }

    [1, -1].forEach((side) => {
      const p = along(0, side);
      const q = along(1, side);
      group.appendChild(
        board(p, q, railW, { fill: palette.dark, stroke: dark, 'stroke-width': 0.1, 'stroke-linejoin': 'round' })
      );
      // Lit edge and shaded edge, then two grain lines and a knot.
      group.appendChild(
        board(along(0, side, lightSide * 0.3), along(1, side, lightSide * 0.3), 0.13, {
          fill: palette.light,
          'fill-opacity': 0.55,
        })
      );
      group.appendChild(
        board(along(0, side, -lightSide * 0.36), along(1, side, -lightSide * 0.36), 0.1, {
          fill: '#000000',
          'fill-opacity': 0.16,
        })
      );
      [-0.08, 0.14].forEach((off, k) => {
        const grain = svgEl('line', {
          x1: along(0.03 + k * 0.05, side, off).x,
          y1: along(0.03 + k * 0.05, side, off).y,
          x2: along(0.97 - k * 0.07, side, off).x,
          y2: along(0.97 - k * 0.07, side, off).y,
          stroke: '#000000',
          'stroke-opacity': 0.2,
          'stroke-width': 0.05,
          'stroke-linecap': 'round',
        });
        group.appendChild(grain);
      });
      const knot = along(0.31 + (from % 5) * 0.09, side, 0.05);
      group.appendChild(
        svgEl('ellipse', {
          cx: knot.x,
          cy: knot.y,
          rx: 0.28,
          ry: 0.13,
          fill: 'none',
          stroke: '#000000',
          'stroke-opacity': 0.24,
          'stroke-width': 0.05,
          transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI} ${knot.x} ${knot.y})`,
        })
      );
    });

    // Now and then a glint runs up the lit edge of each rail, like light
    // catching varnish — the same trick as the snakes' sheen, so every ladder
    // and snake shares one set of keyframes.
    [1, -1].forEach((side) => {
      const p = along(0, side, lightSide * 0.3);
      const q = along(1, side, lightSide * 0.3);
      const sheen = svgEl('path', {
        class: 'ladder-sheen',
        d: `M ${p.x} ${p.y} L ${q.x} ${q.y}`,
        pathLength: 100,
        fill: 'none',
        stroke: '#ffffff',
        'stroke-opacity': 0.6,
        'stroke-width': 0.2,
        'stroke-linecap': 'round',
        'stroke-dasharray': '8 192',
      });
      group.appendChild(sheen);
    });

    // A nail where each rung meets each rail.
    for (let i = 1; i < rungCount; i++) {
      [1, -1].forEach((side) => {
        const n = along(i / rungCount, side);
        group.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 0.17, fill: '#241a12', 'fill-opacity': 0.65 }));
        group.appendChild(
          svgEl('circle', { cx: n.x - 0.05, cy: n.y - 0.06, r: 0.05, fill: '#ffffff', 'fill-opacity': 0.5 })
        );
      });
    }

    svg.appendChild(group);
  }

  // A snake seen from above: a body built from nested, progressively lighter
  // ribbons (slid toward the light so it reads as round), scale texture, a
  // saddle pattern and a proper head with slit-pupil eyes. There's no heavy
  // outline — just a thin dark edge — which is most of what made the old one
  // look like a cartoon.
  function drawSnake(svg, from, to) {
    const { a, dx, dy, len, px, py } = geometry(from, to);
    const palette = boardTheme().snake;
    const waves = Math.max(1.25, Math.min(2.5, len / 26));
    const amp = 2.1;
    const headWidth = Math.min(1.65, Math.max(1.1, len / 34));

    const point = (t) => {
      const damp = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      const wave = Math.sin(t * Math.PI * 2 * waves) * amp * damp;
      return { x: a.x + dx * t + px * wave, y: a.y + dy * t + py * wave };
    };

    const normalAt = (t) => {
      const p0 = point(Math.max(0, t - 0.01));
      const p1 = point(Math.min(1, t + 0.01));
      const tx = p1.x - p0.x;
      const ty = p1.y - p0.y;
      const mag = Math.hypot(tx, ty) || 1;
      return { nx: -ty / mag, ny: tx / mag, tx: tx / mag, ty: ty / mag };
    };

    // Slim at the neck, full through the middle, tapering over the last half.
    const halfWidth = (t) => {
      const neck = 0.8 + 0.2 * Math.min(1, t / 0.2);
      const tail = t < 0.5 ? 1 : Math.max(0, 1 - ((t - 0.5) / 0.5) ** 1.2);
      return headWidth * 0.92 * neck * tail + 0.18;
    };

    const SAMPLES = 72;
    const samples = [];
    let spineLen = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const p = point(t);
      const { nx, ny } = normalAt(t);
      if (i) spineLen += Math.hypot(p.x - samples[i - 1].p.x, p.y - samples[i - 1].p.y);
      samples.push({ t, p, nx, ny, w: halfWidth(t), d: nx * LIGHT.x + ny * LIGHT.y });
    }

    // The body outline scaled to `scale` of its width and slid `lift` toward
    // the light: (1, 0) is the silhouette.
    const ribbon = (scale, lift) => {
      const left = [];
      const right = [];
      samples.forEach((s) => {
        const c = s.d * lift * s.w;
        const w = s.w * scale;
        left.push(`${s.p.x + s.nx * (c + w)} ${s.p.y + s.ny * (c + w)}`);
        right.push(`${s.p.x + s.nx * (c - w)} ${s.p.y + s.ny * (c - w)}`);
      });
      return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`;
    };

    let group = svgEl('g', { 'data-snake': from });
    const clipId = `snake-clip-${from}`;
    const defs = svgEl('defs', {});
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('path', { d: ribbon(1, 0) }));
    defs.appendChild(clip);
    group.appendChild(defs);

    group.appendChild(svgEl('path', { d: ribbon(1, 0), fill: mixHex(palette.body, palette.outline, 0.5) }));

    const shaded = svgEl('g', { 'clip-path': `url(#${clipId})`, filter: 'url(#snake-soft)' });
    [
      [0.86, mixHex(palette.body, palette.outline, 0.18)],
      [0.66, palette.body],
      [0.44, mixHex(palette.body, palette.belly, 0.3)],
      [0.2, mixHex(palette.body, palette.belly, 0.55)],
    ].forEach(([scale, color]) => {
      shaded.appendChild(svgEl('path', { d: ribbon(scale, 0.6 * (1 - scale)), fill: color }));
    });
    group.appendChild(shaded);

    const marks = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const saddles = Math.max(4, Math.floor(spineLen / (headWidth * 2.3)));
    for (let i = 0; i < saddles; i++) {
      const t = 0.14 + (0.8 * (i + 0.5)) / saddles;
      const p = point(t);
      const { tx, ty } = normalAt(t);
      const w = halfWidth(t);
      const angle = (Math.atan2(ty, tx) * 180) / Math.PI;
      const rotate = (cx, cy) => `rotate(${angle} ${cx} ${cy})`;
      marks.appendChild(
        svgEl('ellipse', {
          cx: p.x,
          cy: p.y,
          rx: w * 1.05,
          ry: w * 0.62,
          fill: palette.outline,
          'fill-opacity': 0.5,
          transform: rotate(p.x, p.y),
        })
      );
      marks.appendChild(
        svgEl('ellipse', {
          cx: p.x,
          cy: p.y,
          rx: w * 0.52,
          ry: w * 0.3,
          fill: palette.belly,
          'fill-opacity': 0.3,
          transform: rotate(p.x, p.y),
        })
      );
      // A fleck on the flank, alternating sides, halfway between the saddles.
      const tf = Math.min(0.96, t + 0.4 / saddles);
      const pf = point(tf);
      const nf = normalAt(tf);
      const wf = halfWidth(tf);
      const side = i % 2 ? 1 : -1;
      marks.appendChild(
        svgEl('circle', {
          cx: pf.x + nf.nx * wf * 0.78 * side,
          cy: pf.y + nf.ny * wf * 0.78 * side,
          r: wf * 0.2,
          fill: palette.outline,
          'fill-opacity': 0.4,
        })
      );
    }
    group.appendChild(marks);

    group.appendChild(svgEl('path', { d: ribbon(1, 0), fill: 'url(#snake-scales)' }));

    // A glint down the lit side of the back.
    const glint = samples
      .filter((s) => s.t > 0.08 && s.t < 0.9)
      .map((s) => `${s.p.x + s.nx * s.d * 0.42 * s.w} ${s.p.y + s.ny * s.d * 0.42 * s.w}`);
    group.appendChild(
      svgEl('path', {
        d: `M ${glint.join(' L ')}`,
        fill: 'none',
        stroke: palette.belly,
        'stroke-opacity': 0.32,
        'stroke-width': 0.16,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    );
    // A brighter glint that runs down the back every few seconds, the way
    // light catches scales when a snake shifts. pathLength normalises the
    // dash maths so every snake uses the same keyframes whatever its length.
    const sheen = svgEl('path', {
      class: 'snake-sheen',
      d: `M ${glint.join(' L ')}`,
      pathLength: 100,
      fill: 'none',
      stroke: '#ffffff',
      'stroke-opacity': 0.55,
      'stroke-width': 0.26,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': '9 191',
    });
    group.appendChild(sheen);
    group.appendChild(
      svgEl('path', {
        d: ribbon(1, 0),
        fill: 'none',
        stroke: palette.outline,
        'stroke-opacity': 0.75,
        'stroke-width': 0.16,
        'stroke-linejoin': 'round',
      })
    );

    // ---- Head. Drawn in a frame that points away from the body, in units of
    // the neck's half width.
    const hw0 = halfWidth(0);
    const head = point(0);
    const { tx, ty, nx, ny } = normalAt(0);
    const fx = -tx;
    const fy = -ty;
    const at = (u, v) => ({
      x: head.x + fx * u * hw0 + nx * v * hw0,
      y: head.y + fy * u * hw0 + ny * v * hw0,
    });
    const H = (u, v) => {
      const p = at(u, v);
      return `${p.x} ${p.y}`;
    };
    const headPath =
      `M ${H(-0.4, 0.95)} C ${H(0.3, 1.05)} ${H(0.8, 1.4)} ${H(1.4, 1.3)} ` +
      `C ${H(2.0, 1.2)} ${H(2.5, 0.78)} ${H(3.0, 0.44)} ` +
      `C ${H(3.3, 0.3)} ${H(3.3, -0.3)} ${H(3.0, -0.44)} ` +
      `C ${H(2.5, -0.78)} ${H(2.0, -1.2)} ${H(1.4, -1.3)} ` +
      `C ${H(0.8, -1.4)} ${H(0.3, -1.05)} ${H(-0.4, -0.95)} Z`;
    const heading = (Math.atan2(fy, fx) * 180) / Math.PI;

    // Everything from here on is the head, in its own group so it can sway
    // gently from the neck, with the tongue flicking in and out on its own
    // clock. Both pivots are in board units (transform-box: view-box).
    const neck = at(0, 0);
    const headGroup = svgEl('g', { class: 'snake-head' });
    headGroup.style.setProperty('transform-origin', `${neck.x}px ${neck.y}px`);
    const tongueRoot = at(3.2, 0);
    const tongue = svgEl('g', { class: 'snake-tongue' });
    tongue.style.setProperty('transform-origin', `${tongueRoot.x}px ${tongueRoot.y}px`);
    tongue.style.setProperty('--heading', `${heading}deg`);
    headGroup.appendChild(tongue);
    const bodyGroup = group;
    group = headGroup;

    // Tongue first, so the snout sits over its root.
    tongue.appendChild(
      svgEl('path', {
        d:
          `M ${H(3.2, 0)} Q ${H(3.8, 0.12)} ${H(4.05, 0.04)} ` +
          `M ${H(4.05, 0.04)} L ${H(4.5, 0.34)} M ${H(4.05, 0.04)} L ${H(4.45, -0.26)}`,
        fill: 'none',
        stroke: '#7c2a35',
        'stroke-opacity': 0.9,
        'stroke-width': 0.11,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    );
    group.appendChild(svgEl('path', { d: headPath, fill: mixHex(palette.head, palette.outline, 0.12) }));

    const headShade = svgEl('g', { 'clip-path': `url(#${clipId}-head)`, filter: 'url(#snake-soft)' });
    const headClip = svgEl('clipPath', { id: `${clipId}-head` });
    headClip.appendChild(svgEl('path', { d: headPath }));
    defs.appendChild(headClip);
    const lit = nx * LIGHT.x + ny * LIGHT.y;
    const glow = at(1.6, lit * 0.5);
    headShade.appendChild(
      svgEl('ellipse', {
        cx: glow.x,
        cy: glow.y,
        rx: hw0 * 1.15,
        ry: hw0 * 0.55,
        fill: mixHex(palette.head, palette.belly, 0.45),
        'fill-opacity': 0.75,
        transform: `rotate(${heading} ${glow.x} ${glow.y})`,
      })
    );
    headShade.appendChild(
      svgEl('path', {
        d: `M ${H(0.5, 0)} L ${H(1.3, 0.5)} L ${H(2.4, 0.22)} L ${H(2.7, 0)} L ${H(2.4, -0.22)} L ${H(1.3, -0.5)} Z`,
        fill: palette.outline,
        'fill-opacity': 0.3,
      })
    );
    group.appendChild(headShade);
    group.appendChild(svgEl('path', { d: headPath, fill: 'url(#snake-scales)', 'fill-opacity': 0.8 }));
    group.appendChild(
      svgEl('path', {
        d: headPath,
        fill: 'none',
        stroke: palette.outline,
        'stroke-opacity': 0.8,
        'stroke-width': 0.16,
        'stroke-linejoin': 'round',
      })
    );

    [1, -1].forEach((side) => {
      const eye = at(1.85, side * 0.82);
      group.appendChild(svgEl('circle', { cx: eye.x, cy: eye.y, r: hw0 * 0.3, fill: '#c9963a', stroke: '#2b1d10', 'stroke-width': 0.05, 'stroke-opacity': 0.8 }));
      group.appendChild(
        svgEl('ellipse', {
          cx: eye.x,
          cy: eye.y,
          rx: hw0 * 0.24,
          ry: hw0 * 0.07,
          fill: '#150e08',
          transform: `rotate(${heading} ${eye.x} ${eye.y})`,
        })
      );
      group.appendChild(svgEl('circle', { cx: eye.x - 0.09, cy: eye.y - 0.11, r: hw0 * 0.06, fill: '#ffffff', 'fill-opacity': 0.8 }));
      const nostril = at(2.85, side * 0.17);
      group.appendChild(svgEl('circle', { cx: nostril.x, cy: nostril.y, r: hw0 * 0.05, fill: '#150e08', 'fill-opacity': 0.7 }));
    });

    bodyGroup.appendChild(headGroup);
    svg.appendChild(bodyGroup);
  }

  // ---------- Pawns ----------
  // Drawn as an illustrated board-game piece with the same outline-and-highlight
  // treatment as the ladders and snakes, tinted with the player's colour.
  function pawnSvg(player) {
    const svg = svgEl('svg', { viewBox: '0 0 40 52', class: 'pawn' });
    const dark = shade(player.color, -0.42);
    const light = shade(player.color, 0.38);

    // Lacquered-wood shading: a radial light from the top left over the
    // player's colour, so the piece reads as turned and glossy, not flat.
    const gradId = `pawn-gloss-${player.color.slice(1)}`;
    const defs = svgEl('defs', {});
    const grad = svgEl('radialGradient', { id: gradId, cx: '35%', cy: '28%', r: '75%' });
    [
      [0, light],
      [0.45, player.color],
      [1, shade(player.color, -0.3)],
    ].forEach(([offset, color]) => grad.appendChild(svgEl('stop', { offset, 'stop-color': color })));
    defs.appendChild(grad);
    svg.appendChild(defs);
    const fill = `url(#${gradId})`;

    svg.appendChild(
      svgEl('ellipse', { cx: 20, cy: 47, rx: 14, ry: 4.4, fill: dark, 'fill-opacity': 0.32 })
    );
    // Base, waist and head share one outline so it reads as a carved piece.
    svg.appendChild(
      svgEl('path', {
        d: 'M6 46 Q6 40 13 37.5 Q9 33 12.5 28 Q16 24 20 24 Q24 24 27.5 28 Q31 33 27 37.5 Q34 40 34 46 Z',
        fill,
        stroke: dark,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      })
    );
    svg.appendChild(
      svgEl('ellipse', { cx: 20, cy: 24.5, rx: 9.5, ry: 3, fill: dark, 'fill-opacity': 0.45 })
    );
    svg.appendChild(
      svgEl('circle', { cx: 20, cy: 15, r: 11, fill, stroke: dark, 'stroke-width': 2 })
    );
    // A thin rim of reflected light on the shadow side of the head and base.
    svg.appendChild(
      svgEl('path', { d: 'M28.5 20.5a10 10 0 0 1-9 5', fill: 'none', stroke: light, 'stroke-opacity': 0.55, 'stroke-width': 1.1, 'stroke-linecap': 'round' })
    );
    svg.appendChild(
      svgEl('path', { d: 'M9 44.5Q9.5 41 14 39.5', fill: 'none', stroke: light, 'stroke-opacity': 0.5, 'stroke-width': 1.2, 'stroke-linecap': 'round' })
    );
    svg.appendChild(
      svgEl('ellipse', {
        cx: 15.5,
        cy: 10.5,
        rx: 4,
        ry: 3,
        fill: light,
        'fill-opacity': 0.75,
        transform: 'rotate(-28 15.5 10.5)',
      })
    );

    return svg;
  }

  function shade(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const mix = (channel) => {
      const target = amount < 0 ? 0 : 255;
      return Math.round(channel + (target - channel) * Math.abs(amount));
    };
    const r = mix((num >> 16) & 255);
    const g = mix((num >> 8) & 255);
    const b = mix(num & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  function tokenEl(index) {
    if (!tokenEls[index]) {
      const token = document.createElement('div');
      token.className = 'token';
      tokenEls[index] = token;
    }
    return tokenEls[index];
  }

  function placeTokens() {
    const count = playerCount();
    const perRow = Math.min(count, 3);
    const scale = count <= 2 ? 1 : count <= 4 ? 0.82 : 0.68;

    state.players.forEach((player, i) => {
      const token = tokenEl(i);
      if (token.dataset.look !== player.color) {
        token.innerHTML = '';
        token.appendChild(pawnSvg(player));
        token.dataset.look = player.color;
      }

      const col = i % perRow;
      const row = Math.floor(i / perRow);
      token.style.setProperty('--token-scale', scale);
      token.style.setProperty('--token-left', `${((col + 0.5) / perRow) * 100}%`);
      token.style.setProperty('--token-bottom', `${4 + row * 34}%`);
      token.classList.toggle('active-turn', state.current === i && !state.finished && !animating);

      // A pawn mid-walk or mid-trip lives on the board, not in a square;
      // the move puts it back in its square when it arrives.
      const moving = token.classList.contains('walking') || token.classList.contains('travelling');
      const cell = cellEls[player.pos];
      if (cell && !moving && token.parentElement !== cell) cell.appendChild(token);
    });

    // The square under whoever's turn it is breathes in their colour.
    const mover = state.players[state.current];
    const here = !state.finished && !animating && cellEls[mover.pos];
    Object.values(cellEls).forEach((cell) => {
      if (cell !== here) cell.classList.remove('cell-active');
    });
    if (here) {
      here.style.setProperty('--player-color', mover.color);
      here.classList.add('cell-active');
    }
  }

  // The pawn walks across the board itself, gliding from square to square,
  // and only settles into the last square's element when it arrives. Moving
  // it into a new square's element on every step rebuilt its compositor
  // layer each time, which phones showed as a flicker on every hop.
  async function walkToken(playerIndex, from, to) {
    if (from === to) return;
    const step = to > from ? 1 : -1;
    const token = tokenEl(playerIndex);
    const place = (num) => {
      const c = cellCenter(num);
      token.style.left = `${c.x}%`;
      token.style.top = `${c.y}%`;
    };
    place(from);
    token.classList.add('walking');
    $('board').appendChild(token);
    void token.offsetWidth;
    for (let pos = from + step, n = 0; ; pos += step, n++) {
      place(pos);
      token.classList.remove('hopping');
      void token.offsetWidth;
      token.classList.add('hopping');
      // Each square lights briefly as the pawn passes: a trail of footsteps.
      if (!REDUCED_MOTION) pulse(cellEls[pos], 'stepped');
      soundStep(n);
      await sleep(STEP_MS);
      if (pos === to) break;
    }
    token.classList.remove('walking');
    token.style.left = '';
    token.style.top = '';
    cellEls[to].appendChild(token);
  }

  async function travelToken(playerIndex, from, to) {
    const token = tokenEl(playerIndex);
    const start = cellCenter(from);
    const end = cellCenter(to);

    token.classList.remove('hopping');
    // The token element is busy being transitioned along the line, so the
    // character of the trip rides on the pawn inside it — a bounce on the way
    // up a ladder, a tumble on the way down a snake.
    token.classList.add('travelling', to > from ? 'climbing' : 'sliding');
    token.style.left = `${start.x}%`;
    token.style.top = `${start.y}%`;
    $('board').appendChild(token);
    void token.offsetWidth;

    token.style.left = `${end.x}%`;
    token.style.top = `${end.y}%`;
    await sleep(TRAVEL_MS);

    token.classList.remove('travelling', 'climbing', 'sliding');
    token.style.left = '';
    token.style.top = '';
    cellEls[to].appendChild(token);
  }

  // Marks the square a pawn actually comes to rest on. Without it the landing
  // is invisible: the pawn stops, and a beat later a full-screen card covers
  // the board before you've registered where you ended up.
  function flashCell(num) {
    const cell = cellEls[num];
    if (!cell || REDUCED_MOTION) return;
    replayAnimation(cell, 'landed');
    setTimeout(() => cell.classList.remove('landed'), 1200);
    // The landing ripples out over two rings of squares. Delay and strength
    // follow the true distance from the landing, not the ring, so the wave
    // front is round and each square fades in rather than stepping.
    const index = CELL_INDEX[num];
    const row = Math.floor(index / 10);
    const col = index % 10;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = row + dr;
        const c = col + dc;
        const dist = Math.hypot(dr, dc);
        if (!dist || dist > 2.3 || r < 0 || r > 9 || c < 0 || c > 9) continue;
        const neighbour = cellEls[CELL_ORDER[r * 10 + c]];
        neighbour.style.setProperty('--ripple-delay', `${Math.round(dist * 110)}ms`);
        neighbour.style.setProperty('--ripple-amp', (1.15 - dist * 0.35).toFixed(2));
        pulse(neighbour, 'rippled');
      }
    }
  }

  // ---------- Board motion ----------
  // The board is never quite still, but never busy either: a sheen sweeps
  // across it now and then (CSS, .board-sheen), a few glints wink on random
  // squares, the finish square shimmers, and the square under whoever's turn
  // it is breathes in their colour. The glints are a handful of elements on
  // their own random clocks, each moved to a new square between winks.
  let glints = [];

  function startBoardMotion() {
    stopBoardMotion();
    if (REDUCED_MOTION) return;
    stirTimer = setTimeout(stirBoard, 1500);
    const layer = document.createElement('div');
    layer.className = 'board-glints';
    $('board').appendChild(layer);
    const count = window.innerWidth < 640 ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const glint = document.createElement('span');
      glint.className = 'board-glint';
      layer.appendChild(glint);
      const wink = () => {
        glint.style.left = `${5 + Math.random() * 90}%`;
        glint.style.top = `${5 + Math.random() * 90}%`;
        const size = 0.7 + Math.random() * 0.6;
        const animation = glint.animate(
          [
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.2) rotate(0deg)' },
            { opacity: 0.95, transform: `translate(-50%, -50%) scale(${size}) rotate(45deg)`, offset: 0.45 },
            { opacity: 0, transform: 'translate(-50%, -50%) scale(0.3) rotate(90deg)' },
          ],
          { duration: 1300 + Math.random() * 900, delay: 500 + Math.random() * 4500, easing: 'ease-in-out' }
        );
        animation.onfinish = wink;
        glints[i] = animation;
      };
      wink();
    }
  }

  // One snake or one ladder at a time comes alive for a moment: a snake
  // sways its head, flicks its tongue and a glint runs down its back; a
  // ladder's rails catch the light. The board's SVG sits under a drop-shadow
  // filter, so while anything inside it moves the whole board is redrawn
  // every frame. Stirring one piece now and then, instead of every snake on
  // an endless loop, leaves it a still image the GPU reuses most of the
  // time. Touch devices, usually phones, get longer rests.
  let stirTimer = 0;
  const STIR_REST = window.matchMedia('(pointer: coarse)').matches ? [4500, 4000] : [2200, 2600];

  function stirBoard() {
    const svg = $('board-lines');
    if (svg && !document.hidden) {
      const snakes = [...svg.querySelectorAll('[data-snake]:not(.charmed)')];
      const ladders = [...new Set([...svg.querySelectorAll('.ladder-sheen')].map((el) => el.parentNode))];
      const pickLadder = ladders.length && (!snakes.length || Math.random() < 0.35);
      const pool = pickLadder ? ladders : snakes;
      if (pool.length) {
        const piece = pool[Math.floor(Math.random() * pool.length)];
        const parts = pickLadder ? [...piece.querySelectorAll('.ladder-sheen')] : [piece];
        parts.forEach((el) => el.classList.add('stir'));
        setTimeout(() => parts.forEach((el) => el.classList.remove('stir')), 3200);
      }
    }
    stirTimer = setTimeout(stirBoard, STIR_REST[0] + Math.random() * STIR_REST[1]);
  }

  // Called before the board is rebuilt or left: a wink finishing on a
  // detached glint would otherwise keep scheduling the next one forever.
  function stopBoardMotion() {
    clearTimeout(stirTimer);
    glints.forEach((animation) => {
      animation.onfinish = null;
      animation.cancel();
    });
    glints = [];
  }

  // ---------- Rendering ----------
  const HEART_ICON = '<svg class="icon icon-xs"><use href="#i-heart" /></svg>';

  // Previous love totals. Diffing them here means a score change animates no
  // matter which of the eight surprise types or the answer flow caused it —
  // none of those call sites has to remember to trigger anything.
  let lastLove = null;
  // Set while a change already has a sound of its own (an answered question).
  let quietHearts = false;

  function renderAll() {
    if (!state) return;

    const scores = $('scores');
    if (scores.childElementCount !== playerCount()) {
      scores.innerHTML = '';
      state.players.forEach(() => {
        const card = document.createElement('div');
        card.className = 'score-card';
        card.innerHTML =
          '<span class="score-swatch" aria-hidden="true"></span>' +
          '<span class="score-name"></span>' +
          '<svg class="icon icon-xs score-shield" role="img"><use href="#i-shield" /></svg>' +
          '<svg class="icon icon-xs score-frozen" role="img"><use href="#i-snow" /></svg>' +
          `<span class="score-points"><span class="pts-num"></span>${HEART_ICON}</span>`;
        scores.appendChild(card);
      });
      lastLove = null;
    }

    state.players.forEach((player, i) => {
      const card = scores.children[i];
      card.querySelector('.score-name').textContent = player.name;
      card.querySelector('.score-shield').setAttribute('aria-label', t('shieldUp'));
      card.querySelector('.score-frozen').setAttribute('aria-label', t('skipsNext'));
      card.querySelector('.pts-num').textContent = player.love;
      card.style.setProperty('--player-color', player.color);
      card.classList.toggle('active', state.current === i && !state.finished);
      card.classList.toggle('has-shield', Boolean(player.shield));
      card.classList.toggle('is-frozen', Boolean(player.skipNext));

      const before = lastLove ? lastLove[i] : null;
      if (typeof before === 'number' && before !== player.love) {
        pulse(card, 'bump');
        floatLove(card, player.love - before);
        if (!quietHearts) soundHearts(player.love - before);
      }
    });
    lastLove = state.players.map((player) => player.love);

    const banner = $('turn-banner');
    const current = state.players[state.current];
    const label = state.finished ? t('gameOver') : current.name;
    const showing = `${label}|${state.finished ? '' : current.color}`;
    if (banner.dataset.showing !== showing) {
      banner.innerHTML = '<span class="turn-swatch" aria-hidden="true"></span><span class="turn-name"></span>';
      banner.querySelector('.turn-swatch').classList.toggle('hidden', state.finished);
      banner.style.setProperty('--player-color', current.color);
      banner.querySelector('.turn-name').textContent = label;
      banner.dataset.showing = showing;
      pulse(banner, 'swap');
    }

    const roll = $('roll-btn');
    roll.disabled = state.finished || turnBusy || animating;
    roll.classList.toggle('ready', !roll.disabled && modalsClosed());
    renderPowers();
    placeTokens();
  }

  // Drifts off the score card that changed, so points landing is something you
  // watch happen rather than a number that is quietly different next time you
  // look at the header.
  // The +2 float.
  // It falls rather than rises. The usual "+2 floats up" idiom assumes there is
  // room above the thing that scored — here the score cards are pinned to the
  // top edge of the window, and rising took the number off-screen within about
  // a tenth of a second. Downward, it plays out over the board.
  function floatLove(card, delta) {
    if (REDUCED_MOTION || !delta) return;
    const rect = card.getBoundingClientRect();

    const pop = document.createElement('div');
    pop.className = 'love-pop';
    pop.innerHTML = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}${HEART_ICON}`;
    pop.style.left = `${rect.left + rect.width / 2}px`;
    pop.style.top = `${rect.bottom}px`;
    document.body.appendChild(pop);

    const remove = () => pop.remove();
    pop
      .animate(
        [
          // Snappy on the way in...
          { transform: 'translate(-50%, -10px) scale(0.85)', opacity: 0, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          { transform: 'translate(-50%, 3px) scale(1)', opacity: 1, offset: 0.2 },
          // ...then a flat, readable hold before it goes.
          { transform: 'translate(-50%, 14px) scale(1)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-50%, 32px) scale(1)', opacity: 0 },
        ],
        // linear overall, with the ease on the first segment only. A single
        // ease-out across the whole effect front-loads it so hard that the
        // number is down to 8% opacity by the halfway point — it flashes past
        // before you can read it.
        { duration: 1150, easing: 'linear' }
      )
      .finished.then(remove, remove);
  }

  function logMessage(msg) {
    state.log.push(msg);
    if (state.log.length > 60) state.log.shift();
  }

  function renderLog() {
    const list = $('log-list');
    list.innerHTML = '';
    state.log
      .slice()
      .reverse()
      .forEach((msg) => {
        const li = document.createElement('li');
        li.textContent = msg;
        list.appendChild(li);
      });

    const answers = $('answer-log');
    answers.innerHTML = '';

    if (!state.answers.length) {
      answers.innerHTML = '<h2 class="field-label"></h2><p class="log-empty"></p>';
      answers.querySelector('.field-label').textContent = t('questions');
      answers.querySelector('.log-empty').textContent = t('logEmpty');
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'field-label';
    heading.textContent = t('questionsN', { n: state.answers.length });
    answers.appendChild(heading);

    state.answers
      .slice()
      .reverse()
      .forEach((entry) => {
        const box = document.createElement('div');
        box.className = 'answer-entry';

        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = `${entry.player} · ${themeLabel(entry.theme)}${entry.ai ? ' · AI' : ''}`;

        const q = document.createElement('div');
        q.className = 'q';
        q.textContent = entry.question;

        const a = document.createElement('div');
        a.className = 'a';
        if (entry.answer) {
          a.textContent = entry.answer;
        } else {
          a.classList.add('muted');
          a.textContent = entry.answered ? t('answeredAloud') : t('skipped');
        }

        box.appendChild(who);
        box.appendChild(q);
        box.appendChild(a);
        answers.appendChild(box);
      });
  }

  // Plain-text transcript of every question that came up, in play order —
  // downloadable so a couple can keep what they told each other.
  function buildTranscript() {
    const lines = [];
    lines.push(t('transcriptTitle'));
    lines.push(`${t('transcriptPlayers')}: ${state.players.map((p) => p.name).join('  ·  ')}`);
    lines.push(`${t('transcriptMode')}: ${loc(MODES[state.mode] || MODES.couples, 'label')}`);
    lines.push(`${t('transcriptExported')}: ${new Date().toLocaleString(LANGUAGES[lang].htmlLang)}`);
    lines.push('');

    if (!state.answers.length) {
      lines.push(t('transcriptNone'));
      return lines.join('\n');
    }

    state.answers.forEach((entry, i) => {
      lines.push(`${i + 1}. ${entry.player} — ${themeLabel(entry.theme)}${entry.ai ? t('transcriptAi') : ''}`);
      lines.push(`   Q: ${entry.question}`);
      lines.push(`   A: ${entry.answer || (entry.answered ? t('answeredAloud') : t('skipped'))}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  function downloadAnswers() {
    const blob = new Blob([buildTranscript()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = url;
    link.download = `snakes-ladders-questions-${stamp}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Dice ----------
  function buildDice() {
    const dice = $('dice');
    dice.innerHTML = '';
    Object.entries(PIP_LAYOUT).forEach(([value, slots]) => {
      const face = document.createElement('div');
      face.className = `die-face face-${value}`;
      for (let slot = 1; slot <= 9; slot++) {
        const dot = document.createElement('span');
        if (slots.includes(slot)) dot.className = 'pip';
        face.appendChild(dot);
      }
      dice.appendChild(face);
    });
  }

  function showDiceFace(value, spin) {
    const [rotX, rotY] = DICE_ORIENTATION[value];
    if (spin) diceSpins += 2 + Math.floor(Math.random() * 2);
    $('dice').style.transform = `rotateX(${360 * diceSpins + rotX}deg) rotateY(${360 * diceSpins + rotY}deg)`;
  }

  let diceThrow = 0;

  async function animateDice(value) {
    const overlay = $('dice-overlay');
    overlay.classList.remove('hidden', 'settled');

    // The cube must be painted at its current angle BEFORE the new rotation is
    // set, otherwise there is no start value and the transition never runs —
    // the die would snap straight to the final face with no tumble.
    void $('dice').offsetWidth;

    overlay.classList.add('rolling');
    showDiceFace(value, true);

    // Dust on the first bounce, then a pop and a glow once it's still. A throw
    // that has been skipped (or replaced by the next one) cancels both.
    const throwId = ++diceThrow;
    if (!REDUCED_MOTION) {
      setTimeout(() => throwId === diceThrow && burstDice(), DICE_MS * DICE_IMPACTS[0]);
      setTimeout(() => throwId === diceThrow && overlay.classList.add('settled'), DICE_MS * 0.93);
    }

    // The throw takes about two seconds, every single turn, and the number was
    // decided before the die left the hand — so a tap anywhere cuts it short.
    // Nothing about the outcome changes, only how long you wait to see it.
    await untilTapOrTimeout(overlay, DICE_MS + (REDUCED_MOTION ? 260 : 520));

    diceThrow++;
    overlay.classList.remove('rolling', 'settled');
    overlay.classList.add('hidden');
    $('dice-burst').replaceChildren();
  }

  // Dust and glints kicked out along the ground where the die first lands,
  // plus a ring spreading from the hit. Plain elements on the Web Animations
  // API, gone as soon as they finish.
  function burstDice() {
    const host = $('dice-burst');
    const size = $('dice').offsetWidth || 200;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--rose').trim() || '#ffffff';
    const colors = [accent, '#ffffff', '#fff3d6'];
    const fling = (el, frames, duration) => {
      host.appendChild(el);
      const remove = () => el.remove();
      // `forwards` holds the last (invisible) frame until the element is
      // removed, so it can't flash back at its resting place for a frame.
      el.animate(frames, { duration, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' }).finished.then(remove, remove);
    };

    const ring = document.createElement('span');
    ring.className = 'dice-ring';
    ring.style.width = `${size * 0.9}px`;
    ring.style.height = `${size * 0.22}px`;
    fling(
      ring,
      [
        { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.8 },
        { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 0 },
      ],
      650
    );

    for (let i = 0; i < 14; i++) {
      const bit = document.createElement('span');
      const d = 3 + Math.random() * 6;
      bit.style.width = `${d}px`;
      bit.style.height = `${d}px`;
      bit.style.background = colors[i % colors.length];
      // Spread over the ground plane: wide across, shallow in depth, with a
      // little hop up on the way out.
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const reach = size * (0.45 + Math.random() * 0.45);
      const dx = Math.cos(angle) * reach;
      const dy = Math.sin(angle) * reach * 0.3;
      const hop = size * (0.08 + Math.random() * 0.14);
      fling(
        bit,
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55 - hop}px)) scale(0.9)`, opacity: 0.9, offset: 0.45 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.3)`, opacity: 0 },
        ],
        550 + Math.random() * 400
      );
    }
  }

  function untilTapOrTimeout(el, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.removeEventListener('click', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      el.addEventListener('click', finish);
    });
  }

  // ---------- Turn flow ----------
  async function rollDice() {
    if (turnBusy || animating || state.finished || !modalsClosed()) return;
    turnBusy = true;
    animating = true;
    armedThisTurn = freshArmed();

    // A loaded die decides the face; the throw still plays so it reads as a roll.
    const player = state.players[state.current];
    const loaded = player.loaded || 0;
    player.loaded = 0;
    renderAll();

    const roll = loaded || 1 + Math.floor(Math.random() * 6);
    state.lastRoll = roll;
    soundDice();
    await animateDice(roll);
    await handleRoll(roll, Boolean(loaded));
  }

  function modalsClosed(except) {
    return ['question-modal', 'surprise-modal', 'win-modal', 'ai-modal', 'confirm-modal', 'reroll-modal', 'powers-modal']
      .filter((id) => id !== except)
      .every((id) => $(id).classList.contains('hidden'));
  }

  // ---------- Heart powers ----------
  // Everything but Re-roll is bought from the powers sheet, before rolling.
  // Re-roll is only worth anything once you've seen a bad roll, so it's
  // offered at that moment instead (see handleRoll).
  function canUsePowers() {
    return Boolean(state) && !state.finished && !turnBusy && !animating && modalsClosed('powers-modal');
  }

  const rivals = () => otherIndexes();
  // Snake heads still in front of the current player, nearest first.
  const snakesAhead = () =>
    Object.keys(state.snakes)
      .map(Number)
      .filter((head) => head > state.players[state.current].pos)
      .sort((a, b) => a - b);

  // What each `target` power can act on right now: player indexes, or snake
  // heads for the charmer. Empty means the power can't be bought at the moment.
  const TARGETS = {
    freeze: () => rivals().filter((i) => !state.players[i].skipNext),
    rewind: () => rivals().filter((i) => state.players[i].pos > 1),
    swap: () => rivals().filter((i) => state.players[i].pos !== state.players[state.current].pos),
    heist: () => rivals().filter((i) => state.players[i].love >= HEIST_MIN),
    charm: snakesAhead,
  };

  // buyable · refundable (bought this turn, before rolling) · active (bought
  // earlier, now committed) · poor (can't afford) · none (no valid target)
  function powerState(kind) {
    const me = state.players[state.current];
    if (kind === 'freeze' && armedThisTurn.freeze !== null) return 'refundable';
    if (TARGETS[kind]) {
      if (!TARGETS[kind]().length) return 'none';
    } else if (me[kind]) {
      return armedThisTurn[kind] ? 'refundable' : 'active';
    }
    return me.love >= POWERS[kind].cost ? 'buyable' : 'poor';
  }

  function renderPowers() {
    const me = state.players[state.current];
    $('dock-hearts').textContent = me.love;
    $('powers-btn').disabled = !canUsePowers() || !modalsClosed();

    const armed = [];
    if (me.shield) armed.push(t('shieldOn'));
    if (me.boost) armed.push(t('boostOn', { n: POWERS.boost.steps }));
    if (me.loaded) armed.push(t('nextRoll', { n: me.loaded }));
    if (armedThisTurn.freeze !== null) armed.push(t('frozenOn', { name: state.players[armedThisTurn.freeze].name }));
    $('powers-status').textContent = armed.join(' · ');

    if (!$('powers-modal').classList.contains('hidden')) renderPowerSheet();
  }

  function renderPowerSheet() {
    const me = state.players[state.current];
    $('powers-player').textContent = me.name;
    $('powers-balance').textContent = me.love;

    // Rebuilding the list would drop keyboard focus; put it back where it was.
    const focusKey = document.activeElement && document.activeElement.dataset.focusKey;
    const list = $('power-list');
    list.innerHTML = '';

    SHOP.forEach((kind) => {
      const power = POWERS[kind];
      const status = powerState(kind);

      const row = document.createElement('li');
      row.className = 'power-row';
      row.dataset.state = status;
      row.innerHTML =
        `<svg class="icon power-icon" aria-hidden="true"><use href="#${power.icon}" /></svg>` +
        '<div class="power-text"><span class="power-title"></span><span class="power-desc"></span></div>' +
        '<button type="button" class="power-buy"></button>';
      row.querySelector('.power-title').textContent = powerName(kind);
      row.querySelector('.power-desc').textContent = powerNote(kind, status) || t(`power.${kind}.desc`);

      const buy = row.querySelector('.power-buy');
      buy.dataset.focusKey = `buy-${kind}`;
      if (status === 'refundable') {
        buy.textContent = t('cancel');
        buy.setAttribute('aria-label', t('cancelAria', { power: powerName(kind), cost: power.cost }));
      } else if (status === 'active') {
        buy.textContent = t('active');
        buy.disabled = true;
      } else {
        buy.innerHTML = `<span class="power-cost-num"></span>${HEART_ICON}`;
        buy.querySelector('.power-cost-num').textContent = power.cost;
        buy.disabled = status !== 'buyable';
        buy.setAttribute('aria-label', t('buyAria', { power: powerName(kind), cost: power.cost }));
        buy.setAttribute('aria-expanded', String(pickingPower === kind));
      }
      buy.addEventListener('click', () => onPowerBuy(kind));

      if (pickingPower === kind && status === 'buyable') row.appendChild(powerChoices(kind));
      list.appendChild(row);
    });

    if (focusKey) {
      const again = list.querySelector(`[data-focus-key="${focusKey}"]`);
      if (again && !again.disabled) again.focus();
    }
  }

  function powerNote(kind, status) {
    const me = state.players[state.current];
    if (status === 'active' && kind === 'shield') return t('shieldActive');
    if (status === 'refundable' && kind === 'loaded') return t('loadedNote', { n: me.loaded });
    if (status === 'refundable' && kind === 'freeze') {
      return t('freezeNote', { name: state.players[armedThisTurn.freeze].name });
    }
    if (status === 'none') return t(`none.${kind}`, { n: HEIST_MIN });
    return '';
  }

  function powerChoices(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'power-choices';
    // A rival's button carries their colour, the same mark as their pawn.
    const add = (label, aria, key, onPick, color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      if (color) {
        btn.innerHTML = '<span class="choice-swatch" aria-hidden="true"></span><span></span>';
        btn.style.setProperty('--player-color', color);
        btn.lastChild.textContent = label;
      } else {
        btn.textContent = label;
      }
      btn.setAttribute('aria-label', aria);
      btn.dataset.focusKey = key;
      btn.addEventListener('click', onPick);
      wrap.appendChild(btn);
    };

    if (kind === 'loaded') {
      for (let n = 1; n <= 6; n++) add(String(n), t('rollA', { n }), `pick-${n}`, () => buyLoaded(n));
    } else if (kind === 'charm') {
      snakesAhead().forEach((head) => {
        const tail = state.snakes[head];
        add(`${head} → ${tail}`, t('charmAria', { head, tail }), `snake-${head}`, () =>
          buyCharm(head)
        );
      });
    } else {
      TARGETS[kind]().forEach((i) => {
        const p = state.players[i];
        const detail = kind === 'heist' ? ` · ${t('heartsDetail', { n: p.love })}` : kind === 'freeze' ? '' : ` · ${p.pos}`;
        add(`${p.name}${detail}`, `${powerName(kind)}: ${p.name}`, `target-${i}`, () => buyOn(kind, i), p.color);
      });
    }
    // The first choice takes focus so a keyboard user lands on the options.
    requestAnimationFrame(() => {
      const first = wrap.querySelector('.choice-btn');
      if (first && !wrap.contains(document.activeElement)) first.focus();
    });
    return wrap;
  }

  function spend(kind, message) {
    const player = state.players[state.current];
    player.love -= POWERS[kind].cost;
    pickingPower = null;
    logMessage(`${message} (−${POWERS[kind].cost})`);
    soundPower();
    saveState();
    renderAll();
  }

  function onPowerBuy(kind) {
    if (!canUsePowers()) return;
    const player = state.players[state.current];
    const status = powerState(kind);

    if (status === 'refundable') return refundPower(kind);
    if (status !== 'buyable') return;

    if (POWERS[kind].pick) {
      pickingPower = pickingPower === kind ? null : kind;
      return renderPowerSheet();
    }
    if (POWERS[kind].target) {
      const targets = TARGETS[kind]();
      // With one thing to act on there's nothing to choose.
      if (targets.length === 1) return buyOn(kind, targets[0]);
      pickingPower = pickingPower === kind ? null : kind;
      return renderPowerSheet();
    }

    player[kind] = true;
    armedThisTurn[kind] = true;
    spend(kind, t(kind === 'shield' ? 'log.shield' : 'log.boost', { name: player.name }));
  }

  function buyLoaded(n) {
    if (!canUsePowers() || powerState('loaded') !== 'buyable') return;
    const player = state.players[state.current];
    player.loaded = n;
    armedThisTurn.loaded = true;
    spend('loaded', t('log.loadedDie', { name: player.name, n }));
  }

  function buyOn(kind, target) {
    const buy = { freeze: buyFreeze, rewind: buyRewind, swap: buySwap, heist: buyHeist, charm: buyCharm }[kind];
    return buy(target);
  }

  // The steal happens before spend() so the cost comes off the new total; it's
  // immediate and can't be taken back, like the powers that move pawns.
  function buyHeist(target) {
    if (!canUsePowers() || powerState('heist') !== 'buyable' || !TARGETS.heist().includes(target)) return;
    const player = state.players[state.current];
    const other = state.players[target];
    const take = Math.min(POWERS.heist.take, other.love);
    other.love -= take;
    player.love += take;
    spend('heist', t('log.heist', { name: player.name, n: take, other: other.name }));
  }

  // Removing a snake changes the board for everyone, so it's permanent and
  // can't be refunded. The snake leaves state before spend() saves, so a
  // reload mid-fade doesn't bring it back.
  async function buyCharm(head) {
    if (!canUsePowers() || powerState('charm') !== 'buyable' || !snakesAhead().includes(head)) return;
    const player = state.players[state.current];
    delete state.snakes[head];
    closePowers();
    turnBusy = true;
    animating = true;
    spend('charm', t('log.charm', { name: player.name, n: head }));
    await fadeSnake(head);
    animating = false;
    turnBusy = false;
    saveState();
    renderAll();
  }

  async function fadeSnake(head) {
    const group = document.querySelector(`#board-lines [data-snake="${head}"]`);
    if (!group) return;
    if (!REDUCED_MOTION) {
      group.style.setProperty('--charm-ms', `${CHARM_FADE_MS}ms`);
      group.classList.add('charmed');
      await sleep(CHARM_FADE_MS);
    }
    group.remove();
  }

  function buyFreeze(target) {
    if (!canUsePowers() || powerState('freeze') !== 'buyable' || !TARGETS.freeze().includes(target)) return;
    const player = state.players[state.current];
    state.players[target].skipNext = true;
    armedThisTurn.freeze = target;
    spend('freeze', t('log.freeze', { name: player.name, other: state.players[target].name }));
  }

  async function buyRewind(target) {
    if (!canUsePowers() || powerState('rewind') !== 'buyable' || !TARGETS.rewind().includes(target)) return;
    const player = state.players[state.current];
    const other = state.players[target];
    closePowers();
    turnBusy = true;
    animating = true;
    spend('rewind', t('log.rewind', { name: player.name, other: other.name }));
    const newPos = Math.max(1, other.pos - 5);
    await travelToken(target, other.pos, newPos);
    other.pos = newPos;
    animating = false;
    turnBusy = false;
    saveState();
    renderAll();
  }

  // Swap happens on the spot and isn't refundable — both pawns have already
  // moved. The sheet closes first so the trade is actually seen.
  async function buySwap(target) {
    if (!canUsePowers() || powerState('swap') !== 'buyable' || !TARGETS.swap().includes(target)) return;
    const player = state.players[state.current];
    const other = state.players[target];
    closePowers();
    turnBusy = true;
    animating = true;
    spend('swap', t('log.swap', { name: player.name, other: other.name }));
    const [mine, theirs] = [player.pos, other.pos];
    await Promise.all([travelToken(state.current, mine, theirs), travelToken(target, theirs, mine)]);
    player.pos = theirs;
    other.pos = mine;
    animating = false;
    turnBusy = false;
    saveState();
    renderAll();
  }

  function refundPower(kind) {
    const player = state.players[state.current];
    const { cost } = POWERS[kind];
    if (kind === 'freeze') {
      state.players[armedThisTurn.freeze].skipNext = false;
      armedThisTurn.freeze = null;
    } else {
      player[kind] = kind === 'loaded' ? 0 : false;
      armedThisTurn[kind] = false;
    }
    player.love += cost;
    logMessage(t('log.cancel', { name: player.name, power: powerName(kind), cost }));
    soundStep();
    saveState();
    renderAll();
  }

  function openPowers() {
    if (!canUsePowers() || !modalsClosed()) return;
    pickingPower = null;
    $('powers-modal').classList.remove('hidden');
    renderAll();
  }

  function closePowers() {
    pickingPower = null;
    $('powers-modal').classList.add('hidden');
    renderAll();
  }

  // What's wrong with landing on `target`, if anything worth spending a
  // re-roll on. A snake that a shield will block doesn't count.
  function rollTrouble(player, target) {
    if (target > 100) return { kind: 'overshoot' };
    if (target === 100) return null;
    const snake = ladderSnakeHops(target).find((hop) => hop.type === 'snake');
    if (snake && !player.shield) return { kind: 'snake', from: snake.from, to: snake.to };
    return null;
  }

  let rerollChoice = null;

  function offerReroll(player, roll, bonus, trouble) {
    const thrown = bonus ? t('boostedRoll', { roll, bonus }) : `${roll}`;
    if (trouble.kind === 'snake') {
      $('reroll-title').textContent = t('snakeAhead');
      $('reroll-body').textContent = t('snakeAheadBody', { roll: thrown, from: trouble.from, to: trouble.to });
      $('reroll-no-btn').textContent = t('takeSnake');
    } else {
      $('reroll-title').textContent = t('tooFar');
      $('reroll-body').textContent = t('tooFarBody', { roll: thrown, n: 100 - player.pos });
      $('reroll-no-btn').textContent = t('stayPut');
    }
    $('reroll-modal').classList.remove('hidden');
    return new Promise((resolve) => {
      rerollChoice = resolve;
    });
  }

  function closeReroll(accepted) {
    if (!rerollChoice) return;
    $('reroll-modal').classList.add('hidden');
    const resolve = rerollChoice;
    rerollChoice = null;
    resolve(accepted);
  }

  function ladderSnakeHops(startPos) {
    const hops = [];
    let pos = startPos;
    let guard = 0;
    while (guard++ < 20) {
      if (state.ladders[pos] != null) {
        hops.push({ from: pos, to: state.ladders[pos], type: 'ladder' });
        pos = state.ladders[pos];
      } else if (state.snakes[pos] != null) {
        hops.push({ from: pos, to: state.snakes[pos], type: 'snake' });
        pos = state.snakes[pos];
      } else {
        break;
      }
    }
    return hops;
  }

  async function movePlayerTo(playerIndex, landedOn) {
    const player = state.players[playerIndex];
    await walkToken(playerIndex, player.pos, landedOn);
    player.pos = landedOn;

    for (const hop of ladderSnakeHops(landedOn)) {
      if (hop.type === 'snake' && player.shield) {
        // The shield is spent and the slide never happens — the pawn stays on
        // the snake's head, and nothing further down the chain applies.
        player.shield = false;
        logMessage(t('log.shieldStop', { name: player.name, n: hop.from }));
        soundLadder();
        break;
      }
      logMessage(hop.type === 'ladder' ? `🪜 ${hop.from} → ${hop.to}` : `🐍 ${hop.from} → ${hop.to}`);
      if (hop.type === 'ladder') soundLadder();
      else soundSnake();
      await travelToken(playerIndex, hop.from, hop.to);
      player.pos = hop.to;
    }

    flashCell(player.pos);
  }

  async function handleRoll(firstRoll, loaded) {
    const player = state.players[state.current];
    let roll = firstRoll;
    // A boost is spent on this roll whatever happens next, and still applies
    // if the player re-rolls.
    const bonus = player.boost ? POWERS.boost.steps : 0;
    player.boost = false;
    logMessage(`🎲 ${player.name}: ${roll}${loaded ? t('log.loaded') : ''}${bonus ? ` +${bonus}` : ''}`);
    let target = player.pos + roll + bonus;

    // No re-roll offer on a loaded die: that roll was chosen, not dealt.
    const trouble = loaded ? null : rollTrouble(player, target);
    if (trouble && player.love >= POWERS.reroll.cost) {
      animating = false;
      renderAll();
      if (await offerReroll(player, roll, bonus, trouble)) {
        player.love -= POWERS.reroll.cost;
        logMessage(t('log.rerolled', { name: player.name, cost: POWERS.reroll.cost }));
        animating = true;
        renderAll();
        roll = 1 + Math.floor(Math.random() * 6);
        state.lastRoll = roll;
        soundDice();
        await animateDice(roll);
        logMessage(`🎲 ${player.name}: ${roll}${bonus ? ` +${bonus}` : ''}`);
        target = player.pos + roll + bonus;
      }
      animating = true;
    }

    if (target > 100) {
      logMessage(t('log.needs', { name: player.name, n: 100 - player.pos }));
      animating = false;
      turnBusy = false;
      saveState();
      renderAll();
      advanceTurn();
      return;
    }

    await movePlayerTo(state.current, target);
    animating = false;
    saveState();
    renderAll();

    if (player.pos === 100) {
      turnBusy = false;
      endGame(state.current);
      return;
    }

    // turnBusy stays true across this pause. It is the whole reason the beat
    // is safe: the pawn has stopped, so `animating` is already false, but no
    // modal is up yet either — which used to leave ~900ms where both of
    // rollDice()'s other guards were open and a second roll went straight
    // through, moving the same player twice and skipping their question.
    await sleep(LANDING_PAUSE_MS);
    openTileContent();
    // A modal is now up, so modalsClosed() takes over the lock from here.
    turnBusy = false;
  }

  // Content is decided at landing time, so the board gives nothing away and
  // the same square never repeats itself. Ladder feet and snake heads are
  // never a resting position, so they are the only squares without content.
  function openTileContent() {
    if (Math.random() < BOARD_SETUP.surpriseChance) {
      openSurpriseModal();
    } else {
      openQuestionModal();
    }
  }

  function advanceTurn() {
    state.current = (state.current + 1) % playerCount();
    let guard = 0;
    while (state.players[state.current].skipNext && guard < playerCount()) {
      state.players[state.current].skipNext = false;
      logMessage(t('log.skipped', { name: state.players[state.current].name }));
      state.current = (state.current + 1) % playerCount();
      guard++;
    }
    saveState();
    renderAll();
  }

  // ---------- Questions ----------
  function pickUnused(pool, usedList) {
    if (usedList.length >= pool.length) usedList.length = 0;
    let idx;
    do {
      idx = Math.floor(Math.random() * pool.length);
    } while (usedList.includes(idx) && usedList.length < pool.length);
    usedList.push(idx);
    return pool[idx];
  }

  function openQuestionModal() {
    $('answer-input').value = '';
    $('question-modal').classList.remove('hidden');
    soundCardOpen();
    drawQuestion();
  }

  function setQuestionButtonsDisabled(disabled) {
    ['question-answered-btn', 'question-another-btn', 'question-skip-btn'].forEach((id) => {
      $(id).disabled = disabled;
    });
  }

  function setQuestionBadge(themeKey, isAi) {
    const badge = $('question-theme-badge');
    badge.innerHTML = '<span class="badge-swatch" aria-hidden="true"></span><span class="badge-label"></span>';
    badge.querySelector('.badge-label').textContent = themeLabel(themeKey);
    badge.style.setProperty('--tile-color', themeOf(themeKey).color);
    badge.classList.toggle('ai', isAi);
  }

  function applyQuestion(text, themeKey, isAi, index) {
    currentQuestion = { text, theme: themeKey, ai: isAi, index };
    setQuestionBadge(themeKey, isAi);

    const el = $('question-text');
    el.classList.remove('loading');
    el.textContent = text;
    el.classList.remove('question-swap');
    void el.offsetWidth;
    el.classList.add('question-swap');
  }

  function showQuestionLoading(themeKey) {
    setQuestionBadge(themeKey, true);
    const el = $('question-text');
    el.textContent = t('writingQuestion');
    el.classList.add('loading');
  }

  let questionLoadInFlight = false;

  // Every question tile re-enters here — including the 🔀 "Another question"
  // button. With AI configured, this generates a brand-new line from the
  // model for every single turn rather than pulling from the static bank —
  // but only a minority of turns (AI_PERSONALIZE_CHANCE) reference anything
  // you've actually answered. Most are fresh, theme-only prompts, so AI
  // questions read as varied rather than one long follow-up chain off
  // whatever was just said. The static bank is the fallback when there's no
  // key, the call fails, or the model's reply doesn't parse into anything
  // usable.
  const AI_PERSONALIZE_CHANCE = 0.35;

  async function drawQuestion() {
    if (questionLoadInFlight) return;
    questionLoadInFlight = true;
    setQuestionButtonsDisabled(true);

    try {
      const currentName = state.players[state.current].name;
      const canPersonalize = writtenAnswers().length > 0;
      const wantPersonalized = canPersonalize && Math.random() < AI_PERSONALIZE_CHANCE;

      const themeKey = state.themes[Math.floor(Math.random() * state.themes.length)];

      if (aiReady()) {
        showQuestionLoading(themeKey);
        try {
          const raw = await callLLM(buildLiveQuestionPrompt(themeKey, wantPersonalized, currentName));
          const line = parseSingleLine(raw);
          if (line) {
            applyQuestion(line, themeKey, true);
            saveState();
            return;
          }
          throw new Error('empty reply');
        } catch (error) {
          logMessage(t('log.aiFail', { error: error.message }));
        }
      }

      const used = state.usedQuestions[themeKey];
      const text = pickUnused(questionPool(themeKey), used);
      applyQuestion(text, themeKey, false, used[used.length - 1]);
      saveState();
    } finally {
      questionLoadInFlight = false;
      setQuestionButtonsDisabled(false);
    }
  }

  function closeQuestionModal(answered) {
    const player = state.players[state.current];
    const answer = $('answer-input').value.trim();

    // Every question that comes up is recorded, answered or not.
    state.answers.push({
      player: player.name,
      theme: currentQuestion.theme,
      question: currentQuestion.text,
      answer,
      answered,
      ai: currentQuestion.ai,
    });
    if (state.answers.length > 80) state.answers.shift();

    if (answered) {
      player.love += 2;
      logMessage(`💗 ${player.name} +2`);
      soundAnswer();
    } else {
      logMessage(t('log.skipped', { name: player.name }));
      soundSkip();
    }

    $('question-modal').classList.add('hidden');
    saveState();
    // The answer already has its own sound; the hearts it earns stay quiet.
    quietHearts = true;
    renderAll();
    quietHearts = false;
    advanceTurn();
  }

  // ---------- Surprises ----------
  function openSurpriseModal() {
    pendingSurprise = pickUnused(surprisePool(), state.usedSurprises);
    $('surprise-icon').textContent = pendingSurprise.icon;
    $('surprise-text').textContent = surpriseText(pendingSurprise);
    $('surprise-modal').classList.remove('hidden');
    soundSurprise(surpriseMood(pendingSurprise));
  }

  async function closeSurpriseModal() {
    $('surprise-modal').classList.add('hidden');
    const surprise = pendingSurprise;
    pendingSurprise = null;
    animating = true;
    const grantsExtraTurn = await applySurprise(surprise);
    animating = false;
    saveState();
    renderAll();

    if (state.finished) return;
    if (grantsExtraTurn) {
      renderAll();
    } else {
      advanceTurn();
    }
  }

  async function applySurprise(surprise) {
    const me = state.players[state.current];
    // With more than two players these pick a random rival each time.
    const oppIndex = randomOtherIndex();
    const opp = state.players[oppIndex];

    switch (surprise.type) {
      case 'swapPositions': {
        const myPos = me.pos;
        const theirPos = opp.pos;
        logMessage(`🔀 ${me.name} ⇄ ${opp.name}`);
        await Promise.all([
          travelToken(state.current, myPos, theirPos),
          travelToken(oppIndex, theirPos, myPos),
        ]);
        me.pos = theirPos;
        opp.pos = myPos;
        break;
      }
      case 'joinPartner': {
        if (me.pos !== opp.pos) {
          logMessage(`🧲 ${me.name} → ${opp.name} (${opp.pos})`);
          await travelToken(state.current, me.pos, opp.pos);
          me.pos = opp.pos;
        }
        break;
      }
      case 'moveSelf': {
        const newPos = Math.max(1, Math.min(100, me.pos + surprise.value));
        logMessage(`${surprise.value >= 0 ? '⬆️' : '⬇️'} ${me.name} → ${newPos}`);
        await movePlayerTo(state.current, newPos);
        if (me.pos === 100) {
          endGame(state.current);
          return false;
        }
        break;
      }
      case 'bothPoints': {
        state.players.forEach((player) => {
          player.love += surprise.value;
        });
        logMessage(t('log.everyone', { n: surprise.value }));
        break;
      }
      case 'skipTurn': {
        const target = surprise.target === 'opponent' ? opp : me;
        target.skipNext = true;
        logMessage(t('log.skipsNext', { name: target.name }));
        break;
      }
      case 'extraTurn': {
        logMessage(t('log.rollsAgain', { name: me.name }));
        return true;
      }
      case 'lovePoints': {
        const target = surprise.target === 'opponent' ? opp : me;
        target.love = Math.max(0, target.love + surprise.value);
        logMessage(`${surprise.value >= 0 ? '💞' : '💔'} ${target.name} ${surprise.value >= 0 ? '+' : ''}${surprise.value}`);
        break;
      }
      case 'action': {
        me.love += surprise.bonus;
        logMessage(`🥰 ${me.name} +${surprise.bonus}`);
        break;
      }
      case 'giftPoints': {
        const amt = Math.min(surprise.value, me.love);
        me.love -= amt;
        opp.love += amt;
        logMessage(`🎁 ${me.name} → ${opp.name} ${amt}`);
        break;
      }
      default:
        break;
    }
    return false;
  }

  // ---------- Win ----------
  function endGame(winnerIndex) {
    state.finished = true;
    state.winner = winnerIndex;
    soundWin();
    burstConfetti();
    saveState();
    renderAll();
    showWinModal(winnerIndex);
  }

  // Paper in the players' own colours. Plain DOM nodes driven by the Web
  // Animations API rather than a canvas: ninety elements for a couple of
  // seconds is cheap, and it needs no library — which matters here, since
  // every shipped file also has to be precached for offline play.
  function burstConfetti() {
    if (REDUCED_MOTION) return;
    const host = $('confetti');
    const colors = state.players.map((player) => player.color).concat(['#f6c445', '#ffffff']);

    for (let i = 0; i < 90; i++) {
      const bit = document.createElement('span');
      const width = 6 + Math.random() * 7;
      bit.style.background = colors[i % colors.length];
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.width = `${width}px`;
      bit.style.height = `${width * (0.55 + Math.random() * 0.9)}px`;
      if (Math.random() < 0.3) bit.style.borderRadius = '50%';
      host.appendChild(bit);

      const drift = (Math.random() - 0.5) * 280;
      const spin = 360 * (1 + Math.random() * 3) * (Math.random() < 0.5 ? -1 : 1);
      const remove = () => bit.remove();
      bit
        .animate(
          [
            { transform: 'translate3d(0, 0, 0) rotate(0deg)', opacity: 1 },
            {
              transform: `translate3d(${drift}px, 102vh, 0) rotate(${spin}deg)`,
              opacity: 1,
              offset: 0.86,
            },
            { transform: `translate3d(${drift}px, 110vh, 0) rotate(${spin}deg)`, opacity: 0 },
          ],
          {
            duration: 2600 + Math.random() * 2200,
            delay: Math.random() * 700,
            easing: 'cubic-bezier(0.2, 0.6, 0.5, 1)',
          }
        )
        .finished.then(remove, remove);
    }
  }

  function showWinModal(winnerIndex) {
    const winner = state.players[winnerIndex];
    $('win-text').textContent = t('wins', { name: winner.name });

    // A ranked list rather than one run-on line — with more than two players
    // the joined string was unreadable, and the winner didn't stand out in it.
    const summary = $('win-summary');
    summary.innerHTML = '';
    state.players
      .slice()
      .sort((a, b) => b.love - a.love)
      .forEach((player, i) => {
        const row = document.createElement('div');
        row.className = 'win-row';
        row.style.setProperty('--i', i);
        if (player === winner) row.classList.add('is-winner');
        row.innerHTML =
          '<span class="rank"></span><span class="win-swatch" aria-hidden="true"></span><span class="who"></span>' +
          `<span class="pts"><span class="pts-num"></span>${HEART_ICON}</span>`;
        row.querySelector('.rank').textContent = i + 1;
        row.style.setProperty('--player-color', player.color);
        row.querySelector('.who').textContent = player.name;
        row.querySelector('.pts-num').textContent = player.love;
        summary.appendChild(row);
      });

    $('win-modal').classList.remove('hidden');
  }

  function playAgain() {
    const setups = state.players.map((p) => ({ name: p.name, color: p.color }));
    // Keeps the mode this game was started in, rather than whatever the setup
    // screen was last left on.
    state = freshState(setups, state.themes, state.mode);
    logMessage(`🎉 ${setups.map((p) => p.name).join(' · ')}`);
    saveState();
    $('win-modal').classList.add('hidden');
    buildBoard();
    renderAll();
  }

  function newPlayers() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    state = null;
    $('win-modal').classList.add('hidden');
    initRoster();
    showSetupScreen();
  }

  // ---------- Confirm ----------
  // Replaces window.confirm for the one destructive action in the game. The
  // native dialog was the only piece of OS chrome in an app that otherwise
  // draws its own surface — and installed as a PWA it announces the origin in
  // its title, which reads like a browser warning rather than a game asking.
  let confirmAction = null;

  function askConfirm(title, body, confirmLabel, onYes) {
    $('confirm-title').textContent = title;
    $('confirm-body').textContent = body;
    $('confirm-yes-btn').textContent = confirmLabel;
    confirmAction = onYes;
    $('confirm-modal').classList.remove('hidden');
  }

  function closeConfirm() {
    $('confirm-modal').classList.add('hidden');
    confirmAction = null;
    renderAll();
  }

  // ---------- LLM connection ----------
  const LLM_PROVIDERS = {
    // One key, many models (Claude, GPT, Gemini…). Listed first because it's
    // the easiest single key to get, and it's the default for a fresh setup.
    openrouter: {
      label: 'OpenRouter',
      defaultModel: 'anthropic/claude-sonnet-5',
      url: () => 'https://openrouter.ai/api/v1/chat/completions',
      headers: (key) => ({
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        // Shows up as the app name on the key owner's OpenRouter activity page.
        'x-title': 'Snakes & Ladders',
      }),
      body: (model, prompt) => ({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
      extract: (data) => {
        if (data.error) throw new Error(data.error.message || 'OpenRouter error');
        return data.choices[0].message.content;
      },
    },
    claude: {
      label: 'Claude',
      defaultModel: 'claude-opus-5',
      url: (model, key) => 'https://api.anthropic.com/v1/messages',
      headers: (key) => ({
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Required for calling the API straight from a browser page.
        'anthropic-dangerous-direct-browser-access': 'true',
      }),
      body: (model, prompt) => ({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
      extract: (data) => {
        if (data.stop_reason === 'refusal') throw new Error('Model declined this request');
        return (data.content || [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
      },
    },
    openai: {
      label: 'OpenAI',
      defaultModel: 'gpt-4o-mini',
      url: () => 'https://api.openai.com/v1/chat/completions',
      headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
      body: (model, prompt) => ({
        model,
        max_completion_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
      extract: (data) => data.choices[0].message.content,
    },
    gemini: {
      label: 'Gemini',
      defaultModel: 'gemini-2.0-flash',
      // Key goes in the x-goog-api-key header, NOT the ?key= query param
      // Google's docs also show. A secret in a URL leaks everywhere URLs
      // go — Referer headers on any cross-origin subresource, the browser's
      // own history, and any proxy or error log in between. A header goes
      // only to the host it's addressed to.
      url: (model) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: (key) => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
      body: (model, prompt) => ({ contents: [{ parts: [{ text: prompt }] }] }),
      extract: (data) => data.candidates[0].content.parts.map((p) => p.text).join('\n'),
    },
  };

  function aiReady() {
    return Boolean(aiConfig && aiConfig.key && LLM_PROVIDERS[aiConfig.provider]);
  }

  function activeModel() {
    const provider = LLM_PROVIDERS[aiConfig.provider];
    return aiConfig.model || provider.defaultModel;
  }

  async function callLLM(prompt) {
    const provider = LLM_PROVIDERS[aiConfig.provider];
    const model = activeModel();

    const response = await fetch(provider.url(model, aiConfig.key), {
      method: 'POST',
      headers: provider.headers(aiConfig.key),
      body: JSON.stringify(provider.body(model, prompt)),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${response.status}: ${detail.slice(0, 160)}`);
    }
    return provider.extract(await response.json());
  }

  // A hedge against the model chaining two questions onto one line despite
  // being told not to ("What's your favorite trip? Also, where next?"). This
  // guarantees only the first one ever reaches the screen, even when the
  // prompt gets ignored — it's the mechanical backstop, not the primary fix
  // (that's the wording in buildLiveQuestionPrompt below). Every question the
  // game shows is meant to stand alone, with nothing chained after it — dare
  // lines have no "?" at all, so they pass through untouched.
  function firstQuestionOnly(line) {
    const firstMark = line.indexOf('?');
    if (firstMark === -1 || firstMark === line.length - 1) return line;
    return line.slice(0, firstMark + 1);
  }

  // For a single-line reply. Dare-theme lines are instructions, not
  // questions, so this can't require a "?" outright. Instead: prefer
  // whichever line HAS one (real content, not a "Sure, here you go:"
  // preamble the model added despite instructions); with no "?" anywhere (a
  // dare), fall back to the longest line, since a stray preamble is reliably
  // shorter than the actual instruction.
  function parseSingleLine(raw) {
    const stripQuotes = (s) => s.replace(/^["'“‘]+/, '').replace(/["'”’]+$/, '');
    const lines = raw
      .split('\n')
      .map((l) => firstQuestionOnly(stripQuotes(l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())).trim())
      .filter((l) => l.length > 8 && l.length < 220);

    if (!lines.length) return '';
    return lines.find((l) => l.includes('?')) || lines.reduce((a, b) => (b.length > a.length ? b : a));
  }

  const writtenAnswers = () => state.answers.filter((entry) => entry.answer);

  // How every generated line should sound, per interface language. The rest
  // of the prompt stays in English (models follow English instructions most
  // reliably); this line decides the language and register of the output.
  const AI_VOICE = {
    en:
      'Write it in casual, natural English — the way a friend would ask it over coffee. ' +
      'Contractions are good. No therapist-speak, no survey phrasing, nothing stiff.',
    // The same brief the static Indonesian bank was written to.
    id:
      'Write it in everyday spoken Indonesian, following this brief exactly: "Tulis pakai bahasa Indonesia ' +
      'yang santai, asyik dibaca, dan nggak kaku, kayak lagi ngobrol sama teman." Use "kamu", never "Anda"; ' +
      'casual forms like "nggak", "udah", "aja", "banget", "bareng", "gimana" and -in verbs (ceritain, ' +
      'sebutin) are welcome. No formal or textbook phrasing, and no English translation.',
  };

  // Whole-word, case-insensitive: does this text name this player? Used by
  // personalization to decide whether a fresh question should stay scoped to
  // whoever answered, or cross over to whoever they actually brought up.
  // Regex-escaped since a name is free text a player typed in on setup, not
  // a pattern.
  function mentionsPlayer(text, name) {
    const trimmed = (name || '').trim();
    if (!text || !trimmed) return false;

    // \b only recognises ASCII word characters, so it can't anchor a name
    // that starts or ends with anything else — an emoji, most punctuation.
    // Tested and confirmed: that doesn't throw, it just silently fails to
    // match at all, which a try/catch around the regex would never catch.
    // Those names fall back to a plain substring check instead.
    const edgeSafe = /^[\w'-]/.test(trimmed) && /[\w'-]$/.test(trimmed);
    if (edgeSafe) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }
    return text.toLowerCase().includes(trimmed.toLowerCase());
  }

  // One fresh line for a single theme, generated live for this turn.
  // `personalize` false (the common case) means a clean theme-only prompt
  // with no reference to prior answers, for real variety. `personalize` true
  // weaves in 1-2 sampled answers — but the pool stays with `forName`: their
  // OWN past answers, plus anything anyone else said that actually named
  // them. That's what keeps a callback about someone from landing on a
  // player it has nothing to do with; it only crosses over when the earlier
  // answer itself brought that player up. Told what's already been used for
  // this theme so it doesn't repeat.
  function buildLiveQuestionPrompt(themeKey, personalize, forName) {
    const mode = MODES[activeMode()] || MODES.couples;
    const isDare = themeKey === 'dare';

    const pool = personalize
      ? writtenAnswers().filter((e) => e.player === forName || mentionsPlayer(e.answer, forName))
      : [];
    const sample = shuffle(pool.slice()).slice(0, 2);
    const context = sample
      .map((e) => `${e.player} was asked "${e.question}" and answered: "${e.answer}"`)
      .join('\n');

    const usedBefore = state.answers
      .filter((e) => e.theme === themeKey)
      .slice(-8)
      .map((e) => `"${e.question}"`)
      .join(', ');

    return [
      mode.subject,
      // Empty in Couples mode, so .filter(Boolean) drops the line entirely.
      mode.guard,
      `Write ONE new line for this game's "${themeLabelEn(themeKey)}" theme, for ${forName} to answer. Address ${forName} as "you".`,
      AI_VOICE[lang] || AI_VOICE.en,
      // The naming rule only matters once there's someone else in the prompt
      // to get confused with — a fresh, standalone question never mentions
      // anyone, so there's nothing for "I"/"you" to misattribute.
      context
        ? `Something they said earlier this game — weave it in if it fits naturally. Use real names for ` +
          `anyone besides ${forName} — never "I" or "you" for them, only for ${forName}:\n${context}`
        : "Write a fresh, standalone prompt for this theme. Don't reference or assume any prior answers.",
      usedBefore ? `Already used for this theme — do not repeat or closely rephrase: ${usedBefore}` : '',
      isDare
        ? `This theme is a short playful action for ${forName} to do right now, not a question. One action only — never chain two actions with "and" or "then". Under 20 words.`
        : 'Ask ONE thing, in plain language, under 18 words. Never chain two questions together with "and", "or", a comma, or a second question mark — if you\'re tempted to ask two things, keep only the better one.',
      'Output ONLY that single line. No numbering, no quotes, no preamble, no commentary.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------- AI settings ----------
  function renderAiModal() {
    const container = $('ai-providers');
    container.innerHTML = '';
    Object.entries(LLM_PROVIDERS).forEach(([key, provider]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.provider = key;
      btn.textContent = provider.label;
      btn.classList.toggle('selected', aiConfig.provider === key);
      btn.addEventListener('click', () => {
        aiConfig.provider = key;
        $('ai-model').placeholder = provider.defaultModel;
        renderAiModal();
      });
      container.appendChild(btn);
    });

    $('ai-key').value = aiConfig.key || '';
    $('ai-model').value = aiConfig.model || '';
    $('ai-model').placeholder = LLM_PROVIDERS[aiConfig.provider].defaultModel;
  }

  function openAiModal() {
    renderAiModal();
    $('ai-test-status').textContent = '';
    $('ai-test-status').classList.remove('error');
    $('ai-modal').classList.remove('hidden');
  }

  async function saveAndTestAi() {
    aiConfig.key = $('ai-key').value.trim();
    aiConfig.model = $('ai-model').value.trim();
    saveAiConfig();

    const status = $('ai-test-status');
    if (!aiConfig.key) {
      status.textContent = t('aiNeedKey');
      status.classList.add('error');
      return;
    }

    status.classList.remove('error');
    status.textContent = t('aiTesting');
    try {
      const raw = await callLLM(
        'Write one short question two people could ask each other to get to know each other better. ' +
          `${AI_VOICE[lang] || AI_VOICE.en} Output only the question.`
      );
      status.textContent = `✅ ${raw.trim().slice(0, 90)}`;
    } catch (error) {
      status.textContent = `❌ ${error.message}`;
      status.classList.add('error');
    }
  }

  // ---------- Init ----------
  function applyAnimationSpeeds() {
    const root = document.documentElement.style;
    root.setProperty('--dice-ms', `${DICE_MS}ms`);
    root.setProperty('--step-ms', `${STEP_MS}ms`);
    root.setProperty('--travel-ms', `${TRAVEL_MS}ms`);
  }

  // Registered after load so it never delays first paint, and guarded since
  // an unsupported browser (or a plain file:// open with no server) should
  // just play the game without offline support rather than error.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline install just isn't available here — game still works */
      });
    });
  }

  // ---------- Install (PWA) ----------
  // There was no install affordance at all before this, which is why the app
  // looked "not installable": Chrome stopped showing an automatic install
  // popup years ago — it fires beforeinstallprompt and leaves it to the page
  // to ask. Without a call to prompt(), the only entry point is a menu item
  // most people never open. iOS is worse: Safari never fires the event and
  // exposes no install API whatsoever, so the only honest thing to offer
  // there is instructions.
  let installPrompt = null;

  function isIos() {
    // iPadOS 13+ reports itself as a Mac, so the touch check is what
    // separates an iPad from a desktop Safari that genuinely can install.
    return (
      /iphone|ipod|ipad/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !/android/i.test(navigator.userAgent))
    );
  }

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's own non-standard flag — it doesn't set display-mode.
      navigator.standalone === true
    );
  }

  function initInstall() {
    const btn = $('install-btn');
    if (!btn) return;

    // Already installed and running from the home screen: offering "Install"
    // again is noise.
    if (isStandalone()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      // Cancelling this event is exactly what stops Chrome showing its own
      // install prompt (the one with the app's name and icon), and it was the
      // reason nothing appeared on Android until the player found the link
      // below. So on Android the event is left alone and Chrome does the
      // asking. Elsewhere it's held back, so the link is the one entry point
      // (desktop Chrome shows no prompt of its own anyway).
      if (!/android/i.test(navigator.userAgent)) e.preventDefault();
      // Kept either way for the link. It's single-use and only works from a
      // real user gesture.
      installPrompt = e;
      btn.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      btn.classList.add('hidden');
    });

    if (isIos()) {
      // No event is coming, so show it immediately — the click just explains
      // the manual route.
      btn.classList.remove('hidden');
    }

    btn.addEventListener('click', async () => {
      if (installPrompt) {
        const event = installPrompt;
        // Consumed either way: a dismissed prompt can't be re-shown with the
        // same event, and Chrome fires a fresh one if the user comes back.
        installPrompt = null;
        try {
          event.prompt();
          await event.userChoice;
          btn.classList.add('hidden');
          return;
        } catch (err) {
          // Chrome refused (the event was left uncancelled on Android, and
          // that's not something the spec promises prompt() will accept), so
          // fall through to telling the player where the button is.
        }
      }
      // Name the actual device — an iPad user told to look on their "iPhone"
      // reasonably wonders whether these are the right instructions at all.
      const ipad = isIos() && !/iphone|ipod/i.test(navigator.userAgent);
      $('install-title').textContent = t(ipad ? 'installIpad' : isIos() ? 'installIphone' : 'installThis');
      // The steps in the markup are iOS's. Anywhere else the way in is the
      // browser's own menu.
      $('install-lead').textContent = t(isIos() ? 'installLeadIos' : 'installLeadOther');
      $('install-steps').classList.toggle('hidden', !isIos());
      $('install-note').textContent = isIos() ? '' : t('installNote');
      $('install-modal').classList.remove('hidden');
    });

    $('install-close-btn').addEventListener('click', () => $('install-modal').classList.add('hidden'));
    $('install-modal').addEventListener('click', (e) => {
      if (e.target === $('install-modal')) $('install-modal').classList.add('hidden');
    });
  }

  function init() {
    applyAnimationSpeeds();
    registerServiceWorker();
    initInstall();
    aiConfig = loadAiConfig();
    // A saved key from before OpenRouter existed may name a provider that's
    // since been renamed; fall back rather than crash on a missing entry.
    if (!LLM_PROVIDERS[aiConfig.provider]) aiConfig.provider = 'openrouter';
    loadLanguage();
    loadMode();
    loadScenePref();
    initRoster();
    renderModeChoice();
    initThemeChips();
    initScenePicker();
    applyLanguage();
    buildDice();
    $('lang-btn').addEventListener('click', () => setLanguage(nextLanguage()));

    initParallax();
    initResize();
    loadSoundMode();
    syncSoundButtons();
    document.querySelectorAll('.sound-toggle').forEach((btn) => btn.addEventListener('click', cycleSound));
    // Audio may only start from a gesture; the first one anywhere unlocks it.
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      unlockAudio();
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // Nothing plays to a hidden tab: the ambience stops and the context sleeps.
    document.addEventListener('visibilitychange', () => {
      if (!audioCtx) return;
      if (document.hidden) {
        updateAmbience();
        audioCtx.suspend();
      } else if (soundOn()) {
        audioCtx.resume();
        updateAmbience();
      }
    });

    $('add-player-btn').addEventListener('click', addPlayer);
    $('start-btn').addEventListener('click', startGame);
    $('roll-btn').addEventListener('click', rollDice);

    $('reroll-yes-btn').querySelector('.power-cost-num').textContent = POWERS.reroll.cost;
    $('powers-btn').addEventListener('click', openPowers);
    $('powers-done-btn').addEventListener('click', closePowers);
    $('reroll-yes-btn').addEventListener('click', () => closeReroll(true));
    $('reroll-no-btn').addEventListener('click', () => closeReroll(false));
    $('new-game-btn').addEventListener('click', () =>
      askConfirm(t('confirmTitle'), t('confirmBody'), t('startOver'), newPlayers)
    );
    $('confirm-yes-btn').addEventListener('click', () => {
      const action = confirmAction;
      closeConfirm();
      if (action) action();
    });
    $('confirm-no-btn').addEventListener('click', closeConfirm);

    $('question-answered-btn').addEventListener('click', () => closeQuestionModal(true));
    $('question-another-btn').addEventListener('click', () => {
      soundShuffle();
      drawQuestion();
    });
    $('question-skip-btn').addEventListener('click', () => closeQuestionModal(false));
    $('surprise-ok-btn').addEventListener('click', closeSurpriseModal);
    $('play-again-btn').addEventListener('click', playAgain);
    $('new-players-btn').addEventListener('click', newPlayers);
    // Play again/New players both wipe state.answers immediately, so this has
    // to be the last chance to grab the transcript — same downloadAnswers()
    // the in-game history drawer uses.
    $('win-download-btn').addEventListener('click', downloadAnswers);

    $('log-btn').addEventListener('click', () => {
      renderLog();
      $('log-drawer').classList.remove('hidden');
    });
    $('log-close-btn').addEventListener('click', () => $('log-drawer').classList.add('hidden'));
    $('log-download-btn').addEventListener('click', downloadAnswers);
    $('log-drawer').addEventListener('click', (e) => {
      if (e.target === $('log-drawer')) $('log-drawer').classList.add('hidden');
    });

    // Tapping the dimmed area outside a dismissible panel closes it, the way
    // the history drawer already did. Only the panels with a real "never mind"
    // — the question, surprise and win cards all need a decision.
    [
      ['ai-modal', () => $('ai-modal').classList.add('hidden')],
      ['powers-modal', closePowers],
      ['confirm-modal', closeConfirm],
    ].forEach(([id, close]) => {
      $(id).addEventListener('click', (e) => {
        if (e.target === $(id)) close();
      });
    });

    // Space or Enter rolls, so a desktop turn doesn't need the mouse at all.
    // Ignored while typing an answer, or while a button already has focus and
    // is about to receive the same key itself.
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
      if ($('game-screen').classList.contains('hidden')) return;
      e.preventDefault();
      rollDice();
    });

    $('ai-btn').addEventListener('click', openAiModal);
    $('setup-ai-btn').addEventListener('click', openAiModal);
    $('ai-save-btn').addEventListener('click', saveAndTestAi);
    $('ai-close-btn').addEventListener('click', () => $('ai-modal').classList.add('hidden'));
    $('ai-clear-btn').addEventListener('click', () => {
      aiConfig = { provider: aiConfig.provider, key: '', model: '' };
      saveAiConfig();
      renderAiModal();
      $('ai-test-status').textContent = t('aiCleared');
    });

    const restored = loadState();
    if (restored) {
      state = restored;
      // A game saved before scenery existed has no theme — give it one rather
      // than silently falling back to the default, which looks like nothing
      // changed at all.
      if (!BOARD_THEMES[state.boardTheme]) {
        state.boardTheme = takeBoardTheme();
        saveState();
      }
      // A game saved before modes existed is a couples game. Its used-content
      // lists hold indexes into the old flat arrays, which no longer line up
      // with the per-mode pools — clearing them only costs an earlier repeat.
      if (!MODES[state.mode]) {
        state.mode = 'couples';
        state.usedSurprises = [];
        Object.keys(state.usedQuestions || {}).forEach((key) => {
          state.usedQuestions[key] = [];
        });
        saveState();
      }
      showGameScreen();
      showDiceFace(state.lastRoll || 1, false);
      if (state.finished && typeof state.winner === 'number') showWinModal(state.winner);
    } else {
      showSetupScreen();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
