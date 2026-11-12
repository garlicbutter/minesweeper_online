const $ = id => document.getElementById(id);
let level = 'easy', mode = 'solo', session = null, room = null;
let flagMode = false, busy = false, polling = false, pendingActions = 0, toastTimeout;
let actionQueue = Promise.resolve();
try { session = JSON.parse(sessionStorage.getItem('minefield-session')); } catch {}
$('name').value = localStorage.getItem('minefield-name') || '';

function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').style.display = 'none', 5000);
}
async function request(path, body, credentials = session) {
  const res = await fetch('/api/rooms' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(credentials ? { Authorization: 'Bearer ' + credentials.token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || 'Request failed');
  return data;
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
  busy = true;
  $('create').disabled = $('join').disabled = true;
  try {
    const data = mode === 'join'
      ? await request('/' + $('code').value.trim().toUpperCase() + '/join', { name: name() })
      : await request('', { ...config(), name: name(), solo: mode === 'solo' });
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
function action(type, index) {
  const current = session;
  if (!current) return Promise.resolve();
  pendingActions++;
  actionQueue = actionQueue.then(async () => {
    if (session !== current) return;
    try {
      const data = await request('/' + current.code + '/action', { type, index }, current);
      if (session !== current) return;
      room = data.room;
      render();
    } catch (e) { toast(e.message); }
  }).finally(() => pendingActions--);
  return actionQueue;
}
function tab(nextMode) {
  mode = nextMode;
  $('join-form').hidden = mode !== 'join';
  $('create-form').hidden = mode === 'join';
  for (const [id, value] of [['solo-tab', 'solo'], ['create-tab', 'multi'], ['join-tab', 'join']]) {
    $(id).classList.toggle('selected', mode === value);
    $(id).setAttribute('aria-pressed', mode === value);
  }
  $('create').textContent = mode === 'solo' ? 'Start single player →' : 'Create challenge ↗';
  $('mode-note').textContent = mode === 'solo'
    ? 'Your pace. Your next best time. A safe opening, ready to play.'
    : 'Same board. Same opening. Live side-by-side progress.';
}
$('create').onclick = $('join').onclick = start;
$('solo-tab').onclick = () => tab('solo');
$('create-tab').onclick = () => tab('multi');
$('join-tab').onclick = () => tab('join');
for (const button of document.querySelectorAll('[data-level]')) button.onclick = () => {
  level = button.dataset.level;
  for (const other of document.querySelectorAll('[data-level]')) other.classList.toggle('selected', other === button);
  $('custom').hidden = level !== 'custom';
};
$('help').onclick = () => $('instructions').showModal();
$('close-help').onclick = () => $('instructions').close();
$('ready').onclick = () => action('ready');
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
$('leave').onclick = async () => {
  if (busy) return;
  busy = true;
  await action('leave');
  session = room = null;
  sessionStorage.removeItem('minefield-session');
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  busy = false;
  renderDemo();
};
function cellAction(index, flag) {
  if (!room) { toast('Choose a difficulty, then click Start single player.'); return; }
  if (room.phase !== 'playing' || Date.now() < room.startedAt) return;
  action(flag ? 'flag' : 'reveal', index);
}
$('board').addEventListener('click', event => {
  const cell = event.target.closest('[data-i]');
  if (cell) cellAction(Number(cell.dataset.i), flagMode);
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
  $('board').style.gridTemplateColumns = `repeat(${settings.width}, max-content)`;
  const focus = document.activeElement?.dataset?.i;
  const fragment = document.createDocumentFragment();
  cells.forEach((value, index) => {
    const cell = document.createElement('button');
    cell.dataset.i = index;
    cell.className = 'cell' + (value !== null ? ' open n' + value : '') + (value === -1 ? ' mine' : '') + (flags.includes(index) ? ' flag' : '') + (demo ? ' demo' : '');
    cell.textContent = flags.includes(index) ? '⚑' : value === -1 ? '✳' : value > 0 ? value : '';
    cell.setAttribute('aria-label', `Row ${Math.floor(index / settings.width) + 1}, column ${index % settings.width + 1}: ${flags.includes(index) ? 'flagged' : value === null ? 'covered' : value === -1 ? 'mine' : value + ' nearby mines'}`);
    fragment.append(cell);
  });
  $('board').replaceChildren(fragment);
  if (focus !== undefined) $('board').querySelector(`[data-i="${focus}"]`)?.focus({ preventScroll: true });
}
function progress() {
  const total = room.settings.width * room.settings.height - room.settings.mines;
  $('scoreboard').replaceChildren();
  const players = [...room.players].sort((a, b) => Number(b.you) - Number(a.you));
  if (!room.solo && players.length < 2) players.push({ name: 'Waiting for a friend', cleared: 0, ready: false, online: false });
  for (const player of players) {
    const card = document.createElement('div'); card.className = 'progress-card';
    const title = document.createElement('strong'); title.textContent = player.name + (player.you ? ' (you)' : '');
    const percent = Math.floor(player.cleared / total * 100);
    const detail = document.createElement('small');
    detail.textContent = `${player.cleared} / ${total} cleared · ${percent}%`;
    const state = document.createElement('span'); state.className = 'player-state';
    state.textContent = room.phase === 'waiting' ? (player.ready ? 'Ready ✓' : 'Not ready') : player.winner ? 'Winner' : player.status === 'lost' ? 'Mine hit' : player.online ? 'Playing' : 'Offline';
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
    $('opponent-field-label').textContent = opponent?.name ? opponent.name + ' · progress' : 'Opponent’s progress';
    $('opponent-board').style.width = `min(100%, ${Math.min(room.settings.width * 28, 240 * room.settings.width / room.settings.height)}px)`;
    $('opponent-board').style.gridTemplateColumns = `repeat(${room.settings.width}, minmax(0, 1fr))`;
    $('opponent-board').setAttribute('aria-label', `${opponent?.name || 'Opponent'}: ${opponent?.cleared || 0} of ${total} safe cells cleared`);
    const cleared = new Set(opponent?.clearedCells || []), fragment = document.createDocumentFragment();
    for (let i = 0; i < room.cells.length; i++) {
      const cell = document.createElement('span');
      cell.className = 'progress-cell' + (cleared.has(i) ? ' cleared' : '');
      fragment.append(cell);
    }
    $('opponent-board').replaceChildren(fragment);
  }
}
function render() {
  if (!room) return;
  $('setup').querySelectorAll('input,button').forEach(button => button.disabled = true);
  $('room-bar').hidden = false;
  $('room-prefix').textContent = room.solo ? 'SINGLE PLAYER' : 'ROOM';
  $('room-code').textContent = room.solo ? '' : room.code;
  $('copy').hidden = room.solo;
  $('board-label').textContent = room.solo ? 'SINGLE PLAYER' : 'LIVE 1v1 · ROUND ' + room.round;
  $('mine-count').textContent = room.settings.mines - room.me.flags.length;
  $('phase').textContent = room.phase === 'waiting' ? 'In the lobby' : room.phase === 'finished' ? 'Round complete' : room.solo ? 'Your pace. Your game.' : 'Match in progress';
  $('game-title').textContent = room.phase === 'waiting' ? 'Your challenge awaits.' : room.phase === 'finished'
    ? (room.players.some(player => player.you && player.winner) ? 'Nicely swept. You win!' : !room.solo && room.winner === null ? 'Both boards cleared. A draw!' : room.solo ? 'One mine too many.' : 'Your friend takes the win.') : 'Make every click count.';
  progress();
  $('ready').hidden = room.phase !== 'waiting' || room.solo;
  $('ready').textContent = room.me.ready ? 'Cancel ready' : 'Ready to play →';
  $('rematch').hidden = room.phase !== 'finished' || !room.host;
  $('status').textContent = room.phase === 'waiting'
    ? (room.players.length < 2 && !room.solo ? 'Share your code. Your friend joins here.' : room.me.ready ? 'Waiting for your opponent to get ready…' : 'Both players ready? Let’s begin.')
    : room.phase === 'finished' ? (room.solo ? 'Play again, or end the game to change difficulty.' : 'A good game deserves a rematch.') : 'Clear every safe square. Watch your flags.';
  board(room.cells, room.settings, room.me.flags);
  tick();
}
function tick() {
  if (!room) { $('timer').textContent = '00:00'; return; }
  const remaining = Math.ceil((room.startedAt - Date.now()) / 1000);
  if (room.phase === 'playing' && remaining > 0) {
    $('status').textContent = 'Starting in ' + remaining + '…'; $('phase').textContent = remaining + '…';
  }
  const end = room.phase === 'finished' ? room.finishedAt || room.startedAt : Date.now();
  const seconds = room.startedAt ? Math.max(0, Math.floor((end - room.startedAt) / 1000)) : 0;
  $('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function renderDemo() {
  $('setup').querySelectorAll('input,button').forEach(button => button.disabled = false);
  $('room-bar').hidden = $('ready').hidden = $('rematch').hidden = true;
  $('game-title').textContent = 'A clean slate.';
  $('phase').textContent = 'Ready when you are';
  $('status').textContent = 'Choose a difficulty and start a single-player game.';
  $('board-label').textContent = 'SINGLE PLAYER';
  $('mine-count').textContent = '10';
  $('fields').classList.remove('duel'); $('opponent-field').hidden = $('your-field-label').hidden = true;
  $('scoreboard').replaceChildren();
  board(Array(81).fill(null), { width: 9, height: 9 }, [], true);
  tick();
}
setInterval(tick, 250);
setInterval(async () => {
  if (!session || polling || busy || pendingActions) return;
  const current = session;
  polling = true;
  try {
    const data = await request('/' + current.code + '/action', { type: 'ping' }, current);
    if (session === current && !pendingActions) { room = data.room; render(); }
  } catch { if (session === current) $('status').textContent = 'Connection interrupted. Retrying…'; }
  finally { polling = false; }
}, 1000);
const invite = new URL(location.href).searchParams.get('room');
tab(invite ? 'join' : 'solo');
if (invite) $('code').value = invite.toUpperCase();
if (session) {
  try { room = (await request('/' + session.code)).room; render(); }
  catch (e) { session = null; sessionStorage.removeItem('minefield-session'); toast(e.message); renderDemo(); }
} else renderDemo();
