// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/xp-theme.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  async function fixture(flags = []) {
    await page.goto(base);
    await page.evaluate(async flags => {
      const { create } = await import('/game.js');
      const r = create({ width:5,height:5,mines:1,solo:true });
      const board=Array(25).fill(0);board[0]=-1;for(const i of [1,5,6])board[i]=1;
      Object.assign(r,{phase:'playing',availableAt:Date.now()-1000,startedAt:Date.now()-1000});
      Object.assign(r.players[0],{ready:true,opening:6,board,revealed:[6],flags});
      sessionStorage.setItem('minefield-solo',JSON.stringify(r));
    },flags);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#phase').textContent==='Playing');
  }
  try {
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#mine-led').dataset.value==='010');
    assert.equal(await page.locator('#timer-led').getAttribute('data-value'),'000');
    assert.equal(await page.locator('.lcd-digit').first().locator('.lit').count(),6);
    const raised=await page.locator('#board .cell').first().evaluate(el=>{
      const s=getComputedStyle(el);return { bg:s.backgroundColor,top:s.borderTopColor,right:s.borderRightColor,radius:s.borderRadius,selection:s.userSelect };
    });
    assert.deepEqual(raised,{bg:'rgb(192, 192, 192)',top:'rgb(255, 255, 255)',right:'rgb(128, 128, 128)',radius:'0px',selection:'none'});
    await page.locator('#create').click();
    await page.locator('#board [data-i="0"]').hover();await page.mouse.down();
    assert.equal(await page.locator('#reset-face').getAttribute('data-mood'),'surprised');
    await page.mouse.up();
    assert.equal(await page.locator('#reset-face').getAttribute('data-mood'),'normal');
    assert.equal(await page.locator('#board').evaluate(el=>getComputedStyle(el).gap),'0px');
    await page.locator('#reset-face').click();
    assert.equal(await page.locator('#board .open').count(),0);
    assert.equal(await page.locator('#timer-led').getAttribute('data-value'),'000');
    assert.equal(await page.locator('#mine-led').getAttribute('data-value'),'010');
    assert.equal(await page.locator('#setup').isVisible(),false);

    await fixture();
    const clue=await page.locator('#board [data-i="6"]').evaluate(el=>({color:getComputedStyle(el).color,mask:getComputedStyle(el,'::after').maskImage}));
    assert.equal(clue.color,'rgb(0, 0, 255)');assert(clue.mask.includes('data:image/svg+xml'));
    await page.locator('#board [data-i="0"]').click({button:'right'});
    assert.equal(await page.locator('#mine-led').getAttribute('data-value'),'000');
    await page.locator('#board [data-i="6"]').click();
    assert.equal(await page.locator('#reset-face').getAttribute('data-mood'),'won');
    await page.locator('#reset-face').click();
    assert.equal(await page.locator('#board .open').count(),0);
    await fixture(); await page.locator('#board [data-i="0"]').click();
    assert.equal(await page.locator('#reset-face').getAttribute('data-mood'),'lost');
    assert.equal(await page.locator('#board [data-i="0"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 0, 0)');
    await page.screenshot({path:'/tmp/minefield-xp-lost.png',fullPage:true});
    await page.locator('#leave').click();
    await page.locator('[data-level="easy"]').click();
    await page.locator('#create').click();
    await page.locator('#board [data-i="0"]').click();
    await page.screenshot({path:'/tmp/minefield-xp-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(100);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'/tmp/minefield-xp-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('XP theme QA passed: raised gray tiles, pixel clues, seven-segment counters, zero-gap grid, pressed/win/loss smiley states, solo reset, struck-mine highlight, and mobile layout.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
