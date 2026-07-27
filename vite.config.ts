import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import type { Plugin, Connect } from 'vite'
import type { ServerResponse } from 'node:http'

// ---------------------------------------------------------------------------
// DEV-ONLY: CoH2 local-fs HTTP bridge plugin
// ---------------------------------------------------------------------------
//
// Exposes four endpoints under /__coh2/ that let the browser dev preview
// read the local CoH2 install without the File System Access picker.
// The plugin is ONLY registered in serve (dev) mode — it is a no-op in the
// production build (the `apply: 'serve'` guard ensures rollup never sees it).
//
// Endpoints:
//   GET /__coh2/detect          → { installPath: string | null }
//   GET /__coh2/stat?path=REL   → { exists, size, isDir }
//   GET /__coh2/list?path=REL   → { entries: [{name, isDir}] }
//   GET /__coh2/read?path=REL&offset=N&length=M  → raw bytes (octet-stream)
//
// Security: REL is always resolved against installPath and rejected if the
// resolved path escapes the install directory (path-traversal guard).

function detectLinuxCoh2(): string | null {
  const home = process.env.HOME ?? ''
  const gameRelPath = path.join('steamapps', 'common', 'Company of Heroes 2')
  const roots = [
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
    path.join(home, 'Steam'),
  ]
  for (const root of roots) {
    const candidate = path.join(root, gameRelPath)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function getCoh2InstallPath(): string | null {
  // 1. Explicit env override
  if (process.env.COH2_INSTALL) return process.env.COH2_INSTALL
  // 2. Platform probes
  const platform = process.platform
  if (platform === 'linux') return detectLinuxCoh2()
  if (platform === 'darwin') {
    const home = process.env.HOME ?? ''
    const gameRelPath = path.join('steamapps', 'common', 'Company of Heroes 2')
    const macRoot = path.join(home, 'Library', 'Application Support', 'Steam')
    const candidate = path.join(macRoot, gameRelPath)
    if (fs.existsSync(candidate)) return candidate
  }
  if (platform === 'win32') {
    // Try common Steam locations (no registry in Vite config)
    for (const root of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'D:\\SteamLibrary',
    ]) {
      const candidate = path.join(root, 'steamapps', 'common', 'Company of Heroes 2')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function jsonReply(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function coh2BridgePlugin(): Plugin {
  return {
    name: 'coh2-bridge',
    apply: 'serve', // dev server only — never included in production build
    configureServer(server) {
      const installPath = getCoh2InstallPath()

      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url?.startsWith('/__coh2/')) return next()

        const url = new URL(req.url, 'http://localhost')
        const endpoint = url.pathname.replace('/__coh2/', '')

        if (endpoint === 'detect') {
          return jsonReply(res, { installPath })
        }

        // All other endpoints require a resolved install path
        if (!installPath) {
          return jsonReply(res, { error: 'CoH2 install not found' }, 404)
        }

        const relRaw = url.searchParams.get('path') ?? ''
        // Security: resolve and verify the path stays inside installPath
        const resolved = path.resolve(installPath, relRaw)
        if (!resolved.startsWith(installPath + path.sep) && resolved !== installPath) {
          return jsonReply(res, { error: 'Path traversal rejected' }, 403)
        }

        if (endpoint === 'stat') {
          try {
            const stat = fs.statSync(resolved)
            return jsonReply(res, { exists: true, size: stat.size, isDir: stat.isDirectory() })
          } catch {
            return jsonReply(res, { exists: false, size: 0, isDir: false })
          }
        }

        if (endpoint === 'list') {
          try {
            const entries = fs.readdirSync(resolved, { withFileTypes: true })
              .map(e => ({ name: e.name, isDir: e.isDirectory() }))
            return jsonReply(res, { entries })
          } catch {
            return jsonReply(res, { entries: [] })
          }
        }

        if (endpoint === 'read') {
          const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
          const length = parseInt(url.searchParams.get('length') ?? '0', 10)
          if (isNaN(offset) || isNaN(length) || offset < 0 || length < 0) {
            return jsonReply(res, { error: 'Invalid offset/length' }, 400)
          }
          let fd: number
          try {
            fd = fs.openSync(resolved, 'r')
          } catch {
            res.writeHead(404); res.end(); return
          }
          try {
            const buf = Buffer.allocUnsafe(length)
            const bytesRead = fs.readSync(fd, buf, 0, length, offset)
            const out = bytesRead < length ? buf.subarray(0, bytesRead) : buf
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Length': out.length,
            })
            res.end(out)
          } finally {
            try { fs.closeSync(fd) } catch { /* ignore */ }
          }
          return
        }

        next()
      }

      server.middlewares.use(handler)
    },
  }
}

// ---------------------------------------------------------------------------
// Build stamp
// ---------------------------------------------------------------------------
//
// The user tests the DEPLOYED AppImage, not the dev build, so any change that
// is not rebuilt and installed is invisible to them — and there was no way to
// tell a stale binary from a current one by looking at it. The bug-report
// template (.github/ISSUE_TEMPLATE/bug.yml) already asks for a version as a
// REQUIRED field, which the app never displayed anywhere.
//
// Stamping the commit into the binary makes staleness self-evident: it shows
// in the window title, so it is captured in every screenshot forever.
//
// git may be absent in a packaged/CI context, so both lookups degrade to
// 'unknown' rather than failing the build.
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}
function gitDirty(): boolean {
  try {
    return (
      execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim().length > 0
    )
  } catch {
    return false
  }
}

const BUILD_SHA = gitShortSha() + (gitDirty() ? '-dirty' : '')
const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  plugins: [coh2BridgePlugin(), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Statically replaced at build time; available as globals in dev.
  // Values must be JSON-serialisable strings — https://vite.dev/config/shared-options
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  // Assets load from file:// URLs in the Electron AppImage — base must be
  // relative (`./`) so /assets/foo.js doesn't try to resolve at FS root.
  // v1.0 is desktop-only (Steam Workshop publishing requires Electron's
  // native bridge); the previous GitHub Pages deploy has been retired.
  base: './',
  build: {
    // Pull three.js + pako into their own chunks so the main bundle stays
    // under the 500 kB warning threshold and re-renders / hot reloads stay
    // snappy. Three is by far the heaviest dep (~600 kB minified).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/pako')) return 'pako'
          if (id.includes('node_modules/radix-ui') || id.includes('node_modules/@radix-ui')) return 'radix'
          if (id.includes('node_modules/konva') || id.includes('node_modules/react-konva')) return 'konva'
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
