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
    assert.equal(await host.locator('#board .cell').first().evaluate(el => getComputedStyle(el).userSelect), 'none');
    await host.evaluate(() => getSelection().removeAllRanges());
    const number = host.locator('#board .cell.open').filter({ hasText: /[1-8]/ }).first();
    const bounds = await number.boundingBox();
    await host.mouse.move(bounds.x + 8, bounds.y + 8); await host.mouse.down();
    await host.mouse.move(bounds.x + 70, bounds.y + 8, { steps: 8 }); await host.mouse.up();
    assert.equal(await host.evaluate(() => getSelection().toString()), '');
    let solo = await host.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-solo')));
    const mine = solo.players[0].board.indexOf(-1);
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    assert.equal(await host.locator('#mine-count').textContent(), '9');
    await host.locator(`#board [data-i="${mine}"]`).click({ button: 'right' });
    await host.locator(`#board [data-i="${mine}"]`).click();
    await host.waitForFunction(() => document.querySelector('#game-title').textContent === 'One mine too many.');
    await host.getByRole('button', { name: 'Play again' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Choose your first square');
    assert.equal(await host.locator('#board .open').count(), 0);
    solo = await host.evaluate(() => JSON.parse(sessionStorage.getItem('minefield-solo')));
    assert.equal(solo.round, 2); assert.equal(solo.players[0].board, null);
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
    await guest.locator('[data-level="hard"]').click();
    await guest.getByRole('button', { name: 'Join challenge' }).click();
    await guest.waitForFunction(() => document.querySelector('#phase').textContent === 'In the lobby');
    await guest.locator('[data-level="custom"]').click();
    await guest.locator('#width').fill('12'); await guest.locator('#height').fill('10'); await guest.locator('#mines').fill('25');
    await guest.getByRole('button', { name: 'Ready to play' }).click();
    await host.getByRole('button', { name: 'Ready to play' }).click();
    await host.waitForFunction(() => document.querySelector('#phase').textContent === 'Choose your first square');
    assert.equal(await host.locator('#board .open').count(), 0);
    assert.equal(await guest.locator('#board .open').count(), 0);
    await host.locator('#board [data-i="0"]').click();
    await host.waitForFunction(() => document.querySelectorAll('#board .open').length > 0);
    assert.equal(await guest.locator('#board .open').count(), 0);
    await guest.locator('#board [data-i="119"]').click();
    await host.waitForFunction(() => document.querySelectorAll('#board .open').length > 0);
    await guest.waitForFunction(() => document.querySelectorAll('#opponent-board .cleared').length > 0);
    assert.equal(await host.locator('#board [data-i="0"].mine').count(), 0);
    assert.equal(await guest.locator('#board [data-i="119"].mine').count(), 0);
    await host.waitForFunction(() => document.querySelectorAll('#opponent-board .mine').length === 25);
    await guest.waitForFunction(() => document.querySelectorAll('#opponent-board .mine').length === 10);
    assert.equal(await guest.locator('#board .cell').count(),120);
    assert.equal(await host.locator('#opponent-board .cell').count(),120);
    assert.equal(await host.locator('#scoreboard progress').nth(0).getAttribute('max'),'71');
    assert.equal(await host.locator('#scoreboard progress').nth(1).getAttribute('max'),'95');
    const target = Number(await guest.locator('#opponent-board .mine').first().getAttribute('data-index'));
    await host.locator(`#board [data-i="${target}"]`).click();
    await host.waitForFunction(() => document.querySelector('#toast').textContent.includes('area reset and reshuffled'));
    const blast = await host.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem('minefield-session'));
      return (await (await fetch('/api/rooms/'+s.code,{headers:{Authorization:'Bearer '+s.token}})).json()).room;
    });
    assert.equal(blast.phase,'playing'); assert.equal(blast.me.hits,1); assert.equal(blast.me.explosion.cells.length,36);
    assert(blast.me.explosion.cells.every(i => blast.cells[i] === null));
    assert.equal(await host.locator('#board .blast').count(),36);
    await guest.waitForFunction(index => !document.querySelector(`#opponent-board [data-index="${index}"]`).classList.contains('mine'),target);
    assert.equal(await guest.locator('#opponent-board .mine').count(),10);
    assert(await guest.locator('#opponent-board .n1').count() > 0);
    // Leaving is still immediate; mine hits alone no longer finish the round.
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
    console.log(`Browser QA passed: solo click ${latency.toFixed(1)} ms without API access, persistent tiles, safe first clicks, covered replay, multiplayer progress, independent preset/custom maps, full opponent clues/mines, 6x6 explosion and continued play, nonselectable tiles, instant reset during a stalled request, and mobile layout.`);
  } finally {
    for (const page of [host, guest]) await page.evaluate(() => document.querySelector('#leave')?.click()).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
