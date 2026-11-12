// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/statistics.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  async function fixture(legacy = false) {
    await page.goto(base);
    await page.evaluate(async legacy => {
      const { create } = await import('/game.js');
      const r = create({ width:5, height:5, mines:1, solo:true });
      const board = Array(25).fill(0); board[0] = -1;
      for (const i of [1,5,6]) board[i] = 1;
      Object.assign(r, { phase:'playing', availableAt:Date.now()-1000, startedAt:Date.now()-1000 });
      Object.assign(r.players[0], { ready:true, opening:6, board });
      if (legacy) delete r.players[0].clicks;
      sessionStorage.setItem('minefield-solo', JSON.stringify(r));
    }, legacy);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#phase').textContent === 'Playing');
  }
  async function metrics() {
    return page.locator('.round-statistics').evaluate(el => Object.fromEntries([...el.children].map(child => [child.querySelector('dt').textContent, child.querySelector('dd').textContent])));
  }
  try {
    await fixture();
    assert.equal(await page.locator('.round-statistics').count(), 0);
    await page.locator('#board [data-i="6"]').click();
    await page.locator('#board [data-i="6"]').click(); // A wasted chord counts once.
    await page.locator('#board [data-i="0"]').click({ button:'right' });
    await page.locator('#board [data-i="6"]').click();
    let stats = await metrics();
    assert.equal(stats['3BV'], '1'); assert.equal(stats['Solved 3BV'], '1');
    assert.equal(stats.Clicks, '4'); assert.equal(stats.Efficiency, '25.0%');
    assert(parseFloat(stats.Time) >= 1);
    await page.reload();
    await page.locator('.round-statistics').waitFor();
    assert.deepEqual(await metrics(), stats);
    await page.setViewportSize({ width:390, height:844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path:'/tmp/minefield-statistics-mobile.png', fullPage:true });
    await page.locator('#reset-face').click();
    assert.equal(await page.locator('.round-statistics').count(), 0);
    assert.equal(await page.locator('#board .open').count(), 0);

    await fixture();
    await page.locator('#board [data-i="0"]').click();
    stats = await metrics();
    assert.equal(stats['3BV'], '1'); assert.equal(stats['Solved 3BV'], '0');
    assert.equal(stats.Clicks, '1'); assert.equal(stats.Efficiency, '0.0%');
    await fixture(true);
    await page.locator('#board [data-i="0"]').click();
    stats = await metrics();
    assert.equal(stats.Clicks, '—'); assert.equal(stats.Efficiency, '—');
    assert((await page.locator('#scoreboard').textContent()).includes('Click history unavailable'));
    assert.deepEqual(errors, []);
    console.log('Statistics QA passed: Rust/WASM 3BV, partial efficiency, wasted chord counted once, flags, saved results, fresh reset, legacy history, and mobile fit.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
