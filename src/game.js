export const PRESETS = {
  easy: { width: 9, height: 9, mines: 10 },
  medium: { width: 16, height: 16, mines: 40 },
  hard: { width: 30, height: 16, mines: 99 }
};
export function settings(input = {}) {
  const { width = 16, height = 16, mines = 40 } = PRESETS[input.difficulty] || input;
  if (![width, height, mines].every(Number.isInteger) || width < 5 || width > 40 || height < 5 || height > 30 || mines < 1 || mines > width * height - 9)
    throw Error('Use a width of 5–40, height of 5–30, and 1 to (cells − 9) mines.');
  return { width, height, mines };
}
export function neighbors(index, s) {
  const result = [], x = index % s.width, y = Math.floor(index / s.width);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if ((dx || dy) && x + dx >= 0 && x + dx < s.width && y + dy >= 0 && y + dy < s.height)
      result.push((y + dy) * s.width + x + dx);
  return result;
}
function randomInt(n) {
  const limit = 2 ** 32 - (2 ** 32 % n), value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % n;
}
export function generate(s, opening, otherOpenings = []) {
  // Reserve every chosen opening before adding safe neighborhoods, including dense custom maps.
  const openings = [...new Set([opening, ...otherOpenings])], safe = new Set(openings);
  for (const index of openings) {
    const expanded = new Set([...safe, ...neighbors(index, s)]);
    if (expanded.size <= s.width * s.height - s.mines) for (const cell of expanded) safe.add(cell);
  }
  const candidates = Array.from({ length: s.width * s.height }, (_, i) => i).filter(i => !safe.has(i));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const board = Array(s.width * s.height).fill(0);
  for (const index of candidates.slice(0, s.mines)) board[index] = -1;
  for (let i = 0; i < board.length; i++) if (board[i] !== -1)
    board[i] = neighbors(i, s).filter(j => board[j] === -1).length;
  return board;
}
export function player(name) {
  return { id: crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''), name: String(name || 'Player').trim().slice(0, 24) || 'Player', ready: false, opening: null, revealed: [], flags: [], status: 'playing', lastSeen: Date.now() };
}
export function create(input) {
  return {
    code: Array.from(crypto.getRandomValues(new Uint8Array(6)), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join(''),
    settings: settings(input), players: [player(input.name)], phase: 'waiting', solo: !!input.solo,
    board: null, availableAt: null, startedAt: null, finishedAt: null, winner: null, round: 1, createdAt: Date.now(), version: 0
  };
}
function reveal(r, p, indices) {
  const seen = new Set(p.revealed), flags = new Set(p.flags), queue = [...indices];
  while (queue.length) {
    const index = queue.pop();
    if (seen.has(index) || flags.has(index)) continue;
    seen.add(index);
    if (r.board[index] === -1) { p.status = 'lost'; break; }
    if (r.board[index] === 0) for (const n of neighbors(index, r.settings)) if (!seen.has(n)) queue.push(n);
  }
  p.revealed = [...seen];
  if (p.status !== 'lost' && seen.size === r.board.length - r.settings.mines) p.status = 'won';
}
function finish(r) {
  const winners = r.players.filter(p => p.status === 'won'), loser = r.players.find(p => p.status === 'lost');
  if (!winners.length && !loser) return;
  r.phase = 'finished'; r.finishedAt = Date.now();
  r.winner = winners.length > 1 ? null : winners[0]?.id || r.players.find(p => p !== loser)?.id || null;
}
export function act(r, id, input) {
  const p = r.players.find(p => p.id === id);
  if (!p) throw Error('This player is not in the room.');
  p.lastSeen = Date.now();
  if (input.type === 'ping') return;
  if (input.type === 'ready') {
    if (r.phase !== 'waiting') throw Error('The round has already started.');
    p.ready = !p.ready;
    if (r.players.length === (r.solo ? 1 : 2) && r.players.every(p => p.ready)) {
      r.availableAt = Date.now() + (r.solo ? 0 : 3000); r.phase = 'playing';
      // No board generation or automatic reveals: wait for each player's actual first click.
    }
    return;
  }
  if (input.type === 'rematch') {
    if (r.phase !== 'finished' || p !== r.players[0]) throw Error('The host can start a rematch after the round.');
    Object.assign(r, { phase: 'waiting', board: null, availableAt: null, startedAt: null, finishedAt: null, winner: null, round: r.round + 1 });
    for (const q of r.players) Object.assign(q, { ready: false, opening: null, revealed: [], flags: [], status: 'playing' });
    return;
  }
  if (input.type === 'leave') {
    if (r.phase === 'playing') { p.status = 'lost'; finish(r); }
    else if (r.phase === 'waiting') r.players = r.players.filter(q => q !== p);
    return;
  }
  if (r.phase !== 'playing' || Date.now() < (r.availableAt ?? r.startedAt) || p.status !== 'playing') throw Error('The board is not active.');
  const index = input.index;
  if (!Number.isInteger(index) || index < 0 || index >= r.settings.width * r.settings.height) throw Error('Invalid cell.');
  if (input.type === 'flag') {
    if (!p.revealed.includes(index) && index !== p.opening) {
      if (p.flags.includes(index)) p.flags = p.flags.filter(n => n !== index);
      else if (p.flags.length < r.settings.mines) p.flags.push(index);
    }
    return;
  }
  if (input.type !== 'reveal') throw Error('Unknown action.');
  if (p.flags.includes(index)) return;
  if (!r.board) {
    if (p.opening !== null) return;
    p.opening = index;
    if (!r.players.every(q => q.opening !== null)) return;
    const openings = r.players.map(q => q.opening);
    r.board = generate(r.settings, openings[0], openings.slice(1));
    r.startedAt = Date.now();
    for (const q of r.players) reveal(r, q, [q.opening]);
  } else if (p.revealed.includes(index)) {
    const ns = neighbors(index, r.settings);
    if (r.board[index] > 0 && ns.filter(n => p.flags.includes(n)).length === r.board[index])
      reveal(r, p, ns.filter(n => !p.flags.includes(n)));
  } else reveal(r, p, [index]);
  finish(r);
}
export function view(r, id) {
  const p = r.players.find(q => q.id === id);
  if (!p) throw Error('Room session expired. Rejoin with the room code.');
  const revealed = new Set(p.revealed);
  return {
    code: r.code, settings: r.settings, phase: r.phase, solo: r.solo, availableAt: r.availableAt,
    startedAt: r.startedAt, finishedAt: r.finishedAt, version: r.version,
    winner: r.winner === null ? null : r.winner === id ? 'you' : 'opponent', round: r.round,
    host: r.players[0]?.id === id, me: { ...p, id: undefined },
    players: r.players.map(q => {
      const clearedCells = q.revealed.filter(i => r.board?.[i] !== -1);
      return { name: q.name, you: q.id === id, ready: q.ready, openingChosen: q.opening !== null, status: q.status, cleared: clearedCells.length, flags: q.flags.length, clearedCells, online: Date.now() - q.lastSeen < 15000, winner: r.winner === q.id };
    }),
    cells: Array.from({ length: r.settings.width * r.settings.height }, (_, i) => revealed.has(i) ? r.board[i] : r.phase === 'finished' && r.board?.[i] === -1 ? -1 : null)
  };
}
