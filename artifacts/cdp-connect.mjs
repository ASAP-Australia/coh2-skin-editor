import puppeteer from '/var/home/jflessenkemper/dev/coh2-skin-editor/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const OUT = '/home/jflessenkemper/dev/coh2-skin-editor/artifacts/fix_session/verify'
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })
const pages = await browser.pages()
let page = pages.find(p => p.url().includes('localhost:5173'))

// Click Connect; see if it restores silently (persisted handle) within 6s
const before = await page.evaluate(() => document.body.innerText.slice(0, 80))
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(e => /connect/i.test(e.innerText))
  if (b) b.click()
})
await sleep(6000)
const after = await page.evaluate(() => {
  const txt = document.body.innerText
  return { connected: !/connect coh2 install/i.test(txt), sample: txt.slice(0,120), btns: [...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,30) }
})
console.log('BEFORE:', JSON.stringify(before))
console.log('AFTER:', JSON.stringify(after, null, 2))
await page.screenshot({ path: `${OUT}/connect-attempt.png` }).catch(()=>{})
await browser.disconnect()
