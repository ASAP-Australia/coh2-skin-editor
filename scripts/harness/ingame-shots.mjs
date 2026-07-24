#!/usr/bin/env node
/*
 * ingame-shots.mjs — collect CoH2 (appid 231430) Steam F12 screenshots for
 * in-game VISUAL verification, WITHOUT controlling the game.
 *
 * Respects the no-screen-control rule: the USER presses F12 in-game (Steam
 * overlay must be enabled); this script just reads the PNGs Steam saved and
 * copies the new ones out for inspection.
 *
 * Usage:
 *   node ingame-shots.mjs dir              # print the CoH2 screenshots dir(s)
 *   node ingame-shots.mjs now              # print a baseline epoch-ms (before you F12)
 *   node ingame-shots.mjs collect [--since=<ms>] [--out=<dir>]
 *                                          # copy screenshots newer than <ms> to <dir>
 *                                          # (default out: /tmp/coh2-evidence/ingame)
 */
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const APPID = '231430'
const argOut = process.argv.find(a => a.startsWith('--out='))
const OUT = argOut ? argOut.split('=')[1] : (process.env.COH2_SHOTS_OUT || '/tmp/coh2-evidence/ingame')

function findScreenshotDirs() {
  const roots = [
    path.join(homedir(), '.steam/steam/userdata'),
    path.join(homedir(), '.local/share/Steam/userdata'),
    path.join(homedir(), 'Steam/userdata'),
  ]
  const dirs = new Set()
  for (const root of roots) {
    if (!existsSync(root)) continue
    let accts = []
    try { accts = readdirSync(root) } catch { continue }
    for (const acct of accts) {
      const d = path.join(root, acct, '760', 'remote', APPID, 'screenshots')
      if (existsSync(d)) dirs.add(d)
    }
  }
  return [...dirs]
}

function listShots(dir) {
  return readdirSync(dir)
    .filter(f => /\.(png|jpe?g)$/i.test(f) && !f.includes('thumbnail'))
    .map(f => { const p = path.join(dir, f); return { f, p, m: statSync(p).mtimeMs } })
    .sort((a, b) => a.m - b.m)
}

const cmd = process.argv[2] || 'collect'
const dirs = findScreenshotDirs()

if (cmd === 'now') { console.log(Date.now()); process.exit(0) }

if (cmd === 'dir') {
  if (!dirs.length) {
    console.log('NO CoH2 screenshots dir yet. In CoH2: enable the Steam overlay (Settings > In-Game),')
    console.log('then press F12 once — that creates userdata/<id>/760/remote/231430/screenshots/.')
  } else dirs.forEach(d => console.log(d))
  process.exit(0)
}

// collect
const sinceArg = process.argv.find(a => a.startsWith('--since='))
const since = sinceArg ? Number(sinceArg.split('=')[1]) : 0
if (!dirs.length) {
  console.log('No CoH2 screenshots dir found. Enable Steam overlay + press F12 once in CoH2 first.')
  process.exit(0)
}
mkdirSync(OUT, { recursive: true })
const collected = []
for (const dir of dirs) {
  for (const s of listShots(dir)) {
    if (s.m <= since) continue
    const dest = path.join(OUT, s.f)
    copyFileSync(s.p, dest)
    collected.push({ dest, m: s.m })
  }
}
console.log(`Collected ${collected.length} screenshot(s) newer than ${since} to ${OUT}`)
collected.sort((a, b) => a.m - b.m).forEach(c => console.log(c.dest))
