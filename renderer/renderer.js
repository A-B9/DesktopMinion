// ── DOM refs ────────────────────────────────────────────────────────────────
const buddy       = document.getElementById('buddy');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const bubble      = document.getElementById('bubble');
const bubbleText  = document.getElementById('bubble-text');
const statusDot   = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

// ── Click-through: disable when hovering so the widget is interactive ───────
buddy.addEventListener('mouseenter', () => window.api.setIgnoreMouse(false));
buddy.addEventListener('mouseleave', () => window.api.setIgnoreMouse(true));

// ── Pixel sprite ────────────────────────────────────────────────────────────
const P = 8; // CSS pixels per grid block  (16 blocks × 8 = 128px canvas)

const PALETTE = {
  '.': null,        // transparent
  'K': '#2c2c3e',   // dark outline
  'O': '#f0832f',   // Charizard orange
  'C': '#f6d8a8',   // cream — horns & snout
  'W': '#ffffff',   // eye whites / teeth
  'T': '#1f9e8f',   // teal pupil
  'R': '#e8482a',   // mouth / flame red
};

// Charizard-style dragon head: orange face, cream horns + snout, teal eyes.
const SPRITE_NEUTRAL = [
  '................',
  '..K..........K..',  // horn tips
  '..KC........CK..',  // horns
  '...KC......CK...',  // horns
  '...KCK....KCK...',  // horns meet head
  '....KOOOOOOK....',  // head top
  '...KOOOOOOOOK...',
  '..KOWWOOOOWWOK..',  // eyes — whites
  '..KOWTOOOOTWOK..',  // eyes — teal pupils
  '..KOOOOOOOOOOK..',  // cheeks
  '..KOOOCCCCOOOK..',  // snout top
  '...KOCCCCCCOK...',  // snout
  '...KOCKCCKCOK...',  // nostrils
  '...KOCCCCCCOK...',  // snout
  '....KKCCCCKK....',  // closed mouth
  '......KKKK......',  // chin
];

const SPRITE_HAPPY = [
  '................',
  '..K..........K..',
  '..KC........CK..',
  '...KC......CK...',
  '...KCK....KCK...',
  '....KOOOOOOK....',
  '...KOOOOOOOOK...',
  '..KOWWOOOOWWOK..',  // bright eyes
  '..KOWTOOOOTWOK..',
  '..KOOOOOOOOOOK..',
  '..KOOOCCCCOOOK..',
  '...KOCCCCCCOK...',
  '...KOCKCCKCOK...',  // nostrils
  '...KOWWWWWWOK...',  // open grin — top teeth
  '....KRRRRRRK....',  // open mouth
  '......KKKK......',
];

const SPRITE_STERN = [
  '................',
  '..K..........K..',
  '..KC........CK..',
  '...KC......CK...',
  '...KCK....KCK...',
  '....KOOOOOOK....',
  '...KOOOOOOOOK...',
  '..KOKOOOOOOKOK..',  // angry brows — outer
  '..KOOKOOOOKOOK..',  // angry brows — slant inward
  '..KOOOOOOOOOOK..',
  '..KOOOCCCCOOOK..',
  '...KOCCCCCCOK...',
  '...KOCKCCKCOK...',  // nostrils
  '...KOCCCCCCOK...',
  '....KWKWWKWK....',  // bared-fang snarl
  '......KKKK......',
];

const SPRITE_IDLE = [
  '................',
  '..K..........K..',
  '..KC........CK..',
  '...KC......CK...',
  '...KCK....KCK...',
  '....KOOOOOOK....',
  '...KOOOOOOOOK...',
  '..KOOOOOOOOOOK..',  // eyelids closed
  '..KOKKOOOOKKOK..',  // sleepy eye lines
  '..KOOOOOOOOOOK..',
  '..KOOOCCCCOOOK..',
  '...KOCCCCCCOK...',
  '...KOCKCCKCOK...',  // nostrils
  '...KOCCCCCCOK...',
  '....KKCCCCKK....',  // relaxed mouth
  '......KKKK......',
];

function setExpression(mood) {
  const map = { happy: SPRITE_HAPPY, stern: SPRITE_STERN, idle: SPRITE_IDLE, neutral: SPRITE_NEUTRAL };
  drawSprite(map[mood] || SPRITE_NEUTRAL);
}

function drawSprite(sprite) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sprite.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const color = PALETTE[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(c * P, r * P, P, P);
    });
  });
}

drawSprite(SPRITE_NEUTRAL);

// ── Speech bubble ────────────────────────────────────────────────────────────
let autohideTimer = null;

function showBubble(text, autohideMs = 0) {
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  // Re-trigger pop-in animation on every call
  bubble.style.animation = 'none';
  void bubble.offsetHeight; // force reflow
  bubble.style.animation  = '';

  clearTimeout(autohideTimer);
  if (autohideMs > 0) {
    autohideTimer = setTimeout(() => bubble.classList.add('hidden'), autohideMs);
  }
}

function hideBubble() {
  clearTimeout(autohideTimer);
  bubble.classList.add('hidden');
}

// ── Status strip ─────────────────────────────────────────────────────────────
function setStatus(state, label) {
  statusDot.className = state;   // 'ok' | 'warn' | 'error' | 'none'
  statusLabel.textContent = label;
}

// ── Todo data ─────────────────────────────────────────────────────────────────
let latestFiles = [];   // keep a copy so clicks can re-show the summary

function buildSummary(files) {
  if (!files || files.length === 0) {
    return 'No files in config.json yet.\nAdd paths to "todoPaths" to get started!';
  }

  return files.map(f => {
    if (f.error) return `❌ ${f.name}\n   ${f.error}`;
    const parts = [];
    if (f.pending > 0) parts.push(`${f.pending} pending`);
    if (f.done    > 0) parts.push(`${f.done} done`);
    const counts = parts.length ? parts.join(' · ') : 'no checkboxes found';
    return `📋 ${f.name}\n   ${counts}`;
  }).join('\n\n');
}

// ── Handle incoming todo payload from main process ───────────────────────────
window.api.onTodosUpdated(({ files }) => {
  latestFiles = files;

  if (!files || files.length === 0) {
    setStatus('none', 'no files configured');
    showBubble(buildSummary(files));
    return;
  }

  const errorCount  = files.filter(f =>  f.error).length;
  const loadedCount = files.filter(f => !f.error).length;

  if (errorCount === 0) {
    setStatus('ok', `${loadedCount} file${loadedCount !== 1 ? 's' : ''} loaded`);
  } else if (loadedCount === 0) {
    setStatus('error', `${errorCount} file${errorCount !== 1 ? 's' : ''} failed`);
  } else {
    setStatus('warn', `${loadedCount} ok · ${errorCount} failed`);
  }

  showBubble(buildSummary(files));
});

// ── Handle AI-Generated message from main process ───────────────────────────
window.api.onAiMessage(({ text, mood }) => {
  showBubble(text);
  setExpression(mood || 'neutral');
})

// ── Click character → toggle summary bubble ───────────────────────────────────
canvas.addEventListener('click', () => {
  if (!bubble.classList.contains('hidden')) {
    hideBubble();
  } else {
    const text = latestFiles.length > 0
      ? buildSummary(latestFiles)
      : 'No files loaded yet.\nRight-click to reload.';
    showBubble(text);
  }
});

// ── Kick off: ask main for the current files straight away ───────────────────
showBubble('Loading your tasks…');
window.api.requestTodos();
