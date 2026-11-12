// Optional browser QA: PLAYWRIGHT_PATH=/path/to/playwright node tests/browser-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const guest = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  const readRoom = async page => {
    const code = await page.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-session')).code);
    return JSON.parse(await readFile('.data/rooms.json', 'utf8')).find(room => room.code === code);
  };
  try {
    await host.goto(base);
    await host.getByRole('button', { name: 'Start single player' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Your pace. Your game.');
    assert.equal(await host.locator('#board .cell').count(), 81);
    assert.equal(await host.locator('#ready').isVisible(), false);
    assert.equal(await host.locator('#copy').isVisible(), false);
    assert.equal(await host.locator('#opponent-field').isVisible(), false);
    let raw = await readRoom(host);
    assert(raw.solo);
    assert(raw.startedAt <= Date.now());
    let mine = raw.board.indexOf(-1);
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    await host.waitForFunction(() => document.querySelector('#mine-count').textContent === '9');
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    await host.waitForFunction(() => document.querySelector('#mine-count').textContent === '10');
    await host.locator(`#board [data-i="${mine}"]`).click();
    await host.waitForFunction(() => document.querySelector('#game-title').textContent === 'One mine too many.');
    await host.getByRole('button', { name: 'Play again' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Your pace. Your game.');
    raw = await readRoom(host);
    assert.equal(raw.round, 2);
    await host.getByRole('button', { name: 'End game / change mode' }).click();
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.locator('#name').fill('Host');
    await host.getByRole('button', { name: 'Create challenge' }).click();
    await host.waitForFunction(() => document.querySelector('#room-code').textContent.length === 6);
    const code = await host.locator('#room-code').textContent();
    await guest.goto(base + '/?room=' + code);
    assert.equal(await guest.locator('#code').inputValue(), code);
    await guest.locator('#name').fill('Friend');
    await guest.getByRole('button', { name: 'Join challenge' }).click();
    await guest.getByRole('button', { name: 'Ready to play' }).click();
    await host.getByRole('button', { name: 'Ready to play' }).click();
    await host.waitForTimeout(3300);
    raw = await readRoom(host);
    const safe = raw.board.findIndex((value, index) => value !== -1 && !raw.players[0].revealed.includes(index));
    const previous = raw.players[0].revealed.length;
    assert(safe >= 0);
    await host.locator(`#board [data-i="${safe}"]`).click();
    await guest.waitForFunction(before => document.querySelectorAll('#opponent-board .cleared').length > before, previous);
    assert.equal(await host.locator('#scoreboard progress').count(), 2);
    assert(await host.locator('#opponent-field').isVisible());
    assert.equal(await guest.locator('#opponent-board').locator('button').count(), 0);
    const map = await host.locator('#opponent-board').boundingBox();
    const frame = await host.locator('.opponent-field .board-wrap').boundingBox();
    assert(map.height < frame.height);
    await host.screenshot({ path: '/tmp/minefield-desktop.png', fullPage: true });
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({ path: '/tmp/minefield-mobile.png', fullPage: true });
    assert(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const own = await host.locator('.player-field').boundingBox();
    const rival = await host.locator('.opponent-field').boundingBox();
    assert(rival.x > own.x);
    assert(Math.abs(rival.y - own.y) < 2);
    assert.deepEqual(errors, []);
    console.log('Browser QA passed: immediate solo, flags, loss, replay, room invite, two-player readiness, live side-by-side maps, and mobile layout.');
  } finally {
    // Clean up rooms created by QA; these are isolated browser sessions.
    for (const page of [host, guest]) {
      await page.evaluate(async () => {
        const s = JSON.parse(sessionStorage.getItem('minefield-session'));
        if (s) await fetch('/api/rooms/' + s.code + '/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token }, body: JSON.stringify({ type: 'leave' }) });
      }).catch(() => {});
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
