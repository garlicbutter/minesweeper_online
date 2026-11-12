// Optional: PLAYWRIGHT_PATH=/path/to/playwright node tests/browser-smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const guest = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  let soloRequests = 0;
  try {
    await host.goto(base);
    // Solo must work even when every room API request is unavailable.
    await host.route('**/api/**', route => { soloRequests++; return route.abort(); });
    await host.getByRole('button', { name: 'Start single player' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Choose your first square');
    assert.equal(await host.locator('#board .open').count(), 0);
    assert.equal(await host.locator('#timer').textContent(), '00:00');
    await host.waitForTimeout(1200);
    assert.equal(await host.locator('#timer').textContent(), '00:00');
    const latency = await host.evaluate(() => {
      window.firstTile = document.querySelector('#board [data-i="0"]');
      const start = performance.now(); window.firstTile.click();
      return performance.now() - start;
    });
    assert(latency < 100, `Solo click took ${latency} ms`);
    assert(await host.locator('#board [data-i="0"]').evaluate(el => el.classList.contains('open') && !el.classList.contains('mine')));
    assert(await host.evaluate(() => window.firstTile === document.querySelector('#board [data-i="0"]')));
    let solo = await host.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-solo')));
    const mine = solo.board.indexOf(-1);
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    assert.equal(await host.locator('#mine-count').textContent(), '9');
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    await host.locator(`#board [data-i="${mine}"]`).click();
    await host.waitForFunction(() => document.querySelector('#game-title').textContent === 'One mine too many.');
    await host.getByRole('button', { name: 'Play again' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Choose your first square');
    assert.equal(await host.locator('#board .open').count(), 0);
    solo = await host.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-solo')));
    assert.equal(solo.round, 2); assert.equal(solo.board, null);
    assert.equal(soloRequests, 0);
    await host.getByRole('button', { name: 'Leave / Reset' }).click();
    assert.equal(await host.locator('#create').isEnabled(), true);
    assert.equal(await host.evaluate(() => sessionStorage.getItem('minefield-solo')), null);
    await host.reload();
    assert.equal(await host.locator('#room-bar').isVisible(), false);
    await host.unroute('**/api/**');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await host.locator('#name').fill('Host');
    await host.getByRole('button', { name: 'Create challenge' }).click();
    await host.waitForFunction(() => document.querySelector('#room-code').textContent.length === 6);
    const code = await host.locator('#room-code').textContent();
    await guest.goto(base + '/?room=' + code);
    await guest.locator('#name').fill('Friend');
    await guest.getByRole('button', { name: 'Join challenge' }).click();
    await guest.getByRole('button', { name: 'Ready to play' }).click();
    await host.getByRole('button', { name: 'Ready to play' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Choose your first square');
    assert.equal(await host.locator('#board .open').count(), 0);
    assert.equal(await guest.locator('#board .open').count(), 0);
    await host.locator('#board [data-i="0"]').click();
    await host.waitForFunction(() => document.querySelector('#status').textContent.includes('Waiting for your friend'));
    await guest.locator('#board [data-i="80"]').click();
    await host.waitForFunction(() => document.querySelectorAll('#board .open').length > 0);
    await guest.waitForFunction(() => document.querySelectorAll('#opponent-board .cleared').length > 0);
    assert.equal(await host.locator('#board [data-i="0"].mine').count(), 0);
    assert.equal(await guest.locator('#board [data-i="80"].mine').count(), 0);
    assert.equal(await host.locator('#scoreboard progress').count(), 2);
    await host.screenshot({ path: '/tmp/minefield-desktop.png', fullPage: true });
    await host.setViewportSize({ width: 390, height: 844 });
    assert(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const own = await host.locator('.player-field').boundingBox(), rival = await host.locator('.opponent-field').boundingBox();
    assert(rival.x > own.x); assert(Math.abs(rival.y - own.y) < 2);
    await host.screenshot({ path: '/tmp/minefield-mobile.png', fullPage: true });
    // Reset must finish immediately while a multiplayer action is stuck in flight.
    let release;
    const gate = new Promise(resolve => release = resolve);
    await host.route('**/api/rooms/**/action', async route => {
      if (route.request().postDataJSON().type === 'flag') { await gate; await route.abort().catch(() => {}); }
      else await route.continue();
    });
    const covered = host.locator('#board .cell:not(.open)').first();
    await covered.click({ button: 'right' });
    const resetLatency = await host.evaluate(() => {
      const start = performance.now(); document.querySelector('#leave').click();
      return { ms: performance.now() - start, enabled: !document.querySelector('#create').disabled, session: sessionStorage.getItem('minefield-session') };
    });
    release();
    assert(resetLatency.ms < 100); assert(resetLatency.enabled); assert.equal(resetLatency.session, null);
    await guest.waitForFunction(() => document.querySelector('#phase').textContent === 'Round complete');
    await host.waitForTimeout(1200);
    assert.equal(await host.locator('#room-bar').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(`Browser QA passed: solo click ${latency.toFixed(1)} ms without API access, persistent tiles, safe first clicks, covered replay, multiplayer progress, instant reset during a stalled request, and mobile layout.`);
  } finally {
    for (const page of [host, guest]) await page.evaluate(() => document.querySelector('#leave')?.click()).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
