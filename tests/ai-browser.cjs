// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/ai-browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  const room = () => page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('minefield-session'));
    return (await (await fetch('/api/rooms/' + s.code, { headers: { Authorization: 'Bearer ' + s.token } })).json()).room;
  });
  try {
    await page.goto(base);
    assert.equal(await page.locator('.intro,.bottom-note,.header-note,footer').count(), 0);
    assert.equal(await page.locator('h1').count(), 0);
    await page.getByRole('button', { name: 'vs AI', exact: true }).click();
    assert.equal(await page.locator('#game-title').textContent(),'vs AI');
    await page.locator('[data-level="hard"]').click();
    await page.getByRole('button', { name: 'Start vs AI' }).click();
    await page.waitForFunction(() => document.querySelector('#phase').textContent === 'Lobby');
    let snapshot = await room();
    assert.equal(snapshot.solo, false); assert.equal(snapshot.players.length, 2);
    assert.equal(snapshot.players[1].bot, true); assert.equal(snapshot.players[1].ready, true);
    assert(snapshot.players[1].cells.every(c => c === null));
    assert.equal(await page.locator('#copy').isVisible(), false);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#phase').textContent === 'Lobby');
    assert(await page.locator('#ai-tab').evaluate(el => el.classList.contains('selected')));
    assert.equal(await page.locator('#create').isVisible(),false);
    await page.locator('#ready').click();
    await page.waitForFunction(() => document.querySelectorAll('#opponent-board .cleared').length > 0);
    assert.equal(await page.locator('#board .open').count(), 0);
    assert.equal(await page.locator('#opponent-board .mine').count(), 99);
    await page.locator('#board [data-i="0"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#board .open').length > 0);
    // Block UI polling and prove that the server scheduler still advances the AI.
    await page.route('**/api/rooms/**/action', route => route.request().postDataJSON().type === 'ping' ? route.abort() : route.continue());
    snapshot = await room();
    await page.waitForFunction(async before => {
      const s = JSON.parse(sessionStorage.getItem('minefield-session'));
      const r = (await (await fetch('/api/rooms/' + s.code, { headers: { Authorization: 'Bearer ' + s.token } })).json()).room;
      return r.version > before;
    }, snapshot.version);
    await page.unroute('**/api/rooms/**/action');
    // Forfeit through the normal API, then exercise the visible rematch flow.
    await page.evaluate(async () => {
      const s = JSON.parse(sessionStorage.getItem('minefield-session'));
      await fetch('/api/rooms/' + s.code + '/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token }, body: JSON.stringify({ type: 'leave' }) });
    });
    await page.waitForFunction(() => document.querySelector('#game-title').textContent === 'AI wins');
    const finished = await room();
    await page.waitForTimeout(900); assert.equal((await room()).version, finished.version);
    await page.locator('#rematch').click();
    await page.waitForFunction(() => document.querySelector('#phase').textContent === 'Lobby');
    snapshot = await room();
    assert.equal(snapshot.players[1].ready, true); assert.equal(snapshot.players[1].cleared, 0);
    assert(snapshot.players[1].cells.every(c => c === null));
    await page.locator('#ready').click();
    await page.waitForFunction(() => document.querySelectorAll('#opponent-board .cleared').length > 0);
    await page.locator('#board [data-i="0"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#board .open').length > 0);
    await page.screenshot({ path: '/tmp/minefield-ai-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/minefield-ai-mobile.png', fullPage: true });
    await page.locator('#leave').click();
    assert.equal(await page.locator('#create').isEnabled(), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('minefield-session')), null);
    assert.deepEqual(errors, []);
    console.log('AI browser QA passed: clean layout, AI readiness, autonomous moves without polling, normal forfeit/rematch, full opponent board, reset, and mobile layout.');
  } finally {
    await page.evaluate(() => document.querySelector('#leave')?.click()).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
