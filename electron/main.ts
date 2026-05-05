import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// CoH2 install auto-detection
// ---------------------------------------------------------------------------

function getSteamPathFromRegistry(): string | null {
  if (os.platform() !== 'win32') return null
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam" /v InstallPath',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {/* registry key not found */}
  try {
    const out = execSync(
      'reg query "HKCU\\SOFTWARE\\Valve\\Steam" /v SteamPath',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim().replace(/\//g, '\\')
  } catch {/* ignore */}
  return null
}

function detectCoh2Path(): string | null {
  const gameSubpath = path.join('steamapps', 'common', 'Company of Heroes 2')
  const platform = os.platform()

  if (platform === 'win32') {
    const steamRoot = getSteamPathFromRegistry()
    if (steamRoot) {
      const candidate = path.join(steamRoot, gameSubpath)
      if (fs.existsSync(candidate)) return candidate
    }
    // Common path fallbacks
    for (const root of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'E:\\Steam',
    ]) {
      const candidate = path.join(root, gameSubpath)
      if (fs.existsSync(candidate)) return candidate
    }
  } else {
    // Linux / Steam Deck
    const home = os.homedir()
    for (const steamRoot of [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
      '/run/media',   // SD card mounts on Deck
    ]) {
      const candidate = path.join(steamRoot, gameSubpath)
      if (fs.existsSync(candidate)) return candidate
    }
    // flatpak Steam
    const xdgData = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share')
    const flatpakSteam = path.join(xdgData, 'flatpak', 'app', 'com.valvesoftware.Steam',
      'x86_64', 'active', 'files', 'share', 'Steam')
    const flatpakCandidate = path.join(flatpakSteam, gameSubpath)
    if (fs.existsSync(flatpakCandidate)) return flatpakCandidate
  }
  return null
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0d0f',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // ── Window control IPC ──────────────────────────────────────────────────
  ipcMain.handle('window-minimize', () => mainWindow?.minimize())
  ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('window-close', () => mainWindow?.close())
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  // ── CoH2 detection ────────────────────────────────────────────────────
  ipcMain.handle('detect-coh2', () => detectCoh2Path())

  // ── Native folder picker (fallback if auto-detect fails) ────────────
  ipcMain.handle('pick-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select your CoH2 installation folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── File system reads ──────────────────────────────────────────────────
  ipcMain.handle('read-file', async (_e, filePath: string) => {
    const buf = await fs.promises.readFile(filePath)
    // Transfer as plain Uint8Array — structuredClone-safe across IPC
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle('list-dir', async (_e, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }
  })

  ipcMain.handle('file-exists', (_e, filePath: string) => {
    return fs.existsSync(filePath)
  })

  // ── Load ──────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    // In dev, Vite serves under the same base path it would for GitHub
    // Pages — load the explicit URL so we don't follow a 302 first.
    mainWindow.loadURL('http://localhost:5173/coh2-skin-editor/')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
