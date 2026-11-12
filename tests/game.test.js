import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings, generate, neighbors, create, player, act, view } from '../src/game.js';

test('mine counts, protected openings, and clues remain correct at all preset difficulties', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) for (let k = 0; k < 25; k++) {
    const s = settings({ difficulty }), opening = k % (s.width * s.height), board = generate(s, opening);
    assert.equal(board.filter(n => n === -1).length, s.mines);
    for (const index of [opening, ...neighbors(opening, s)]) assert.notEqual(board[index], -1);
    for (let i = 0; i < board.length; i++) if (board[i] !== -1)
      assert.equal(board[i], neighbors(i, s).filter(j => board[j] === -1).length);
  }
});
test('invalid custom settings are rejected', () => {
  for (const s of [{ width: 4, height: 9, mines: 1 }, { width: 9, height: 9, mines: 73 }, { width: 9.5, height: 9, mines: 10 }])
    assert.throws(() => settings(s));
});
test('solo starts completely covered with no clock; any actual first click is safe', () => {
  for (const opening of [0, 8, 40, 72, 80]) {
    const r = create({ difficulty: 'easy', solo: true }), p = r.players[0];
    act(r, p.id, { type: 'ready' });
    assert.equal(r.board, null); assert.equal(r.startedAt, null);
    assert(view(r, p.id).cells.every(c => c === null));
    act(r, p.id, { type: 'flag', index: opening });
    act(r, p.id, { type: 'reveal', index: opening });
    assert.equal(r.board, null); // A flagged cell cannot consume the safe opening.
    act(r, p.id, { type: 'flag', index: opening });
    act(r, p.id, { type: 'reveal', index: opening });
    assert.notEqual(r.board[opening], -1); assert.equal(r.board[opening], 0);
    assert(p.revealed.includes(opening)); assert(r.startedAt <= Date.now());
  }
});
test('multiplayer accepts different openings and protects both on the identical map', () => {
  for (const mines of [10, 72]) {
    const r = create({ width: 9, height: 9, mines }), p = r.players[0], q = player('Friend'); r.players.push(q);
    act(r, p.id, { type: 'ready' }); assert.equal(r.phase, 'waiting');
    act(r, q.id, { type: 'ready' }); assert.equal(r.phase, 'playing');
    assert.equal(r.board, null); assert.equal(r.startedAt, null);
    assert.throws(() => act(r, p.id, { type: 'reveal', index: 0 }));
    r.availableAt = Date.now() - 1;
    act(r, p.id, { type: 'reveal', index: 0 });
    assert.equal(r.board, null); assert.deepEqual(p.revealed, []);
    act(r, p.id, { type: 'reveal', index: 1 }); assert.equal(p.opening, 0);
    act(r, q.id, { type: 'reveal', index: 80 });
    assert.equal(r.board.filter(v => v === -1).length, mines);
    assert.notEqual(r.board[0], -1); assert.notEqual(r.board[80], -1);
    assert(p.revealed.includes(0)); assert(q.revealed.includes(80));
    assert(!JSON.stringify(view(r, p.id)).includes(q.id));
  }
});
function fixture() {
  const r = create({ width: 5, height: 5, mines: 1 });
  r.board = Array(25).fill(0); r.board[0] = -1;
  for (const i of [1, 5, 6]) r.board[i] = 1;
  r.phase = 'playing'; r.startedAt = Date.now() - 5000; r.players[0].revealed = [6];
  return r;
}
test('left-click chording requires matching flags and reveals every safe neighbor', () => {
  const r = fixture(), p = r.players[0];
  act(r, p.id, { type: 'reveal', index: 6 }); assert.deepEqual(p.revealed, [6]);
  act(r, p.id, { type: 'flag', index: 0 }); act(r, p.id, { type: 'reveal', index: 6 });
  assert.equal(p.status, 'won'); assert.equal(p.revealed.length, 24); assert(!p.revealed.includes(0));
});
test('incorrect chord flags lose and award the opponent', () => {
  const r = fixture(), p = r.players[0], q = player('Friend'); r.players.push(q);
  act(r, p.id, { type: 'flag', index: 1 }); act(r, p.id, { type: 'reveal', index: 6 });
  assert.equal(p.status, 'lost'); assert.equal(r.winner, q.id); assert.equal(r.phase, 'finished');
});
test('forfeit awards opponent and rematch starts with zero revealed tiles', () => {
  const r = fixture(), p = r.players[0], q = player('Friend'); r.players.push(q);
  act(r, p.id, { type: 'leave' }); assert.equal(r.winner, q.id);
  act(r, p.id, { type: 'rematch' });
  assert.equal(r.board, null); assert.equal(r.startedAt, null); assert.equal(r.round, 2);
  assert(r.players.every(p => p.opening === null && p.revealed.length === 0 && !p.ready));
});
test('opponent progress never exposes hidden clues, flag positions, or session tokens', () => {
  const r = fixture(), p = r.players[0], q = player('Friend'); r.players.push(q);
  q.revealed = [0, 1, 6]; q.flags = [2]; q.status = 'lost'; r.phase = 'finished'; r.winner = q.id;
  const v = view(r, p.id), opponent = v.players.find(p => !p.you);
  assert.deepEqual(opponent.clearedCells, [1, 6]); assert.equal(opponent.flags, 1);
  assert(!JSON.stringify(v).includes(q.id)); assert(!('board' in v));
});
