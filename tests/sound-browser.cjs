// Optional: TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/sound-browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = process.env.TEST_URL || 'http://localhost:3000';
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.audioStats = { contexts: 0, tones: [], noise: [] };
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); audioStats.contexts++; }
      createGain() { const gain = super.createGain(); if (!window.observedMaster) window.observedMaster = gain; return gain; }
      createOscillator() {
        const node = super.createOscillator(), start = node.start.bind(node);
        const setFrequency = node.frequency.setValueAtTime.bind(node.frequency);
        let frequency = null;
        node.frequency.setValueAtTime = (value, when) => { frequency = value; return setFrequency(value, when); };
        node.start = when => { audioStats.tones.push({ hz: frequency, when }); start(when); };
        return node;
      }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node);
        node.start = when => { audioStats.noise.push({ when, nonzero: node.buffer.getChannelData(0).some(v => v !== 0) }); start(when); };
        return node;
      }
    };
  });
  const stats = () => page.evaluate(() => audioStats);
  async function fixture({ flags = [], simple = false } = {}) {
    await page.goto(base);
    await page.evaluate(async ({ flags, simple }) => {
      const { create } = await import('/game.js');
      const r = create({ width: 5, height: 5, mines: simple ? 1 : 7, solo: true });
      const mines = new Set(simple ? [0] : [0,2,4,10,14,20,24]);
      const board = Array.from({length:25},(_,i)=>{
        if (mines.has(i)) return -1;
        let count=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const x=i%5+dx,y=Math.floor(i/5)+dy;
          if((dx||dy)&&x>=0&&x<5&&y>=0&&y<5&&mines.has(y*5+x))count++;
        }
        return count;
      });
      Object.assign(r,{phase:'playing',availableAt:Date.now()-1000,startedAt:Date.now()-1000});
      Object.assign(r.players[0],{ready:true,opening:6,board,flags,revealed:[6]});
      sessionStorage.removeItem('minefield-session');
      sessionStorage.setItem('minefield-solo',JSON.stringify(r));
      localStorage.setItem('minefield-sound','on');
    },{flags,simple});
    await page.reload(); await page.waitForFunction(()=>document.querySelector('#phase').textContent==='Playing');
  }
  try {
    await page.goto(base);
    assert.equal((await stats()).contexts,0); assert.equal((await stats()).tones.length,0);
    await page.locator('#create').click();
    await page.locator('#board [data-i="0"]').click();
    await page.waitForFunction(()=>audioStats.tones.length===1);
    assert.equal((await stats()).contexts,1); assert.equal((await stats()).tones[0].hz,660);
    let r=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('minefield-solo')));
    const mine=r.players[0].board.indexOf(-1);
    await page.locator(`#board [data-i="${mine}"]`).click({button:'right'});
    await page.waitForFunction(()=>audioStats.tones.length===2);
    await page.locator(`#board [data-i="${mine}"]`).click({button:'right'});
    await page.waitForFunction(()=>audioStats.tones.length===3);
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'),'false');
    await page.waitForFunction(()=>observedMaster.gain.value===0);
    const mutedCount=(await stats()).tones.length;
    await page.locator(`#board [data-i="${mine}"]`).click({button:'right'});
    assert.equal((await stats()).tones.length,mutedCount);
    await page.reload();
    assert.equal(await page.locator('#sound').textContent(),'Sound: off');
    await page.locator('#flag-mode').click(); assert.equal((await stats()).contexts,0);
    await page.locator('#sound').click();
    await page.waitForFunction(()=>audioStats.tones.length===1);
    assert.equal((await stats()).contexts,1);

    await fixture();
    await page.locator('#board [data-i="6"]').hover(); await page.mouse.down();
    await page.mouse.up(); assert.equal((await stats()).tones.length,0); // Preview/no-op is silent.
    for(const i of [0,2,10])await page.locator(`#board [data-i="${i}"]`).click({button:'right'});
    await page.waitForFunction(()=>audioStats.tones.length===3);
    await page.locator('#board [data-i="6"]').click();
    await page.waitForFunction(()=>audioStats.tones.length>=5);
    assert.deepEqual((await stats()).tones.slice(3,5).map(t=>t.hz),[480,720]);

    await fixture(); await page.locator('#board [data-i="0"]').click();
    await page.waitForFunction(()=>audioStats.noise.length===1&&audioStats.tones.length>=4);
    assert((await stats()).noise[0].nonzero);
    const resultCount=(await stats()).tones.length;
    await page.waitForTimeout(450); assert.equal((await stats()).tones.length,resultCount);
    await page.reload(); assert.equal((await stats()).contexts,0); // Do not replay a restored result.

    await fixture({flags:[0],simple:true});
    await page.locator('#board [data-i="6"]').click();
    await page.waitForFunction(()=>audioStats.tones.length===6);
    assert.deepEqual((await stats()).tones.slice(2).map(t=>t.hz),[523,659,784,1047]);
    await page.locator('#leave').click();
    await page.locator('#ai-tab').click(); await page.locator('[data-level="hard"]').click();
    await page.locator('#create').click(); await page.waitForFunction(()=>document.querySelector('#phase').textContent==='Lobby');
    await page.evaluate(()=>{audioStats.tones=[];audioStats.noise=[];});
    await page.locator('#ready').click();
    await page.waitForFunction(()=>audioStats.tones.some(t=>t.hz===990));
    const startStats=await stats();
    assert.equal(startStats.tones.filter(t=>t.hz===420).length,3);
    assert.equal(startStats.tones.filter(t=>t.hz===990).length,1);
    await page.waitForTimeout(900); assert.equal((await stats()).tones.length,startStats.tones.length); // AI moves are quiet.
    await page.locator('#leave').click();

    const unsupported=await browser.newPage(); unsupported.on('pageerror',e=>errors.push(e.message));
    await unsupported.addInitScript(()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});
    await unsupported.goto(base); assert(await unsupported.locator('#sound').isDisabled());
    await unsupported.locator('#create').click(); await unsupported.locator('#board [data-i="0"]').click();
    assert(await unsupported.locator('#board .open').count()>0);
    assert.deepEqual(errors,[]);
    console.log('Sound QA passed: no autoplay, one reveal cue per action, flag/unflag, persistent mute, silent previews, chord, explosion noise, win/loss, one countdown/start sequence, quiet AI moves, and unsupported-audio fallback.');
  } finally {
    await page.evaluate(()=>document.querySelector('#leave')?.click()).catch(()=>{});
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
