import puppeteer from '/var/home/jflessenkemper/dev/coh2-skin-editor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = '/home/jflessenkemper/dev/coh2-skin-editor/artifacts/fix_session/verify'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
let page = pages.find(p => p.url().includes('localhost:5173'))
if (!page) { console.log('NO PAGE'); process.exit(1) }

const errors = []
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text().slice(0, 200)) })

console.log('reloading...')
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('reload warn', e.message))
await sleep(3000)

// Helper: click a button by visible text
async function clickText(txt, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, [role=button], div, span')]
      const el = els.find(e => (e.innerText || '').trim().toLowerCase() === t.toLowerCase())
      if (el) { el.click(); return true }
      return false
    }, txt)
    if (ok) return true
    await sleep(300)
  }
  return false
}

// Dump top-level visible buttons to understand current UI state
const buttons = await page.evaluate(() => {
  return [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 40)
})
console.log('BUTTONS:', JSON.stringify(buttons))

await page.screenshot({ path: `${OUT}/00-after-reload.png` }).catch(()=>{})

// Try to find the Elefant entry & click it
const clickedElefant = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button, [role=button], li, div, span')]
  const el = els.find(e => /elefant/i.test((e.innerText || '')) && (e.innerText||'').length < 40)
  if (el) { el.click(); return (el.innerText||'').trim() }
  return null
})
console.log('clickedElefant:', clickedElefant)
await sleep(8000)
await page.screenshot({ path: `${OUT}/01-elefant.png` }).catch(()=>{})

// Synthetic orbit: dispatch pointer drag on canvas repeatedly
async function orbit(steps = 30) {
  await page.evaluate(async (n) => {
    const cv = document.querySelector('canvas')
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const cx = r.left + r.width/2, cy = r.top + r.height/2
    const fire = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX:x, clientY:y, bubbles:true, pointerId:1, button:0, buttons:1 }))
    fire('pointerdown', cx, cy)
    for (let i=0;i<n;i++){ fire('pointermove', cx + Math.sin(i/3)*120, cy + Math.cos(i/3)*40); await new Promise(r=>setTimeout(r,16)) }
    fire('pointerup', cx, cy)
  }, steps)
}
console.log('orbiting...')
await orbit(40)
await sleep(1500)
await page.screenshot({ path: `${OUT}/02-elefant-orbited.png` }).catch(()=>{})

// Now try Tiger to check stuck-loading
const clickedTiger = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button, [role=button], li, div, span')]
  const el = els.find(e => /^tiger( i)?$/i.test((e.innerText || '').trim()))
  if (el) { el.click(); return (el.innerText||'').trim() }
  return null
})
console.log('clickedTiger:', clickedTiger)
await sleep(9000)
// Check for a loading spinner/overlay still present
const tigerState = await page.evaluate(() => {
  const txt = document.body.innerText
  const loading = /loading/i.test(txt)
  const loadingMatch = (txt.match(/loading[^\n]*/i) || [''])[0].slice(0,40)
  return { loading, loadingMatch }
})
console.log('TIGER STATE:', JSON.stringify(tigerState))
await page.screenshot({ path: `${OUT}/03-tiger.png` }).catch(()=>{})

console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0,15), null, 2) : 'none')
await browser.disconnect()
console.log('DONE')
