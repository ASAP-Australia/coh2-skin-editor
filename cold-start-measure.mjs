import WebSocket from 'ws'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'

const APP = path.join(os.homedir(), '.local/bin/coh2-community-modding-tool.AppImage')
const PORT = 9222
const PIDFILE = '/tmp/coh2-harness.pid'

function stop() {
  if (!existsSync(PIDFILE)) return
  const pid = Number(readFileSync(PIDFILE, 'utf8'))
  if (!pid) return
  try { process.kill(-pid, 'SIGTERM') } catch {}
  try { process.kill(pid, 'SIGTERM') } catch {}
}

async function waitCDP(timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`)
      const list = await res.json()
      if (list.some(t => t.type === 'page')) return Date.now() - t0
    } catch {}
    await sleep(50)
  }
  throw new Error('CDP timeout')
}

async function measure() {
  stop()
  await sleep(1500) // give OS time to release port/FUSE
  
  const launchT = Date.now()
  const child = spawn(APP, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    detached: true, stdio: 'ignore'
  })
  child.unref()
  writeFileSync(PIDFILE, String(child.pid))
  
  const cdpMs = await waitCDP()
  
  // Connect CDP
  const res = await fetch(`http://localhost:${PORT}/json`)
  const list = await res.json()
  const page = list.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
  
  let id = 0
  const pending = new Map()
  ws.on('message', d => {
    const m = JSON.parse(d)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, m => m.error ? rej(new Error(method + ':' + JSON.stringify(m.error))) : res(m.result))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const ev = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result?.value)
  
  await send('Runtime.enable')
  
  // Poll for Connect button presence
  const pollStart = Date.now()
  let connectVisible = null
  for (let i = 0; i < 200; i++) {
    await sleep(50)
    const text = await ev('document.body.innerText').catch(() => '')
    if (text && /Connect CoH2/i.test(text)) {
      connectVisible = Date.now() - launchT
      break
    }
  }
  
  const paintEntries = await ev("JSON.stringify(performance.getEntriesByType('paint').map(e => ({name: e.name, t: Math.round(e.startTime)})))")
  const navEntry = await ev("JSON.stringify(({di: Math.round(performance.getEntriesByType('navigation')[0]?.domInteractive||0), dcl: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd||0), le: Math.round(performance.getEntriesByType('navigation')[0]?.loadEventEnd||0)}))")
  const perfNow = await ev("Math.round(performance.now())")
  
  ws.close()
  stop()
  
  return {
    launchToCDP: cdpMs,
    launchToConnectScreen: connectVisible,
    paint: JSON.parse(paintEntries),
    nav: JSON.parse(navEntry),
    perfNowAtMeasure: perfNow
  }
}

for (let run = 1; run <= 3; run++) {
  console.log(`\n=== RUN ${run} ===`)
  try {
    const r = await measure()
    console.log(JSON.stringify(r, null, 2))
  } catch(e) {
    console.error('FAILED:', e.message)
  }
  if (run < 3) await sleep(2000)
}
