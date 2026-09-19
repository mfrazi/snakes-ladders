(function () {
  'use strict';

  // Bump when shipping changes — lets you confirm the browser isn't serving a
  // stale cached copy (check the console line on startup).
  const BUILD = '2026-09-20b';

  const STORAGE_KEY = 'snakeLoveGame_v5';
  const AI_KEY = 'snakeLoveAI_v1';
  const SOUND_KEY = 'snakeLoveSound_v1';
  const MODE_KEY = 'snakeLoveMode_v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Kept comfortably longer than MAX_PLAYERS so there is always a free option
  // to cycle to — every player must end up visually distinct.
  const EMOJI_CHOICES = ['🐱', '🐶', '🐰', '🦊', '🐼', '🐨', '🐻', '🐷', '🐸', '🦁', '🐯', '🐵'];
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
    shield: { cost: 4, name: 'Shield', icon: 'i-shield', desc: 'Your next snake can’t drop you.' },
    boost: { cost: 4, steps: 3, name: 'Boost +3', icon: 'i-bolt', desc: 'Adds 3 to your next roll.' },
    freeze: { cost: 5, name: 'Freeze', icon: 'i-snow', desc: 'A rival skips their next turn.', target: true },
    rewind: { cost: 6, name: 'Rewind', icon: 'i-history', desc: 'Move a rival back 5 squares.', target: true },
    heist: { cost: 8, take: 4, name: 'Heist', icon: 'i-mask', desc: 'Steal up to 4 hearts from a rival.', target: true },
    loaded: { cost: 8, name: 'Loaded die', icon: 'i-dice', desc: 'Choose what your next roll shows.', pick: true },
    charm: { cost: 13, name: 'Snake charmer', icon: 'i-charm', desc: 'Remove a snake ahead of you for good.', target: true },
    swap: { cost: 20, name: 'Swap places', icon: 'i-swap', desc: 'Trade squares with a rival, right now.', target: true },
  };
  // Ascending cost, so a new power slots in where its price puts it.
  const SHOP = ['shield', 'boost', 'freeze', 'rewind', 'heist', 'loaded', 'charm', 'swap'];
  // A steal is capped by the price (8 for at most 4), so a thief always loses
  // hearts by stealing and can't farm a rival. It also needs something worth
  // taking — stealing one heart for eight is never a real choice.
  const HEIST_MIN = 3;

  const $ = (id) => document.getElementById(id);
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
      return JSON.parse(localStorage.getItem(AI_KEY)) || { provider: 'claude', key: '', model: '' };
    } catch (e) {
      return { provider: 'claude', key: '', model: '' };
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

  const themeOf = (key) => QUESTION_THEMES[key] || QUESTION_THEMES.general;

  function themeLabel(key) {
    const theme = themeOf(key);
    return (activeMode() === 'friends' && theme.friendsLabel) || theme.label;
  }

  // A theme's pool is its shared questions plus the ones written for the mode
  // in play. pickUnused() records indexes into this, which is safe because the
  // composition can't change mid-game — mode is fixed when the game starts.
  function questionPool(themeKey) {
    const entry = QUESTIONS[themeKey] || {};
    return (entry.shared || []).concat(entry[activeMode()] || []);
  }

  // Cards carrying `only` drop out of the other mode. This is what keeps the
  // romantic surprises out of a game between friends.
  function surprisePool() {
    const mode = activeMode();
    return SURPRISES.filter((surprise) => !surprise.only || surprise.only === mode);
  }

  const surpriseText = (surprise) =>
    (activeMode() === 'friends' && surprise.friends) || surprise.text;

  // ---------- New game ----------
  function freshState(playerSetups, themes, mode) {
    const usedQuestions = {};
    Object.keys(QUESTION_THEMES).forEach((key) => {
      usedQuestions[key] = [];
    });

    return {
      players: playerSetups.map((p) => ({
        name: p.name,
        emoji: p.emoji,
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
  // Everything is synthesised with Web Audio, so there are no asset files and
  // nothing to load. The context is created on the first roll, which is a real
  // user gesture — browsers block audio started any other way.
  let audioCtx = null;
  let soundOn = true;

  function ensureAudio() {
    if (!soundOn) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function blip(ctx, { freq, endFreq, type = 'sine', start = 0, duration = 0.12, gain = 0.12 }) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function noiseBurst(ctx, { start = 0, duration = 0.06, gain = 0.1, freq = 1800 }) {
    const t0 = ctx.currentTime + start;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t0);
  }

  // Dice clatter that thins out as the die slows, then a landing thud.
  function soundDice() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const rollTime = DICE_MS / 1000;
    const clatters = Math.max(6, Math.round(rollTime * 9));
    for (let i = 0; i < clatters; i++) {
      const at = (i / clatters) ** 1.5 * rollTime * 0.85;
      noiseBurst(ctx, { start: at, duration: 0.05, gain: 0.07, freq: 900 + Math.random() * 1700 });
    }
    noiseBurst(ctx, { start: rollTime * 0.9, duration: 0.18, gain: 0.13, freq: 240 });
    blip(ctx, { freq: 190, endFreq: 90, type: 'triangle', start: rollTime * 0.9, duration: 0.22, gain: 0.11 });
  }

  function soundStep() {
    const ctx = ensureAudio();
    if (!ctx) return;
    blip(ctx, { freq: 520, endFreq: 780, type: 'triangle', duration: 0.09, gain: 0.09 });
  }

  function soundLadder() {
    const ctx = ensureAudio();
    if (!ctx) return;
    [0, 1, 2, 3, 4].forEach((i) =>
      blip(ctx, { freq: 392 + i * 108, type: 'sine', start: i * 0.1, duration: 0.15, gain: 0.09 })
    );
  }

  function soundSnake() {
    const ctx = ensureAudio();
    if (!ctx) return;
    blip(ctx, { freq: 720, endFreq: 150, type: 'sawtooth', duration: 0.75, gain: 0.06 });
  }

  function soundWin() {
    const ctx = ensureAudio();
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((freq, i) =>
      blip(ctx, { freq, type: 'triangle', start: i * 0.13, duration: 0.32, gain: 0.12 })
    );
  }

  function setSound(on) {
    soundOn = on;
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch (e) {
      /* storage unavailable */
    }
    const icon = $('sound-icon');
    if (icon) icon.setAttribute('href', on ? '#i-sound-on' : '#i-sound-off');
  }

  // ---------- Board theme ----------
  // Chosen ahead of time so the setup screen already shows the scene the next
  // game will be played in, instead of the scenery only appearing after Start.
  let pendingBoardTheme = null;

  function randomBoardTheme(avoid) {
    const keys = Object.keys(BOARD_THEMES).filter((key) => key !== avoid);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  function takeBoardTheme() {
    const chosen = pendingBoardTheme || randomBoardTheme();
    pendingBoardTheme = randomBoardTheme(chosen);
    return chosen;
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

    // Installed as a PWA, this tints the OS status bar / title bar to match
    // whichever scene is live, same as everything else in the app already does.
    const meta = $('theme-color-meta');
    if (meta) meta.setAttribute('content', theme.accent);
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

    const board = document.querySelector('.board-texture');
    if (board) {
      board.style.setProperty('--cell-texture', url(theme.cellTexture));
      board.style.setProperty('--cell-tex-size', theme.cellTextureSize);
      run(board, oneTile(theme.cellTextureSize), theme.boardDriftDuration);
    }

    const boardPhoto = document.querySelector('.board-photo');
    if (boardPhoto) {
      boardPhoto.style.setProperty('--board-photo', `url("${theme.photo}")`);
      boardPhoto.style.setProperty('--board-photo-size', theme.photoBoardSize);
      boardPhoto.style.setProperty('--board-photo-opacity', theme.photoBoardOpacity);
      run(
        boardPhoto,
        oneTile(`${theme.photoBoardSize} ${theme.photoBoardSize}`),
        theme.boardDriftDuration
      );
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

  const takenBy = (key, exclude) =>
    roster.filter((player) => player !== exclude).map((player) => player[key]);

  const firstFree = (choices, taken) => choices.find((choice) => !taken.includes(choice));

  // Steps to the next option nobody else is using, so two players can never
  // share an emoji or a colour.
  function nextFree(choices, current, taken) {
    const start = choices.indexOf(current);
    for (let step = 1; step <= choices.length; step++) {
      const candidate = choices[(start + step) % choices.length];
      if (!taken.includes(candidate)) return candidate;
    }
    return current;
  }

  function defaultPlayer() {
    return {
      name: '',
      emoji: firstFree(EMOJI_CHOICES, takenBy('emoji')),
      color: firstFree(COLOR_CHOICES, takenBy('color')),
    };
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

      const num = document.createElement('span');
      num.className = 'player-num';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(index + 1).padStart(2, '0');
      row.appendChild(num);

      const emojiBtn = document.createElement('button');
      emojiBtn.type = 'button';
      emojiBtn.className = 'chip-btn';
      emojiBtn.textContent = player.emoji;
      emojiBtn.title = 'Tap to change';
      emojiBtn.setAttribute('aria-label', `Change face for player ${index + 1}`);
      emojiBtn.addEventListener('click', () => {
        player.emoji = nextFree(EMOJI_CHOICES, player.emoji, takenBy('emoji', player));
        emojiBtn.textContent = player.emoji;
        pulse(emojiBtn, 'cycled');
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = `Player ${index + 1}`;
      input.setAttribute('aria-label', `Player ${index + 1} name`);
      input.value = player.name;
      input.addEventListener('input', () => {
        player.name = input.value;
      });

      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'chip-btn color-chip';
      colorBtn.style.background = player.color;
      colorBtn.title = 'Tap to change';
      colorBtn.setAttribute('aria-label', `Change colour for player ${index + 1}`);
      colorBtn.addEventListener('click', () => {
        player.color = nextFree(COLOR_CHOICES, player.color, takenBy('color', player));
        colorBtn.style.background = player.color;
        pulse(colorBtn, 'cycled');
      });

      row.appendChild(emojiBtn);
      row.appendChild(input);
      row.appendChild(colorBtn);

      if (roster.length > MIN_PLAYERS) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'chip-btn remove-chip';
        removeBtn.title = 'Remove player';
        removeBtn.setAttribute('aria-label', `Remove player ${index + 1}`);
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
      btn.textContent = mode.label;
      btn.classList.toggle('selected', pendingMode === key);
      btn.setAttribute('aria-pressed', pendingMode === key);
      btn.addEventListener('click', () => setPendingMode(key));
      container.appendChild(btn);
    });

    $('mode-hint').textContent = MODES[pendingMode].hint;
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
    $('theme-toggle-all').textContent = on === total ? 'Clear all' : `Select all (${total - on})`;
  }

  function startGame() {
    const themes = Array.from($('theme-chips').querySelectorAll('.theme-chip.selected')).map(
      (chip) => chip.dataset.theme
    );
    const setups = roster.map((player, i) => ({
      name: player.name.trim() || `Player ${i + 1}`,
      emoji: player.emoji,
      color: player.color,
    }));

    state = freshState(setups, themes, pendingMode);
    logMessage(`🎉 ${setups.map((p) => p.name).join(' · ')}`);
    saveState();
    showGameScreen();
  }

  function showSetupScreen() {
    if (!pendingBoardTheme) pendingBoardTheme = randomBoardTheme();
    applyBoardTheme(pendingBoardTheme);
    renderModeChoice();
    renderThemeChips();
    $('setup-screen').classList.remove('hidden');
    $('game-screen').classList.add('hidden');
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

    const clip = document.createElement('div');
    clip.className = 'board-texture-clip';
    const boardPhoto = document.createElement('div');
    boardPhoto.className = 'board-photo';
    const texture = document.createElement('div');
    texture.className = 'board-texture';
    clip.appendChild(boardPhoto);
    clip.appendChild(texture);
    board.appendChild(clip);
    board.appendChild(buildConnections());
    applyTextures(boardTheme());

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

    const group = svgEl('g', { 'data-snake': from });
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

    // Tongue first, so the snout sits over its root.
    group.appendChild(
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

    svg.appendChild(group);
  }

  // ---------- Pawns ----------
  // Drawn as an illustrated board-game piece with the same outline-and-highlight
  // treatment as the ladders and snakes, tinted with the player's colour.
  function pawnSvg(player) {
    const svg = svgEl('svg', { viewBox: '0 0 40 52', class: 'pawn' });
    const dark = shade(player.color, -0.42);
    const light = shade(player.color, 0.38);

    svg.appendChild(
      svgEl('ellipse', { cx: 20, cy: 47, rx: 14, ry: 4.4, fill: dark, 'fill-opacity': 0.32 })
    );
    // Base, waist and head share one outline so it reads as a carved piece.
    svg.appendChild(
      svgEl('path', {
        d: 'M6 46 Q6 40 13 37.5 Q9 33 12.5 28 Q16 24 20 24 Q24 24 27.5 28 Q31 33 27 37.5 Q34 40 34 46 Z',
        fill: player.color,
        stroke: dark,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      })
    );
    svg.appendChild(
      svgEl('ellipse', { cx: 20, cy: 24.5, rx: 9.5, ry: 3, fill: dark, 'fill-opacity': 0.45 })
    );
    svg.appendChild(
      svgEl('circle', { cx: 20, cy: 15, r: 11, fill: player.color, stroke: dark, 'stroke-width': 2 })
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

    const face = svgEl('text', {
      x: 20,
      y: 15,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 12,
    });
    face.textContent = player.emoji;
    svg.appendChild(face);

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
      if (token.dataset.look !== `${player.color}|${player.emoji}`) {
        token.innerHTML = '';
        token.appendChild(pawnSvg(player));
        token.dataset.look = `${player.color}|${player.emoji}`;
      }

      const col = i % perRow;
      const row = Math.floor(i / perRow);
      token.style.setProperty('--token-scale', scale);
      token.style.setProperty('--token-left', `${((col + 0.5) / perRow) * 100}%`);
      token.style.setProperty('--token-bottom', `${4 + row * 34}%`);
      token.classList.toggle('active-turn', state.current === i && !state.finished && !animating);

      const cell = cellEls[player.pos];
      if (cell && token.parentElement !== cell) cell.appendChild(token);
    });
  }

  async function walkToken(playerIndex, from, to) {
    if (from === to) return;
    const step = to > from ? 1 : -1;
    for (let pos = from + step; ; pos += step) {
      const token = tokenEl(playerIndex);
      cellEls[pos].appendChild(token);
      token.classList.remove('hopping');
      void token.offsetWidth;
      token.classList.add('hopping');
      soundStep();
      await sleep(STEP_MS);
      if (pos === to) break;
    }
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
    setTimeout(() => cell.classList.remove('landed'), 900);
  }

  // ---------- Rendering ----------
  const HEART_ICON = '<svg class="icon icon-xs"><use href="#i-heart" /></svg>';

  // Previous love totals. Diffing them here means a score change animates no
  // matter which of the eight surprise types or the answer flow caused it —
  // none of those call sites has to remember to trigger anything.
  let lastLove = null;

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
          '<span class="score-emoji"></span><span class="score-name"></span>' +
          '<svg class="icon icon-xs score-shield" role="img" aria-label="Shield up"><use href="#i-shield" /></svg>' +
          '<svg class="icon icon-xs score-frozen" role="img" aria-label="Skips next turn"><use href="#i-snow" /></svg>' +
          `<span class="score-points"><span class="pts-num"></span>${HEART_ICON}</span>`;
        scores.appendChild(card);
      });
      lastLove = null;
    }

    state.players.forEach((player, i) => {
      const card = scores.children[i];
      card.querySelector('.score-emoji').textContent = player.emoji;
      card.querySelector('.score-name').textContent = player.name;
      card.querySelector('.pts-num').textContent = player.love;
      card.style.setProperty('--player-color', player.color);
      card.classList.toggle('active', state.current === i && !state.finished);
      card.classList.toggle('has-shield', Boolean(player.shield));
      card.classList.toggle('is-frozen', Boolean(player.skipNext));

      const before = lastLove ? lastLove[i] : null;
      if (typeof before === 'number' && before !== player.love) {
        pulse(card, 'bump');
        floatLove(card, player.love - before);
      }
    });
    lastLove = state.players.map((player) => player.love);

    const banner = $('turn-banner');
    const current = state.players[state.current];
    const face = state.finished ? '🏁' : current.emoji;
    const label = state.finished ? 'Game over' : current.name;
    const showing = `${face}|${label}|${state.finished ? '' : current.color}`;
    if (banner.dataset.showing !== showing) {
      banner.innerHTML =
        '<span class="turn-swatch" aria-hidden="true"></span><span class="turn-emoji"></span><span class="turn-name"></span>';
      banner.querySelector('.turn-swatch').classList.toggle('hidden', state.finished);
      banner.style.setProperty('--player-color', current.color);
      banner.querySelector('.turn-emoji').textContent = face;
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
      answers.innerHTML =
        '<h2 class="field-label">Questions</h2>' +
        '<p class="log-empty">Nothing yet — land on a question square to start.</p>';
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'field-label';
    heading.textContent = `Questions (${state.answers.length})`;
    answers.appendChild(heading);

    state.answers
      .slice()
      .reverse()
      .forEach((entry) => {
        const box = document.createElement('div');
        box.className = 'answer-entry';

        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = `${entry.emoji || ''} ${entry.player} · ${themeLabel(entry.theme)}${entry.ai ? ' · AI' : ''}`;

        const q = document.createElement('div');
        q.className = 'q';
        q.textContent = entry.question;

        const a = document.createElement('div');
        a.className = 'a';
        if (entry.answer) {
          a.textContent = entry.answer;
        } else {
          a.classList.add('muted');
          a.textContent = entry.answered ? 'Answered out loud' : 'Skipped';
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
    lines.push('Snakes & Ladders — Love & Friends Edition');
    lines.push(`Players: ${state.players.map((p) => `${p.emoji} ${p.name}`).join('  ·  ')}`);
    lines.push(`Mode: ${(MODES[state.mode] || MODES.couples).label}`);
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push('');

    if (!state.answers.length) {
      lines.push('(No questions came up this game.)');
      return lines.join('\n');
    }

    state.answers.forEach((entry, i) => {
      lines.push(`${i + 1}. ${entry.emoji || ''} ${entry.player} — ${themeLabel(entry.theme)}${entry.ai ? ' (AI-personalized)' : ''}`);
      lines.push(`   Q: ${entry.question}`);
      lines.push(`   A: ${entry.answer || (entry.answered ? 'Answered out loud' : 'Skipped')}`);
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

  async function animateDice(value) {
    const overlay = $('dice-overlay');
    overlay.classList.remove('hidden');

    // The cube must be painted at its current angle BEFORE the new rotation is
    // set, otherwise there is no start value and the transition never runs —
    // the die would snap straight to the final face with no tumble.
    void $('dice').offsetWidth;

    overlay.classList.add('rolling');
    showDiceFace(value, true);

    // The throw is 1.8s, every single turn, and the number was already decided
    // before the die left the ground — so a tap anywhere cuts it short. Nothing
    // about the outcome changes, only how long you wait to see it.
    await untilTapOrTimeout(overlay, DICE_MS + 260);

    overlay.classList.remove('rolling');
    overlay.classList.add('hidden');
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
    if (me.shield) armed.push('Shield on');
    if (me.boost) armed.push(`Boost +${POWERS.boost.steps}`);
    if (me.loaded) armed.push(`Next roll ${me.loaded}`);
    if (armedThisTurn.freeze !== null) armed.push(`${state.players[armedThisTurn.freeze].name} frozen`);
    $('powers-status').textContent = armed.join(' · ');

    if (!$('powers-modal').classList.contains('hidden')) renderPowerSheet();
  }

  function renderPowerSheet() {
    const me = state.players[state.current];
    $('powers-player').textContent = `${me.emoji} ${me.name}`;
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
      row.querySelector('.power-title').textContent = power.name;
      row.querySelector('.power-desc').textContent = powerNote(kind, status) || power.desc;

      const buy = row.querySelector('.power-buy');
      buy.dataset.focusKey = `buy-${kind}`;
      if (status === 'refundable') {
        buy.textContent = 'Cancel';
        buy.setAttribute('aria-label', `Cancel ${power.name} and get ${power.cost} hearts back`);
      } else if (status === 'active') {
        buy.textContent = 'Active';
        buy.disabled = true;
      } else {
        buy.innerHTML = `<span class="power-cost-num"></span>${HEART_ICON}`;
        buy.querySelector('.power-cost-num').textContent = power.cost;
        buy.disabled = status !== 'buyable';
        buy.setAttribute('aria-label', `${power.name}, ${power.cost} hearts`);
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

  const NO_TARGET_NOTE = {
    freeze: 'Every rival is already skipping a turn.',
    rewind: 'No rivals have left the start.',
    swap: 'Everyone is on your square.',
    heist: `No rival has ${HEIST_MIN} hearts to steal.`,
    charm: 'There are no snakes left ahead of you.',
  };

  function powerNote(kind, status) {
    const me = state.players[state.current];
    if (status === 'active' && kind === 'shield') return 'On until you meet a snake.';
    if (status === 'refundable' && kind === 'loaded') return `Your next roll will be a ${me.loaded}.`;
    if (status === 'refundable' && kind === 'freeze') {
      return `${state.players[armedThisTurn.freeze].name} skips their next turn.`;
    }
    if (status === 'none') return NO_TARGET_NOTE[kind] || '';
    return '';
  }

  function powerChoices(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'power-choices';
    const add = (label, aria, key, onPick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = label;
      btn.setAttribute('aria-label', aria);
      btn.dataset.focusKey = key;
      btn.addEventListener('click', onPick);
      wrap.appendChild(btn);
    };

    if (kind === 'loaded') {
      for (let n = 1; n <= 6; n++) add(String(n), `Roll a ${n}`, `pick-${n}`, () => buyLoaded(n));
    } else if (kind === 'charm') {
      snakesAhead().forEach((head) => {
        const tail = state.snakes[head];
        add(`${head} → ${tail}`, `Charm the snake on ${head}, which drops to ${tail}`, `snake-${head}`, () =>
          buyCharm(head)
        );
      });
    } else {
      TARGETS[kind]().forEach((i) => {
        const p = state.players[i];
        const detail = kind === 'heist' ? ` · ${p.love} hearts` : kind === 'freeze' ? '' : ` · ${p.pos}`;
        add(`${p.emoji} ${p.name}${detail}`, `${POWERS[kind].name}: ${p.name}`, `target-${i}`, () => buyOn(kind, i));
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
    soundStep();
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
    spend(kind, kind === 'shield' ? `🛡️ ${player.name} raised a shield` : `⚡ ${player.name} boosted the next roll`);
  }

  function buyLoaded(n) {
    if (!canUsePowers() || powerState('loaded') !== 'buyable') return;
    const player = state.players[state.current];
    player.loaded = n;
    armedThisTurn.loaded = true;
    spend('loaded', `🎯 ${player.name} loaded the die to ${n}`);
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
    spend('heist', `💘 ${player.name} stole ${take} from ${other.name}`);
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
    spend('charm', `🐍 ${player.name} charmed the snake on ${head}`);
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
    spend('freeze', `❄️ ${player.name} froze ${state.players[target].name}`);
  }

  async function buyRewind(target) {
    if (!canUsePowers() || powerState('rewind') !== 'buyable' || !TARGETS.rewind().includes(target)) return;
    const player = state.players[state.current];
    const other = state.players[target];
    closePowers();
    turnBusy = true;
    animating = true;
    spend('rewind', `⏪ ${player.name} rewound ${other.name} by 5`);
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
    spend('swap', `🔀 ${player.name} swapped places with ${other.name}`);
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
    const { cost, name } = POWERS[kind];
    if (kind === 'freeze') {
      state.players[armedThisTurn.freeze].skipNext = false;
      armedThisTurn.freeze = null;
    } else {
      player[kind] = kind === 'loaded' ? 0 : false;
      armedThisTurn[kind] = false;
    }
    player.love += cost;
    logMessage(`↩️ ${player.name} cancelled ${name} (+${cost})`);
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
    const thrown = bonus ? `${roll} (+${bonus} boost)` : `${roll}`;
    if (trouble.kind === 'snake') {
      $('reroll-title').textContent = 'Snake ahead';
      $('reroll-body').textContent = `You rolled ${thrown}. That lands on the snake at ${trouble.from}, which drops you to ${trouble.to}.`;
      $('reroll-no-btn').textContent = 'Take the snake';
    } else {
      $('reroll-title').textContent = 'Too far';
      $('reroll-body').textContent = `You rolled ${thrown}, but you need exactly ${100 - player.pos} to finish.`;
      $('reroll-no-btn').textContent = 'Stay put';
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
        logMessage(`🛡️ ${player.name}'s shield stopped the snake on ${hop.from}`);
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
    logMessage(`🎲 ${player.name}: ${roll}${loaded ? ' (loaded)' : ''}${bonus ? ` +${bonus}` : ''}`);
    let target = player.pos + roll + bonus;

    // No re-roll offer on a loaded die: that roll was chosen, not dealt.
    const trouble = loaded ? null : rollTrouble(player, target);
    if (trouble && player.love >= POWERS.reroll.cost) {
      animating = false;
      renderAll();
      if (await offerReroll(player, roll, bonus, trouble)) {
        player.love -= POWERS.reroll.cost;
        logMessage(`🎲 ${player.name} re-rolled (−${POWERS.reroll.cost})`);
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
      logMessage(`🎯 ${player.name} needs exactly ${100 - player.pos}`);
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
      logMessage(`⏭️ ${state.players[state.current].name} skipped`);
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

  function applyQuestion(text, themeKey, isAi) {
    currentQuestion = { text, theme: themeKey, ai: isAi };
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
    el.textContent = 'Writing a question…';
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
          logMessage(`✨ AI unavailable, used a saved question instead (${error.message})`);
        }
      }

      applyQuestion(pickUnused(questionPool(themeKey), state.usedQuestions[themeKey]), themeKey, false);
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
      emoji: player.emoji,
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
    } else {
      logMessage(`⏭️ ${player.name} skipped`);
    }

    $('question-modal').classList.add('hidden');
    saveState();
    renderAll();
    advanceTurn();
  }

  // ---------- Surprises ----------
  function openSurpriseModal() {
    pendingSurprise = pickUnused(surprisePool(), state.usedSurprises);
    $('surprise-icon').textContent = pendingSurprise.icon;
    $('surprise-text').textContent = surpriseText(pendingSurprise);
    $('surprise-modal').classList.remove('hidden');
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
        logMessage(`🤝 everyone +${surprise.value}`);
        break;
      }
      case 'skipTurn': {
        const target = surprise.target === 'opponent' ? opp : me;
        target.skipNext = true;
        logMessage(`⏸️ ${target.name} skips next`);
        break;
      }
      case 'extraTurn': {
        logMessage(`🔁 ${me.name} rolls again`);
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
    $('win-text').textContent = `${winner.emoji} ${winner.name} wins`;

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
          '<span class="rank"></span><span class="score-emoji"></span><span class="who"></span>' +
          `<span class="pts"><span class="pts-num"></span>${HEART_ICON}</span>`;
        row.querySelector('.rank').textContent = i + 1;
        row.querySelector('.score-emoji').textContent = player.emoji;
        row.querySelector('.who').textContent = player.name;
        row.querySelector('.pts-num').textContent = player.love;
        summary.appendChild(row);
      });

    $('win-modal').classList.remove('hidden');
  }

  function playAgain() {
    const setups = state.players.map((p) => ({ name: p.name, emoji: p.emoji, color: p.color }));
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
      `Write ONE new line for this game's "${themeLabel(themeKey)}" theme, for ${forName} to answer. Address ${forName} as "you".`,
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
      status.textContent = 'Add a key to enable AI questions.';
      status.classList.add('error');
      return;
    }

    status.classList.remove('error');
    status.textContent = 'Testing…';
    try {
      const raw = await callLLM(
        'Write one short question two people could ask each other to get to know each other better. Output only the question.'
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

  // The banner is only for Android, where the install event fires on load and
  // the address bar has no install icon to fall back on. Desktop browsers show
  // one of their own, and iOS never fires the event. A dismissal is remembered
  // for two weeks so it doesn't nag; the setup screen's link is always there.
  const INSTALL_DISMISS_KEY = 'snakeLoveInstallDismissed_v1';
  const INSTALL_DISMISS_DAYS = 14;

  function isIos() {
    // iPadOS 13+ reports itself as a Mac, so the touch check is what
    // separates an iPad from a desktop Safari that genuinely can install.
    return (
      /iphone|ipod|ipad/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
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

    const banner = $('install-banner');
    const dismissedRecently = () => {
      try {
        const at = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
        return Boolean(at) && Date.now() - at < INSTALL_DISMISS_DAYS * 86400000;
      } catch (e) {
        return false;
      }
    };

    // prompt() has to run inside the user's tap, so it's called before the
    // first await. The event is single-use whatever the answer: a dismissed
    // prompt can't be re-shown, and Chrome fires a fresh one on a later visit.
    async function promptInstall() {
      if (!installPrompt) return false;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      btn.classList.add('hidden');
      banner.classList.add('hidden');
      return true;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      // Chrome/Edge: hold the event instead of letting the browser show its
      // own bottom infobar, so the prompt can come from here, at the top, with
      // the app's name on it. It can only be used from a real user gesture.
      e.preventDefault();
      installPrompt = e;
      btn.classList.remove('hidden');
      if (/android/i.test(navigator.userAgent) && !dismissedRecently()) banner.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      btn.classList.add('hidden');
      banner.classList.add('hidden');
    });

    $('install-banner-btn').addEventListener('click', promptInstall);
    $('install-banner-close').addEventListener('click', () => {
      banner.classList.add('hidden');
      try {
        localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
      } catch (e) {
        /* storage unavailable */
      }
    });

    if (isIos()) {
      // No event is coming, so show it immediately — the click just explains
      // the manual route.
      btn.classList.remove('hidden');
    }

    btn.addEventListener('click', async () => {
      if (await promptInstall()) return;
      // Name the actual device — an iPad user told to look on their "iPhone"
      // reasonably wonders whether these are the right instructions at all.
      const ipad = /ipad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      $('install-title').textContent = ipad ? 'Install on your iPad' : isIos() ? 'Install on your iPhone' : 'Install this app';
      $('install-note').textContent = isIos()
        ? ''
        : "If you don't see an install option, this browser may not support installing web apps — Chrome, Edge or Safari can.";
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
    loadMode();
    initRoster();
    renderModeChoice();
    initThemeChips();
    buildDice();

    try {
      setSound(localStorage.getItem(SOUND_KEY) !== 'off');
    } catch (e) {
      setSound(true);
    }
    $('sound-btn').addEventListener('click', () => {
      setSound(!soundOn);
      if (soundOn) soundStep();
    });

    $('add-player-btn').addEventListener('click', addPlayer);
    $('start-btn').addEventListener('click', startGame);
    $('roll-btn').addEventListener('click', rollDice);

    $('reroll-yes-btn').querySelector('.power-cost-num').textContent = POWERS.reroll.cost;
    $('powers-reroll-cost').textContent = `${POWERS.reroll.cost} hearts`;
    $('powers-btn').addEventListener('click', openPowers);
    $('powers-done-btn').addEventListener('click', closePowers);
    $('reroll-yes-btn').addEventListener('click', () => closeReroll(true));
    $('reroll-no-btn').addEventListener('click', () => closeReroll(false));
    $('new-game-btn').addEventListener('click', () =>
      askConfirm(
        'Start a new game?',
        "This board, the scores and everything you've answered will be cleared.",
        'Start over',
        newPlayers
      )
    );
    $('confirm-yes-btn').addEventListener('click', () => {
      const action = confirmAction;
      closeConfirm();
      if (action) action();
    });
    $('confirm-no-btn').addEventListener('click', closeConfirm);

    $('question-answered-btn').addEventListener('click', () => closeQuestionModal(true));
    $('question-another-btn').addEventListener('click', drawQuestion);
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
      $('ai-test-status').textContent = 'Cleared.';
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
