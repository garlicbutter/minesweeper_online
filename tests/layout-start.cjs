// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/layout-start.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const guest = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  const snapshot = page => page.evaluate(async () => {
    const s=JSON.parse(sessionStorage.getItem('minefield-session'));
    return (await (await fetch('/api/rooms/'+s.code,{headers:{Authorization:'Bearer '+s.token}})).json()).room;
  });
  async function fits(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result=await page.evaluate(() => [...document.querySelectorAll('.board-wrap')].filter(w=>w.getBoundingClientRect().width>0).map(w=>{
      const last=w.firstElementChild.lastElementChild.getBoundingClientRect(), frame=w.getBoundingClientRect();
      return { overflow:getComputedStyle(w).overflow, width:w.scrollWidth-w.clientWidth,height:w.scrollHeight-w.clientHeight, right:last.right-frame.right,bottom:last.bottom-frame.bottom };
    }));
    for (const r of result) { assert.equal(r.overflow,'visible');assert(r.width<=1);assert(r.height<=1);assert(r.right<=0);assert(r.bottom<=0); }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  try {
    // Simulate two machines whose wall clocks differ by 75 seconds.
    await host.addInitScript(() => { const real=Date.now; Date.now=()=>real()+45000; });
    await guest.addInitScript(() => { const real=Date.now; Date.now=()=>real()-30000; });
    await host.goto(base);
    await host.locator('#create-tab').click(); await host.locator('[data-level="custom"]').click();
    for (const [id,value] of [['width','40'],['height','30'],['mines','300']]) await host.locator('#'+id).fill(value);
    await host.locator('#create').click();
    await host.waitForFunction(()=>document.querySelector('#room-code').textContent.length===6);
    const code=await host.locator('#room-code').textContent();
    await guest.goto(base+'/?room='+code); await guest.locator('[data-level="custom"]').click();
    for (const [id,value] of [['width','40'],['height','30'],['mines','300']]) await guest.locator('#'+id).fill(value);
    await guest.locator('#join').click(); await guest.waitForFunction(()=>document.querySelector('#phase').textContent==='Lobby');
    for (const page of [host,guest]) await page.evaluate(()=>{
      new MutationObserver(()=>{
        if (!window.observedStart && document.querySelector('#phase').textContent==='Choose your first square') window.observedStart=performance.timeOrigin+performance.now();
      }).observe(document.querySelector('#phase'),{childList:true,subtree:true,characterData:true});
    });
    await host.locator('#ready').click();
    assert.equal((await snapshot(host)).startedAt,null); assert.equal((await snapshot(guest)).startedAt,null);
    await guest.locator('#ready').click();
    const a=await snapshot(host), b=await snapshot(guest);
    assert.equal(a.startedAt,a.availableAt); assert.equal(a.startedAt,b.startedAt);
    assert(a.startedAt>a.serverNow);
    // A direct request cannot bypass the common start deadline.
    for (const page of [host,guest]) assert.equal(await page.evaluate(async()=>{
      const s=JSON.parse(sessionStorage.getItem('minefield-session'));
      return (await fetch('/api/rooms/'+s.code+'/action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.token},body:JSON.stringify({type:'reveal',index:0})})).status;
    }),400);
    await Promise.all([host,guest].map(page=>page.waitForFunction(()=>window.observedStart)));
    const starts=await Promise.all([host,guest].map(page=>page.evaluate(()=>window.observedStart)));
    assert(Math.abs(starts[0]-starts[1])<400,`Start display skew ${Math.abs(starts[0]-starts[1])} ms`);
    assert.equal(await host.locator('#board .open').count(),0); assert.equal(await guest.locator('#board .open').count(),0);
    await host.waitForTimeout(1300);
    assert.equal(await host.locator('#timer').textContent(),await guest.locator('#timer').textContent());
    assert.notEqual(await host.locator('#timer').textContent(),'00:00');
    assert.equal(await host.locator('#setup').isVisible(),false);
    await fits(host); await fits(guest);
    await host.locator('#board [data-i="0"]').click();
    await guest.waitForFunction(()=>document.querySelectorAll('#opponent-board .open').length>0);
    let own=await snapshot(host), other=await snapshot(guest);
    assert.deepEqual(other.players[0].cells,own.cells);
    assert(other.players[0].cells.some(c=>c===null)); assert(!other.players[0].cells.includes(-1));
    assert.equal(other.startedAt,a.startedAt);
    const unknown=own.cells.findIndex(c=>c===null);
    await host.locator(`#board [data-i="${unknown}"]`).click({button:'right'});
    await guest.waitForFunction(index=>document.querySelector(`#opponent-board [data-index="${index}"]`).textContent==='⚑',unknown);
    other=await snapshot(guest); assert.equal(other.players[0].cells[unknown],null);
    await host.screenshot({path:'/tmp/minefield-fit-desktop.png',fullPage:true});
    for (const width of [900,390]) { await host.setViewportSize({width,height:844});await fits(host); }
    assert(await host.locator('#fields').evaluate(el=>el.classList.contains('stacked')));
    await host.screenshot({path:'/tmp/minefield-fit-mobile.png',fullPage:true});
    await host.locator('#leave').click(); assert.equal(await host.locator('#setup').isVisible(),true);
    assert.deepEqual(errors,[]);
    console.log(`Layout/start QA passed: full 40×30 fields without internal scrolling, revealed-only opponent/flags, one shared start with 75-second clock skew (display difference ${Math.abs(starts[0]-starts[1]).toFixed(0)} ms), early-move rejection, and tablet/mobile fitting.`);
  } finally {
    for (const page of [host,guest]) await page.evaluate(()=>document.querySelector('#leave')?.click()).catch(()=>{});
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
