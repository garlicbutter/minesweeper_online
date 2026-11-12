// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/chord-preview.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  const state = (target = page) => target.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-solo')));
  async function fixture({ flags = [], revealed = [6] } = {}, target = page) {
    await target.goto(base);
    await target.evaluate(async ({ flags, revealed }) => {
      const { create } = await import('/game.js');
      const room = create({ width: 5, height: 5, mines: 7, solo: true });
      const mines = new Set([0, 2, 4, 10, 14, 20, 24]);
      const board = Array.from({ length: 25 }, (_, i) => {
        if (mines.has(i)) return -1;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = i % 5 + dx, y = Math.floor(i / 5) + dy;
          if ((dx || dy) && x >= 0 && x < 5 && y >= 0 && y < 5 && mines.has(y * 5 + x)) count++;
        }
        return count;
      });
      Object.assign(room, { phase: 'playing', availableAt: Date.now() - 1000, startedAt: Date.now() - 1000 });
      Object.assign(room.players[0], { ready: true, opening: 6, board, flags, revealed });
      sessionStorage.removeItem('minefield-session');
      sessionStorage.setItem('minefield-solo', JSON.stringify(room));
    }, { flags, revealed });
    await target.reload();
    await target.waitForFunction(() => document.querySelector('#phase').textContent === 'Playing');
  }
  async function press(index, button = 'left') {
    await page.locator(`#board [data-i="${index}"]`).hover();
    await page.mouse.down({ button });
  }
  try {
    await fixture();
    await press(6);
    assert.equal(await page.locator('.chord-neighbor').count(), 8);
    assert.equal(await page.locator('.chord-source').count(), 1);
    assert.deepEqual((await state()).players[0].revealed, [6]);
    // A Rust-backed rerender during the hold must preserve the neighborhood preview.
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('f');
    assert.equal(await page.locator('.chord-neighbor').count(), 8);
    await page.keyboard.press('f');
    assert.equal(await page.locator('.chord-neighbor').count(), 8);
    const held = await state();
    await page.mouse.move(5, 5); await page.mouse.up();
    assert.equal(await page.locator('.chord-neighbor,.chord-source').count(), 0);
    assert.deepEqual((await state()).players[0].revealed, [6]);
    assert.equal((await state()).version, held.version); // No second chord or stray cell reveal on release.

    await fixture({ flags: [0] }); // Under-flagged: one flag for a three.
    await press(6); assert.equal(await page.locator('.chord-neighbor').count(), 8);
    await page.mouse.up(); assert.deepEqual((await state()).players[0].revealed, [6]);
    assert.equal(await page.locator('.chord-neighbor').count(), 0);

    await fixture({ flags: [0, 2, 10, 11] }); // Over-flagged: four flags for a three.
    await press(6); assert.equal(await page.locator('.chord-neighbor').count(), 8);
    await page.mouse.up(); assert.deepEqual((await state()).players[0].revealed, [6]);

    await fixture({ flags: [0, 2, 10] });
    await press(6);
    const chorded = await state();
    assert(chorded.players[0].revealed.length > 1); // Matching flags reveal on press, before release.
    assert(!chorded.players[0].revealed.some(i => chorded.players[0].board[i] === -1));
    await page.mouse.up(); assert.equal((await state()).version, chorded.version);
    assert.equal(await page.locator('.chord-neighbor,.chord-source').count(), 0);

    await fixture({ flags: [0, 2, 10] });
    await page.locator('#board [data-i="6"]').focus(); await page.keyboard.press('Enter');
    assert((await state()).players[0].revealed.length > 1);
    assert.equal(await page.locator('.chord-neighbor').count(), 0);

    await fixture({ revealed: [1] });
    await press(1); assert.equal(await page.locator('.chord-neighbor').count(), 5);
    assert.equal(await page.locator('[data-i="4"].chord-neighbor').count(), 0);
    await page.mouse.up(); assert.equal(await page.locator('.chord-neighbor').count(), 0);

    await fixture();
    await press(6, 'right'); assert.equal(await page.locator('.chord-neighbor').count(), 0);
    await page.mouse.up({ button: 'right' });
    await press(6); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.locator('.chord-neighbor,.chord-source').count(), 0);
    await page.mouse.up();
    await press(6);
    await page.evaluate(() => document.querySelector('#leave').click());
    assert.equal(await page.locator('.chord-neighbor,.chord-source').count(), 0);
    await page.mouse.up(); assert.equal(await page.locator('#room-bar').isVisible(), false);

    await fixture({ flags: [0, 5, 10] }); // Correct count with an incorrect flag still triggers the normal mine rule.
    await press(6); assert.equal((await state()).phase, 'finished');
    assert.equal(await page.locator('.chord-neighbor,.chord-source').count(), 0);
    await page.mouse.up();
    const touch = await browser.newPage({ hasTouch: true });
    touch.on('pageerror', error => errors.push(error.message));
    await fixture({ flags: [0, 2, 10] }, touch);
    await touch.locator('#board [data-i="6"]').scrollIntoViewIfNeeded();
    const touchBounds = await touch.locator('#board [data-i="6"]').boundingBox();
    const cdp = await touch.context().newCDPSession(touch);
    const point = { x: touchBounds.x + 10, y: touchBounds.y + 10 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    assert.equal(await touch.locator('.chord-neighbor').count(), 8);
    assert.deepEqual((await state(touch)).players[0].revealed, [6]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await touch.locator('.chord-neighbor').count(), 0);
    assert.deepEqual((await state(touch)).players[0].revealed, [6]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.waitForFunction(() => JSON.parse(sessionStorage.getItem('minefield-solo')).players[0].revealed.length > 1);
    assert.equal(await touch.locator('.chord-neighbor').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Chord preview passed: holds, rerenders, mismatched flags, matching chord on press, no double action, edge bounds, outside release, keyboard, blur/reset, touch cancellation/tap, and incorrect flags.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
