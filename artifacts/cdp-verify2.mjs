import puppeteer from '/var/home/jflessenkemper/dev/coh2-skin-editor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = '/home/jflessenkemper/dev/coh2-skin-editor/artifacts/fix_session/verify'
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
let page = pages.find(p => p.url().includes('localhost:5173'))
const errors = []
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message))
page.on('console', m => { if (m.type()==='error') errors.push('CERR: ' + m.text().slice(0,160)) })

// Continue into the existing skin pack
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(e => /continue/i.test(e.innerText))
  if (b) b.click()
})
await sleep(7000)
await page.screenshot({ path: `${OUT}/E0-editor.png` }).catch(()=>{})

// What vehicle is loaded + list selectable vehicles
const state = await page.evaluate(() => {
  const txt = document.body.innerText
  return { loading: /loading/i.test(txt), sample: txt.slice(0,200) }
})
console.log('EDITOR STATE:', JSON.stringify(state))

// orbit helper
async function orbit(n=40){ await page.evaluate(async(n)=>{const cv=document.querySelector('canvas');if(!cv)return;const r=cv.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const f=(t,x,y)=>cv.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,pointerId:1,button:0,buttons:1}));f('pointerdown',cx,cy);for(let i=0;i<n;i++){f('pointermove',cx+Math.sin(i/3)*140,cy+Math.cos(i/3)*50);await new Promise(r=>setTimeout(r,16))}f('pointerup',cx,cy)},n) }

// Measure frame cadence DURING orbit using a CDP-side rAF sampler started before orbit.
// (Window may be occluded -> rAF paused; guard with timeout.)
async function sampleFrames(ms=2500){
  return await Promise.race([
    page.evaluate((ms)=>new Promise(res=>{const ts=[];let raf;const t0=performance.now();const loop=(t)=>{ts.push(t);if(performance.now()-t0<ms){raf=requestAnimationFrame(loop)}else{const d=[];for(let i=1;i<ts.length;i++)d.push(ts[i]-ts[i-1]);d.sort((a,b)=>a-b);res({frames:ts.length,medianMs:d[Math.floor(d.length/2)]||0,maxMs:d[d.length-1]||0})}};raf=requestAnimationFrame(loop)}),ms),
    new Promise(res=>setTimeout(()=>res({frames:-1,note:'rAF paused (occluded)'}), ms+1500))
  ])
}

console.log('sampling frames while orbiting...')
const samp = sampleFrames(2600)
await sleep(150); await orbit(50)
const result = await samp
console.log('FRAME SAMPLE:', JSON.stringify(result))
await page.screenshot({ path: `${OUT}/E1-elefant-orbited.png` }).catch(()=>{})

console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0,12),null,2) : 'none')
await browser.disconnect()
console.log('DONE')
