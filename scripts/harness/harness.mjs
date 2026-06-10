#!/usr/bin/env node
/**
 * harness.mjs — headless control + measurement harness for the CoH2 Skin Editor
 * Electron app, driven entirely over the Chrome DevTools Protocol (CDP).
 *
 * It lets an automated agent (or a developer) launch the app, drive the UI,
 * capture screenshots, and — most importantly — MEASURE main-thread jank
 * (long-tasks + dropped animation frames) during the Connect-screen vehicle
 * warmup, without grabbing the mouse or needing a human to click.
 *
 * Requirements: the app must be launched with --remote-debugging-port=9222
 * (the `launch` subcommand does this for you). Uses the repo's `ws` dep.
 *
 * Subcommands:
 *   launch                 Kill any harness-launched instance, start a fresh one with CDP.
 *   stop                   Kill the harness-launched instance (by recorded pid group).
 *   shot [name]            Capture a screenshot of the current page → /tmp/coh2-harness/.
 *   eval "<expr>"          Evaluate a JS expression in the renderer, print the JSON result.
 *   text                   Print document.body.innerText (what's on screen right now).
 *   click "<text>"         Click the first button/role=button whose text contains <text>.
 *   profile [seconds] [--fresh]
 *                          Install a long-task + frame-timing profiler, click
 *                          "Connect CoH2 install", run for [seconds] (default 30),
 *                          then print a jank report (long tasks, blocking time,
 *                          dropped frames, worst frame) + timeline screenshots.
 *                          --fresh relaunches the app first for a clean run.
 *   monitor [seconds]      Just install the profiler and watch the CURRENT screen
 *                          for [seconds] without clicking anything (e.g. to profile
 *                          a phase you navigate to manually).
 */
import WebSocket from 'ws'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'

const PORT = Number(process.env.COH2_CDP_PORT || 9222)
const APP = process.env.COH2_APP || path.join(os.homedir(), '.local/bin/coh2-community-modding-tool.AppImage')
const PIDFILE = '/tmp/coh2-harness.pid'
const OUTDIR = '/tmp/coh2-harness'
mkdirSync(OUTDIR, { recursive: true })

// ----------------------------- CDP client -----------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []
    ws.on('message', (d) => {
      const m = JSON.parse(d)
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id) }
      else if (m.method) this.events.push(m)
    })
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)))
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    const p = path.join(OUTDIR, name)
    writeFileSync(p, Buffer.from(r.data, 'base64'))
    return p
  }
  close() { try { this.ws.close() } catch {} }
}

async function findPageWs(port) {
  const res = await fetch(`http://localhost:${port}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target found')
  return page.webSocketDebuggerUrl
}

async function waitCDP(port = PORT, timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json`)
      const list = await res.json()
      if (list.some((t) => t.type === 'page')) return true // page target exists → attachable
    } catch {}
    await sleep(120)
  }
  throw new Error('CDP did not come up in time')
}

async function connect(port = PORT) {
  const url = await findPageWs(port)
  const ws = new WebSocket(url)
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return cdp
}

// --------------------------- app lifecycle -----------------------------------
function stop() {
  if (!existsSync(PIDFILE)) return false
  const pid = Number(readFileSync(PIDFILE, 'utf8'))
  if (!pid) return false
  // Kill the whole process group (setsid/detached leader) WITHOUT a pkill -f
  // pattern that would self-match this script's own command line.
  try { process.kill(-pid, 'SIGTERM') } catch {}
  try { process.kill(pid, 'SIGTERM') } catch {}
  return true
}

function launch() {
  stop()
  const child = spawn(APP, [`--remote-debugging-port=${PORT}`, '--no-sandbox'], {
    detached: true, stdio: 'ignore',
  })
  child.unref()
  writeFileSync(PIDFILE, String(child.pid))
  return child.pid
}

// ----------------------------- injected JS -----------------------------------
const CLICK_BY_TEXT = (text) => `(() => {
  const els = [...document.querySelectorAll('button, [role=button], a')];
  const el = els.find(e => e.textContent && e.textContent.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return 'NOTFOUND';
  el.click();
  return 'CLICKED: ' + el.textContent.trim().slice(0, 60);
})()`

// PerformanceObserver for longtasks + a rAF inter-frame delta sampler.
// Stored on window.__h so COLLECT can read it back later.
const INSTALL_PROFILER = `(() => {
  if (window.__h) { window.__h.lt = []; window.__h.frames = []; window.__h.t0 = performance.now(); return 'reset'; }
  window.__h = { lt: [], frames: [], t0: performance.now(), err: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__h.lt.push({
          s: Math.round(e.startTime),
          d: Math.round(e.duration),
          a: (e.attribution || []).map(x => x.containerType + ':' + (x.containerName || '')).join(',')
        });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { window.__h.err = String(e); }
  let last = performance.now();
  (function frame(now) {
    window.__h.frames.push(Math.round(now - last));
    last = now;
    window.__h._r = requestAnimationFrame(frame);
  })(performance.now());
  return 'installed';
})()`

const COLLECT = `(() => {
  const h = window.__h; if (!h) return null;
  const fr = h.frames;
  const droppedGt32 = fr.filter(d => d > 32).length;
  const droppedGt50 = fr.filter(d => d > 50).length;
  const worstFrameMs = fr.length ? Math.max(...fr) : 0;
  const lt = h.lt;
  const totalLongTaskMs = lt.reduce((a, e) => a + e.d, 0);
  const blockingMs = lt.reduce((a, e) => a + Math.max(0, e.d - 50), 0);
  const top = [...lt].sort((a, b) => b.d - a.d).slice(0, 12);
  const avgFps = fr.length ? Math.round(1000 / (fr.reduce((a, d) => a + d, 0) / fr.length)) : 0;
  return {
    durationMs: Math.round(performance.now() - h.t0),
    frames: fr.length, avgFps,
    droppedGt32, droppedGt50, worstFrameMs,
    longTasks: lt.length, totalLongTaskMs, blockingMs,
    observerErr: h.err,
    topLongTasks: top,
  };
})()`

// ------------------------------- commands ------------------------------------
async function cmdShot(name = `shot-${Date.now()}.png`) {
  const cdp = await connect()
  const p = await cdp.screenshot(name)
  console.log('screenshot →', p)
  cdp.close()
}

async function cmdEval(expr) {
  const cdp = await connect()
  const v = await cdp.evaluate(expr)
  console.log(JSON.stringify(v, null, 2))
  cdp.close()
}

async function cmdText() {
  const cdp = await connect()
  const v = await cdp.evaluate('document.body.innerText')
  console.log(v)
  cdp.close()
}

async function cmdClick(text) {
  const cdp = await connect()
  const v = await cdp.evaluate(CLICK_BY_TEXT(text))
  console.log(v)
  cdp.close()
}

const PHASE_OF = `(() => {
  const t = document.body.innerText || '';
  if (/Connect CoH2/i.test(t)) return 'connect';
  if (/New Skin Pack|Continue ·|Load Project/i.test(t)) return 'start';
  if (/vehicle|loading|preparing|warming|%/i.test(t)) return 'preloading';
  if (t.length < 5) return 'blank';
  return 'other:' + t.slice(0, 24).replace(/\\n/g, ' ');
})()`

async function cmdProfile(seconds, fresh) {
  let cdp
  if (fresh) {
    const pid = launch()
    console.log('launched fresh app pid', pid, '— attaching as fast as possible…')
    await waitCDP()
    // Connect the instant a page target exists, retrying through the brief
    // window where the renderer hasn't finished its first paint.
    for (let i = 0; i < 40; i++) {
      try { cdp = await connect(); break } catch { await sleep(80) }
    }
  } else {
    cdp = await connect()
  }
  if (!cdp) throw new Error('could not attach to renderer')
  console.log('installing profiler…', await cdp.evaluate(INSTALL_PROFILER))
  // Phase timeline: poll innerText classification every 200ms so we can see
  // exactly when (and for how long) the warmup 'preloading' phase is on screen.
  const timeline = []
  let lastPhase = null
  let clickedConnect = false
  const t0 = Date.now()
  let nextShot = 0
  while ((Date.now() - t0) / 1000 < seconds) {
    const phase = await cdp.evaluate(PHASE_OF).catch(() => 'err')
    const ms = Date.now() - t0
    if (phase !== lastPhase) { timeline.push({ ms, phase }); lastPhase = phase; await cdp.screenshot(`phase-${String(ms).padStart(6, '0')}-${String(phase).replace(/[^a-z0-9]/gi, '_')}.png`) }
    // If the app is sitting on Connect (manual button, no auto-advance), click it once.
    if (phase === 'connect' && !clickedConnect && ms > 600) {
      const r = await cdp.evaluate(CLICK_BY_TEXT('Connect CoH2')).catch(() => 'err')
      console.log('auto-click connect:', r); clickedConnect = true
    }
    if (ms > nextShot) { await cdp.screenshot(`t-${String(Math.round(ms / 1000)).padStart(2, '0')}s.png`); nextShot += Math.max(2000, (seconds * 1000) / 8) }
    await sleep(200)
  }
  console.log('\nPHASE TIMELINE:')
  for (const e of timeline) console.log(`  ${String(e.ms).padStart(6)}ms  → ${e.phase}`)
  const report = await cdp.evaluate(COLLECT)
  console.log('\n================= JANK REPORT =================')
  console.log(JSON.stringify(report, null, 2))
  console.log('==============================================')
  console.log('\nINTERPRETATION:')
  if (report) {
    console.log(`  • Watched ${ (report.durationMs/1000).toFixed(1) }s, ~${report.frames} frames, avg ${report.avgFps} fps`)
    console.log(`  • Dropped frames (>32ms gap): ${report.droppedGt32}; severe (>50ms): ${report.droppedGt50}; worst frame: ${report.worstFrameMs}ms`)
    console.log(`  • Long tasks (>50ms): ${report.longTasks}; total ${report.totalLongTaskMs}ms; blocking ${report.blockingMs}ms`)
    if (report.topLongTasks?.length) {
      console.log('  • Worst long tasks (ms @ ms-offset):')
      for (const t of report.topLongTasks) console.log(`      ${String(t.d).padStart(4)}ms @ ${t.s}  ${t.a || ''}`)
    }
  }
  console.log('\nscreenshots in', OUTDIR)
  cdp.close()
}

async function cmdCpuProfile(seconds, fresh) {
  let cdp
  if (fresh) {
    const pid = launch()
    console.log('launched fresh app pid', pid, '— attaching as fast as possible…')
    await waitCDP()
    for (let i = 0; i < 40; i++) { try { cdp = await connect(); break } catch { await sleep(80) } }
  } else { cdp = await connect() }
  if (!cdp) throw new Error('could not attach')
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 }) // 200µs = fine-grained
  await cdp.send('Profiler.start')
  // Auto-click Connect if the app is waiting on the button.
  await sleep(700)
  const phase = await cdp.evaluate(PHASE_OF).catch(() => '')
  if (phase === 'connect') console.log('auto-click connect:', await cdp.evaluate(CLICK_BY_TEXT('Connect CoH2')).catch(() => 'err'))
  console.log(`profiling CPU for ${seconds}s through warmup…`)
  await sleep(seconds * 1000)
  const { profile } = await cdp.send('Profiler.stop')
  writeFileSync(path.join(OUTDIR, 'warmup.cpuprofile'), JSON.stringify(profile))
  // Aggregate self-time by call frame (functionName @ url:line).
  const interval = 200 / 1000 // ms per sample (approx; we use hitCount)
  const byFrame = new Map()
  for (const n of profile.nodes) {
    const f = n.callFrame
    const key = `${f.functionName || '(anonymous)'}  ${(f.url || '').replace(/^.*\//, '')}:${f.lineNumber + 1}`
    const self = (n.hitCount || 0) * interval
    byFrame.set(key, (byFrame.get(key) || 0) + self)
  }
  const top = [...byFrame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  const totalMs = (profile.endTime - profile.startTime) / 1000
  console.log(`\n=========== CPU SELF-TIME (top 30) over ${totalMs.toFixed(0)}ms ===========`)
  for (const [k, ms] of top) console.log(`  ${ms.toFixed(0).padStart(6)}ms  ${k}`)
  console.log('\nfull profile → /tmp/coh2-harness/warmup.cpuprofile (load in chrome devtools Performance)')
  cdp.close()
}

async function cmdMonitor(seconds) {
  const cdp = await connect()
  console.log('installing profiler…', await cdp.evaluate(INSTALL_PROFILER))
  await sleep(seconds * 1000)
  const report = await cdp.evaluate(COLLECT)
  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

// --------------------------------- CLI ---------------------------------------
const [cmd, ...rest] = process.argv.slice(2)
try {
  switch (cmd) {
    case 'launch': console.log('pid', launch()); await waitCDP(); console.log('CDP up on', PORT); break
    case 'stop': console.log(stop() ? 'stopped' : 'nothing to stop'); break
    case 'shot': await cmdShot(rest[0]); break
    case 'eval': await cmdEval(rest.join(' ')); break
    case 'text': await cmdText(); break
    case 'click': await cmdClick(rest.join(' ')); break
    case 'profile': {
      const fresh = rest.includes('--fresh')
      const secs = Number(rest.find(a => /^\d+$/.test(a))) || 30
      await cmdProfile(secs, fresh); break
    }
    case 'monitor': await cmdMonitor(Number(rest[0]) || 15); break
    case 'cpuprofile': {
      const fresh = rest.includes('--fresh')
      const secs = Number(rest.find(a => /^\d+$/.test(a))) || 18
      await cmdCpuProfile(secs, fresh); break
    }
    default:
      console.log('usage: node scripts/harness/harness.mjs <launch|stop|shot|eval|text|click|profile|monitor> [...]')
  }
  process.exit(0)
} catch (e) {
  console.error('harness error:', e.message)
  process.exit(1)
}
