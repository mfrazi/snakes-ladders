(function () {
  'use strict';

  // Bump when shipping changes — lets you confirm the browser isn't serving a
  // stale cached copy (check the console line on startup).
  const BUILD = '2026-09-15d';

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
  let animating = false;
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
    renderModeChoice();
    // Topic names change with the mode ("Love" reads wrong for friends), so
    // the chips are redrawn — keeping whatever was already selected.
    renderThemeChips();
  }

  const themeOf = (key) => QUESTION_THEMES[key] || QUESTION_THEMES.general;

  function themeLabel(key) {
    const theme = themeOf(key);
    return (activeMode() === 'friends' && theme.friendsLabel) || theme.label;
  }

  function themeIcon(key) {
    const theme = themeOf(key);
    return (activeMode() === 'friends' && theme.friendsIcon) || theme.icon;
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
      aiQuestions: [],
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
    root.setProperty('--board-bg', theme.boardBg);
    root.setProperty('--board-frame', theme.frame);
    root.setProperty('--cell-bg', theme.cell);
    root.setProperty('--cell-alt-bg', theme.cellAlt);
    applyTextures(theme);
    root.setProperty('--cell-border', theme.cellBorder);
    root.setProperty('--cell-ink', theme.cellInk);
    root.setProperty('--rose', theme.accent);
    root.setProperty('--rose-deep', theme.accentDeep);

    // Installed as a PWA, this tints the OS status bar / title bar to match
    // whichever scene is live, same as everything else in the app already does.
    const meta = $('theme-color-meta');
    if (meta) meta.setAttribute('content', theme.accent);

    // The setup screen already wears the scene it's about to deal; naming it
    // turns that from "why is this one green" into a visible part of the game.
    const label = $('scene-label');
    if (label) label.textContent = `${theme.label} board`;
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

      const emojiBtn = document.createElement('button');
      emojiBtn.type = 'button';
      emojiBtn.className = 'chip-btn';
      emojiBtn.textContent = player.emoji;
      emojiBtn.title = 'Tap to change';
      emojiBtn.addEventListener('click', () => {
        player.emoji = nextFree(EMOJI_CHOICES, player.emoji, takenBy('emoji', player));
        emojiBtn.textContent = player.emoji;
        pulse(emojiBtn, 'cycled');
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = `Player ${index + 1}`;
      input.value = player.name;
      input.addEventListener('input', () => {
        player.name = input.value;
      });

      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'chip-btn color-chip';
      colorBtn.style.background = player.color;
      colorBtn.title = 'Tap to change';
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
        removeBtn.innerHTML = '<svg class="icon icon-xs"><use href="#i-close" /></svg>';
        removeBtn.addEventListener('click', () => {
          roster.splice(index, 1);
          renderRoster();
        });
        row.appendChild(removeBtn);
      }

      list.appendChild(row);
    });

    $('add-player-btn').classList.toggle('hidden', roster.length >= MAX_PLAYERS);
  }

  function addPlayer() {
    if (roster.length >= MAX_PLAYERS) return;
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
      chip.innerHTML = '<span class="chip-icon"></span><span class="chip-label"></span>';
      chip.querySelector('.chip-icon').textContent = themeIcon(key);
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

  // Ladder styled from the active board theme, so it belongs to the scene.
  function drawLadder(svg, from, to) {
    const { a, dx, dy, len, px, py } = geometry(from, to);
    const palette = boardTheme().ladder;
    const rail = 1.7;
    const group = svgEl('g', { fill: 'none', 'stroke-linecap': 'round' });

    const beam = (x1, y1, x2, y2, width, color) =>
      group.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': width }));

    const rungCount = Math.max(2, Math.round(len / 4.2));

    for (let pass = 0; pass < 2; pass++) {
      const width = pass === 0 ? 1.5 : 0.8;
      const color = pass === 0 ? palette.dark : palette.light;

      for (let i = 1; i < rungCount; i++) {
        const t = i / rungCount;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;
        beam(cx + px * rail, cy + py * rail, cx - px * rail, cy - py * rail, width * 0.85, color);
      }

      [1, -1].forEach((side) => {
        beam(
          a.x + px * rail * side,
          a.y + py * rail * side,
          a.x + dx + px * rail * side,
          a.y + dy + py * rail * side,
          width,
          color
        );
      });
    }

    [0, 1].forEach((t) => {
      [1, -1].forEach((side) => {
        group.appendChild(
          svgEl('circle', {
            cx: a.x + dx * t + px * rail * side,
            cy: a.y + dy * t + py * rail * side,
            r: 0.85,
            fill: palette.foot,
          })
        );
      });
    });

    svg.appendChild(group);
  }

  // Snake — tapered body, belly stripe, scales, head, tongue; themed colours.
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

    const halfWidth = (t) => headWidth * (1 - t) ** 1.15 + 0.2;

    const SAMPLES = 60;
    const leftEdge = [];
    const rightEdge = [];
    const spine = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const p = point(t);
      const { nx, ny } = normalAt(t);
      const w = halfWidth(t);
      leftEdge.push(`${p.x + nx * w} ${p.y + ny * w}`);
      rightEdge.push(`${p.x - nx * w} ${p.y - ny * w}`);
      spine.push(`${p.x} ${p.y}`);
    }

    const group = svgEl('g', {});
    group.appendChild(
      svgEl('path', {
        d: `M ${leftEdge.join(' L ')} L ${rightEdge.reverse().join(' L ')} Z`,
        fill: palette.body,
        stroke: palette.outline,
        'stroke-width': 0.35,
        'stroke-linejoin': 'round',
      })
    );
    group.appendChild(
      svgEl('path', {
        d: `M ${spine.join(' L ')}`,
        fill: 'none',
        stroke: palette.belly,
        'stroke-width': 0.45,
        'stroke-opacity': 0.6,
        'stroke-linecap': 'round',
      })
    );

    for (let i = 2; i < 12; i++) {
      const t = i / 13;
      const p = point(t);
      const { nx, ny } = normalAt(t);
      const w = halfWidth(t) * 0.78;
      group.appendChild(
        svgEl('line', {
          x1: p.x + nx * w,
          y1: p.y + ny * w,
          x2: p.x - nx * w,
          y2: p.y - ny * w,
          stroke: palette.outline,
          'stroke-width': 0.28,
          'stroke-opacity': 0.4,
          'stroke-linecap': 'round',
        })
      );
    }

    const head = point(0);
    const { tx, ty, nx, ny } = normalAt(0);
    group.appendChild(
      svgEl('ellipse', {
        cx: head.x,
        cy: head.y,
        rx: headWidth * 1.25,
        ry: headWidth * 0.95,
        fill: palette.head,
        stroke: palette.outline,
        'stroke-width': 0.35,
        transform: `rotate(${(Math.atan2(ty, tx) * 180) / Math.PI} ${head.x} ${head.y})`,
      })
    );

    const tipX = head.x - tx * headWidth * 2.1;
    const tipY = head.y - ty * headWidth * 2.1;
    [0.45, -0.45].forEach((side) => {
      group.appendChild(
        svgEl('line', {
          x1: head.x - tx * headWidth * 1.2,
          y1: head.y - ty * headWidth * 1.2,
          x2: tipX + nx * side,
          y2: tipY + ny * side,
          stroke: '#e0455f',
          'stroke-width': 0.3,
          'stroke-linecap': 'round',
        })
      );
    });

    [1, -1].forEach((side) => {
      const ex = head.x + nx * headWidth * 0.45 * side - tx * headWidth * 0.1;
      const ey = head.y + ny * headWidth * 0.45 * side - ty * headWidth * 0.1;
      group.appendChild(svgEl('circle', { cx: ex, cy: ey, r: headWidth * 0.3, fill: '#fffdf5' }));
      group.appendChild(svgEl('circle', { cx: ex, cy: ey, r: headWidth * 0.14, fill: '#2c1f33' }));
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
          '<span class="score-emoji"></span><span class="score-name"></span>' +
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
    if (banner.dataset.showing !== `${face}|${label}`) {
      banner.innerHTML = '<span class="turn-emoji"></span><span class="turn-name"></span>';
      banner.querySelector('.turn-emoji').textContent = face;
      banner.querySelector('.turn-name').textContent = label;
      banner.dataset.showing = `${face}|${label}`;
      pulse(banner, 'swap');
    }

    const roll = $('roll-btn');
    roll.disabled = state.finished || animating;
    roll.classList.toggle('ready', !roll.disabled && modalsClosed());
    placeTokens();
  }

  // Drifts off the score card that changed, so points landing is something you
  // watch happen rather than a number that is quietly different next time you
  // look at the header.
  //
  // It falls rather than rises. The usual "+3 floats up" idiom assumes there is
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
          { transform: 'translate(-50%, -10px) scale(0.7)', opacity: 0, easing: 'cubic-bezier(0.2, 1.5, 0.4, 1)' },
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
        who.textContent = `${entry.emoji || ''} ${entry.player} · ${themeIcon(entry.theme)} ${themeLabel(entry.theme)}${entry.ai ? ' · AI' : ''}`;

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
    lines.push('Snake & Ladder — Love & Friends Edition');
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
    if (animating || state.finished || !modalsClosed()) return;
    animating = true;
    renderAll();

    const roll = 1 + Math.floor(Math.random() * 6);
    state.lastRoll = roll;
    soundDice();
    await animateDice(roll);
    await handleRoll(roll);
  }

  function modalsClosed() {
    return ['question-modal', 'surprise-modal', 'win-modal', 'ai-modal', 'confirm-modal'].every((id) =>
      $(id).classList.contains('hidden')
    );
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
      logMessage(hop.type === 'ladder' ? `🪜 ${hop.from} → ${hop.to}` : `🐍 ${hop.from} → ${hop.to}`);
      if (hop.type === 'ladder') soundLadder();
      else soundSnake();
      await travelToken(playerIndex, hop.from, hop.to);
      player.pos = hop.to;
    }

    flashCell(player.pos);
  }

  async function handleRoll(roll) {
    const player = state.players[state.current];
    const target = player.pos + roll;
    logMessage(`🎲 ${player.name}: ${roll}`);

    if (target > 100) {
      logMessage(`🎯 ${player.name} needs exactly ${100 - player.pos}`);
      animating = false;
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
      endGame(state.current);
      return;
    }

    await sleep(LANDING_PAUSE_MS);
    openTileContent();
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

  function applyQuestion(text, themeKey, isAi) {
    currentQuestion = { text, theme: themeKey, ai: isAi };

    const badge = $('question-theme-badge');
    badge.textContent = `${themeIcon(themeKey)} ${themeLabel(themeKey)}`;
    badge.style.setProperty('--tile-color', themeOf(themeKey).color);
    badge.classList.toggle('ai', isAi);

    const el = $('question-text');
    el.classList.remove('loading');
    el.textContent = text;
    el.classList.remove('question-swap');
    void el.offsetWidth;
    el.classList.add('question-swap');
  }

  function showQuestionLoading(themeKey) {
    const badge = $('question-theme-badge');
    badge.textContent = `${themeIcon(themeKey)} ${themeLabel(themeKey)}`;
    badge.style.setProperty('--tile-color', themeOf(themeKey).color);
    badge.classList.add('ai');

    const el = $('question-text');
    el.textContent = '✨ …';
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

      // A background follow-up is reserved for the player it was actually
      // written for (see requestFollowUps) — normally whoever gave the
      // original answer, or whoever they named instead. It only fires on
      // THAT player's own turn, however many turns that takes, rather than
      // being handed to whoever happens to land on a question tile next.
      // (`target == null` covers a queue item saved before this existed —
      // those have no owner recorded, so any player can claim one.)
      const queuedIndex = state.aiQuestions.findIndex(
        (q) => q.target == null || q.target === currentName
      );
      if (wantPersonalized && queuedIndex !== -1) {
        const [queued] = state.aiQuestions.splice(queuedIndex, 1);
        applyQuestion(queued.question, queued.theme, true);
        saveState();
        return;
      }

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
      player.love += 3;
      logMessage(`💗 ${player.name} +3`);
      if (answer) requestFollowUps();
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
      url: (model, key) =>
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      headers: () => ({ 'content-type': 'application/json' }),
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
  // (that's the wording in buildLiveQuestionPrompt/buildFollowUpPrompt below).
  // Dare lines have no "?" at all, so they pass through untouched.
  function firstQuestionOnly(line) {
    const firstMark = line.indexOf('?');
    if (firstMark === -1 || firstMark === line.length - 1) return line;
    return line.slice(0, firstMark + 1);
  }

  function parseQuestions(raw) {
    return raw
      .split('\n')
      .map((line) => firstQuestionOnly(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()))
      .filter((line) => line.length > 8 && line.length < 220 && line.includes('?'))
      .slice(0, 3);
  }

  // For a single-line reply. Dare-theme lines are instructions, not
  // questions, so this — unlike parseQuestions — can't require a "?" outright.
  // Instead: prefer whichever line HAS one (real content, not a "Sure, here
  // you go:" preamble the model added despite instructions); with no "?"
  // anywhere (a dare), fall back to the longest line, since a stray preamble
  // is reliably shorter than the actual instruction.
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

  // Whole-word, case-insensitive: does this text name this player? Used to
  // decide whether a follow-up stays with whoever answered, or crosses over
  // to whoever they actually brought up. Regex-escaped since a name is free
  // text a player typed in on setup, not a pattern.
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

  // `target` is who will actually be asked these — the source answerer by
  // default, or whoever they named instead (decided by the caller before
  // this runs). `sourcePlayer` is who really said the thing being built on,
  // which only differs from `target` in that mention case — that's exactly
  // when a model is most likely to blur "I"/"you" between the wrong two
  // people, so it's spelled out explicitly rather than left implicit.
  // `entries` is the scoped slice of writtenAnswers() this may draw on —
  // never a third player's unrelated answer; see requestFollowUps for how
  // that scope is decided.
  function buildFollowUpPrompt(target, sourcePlayer, entries) {
    const mode = MODES[activeMode()] || MODES.couples;
    const transcript = entries
      .map((entry) => `${entry.player} was asked "${entry.question}" and answered: "${entry.answer}"`)
      .join('\n');

    const identity =
      sourcePlayer === target
        ? `Write these for ${target} to answer next. Address ${target} as "you" — ${target} is the one who said this, so "you" refers to them throughout.`
        : `Write these for ${target} to answer next, even though ${sourcePlayer} is the one who said this below. ` +
          `Address ${target} as "you". Refer to ${sourcePlayer} by name, never as "I" or "you" — ${sourcePlayer} is not who this is being written for.`;

    // Built in two pieces rather than one filtered array: the blank lines here
    // are deliberate paragraph breaks around the transcript, so a blanket
    // .filter(Boolean) to drop the empty Couples-mode guard would eat them too.
    const preamble = [mode.subject, mode.guard].filter(Boolean);

    return preamble
      .concat([
        'Here is what they just shared with each other:',
        '',
        transcript,
        '',
        `Write 2 new follow-up questions that build directly on what's above. ${identity}`,
        'Rules: one question per line, and each line asks ONE thing only — never chain two ' +
          'questions with "and", "or", a comma, or a second question mark. No numbering, no ' +
          'preamble, no commentary.',
        'Each question must be under 18 words, plain language, specific to their answers, and answerable out loud.',
      ])
      .join('\n');
  }

  let followUpInFlight = false;

  // Fire-and-forget: this runs in the background after the question modal has
  // already closed, so its outcome is reported through the game log (visible
  // any time in the 📜 drawer) rather than a status line inside a modal that's
  // gone by the time this resolves.
  async function requestFollowUps() {
    if (!aiReady() || followUpInFlight || writtenAnswers().length === 0) return;
    followUpInFlight = true;

    try {
      const written = writtenAnswers();
      const last = written[written.length - 1];

      // Stays with whoever just answered by default — the question thread
      // continues with the same person rather than jumping to whoever's
      // turn happens to come up next. Unless their own answer named someone
      // else at the table, in which case that's who the follow-up is
      // actually about, and who it's held for instead.
      const mentioned = state.players.find(
        (p) => p.name !== last.player && mentionsPlayer(last.answer, p.name)
      );
      const target = mentioned ? mentioned.name : last.player;

      // What the follow-up is allowed to draw on — decided BEFORE the model
      // ever sees a prompt, not after. Always the answer that just triggered
      // this. Enriched with the same person's own earlier answers only when
      // nobody else was named: a mention means this is specifically about
      // what was said regarding that other player, not a general
      // continuation of the answerer's own theme, so it stays scoped to
      // just that one answer. Either way, a third player's unrelated answer
      // never enters the picture — this is the actual fix for "don't ask
      // player A's answer to another player unless A named them": the old
      // code drew its transcript from the last 4 answers from ANYONE, and
      // only decided who to route the result to afterward, so a follow-up
      // could already be contaminated with someone else's unrelated answer
      // before targeting ever got a say.
      const entries = mentioned
        ? [last]
        : [last, ...written.filter((e) => e.player === last.player && e !== last).slice(-2)];

      const raw = await callLLM(buildFollowUpPrompt(target, last.player, entries));
      const questions = parseQuestions(raw);
      if (questions.length) {
        const theme = last.theme;

        // Prepended, not appended — so the very next question tile the
        // target player lands on uses this fresh, on-topic follow-up, not
        // whatever was already queued from an earlier exchange.
        state.aiQuestions = [
          ...questions.map((question) => ({ question, theme, target })),
          ...state.aiQuestions,
        ];
        // Kept modest — the queue is no longer drained every turn (see
        // drawQuestion), so a large cap would let stale, recency-biased
        // items linger indefinitely.
        if (state.aiQuestions.length > 6) state.aiQuestions.length = 6;
        logMessage(`✨ ${questions.length} personal question${questions.length > 1 ? 's' : ''} ready for ${target}`);
        saveState();
      }
    } catch (error) {
      logMessage(`✨ AI unavailable: ${error.message}`);
      saveState();
    } finally {
      followUpInFlight = false;
    }
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

  function init() {
    applyAnimationSpeeds();
    registerServiceWorker();
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
