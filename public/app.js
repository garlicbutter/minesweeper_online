import { create, act, view, PRESETS } from '/game.js';
import { sound } from '/sound.js';
const $ = id => document.getElementById(id);
let level = 'easy', mode = 'solo', session = null, room = null;
let flagMode = false, busy = false, polling = false, pendingActions = 0, toastTimeout;
let actionQueue = Promise.resolve(), soloState = null;
const requests = new Set();
let boardCells = [], boardState = [], boardShape = '', progressKey = '', lastExplosion = '';
let blastTimer, configuredRoom = null;
let serverClockOffset = 0, lastPollAt = 0, boardFitFrame = 0;
const gameNow = () => Date.now() + (room && !room.solo ? serverClockOffset : 0);
let chordPress = null, chordClick = null;
const chordPreviewTiles = new Set();
let audioRound = null, audioPhase = null, audioCountdown = null;
try { soloState = JSON.parse(sessionStorage.getItem('minefield-solo')); } catch {}
try { session = JSON.parse(sessionStorage.getItem('minefield-session')); } catch {}
$('name').value = localStorage.getItem('minefield-name') || '';

function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').style.display = 'none', 5000);
}
async function request(path, body, credentials = session) {
  const sentAt = performance.now();
  const controller = new AbortController();
  requests.add(controller);
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/rooms' + path, {
      method: body ? 'POST' : 'GET', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(credentials ? { Authorization: 'Bearer ' + credentials.token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || 'Request failed');
    if (Number.isFinite(data.room?.serverNow)) {
      serverClockOffset = data.room.serverNow + (performance.now() - sentAt) / 2 - Date.now();
    }
    return data;
  } finally { clearTimeout(timeout); requests.delete(controller); }
}
function localAction(type, index) {
  const previous = room;
  act(soloState, soloState.players[0].id, { type, index });
  room = view(soloState, soloState.players[0].id);
  moveSound(previous, room, type, index);
  sessionStorage.setItem('minefield-solo', JSON.stringify(soloState));
  render();
}

function moveSound(previous, next, type, index) {
  if (!previous || !next) return;
  if (next.me.hits > previous.me.hits || (next.me.status === 'lost' && previous.me.status !== 'lost')) sound.play('explode');
  else if (type === 'flag' && previous.me.flags.length !== next.me.flags.length) sound.play(next.me.flags.length > previous.me.flags.length ? 'flag' : 'unflag');
  else if (type === 'reveal' && next.me.revealed.length > previous.me.revealed.length) sound.play(previous.cells[index] > 0 ? 'chord' : 'reveal');
}
function roundSound() {
  const key = `${room.code}/${room.round}`;
  if (audioRound !== key) {
    sound.stop(); audioRound = key; audioPhase = room.phase; audioCountdown = null; return;
  }
  if (room.phase === 'finished' && audioPhase !== 'finished') {
    const win = room.players.some(player => player.you && player.winner);
    sound.play(win ? 'win' : room.winner === null && !room.solo ? 'draw' : 'lose', room.me.status === 'lost' ? .22 : .06);
  }
  audioPhase = room.phase;
}
function name() {
  const value = $('name').value.trim() || 'Player';
  localStorage.setItem('minefield-name', value);
  return value;
}
function config() {
  return level === 'custom'
    ? { width: Number($('width').value), height: Number($('height').value), mines: Number($('mines').value) }
    : { difficulty: level };
}
async function start() {
  if (busy || room) return;
  if (mode === 'solo') {
    try {
      soloState = create({ ...config(), name: name(), solo: true });
      localAction('ready');
    } catch (e) { soloState = null; toast(e.message); }
    return;
  }
  busy = true;
  $('create').disabled = $('join').disabled = true;
  try {
    const data = mode === 'join'
      ? await request('/' + $('code').value.trim().toUpperCase() + '/join', { ...config(), name: name() })
      : await request('', { ...config(), name: name(), solo: mode === 'solo', bot: mode === 'ai' });
    session = { code: data.room.code, token: data.token };
    sessionStorage.setItem('minefield-session', JSON.stringify(session));
    room = data.room;
    render();
    if (room.solo) await action('ready');
  } catch (e) { toast(e.message); }
  finally {
    busy = false;
    if (!room) $('create').disabled = $('join').disabled = false;
  }
}
function action(type, index, extra = {}) {
  if (soloState) {
    try { localAction(type, index); } catch (e) { toast(e.message); }
    return Promise.resolve();
  }
  const current = session;
  if (!current) return Promise.resolve();
  pendingActions++;
  actionQueue = actionQueue.then(async () => {
    if (session !== current) return;
    try {
      const previous = room;
      const data = await request('/' + current.code + '/action', { ...extra, type, index }, current);
      if (session !== current) return;
      room = data.room;
      if (type !== 'flag') moveSound(previous, room, type, index);
      render();
    } catch (e) { if (session === current) toast(e.message); }
  }).finally(() => pendingActions--);
  return actionQueue;
}
function tab(nextMode) {
  mode = nextMode;
  $('join-form').hidden = mode !== 'join';
  $('create-form').hidden = false;
  $('create').hidden = mode === 'join';
  for (const [id, value] of [['solo-tab', 'solo'], ['ai-tab', 'ai'], ['create-tab', 'multi'], ['join-tab', 'join']]) {
    $(id).classList.toggle('selected', mode === value);
    $(id).setAttribute('aria-pressed', mode === value);
  }
  $('create').textContent = mode === 'solo' ? 'Start single player' : mode === 'ai' ? 'Start vs AI' : 'Create room';
  if (!room) {
    $('game-title').textContent = mode === 'solo' ? 'Single player' : mode === 'ai' ? 'vs AI' : mode === 'join' ? 'Join room' : 'Host room';
    $('status').textContent = mode === 'join' ? 'Enter a room code.' : 'Choose a difficulty.';
  }
}
$('create').onclick = $('join').onclick = start;
$('solo-tab').onclick = () => tab('solo');
$('ai-tab').onclick = () => tab('ai');
$('create-tab').onclick = () => tab('multi');
$('join-tab').onclick = () => tab('join');
for (const button of document.querySelectorAll('[data-level]')) button.onclick = () => {
  level = button.dataset.level;
  for (const other of document.querySelectorAll('[data-level]')) other.classList.toggle('selected', other === button);
  $('custom').hidden = level !== 'custom';
};
$('help').onclick = () => $('instructions').showModal();
$('close-help').onclick = () => $('instructions').close();
$('ready').onclick = () => action('ready', undefined, { settings: config() });
$('rematch').onclick = async () => {
  await action('rematch');
  if (room?.solo && room.phase === 'waiting') await action('ready');
};
$('flag-mode').onclick = () => {
  flagMode = !flagMode;
  $('flag-mode').setAttribute('aria-pressed', flagMode);
  $('flag-mode').textContent = '⚑ Flag mode: ' + (flagMode ? 'on' : 'off');
};
$('copy').onclick = async () => {
  const url = new URL(location.href);
  url.searchParams.set('room', room.code);
  try { await navigator.clipboard.writeText(url.href); toast('Invite link copied · Room ' + room.code); }
  catch { toast('Share this room code: ' + room.code); }
};
$('leave').onclick = () => {
  sound.stop(); audioRound = null; audioPhase = null; audioCountdown = null;
  clearChordPreview(); chordClick = null;
  const previous = session;
  session = room = soloState = null;
  configuredRoom = null; lastExplosion = ''; clearTimeout(blastTimer);
  busy = false;
  for (const controller of requests) controller.abort();
  actionQueue = Promise.resolve();
  sessionStorage.removeItem('minefield-session');
  sessionStorage.removeItem('minefield-solo');
  flagMode = false;
  $('flag-mode').setAttribute('aria-pressed', 'false');
  $('flag-mode').textContent = '⚑ Flag mode: off';
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  renderDemo();
  // Leaving the UI never waits for a slow connection or queued moves.
  if (previous) void fetch('/api/rooms/' + previous.code + '/action', {
    method: 'POST', keepalive: true, signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + previous.token },
    body: JSON.stringify({ type: 'leave' })
  }).catch(() => toast('Reset complete. Your friend may need to leave the old room if the server is offline.'));
};
function cellAction(index, flag) {
  if (!room) { toast('Choose a difficulty, then click Start single player.'); return; }
  if (room.phase !== 'playing' || gameNow() < (room.availableAt ?? room.startedAt)) return;
  // Flags respond immediately while server-checked multiplayer moves are in flight.
  if (!soloState && flag && !room.me.revealed.includes(index) ) {
    const flags = room.me.flags;
    const previousCount = flags.length;
    room.me.flags = flags.includes(index) ? flags.filter(i => i !== index) : flags.length < room.settings.mines ? [...flags, index] : flags;
    if (room.me.flags.length !== previousCount) sound.play(room.me.flags.length > previousCount ? 'flag' : 'unflag');
    board(room.cells, room.settings, room.me.flags);
    $('mine-count').textContent = room.settings.mines - room.me.flags.length;
  }
  action(flag ? 'flag' : 'reveal', index);
}
function clearChordPreview() {
  const press = chordPress;
  chordPress = null;
  for (const cell of chordPreviewTiles) cell.classList.remove('chord-neighbor', 'chord-source');
  chordPreviewTiles.clear();
  if (press?.cell.hasPointerCapture(press.pointerId)) press.cell.releasePointerCapture(press.pointerId);
}
function refreshChordPreview() {
  for (const cell of chordPreviewTiles) cell.classList.remove('chord-neighbor', 'chord-source');
  chordPreviewTiles.clear();
  if (!chordPress) return;
  const { index } = chordPress;
  if (room?.phase !== 'playing' || !(room.cells[index] > 0)) { clearChordPreview(); return; }
  const { width, height } = room.settings, x = index % width, y = Math.floor(index / width);
  // This is only a visual neighborhood; Rust remains responsible for validating the chord.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!(dx || dy) || nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    const cell = boardCells[ny * width + nx];
    cell.classList.add('chord-neighbor'); chordPreviewTiles.add(cell);
  }
  boardCells[index].classList.add('chord-source'); chordPreviewTiles.add(boardCells[index]);
}
$('board').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  chordClick = null;
  const cell = event.target.closest('[data-i]'), index = Number(cell?.dataset.i);
  if (!cell || room?.phase !== 'playing' || gameNow() < (room.availableAt ?? room.startedAt) || !(room.cells[index] > 0)) return;
  clearChordPreview();
  chordPress = { cell, index, pointerId: event.pointerId };
  cell.setPointerCapture(event.pointerId);
  refreshChordPreview();
  // Mouse and pen chords happen on press. Touch keeps normal tap/scroll cancellation behavior.
  if (event.pointerType !== 'touch') {
    event.preventDefault(); cell.focus({ preventScroll: true });
    chordClick = { index, pointerId: event.pointerId };
    cellAction(index, false);
  }
});
window.addEventListener('pointerup', event => {
  if (chordPress?.pointerId === event.pointerId) clearChordPreview();
});
window.addEventListener('pointercancel', event => {
  if (chordPress?.pointerId === event.pointerId) clearChordPreview();
  chordClick = null;
});
$('board').addEventListener('lostpointercapture', event => {
  if (chordPress?.pointerId === event.pointerId) clearChordPreview();
});
window.addEventListener('blur', () => { clearChordPreview(); chordClick = null; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearChordPreview(); chordClick = null; }
});
$('board').addEventListener('click', event => {
  const cell = event.target.closest('[data-i]');
  if (!cell) return;
  const index = Number(cell.dataset.i);
  if (event.detail > 0 && chordClick && (chordClick.pointerId === event.pointerId || chordClick.index === index)) {
    chordClick = null; return; // Do not chord twice from the pointerdown + click event pair.
  }
  cellAction(index, flagMode && !(room?.cells[index] > 0));
});
$('board').addEventListener('contextmenu', event => {
  const cell = event.target.closest('[data-i]');
  if (cell) { event.preventDefault(); cellAction(Number(cell.dataset.i), true); }
});
$('board').addEventListener('keydown', event => {
  const cell = event.target.closest('[data-i]');
  if (!cell) return;
  const index = Number(cell.dataset.i), width = room?.settings.width || 9;
  const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -width, ArrowDown: width };
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); cellAction(index, true); }
  if (directions[event.key]) {
    event.preventDefault();
    $('board').querySelector(`[data-i="${index + directions[event.key]}"]`)?.focus();
  }
});
function board(cells, settings, flags = [], demo = false) {
  const shape = `${settings.width}x${settings.height}`, flagged = new Set(flags);
  if (boardShape !== shape) {
    boardShape = shape;
    $('board').style.gridTemplateColumns = `repeat(${settings.width}, max-content)`;
    const fragment = document.createDocumentFragment();
    boardCells = cells.map((_, index) => {
      const cell = document.createElement('button');
      cell.dataset.i = index;
      fragment.append(cell);
      return cell;
    });
    boardState = [];
    $('board').replaceChildren(fragment);
  }
  const explosion = !demo ? room?.me.explosion : null;
  const blast = new Set(explosion && gameNow() - explosion.at < 1000 ? explosion.cells : []);
  cells.forEach((value, index) => {
    const isFlagged = flagged.has(index), pending = !demo && !room?.startedAt && room?.me.opening === index;
    const state = `${value}/${isFlagged}/${demo}/${pending}/${blast.has(index) ? explosion.sequence : 0}`;
    if (boardState[index] === state) return;
    boardState[index] = state;
    const cell = boardCells[index];
    cell.className = 'cell' + (value !== null ? ' open n' + value : '') + (value === -1 ? ' mine' : '') + (isFlagged ? ' flag' : '') + (demo ? ' demo' : '') + (pending ? ' opening-pending' : '') + (blast.has(index) ? ' blast' : '');
    cell.textContent = isFlagged ? '⚑' : pending ? '◎' : value === -1 ? '✳' : value > 0 ? value : '';
    cell.setAttribute('aria-label', `Row ${Math.floor(index / settings.width) + 1}, column ${index % settings.width + 1}: ${isFlagged ? 'flagged' : pending ? 'chosen opening' : value === null ? 'covered' : value === -1 ? 'mine' : value + ' nearby mines'}`);
  });
  refreshChordPreview();
  scheduleBoardFit();
}
function scheduleBoardFit() {
  if (boardFitFrame) return;
  boardFitFrame = requestAnimationFrame(() => {
    boardFitFrame = 0;
    const fields = $('fields');
    const [width, height] = boardShape.split('x').map(Number);
    if (!width || !fields.clientWidth) return;
    const mine = room?.settings || { width, height };
    const opponent = room?.players.find(player => !player.you)?.settings || mine;
    const duel = !!room && !room.solo;
    const stacked = duel && (innerWidth < 760 || (fields.clientWidth - 16) / (mine.width + opponent.width) < 18);
    fields.classList.toggle('stacked', stacked);
    fields.style.gridTemplateColumns = duel && !stacked ? `${mine.width}fr ${opponent.width}fr` : 'minmax(0, 1fr)';
    for (const [id, settings] of [['board', mine], ...(duel ? [['opponent-board', opponent]] : [])]) {
      const grid = $(id), wrap = grid.parentElement, style = getComputedStyle(wrap);
      const available = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available <= 0) continue;
      const gap = available / settings.width < 18 ? 1 : 3;
      const size = Math.min(25, (available - gap * (settings.width - 1)) / settings.width);
      grid.style.gridTemplateColumns = `repeat(${settings.width}, minmax(0, 1fr))`;
      grid.style.gap = `${gap}px`;
      grid.style.width = `${size * settings.width + gap * (settings.width - 1)}px`;
      grid.style.setProperty('--tile-size', `${size}px`);
    }
  });
}
const boardSizer = new ResizeObserver(scheduleBoardFit);
boardSizer.observe($('fields'));
window.addEventListener('resize', scheduleBoardFit);
function progress() {
  const key = JSON.stringify([room.settings, room.players, room.solo, room.phase]);
  if (key === progressKey) return;
  progressKey = key;
  $('scoreboard').replaceChildren();
  const players = [...room.players].sort((a, b) => Number(b.you) - Number(a.you));
  if (!room.solo && players.length < 2) players.push({ name: 'Waiting for opponent', cleared: 0, ready: false, online: false });
  for (const player of players) {
    const card = document.createElement('div'); card.className = 'progress-card';
    const title = document.createElement('strong'); title.textContent = player.name + (player.you ? ' (you)' : '');
    const settings = player.settings || room.settings;
    const total = settings.width * settings.height - settings.mines;
    const percent = Math.floor(player.cleared / total * 100);
    const detail = document.createElement('small');
    detail.textContent = `${settings.width} × ${settings.height} · ${settings.mines} mines · ${player.cleared} / ${total} cleared (${percent}%)`;
    const state = document.createElement('span'); state.className = 'player-state';
    state.textContent = room.phase === 'waiting' ? (player.ready ? 'Ready ✓' : 'Not ready') : player.winner ? 'Winner' : player.status === 'lost' ? 'Mine hit' : player.online ? `${player.hits || 0} explosions` : 'Offline';
    const bar = document.createElement('progress'); bar.max = total; bar.value = player.cleared;
    bar.setAttribute('aria-label', player.name + ' cleared cells');
    card.append(title, detail, bar, state);
    $('scoreboard').append(card);
  }
  const opponent = players.find(player => !player.you);
  $('fields').classList.toggle('duel', !room.solo);
  $('opponent-field').hidden = room.solo;
  $('your-field-label').hidden = room.solo;
  if (!room.solo) {
    const settings = opponent?.settings || room.settings;
    $('opponent-field-label').textContent = `${opponent?.name || 'Opponent'} · ${settings.width} × ${settings.height} · ${settings.mines} mines`;
    $('opponent-board').setAttribute('aria-label', `${opponent?.name || 'Opponent'} revealed board`);
    const cleared = new Set(opponent?.clearedCells || []), flags = new Set(opponent?.flaggedCells || []), fragment = document.createDocumentFragment();
    const blast = new Set(opponent?.explosion && gameNow() - opponent.explosion.at < 1500 ? opponent.explosion.cells : []);
    const cells = opponent?.cells || Array(settings.width * settings.height).fill(null);
    cells.forEach((value, i) => {
      const cell = document.createElement('span');
      cell.className = 'cell spectator-cell' + (cleared.has(i) ? ' open cleared' : ' covered') + (value === -1 ? ' mine' : value !== null ? ' n' + value : '') + (flags.has(i) ? ' flag' : '') + (blast.has(i) ? ' blast' : '');
      cell.textContent = flags.has(i) ? '⚑' : value === -1 ? '✳' : value > 0 ? value : '';
      cell.dataset.index = i;
      cell.setAttribute('aria-label', `Row ${Math.floor(i / settings.width) + 1}, column ${i % settings.width + 1}: ${flags.has(i) ? 'flagged' : value === null ? 'covered' : value === -1 ? 'mine' : value + ' nearby mines'}${cleared.has(i) ? ', cleared' : ''}`);
      fragment.append(cell);
    });
    $('opponent-board').replaceChildren(fragment);
  }
}
function render() {
  if (!room) return;
  roundSound();
  const inMatch = room.phase !== 'waiting';
  $('setup').hidden = inMatch;
  document.querySelector('.workspace').classList.toggle('in-match', inMatch);
  if (configuredRoom !== room.code) {
    configuredRoom = room.code;
    tab(room.solo ? 'solo' : room.players.some(player => player.bot) ? 'ai' : room.host ? 'multi' : 'join');
    const preset = Object.entries(PRESETS).find(([, s]) => s.width === room.settings.width && s.height === room.settings.height && s.mines === room.settings.mines);
    level = preset?.[0] || 'custom';
    for (const button of document.querySelectorAll('[data-level]')) button.classList.toggle('selected', button.dataset.level === level);
    for (const key of ['width', 'height', 'mines']) $(key).value = room.settings[key];
    $('custom').hidden = level !== 'custom';
  }
  $('setup').querySelectorAll('input,button').forEach(button => button.disabled = true);
  $('create').hidden = true;
  $('join-form').hidden = true;
  if (room.phase === 'waiting' && !room.me.ready) {
    for (const button of document.querySelectorAll('[data-level], #custom input')) button.disabled = false;
  }
  $('room-bar').hidden = false;
  $('room-prefix').textContent = room.solo ? 'SINGLE PLAYER' : 'ROOM';
  $('room-code').textContent = room.solo ? '' : room.code;
  const hasAI = room.players.some(player => player.bot);
  $('copy').hidden = room.solo || hasAI;
  $('room-prefix').parentElement.hidden = room.solo || hasAI;
  $('board-label').textContent = 'Round ' + room.round;
  $('mine-count').textContent = room.settings.mines - room.me.flags.length;
  $('phase').textContent = room.phase === 'waiting' ? 'Lobby' : room.phase === 'finished' ? 'Round complete' : 'Playing';
  $('game-title').textContent = room.phase === 'finished'
    ? (room.players.some(player => player.you && player.winner) ? 'You win' : !room.solo && room.winner === null ? 'Draw' : room.solo ? 'Mine hit' : room.players.some(player => player.bot) ? 'AI wins' : 'Opponent wins')
    : room.solo ? 'Single player' : room.players.some(player => player.bot) ? 'vs AI' : '1v1';
  progress();
  $('ready').hidden = room.phase !== 'waiting' || room.solo;
  $('ready').textContent = room.me.ready ? 'Cancel ready' : 'Ready';
  $('rematch').hidden = room.phase !== 'finished' || !room.host;
  $('status').textContent = room.phase === 'waiting'
    ? (room.players.length < 2 && !room.solo ? 'Share the room code.' : room.me.ready ? 'Waiting for opponent.' : 'Choose your difficulty, then Ready.')
    : room.phase === 'finished' ? (room.host ? 'Play again or reset.' : 'Waiting for host.') : room.solo ? 'Clear all safe tiles.' : 'Mine hits reset a 6 × 6 area.';
  board(room.cells, room.settings, room.me.flags);
  const explosion = room.me.explosion;
  if (explosion && lastExplosion !== `${room.code}/${room.round}/${explosion.sequence}`) {
    lastExplosion = `${room.code}/${room.round}/${explosion.sequence}`;
    if (gameNow() - explosion.at < 5000) {
      toast(`${explosion.width} × ${explosion.height} area reset and reshuffled.`);
      clearTimeout(blastTimer);
      blastTimer = setTimeout(() => { if (room) board(room.cells, room.settings, room.me.flags); }, 1050);
    }
  }
  tick();
}
function tick() {
  if (!room) { $('timer').textContent = '00:00'; return; }
  const remaining = Math.ceil(((room.availableAt ?? room.startedAt) - gameNow()) / 1000);
  if (!room.solo && room.phase === 'playing') {
    if (remaining > 0 && remaining <= 3 && audioCountdown !== remaining) { sound.play('tick'); audioCountdown = remaining; }
    else if (remaining <= 0 && audioCountdown > 0) { sound.play('start'); audioCountdown = 0; }
  }
  if (room.phase === 'playing' && remaining > 0) {
    $('status').textContent = 'Starting in ' + remaining + '…'; $('phase').textContent = remaining + '…';
  }
  if (room.phase === 'playing' && remaining <= 0 && room.me.opening === null) {
    $('phase').textContent = 'Choose your first square';
    $('status').textContent = 'First click is safe.';
  }
  const end = room.phase === 'finished' ? room.finishedAt || room.startedAt : gameNow();
  const seconds = room.startedAt ? Math.max(0, Math.floor((end - room.startedAt) / 1000)) : 0;
  $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function renderDemo() {
  $('setup').hidden = false;
  document.querySelector('.workspace').classList.remove('in-match');
  $('setup').querySelectorAll('input,button').forEach(button => button.disabled = false);
  $('room-bar').hidden = $('ready').hidden = $('rematch').hidden = true;
  $('game-title').textContent = 'Single player';
  $('phase').textContent = 'Ready';
  $('status').textContent = 'Choose a difficulty.';
  $('board-label').textContent = '';
  const preview = config(), previewSettings = PRESETS[preview.difficulty] || { width: 9, height: 9, mines: 10 };
  $('mine-count').textContent = previewSettings.mines;
  progressKey = '';
  $('fields').classList.remove('duel'); $('opponent-field').hidden = $('your-field-label').hidden = true;
  $('scoreboard').replaceChildren();
  board(Array(previewSettings.width * previewSettings.height).fill(null), previewSettings, [], true);
  tick();
  tab(mode);
}
setInterval(tick, 100);
setInterval(async () => {
  if (!session || polling || busy || pendingActions) return;
  const cadence = room?.phase === 'waiting' || (room?.availableAt && gameNow() < room.availableAt) ? 200 : 1000;
  if (performance.now() - lastPollAt < cadence) return;
  lastPollAt = performance.now();
  const current = session;
  polling = true;
  try {
    const data = await request('/' + current.code + '/action', { type: 'ping' }, current);
    if (session === current && !pendingActions) { room = data.room; render(); }
  } catch { if (session === current) $('status').textContent = 'Connection interrupted. Retrying…'; }
  finally { polling = false; }
}, 200);
const invite = new URL(location.href).searchParams.get('room');
tab(invite ? 'join' : 'solo');
if (invite) $('code').value = invite.toUpperCase();
if (soloState) {
  session = null;
  sessionStorage.removeItem('minefield-session');
  room = view(soloState, soloState.players[0].id); render();
} else if (session) {
  try { room = (await request('/' + session.code)).room; render(); }
  catch (e) { session = null; sessionStorage.removeItem('minefield-session'); toast(e.message); renderDemo(); }
} else renderDemo();
