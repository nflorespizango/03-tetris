'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // Tuerca - gris metálico
];

// Celda del hueco de la tuerca: se dibuja vacía pero cuenta como llena al limpiar líneas
const HOLE = -1;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,HOLE,8],[8,8,8]],               // Tuerca
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleText = document.getElementById('theme-toggle-text');

const THEME_KEY = 'tetris-theme';
let gridColor;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === 'light';
  themeToggle.setAttribute('aria-checked', String(isLight));
  themeToggleText.textContent = isLight ? 'Claro' : 'Oscuro';
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] <= 0) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c]) {
        const cell = board[current.y + r][current.x + c];
        // el hueco no sobrescribe un bloque que ya estaba dentro de la tuerca
        if (current.shape[r][c] === HOLE && cell) continue;
        board[current.y + r][current.x + c] = current.shape[r][c];
      }
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  registerLock(cleared);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  if (colorIndex === HOLE) {
    context.globalAlpha = alpha ?? 1;
    context.strokeStyle = COLORS[8];
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x * size + size / 2, y * size + size / 2, size / 2 - 4, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    return;
  }
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  if (!board || !current) return; // aún no empezó la partida
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  showGameOverRecords();
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  started = true;
  resetRunStats();
  hideGameOverRecords();
  startOverlay.classList.add('hidden');
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // las teclas escritas en el campo de nombre no controlan el juego
  if (e.target instanceof HTMLInputElement || !started) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* sin persistencia */ }
  themeToggle.blur(); // evita que Space vuelva a activar el botón
  draw(); // redibuja el canvas si el juego está en pausa o terminado
});

// ---- Récords ----
const RECORDS_KEY = 'tetris-records';
const STATS_KEY = 'tetris-best-stats';
const NAME_KEY = 'tetris-last-name';
const MAX_RECORDS = 5;

const startOverlay = document.getElementById('start-overlay');
const playBtn = document.getElementById('play-btn');
const goRecords = document.getElementById('go-records');
const recordMsg = document.getElementById('record-msg');
const recordForm = document.getElementById('record-form');
const recordName = document.getElementById('record-name');

let started = false;
let combo = 0;        // bloqueos consecutivos que limpian líneas
let runBestCombo = 0; // mejor combo de la partida actual
let pendingSave = false;

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin persistencia */ }
}

function loadRecords() {
  const list = loadJSON(RECORDS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(r => r && typeof r.score === 'number')
    .map(r => ({ ...r, name: String(r.name ?? '').slice(0, 12) }))
    .slice(0, MAX_RECORDS);
}

function loadBestStats() {
  const s = loadJSON(STATS_KEY, {});
  return {
    bestCombo: Number(s?.bestCombo) || 0,
    maxLines: Number(s?.maxLines) || 0,
  };
}

function resetRunStats() {
  combo = 0;
  runBestCombo = 0;
  pendingSave = false;
}

// Se llama en cada bloqueo de pieza con las líneas limpiadas
function registerLock(cleared) {
  if (cleared) {
    combo++;
    runBestCombo = Math.max(runBestCombo, combo);
  } else {
    combo = 0;
  }
}

// Posición (0-based) que ocuparía la puntuación en el top, o -1 si no entra
function recordRank(sc) {
  if (sc <= 0) return -1;
  const list = loadRecords();
  let idx = list.findIndex(r => sc > r.score);
  if (idx === -1) idx = list.length;
  return idx < MAX_RECORDS ? idx : -1;
}

function renderRecords(table, highlight) {
  const list = loadRecords();
  table.replaceChildren();
  const head = table.createTHead().insertRow();
  ['#', 'Nombre', 'Puntos', 'Líneas'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  });
  const body = table.createTBody();
  if (!list.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = 4;
    td.className = 'records-empty';
    td.textContent = 'Sin récords todavía';
    return;
  }
  list.forEach((r, i) => {
    const row = body.insertRow();
    if (i === highlight) row.className = 'record-new';
    if (r.date) row.title = `Nivel ${r.level ?? '-'} · combo ${r.bestCombo ?? 0} · ${String(r.date).slice(0, 10)}`;
    [i + 1, r.name || 'Anónimo', (r.score || 0).toLocaleString(), r.lines ?? 0].forEach(v => {
      row.insertCell().textContent = v;
    });
  });
}

function renderStats() {
  const st = loadBestStats();
  document.querySelectorAll('[data-stat="combo"]').forEach(el => { el.textContent = st.bestCombo; });
  document.querySelectorAll('[data-stat="lines"]').forEach(el => { el.textContent = st.maxLines; });
}

function renderAllRecords(highlight = -1) {
  document.querySelectorAll('.records-table').forEach(t => {
    renderRecords(t, t === goRecords ? highlight : -1);
  });
  renderStats();
}

function showStartScreen() {
  renderAllRecords();
  startOverlay.classList.remove('hidden');
  playBtn.focus();
}

function hideGameOverRecords() {
  document.getElementById('go-records-box').classList.add('hidden');
}

function showGameOverRecords() {
  // actualiza mejor combo y líneas máximas aunque no entre en el top
  const st = loadBestStats();
  st.bestCombo = Math.max(st.bestCombo, runBestCombo);
  st.maxLines = Math.max(st.maxLines, lines);
  saveJSON(STATS_KEY, st);

  const rank = recordRank(score);
  pendingSave = rank !== -1;
  renderAllRecords();
  recordForm.classList.toggle('hidden', !pendingSave);
  recordMsg.textContent = pendingSave ? `¡Nuevo récord! Entras en el top ${MAX_RECORDS} (puesto ${rank + 1})` : '';
  if (pendingSave) {
    recordName.value = loadJSON(NAME_KEY, '');
    setTimeout(() => { recordName.focus(); recordName.select(); }, 0);
  }
  document.getElementById('go-records-box').classList.remove('hidden');
}

function saveRecord() {
  if (!pendingSave) return;
  pendingSave = false;
  const name = recordName.value.trim().slice(0, 12) || 'Anónimo';
  const entry = {
    name, score, lines, level, bestCombo: runBestCombo, date: new Date().toISOString(),
  };
  const list = loadRecords();
  let idx = list.findIndex(r => score > r.score);
  if (idx === -1) idx = list.length;
  list.splice(idx, 0, entry);
  saveJSON(RECORDS_KEY, list.slice(0, MAX_RECORDS));
  saveJSON(NAME_KEY, name);
  recordForm.classList.add('hidden');
  recordMsg.textContent = `¡Guardado en el puesto ${idx + 1}!`;
  renderAllRecords(idx);
}

recordForm.addEventListener('submit', e => {
  e.preventDefault();
  saveRecord();
  document.getElementById('restart-btn').focus();
  document.getElementById('restart-btn').blur(); // evita que Space reinicie
});

document.querySelectorAll('.reset-records').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.blur(); // evita que Space vuelva a activar el botón
    if (!confirm('¿Borrar todos los récords?')) return;
    try {
      localStorage.removeItem(RECORDS_KEY);
      localStorage.removeItem(STATS_KEY);
    } catch { /* sin persistencia */ }
    // tras borrar ya no se puede guardar la puntuación actual
    pendingSave = false;
    recordForm.classList.add('hidden');
    recordMsg.textContent = '';
    renderAllRecords();
  });
});

playBtn.addEventListener('click', () => {
  playBtn.blur();
  init();
});

applyTheme(loadTheme());

showStartScreen();
