"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
// ---------------------------------------------------------------------------
// CoH2 install auto-detection
// ---------------------------------------------------------------------------
function getSteamPathFromRegistry() {
    if (os.platform() !== 'win32')
        return null;
    try {
        const out = (0, child_process_1.execSync)('reg query "HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/);
        if (match)
            return match[1].trim();
    }
    catch { /* registry key not found */ }
    try {
        const out = (0, child_process_1.execSync)('reg query "HKCU\\SOFTWARE\\Valve\\Steam" /v SteamPath', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match)
            return match[1].trim().replace(/\//g, '\\');
    }
    catch { /* ignore */ }
    return null;
}
function detectCoh2Path() {
    const gameSubpath = path.join('steamapps', 'common', 'Company of Heroes 2');
    const platform = os.platform();
    if (platform === 'win32') {
        const steamRoot = getSteamPathFromRegistry();
        if (steamRoot) {
            const candidate = path.join(steamRoot, gameSubpath);
            if (fs.existsSync(candidate))
                return candidate;
        }
        // Common path fallbacks
        for (const root of [
            'C:\\Program Files (x86)\\Steam',
            'C:\\Program Files\\Steam',
            'D:\\Steam',
            'E:\\Steam',
        ]) {
            const candidate = path.join(root, gameSubpath);
            if (fs.existsSync(candidate))
                return candidate;
        }
    }
    else {
        // Linux / Steam Deck
        const home = os.homedir();
        for (const steamRoot of [
            path.join(home, '.steam', 'steam'),
            path.join(home, '.local', 'share', 'Steam'),
            path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
            '/run/media', // SD card mounts on Deck
        ]) {
            const candidate = path.join(steamRoot, gameSubpath);
            if (fs.existsSync(candidate))
                return candidate;
        }
        // flatpak Steam
        const xdgData = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
        const flatpakSteam = path.join(xdgData, 'flatpak', 'app', 'com.valvesoftware.Steam', 'x86_64', 'active', 'files', 'share', 'Steam');
        const flatpakCandidate = path.join(flatpakSteam, gameSubpath);
        if (fs.existsSync(flatpakCandidate))
            return flatpakCandidate;
    }
    return null;
}
// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
let mainWindow = null;
function createWindow() {
    const headless = !!process.env.HEADLESS_SCREENSHOT;
    mainWindow = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: !headless, // hide for screenshots, capture via webContents.capturePage()
        paintWhenInitiallyHidden: true,
        frame: false,
        transparent: false,
        backgroundColor: '#0d0d0f',
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    // ── Window control IPC ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('window-minimize', () => mainWindow?.minimize());
    electron_1.ipcMain.handle('window-maximize', () => {
        if (!mainWindow)
            return;
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });
    electron_1.ipcMain.handle('window-close', () => mainWindow?.close());
    electron_1.ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
    // ── CoH2 detection ────────────────────────────────────────────────────
    electron_1.ipcMain.handle('detect-coh2', () => detectCoh2Path());
    // ── Native folder picker (fallback if auto-detect fails) ────────────
    electron_1.ipcMain.handle('pick-directory', async () => {
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Select your CoH2 installation folder',
            properties: ['openDirectory'],
        });
        return result.canceled ? null : result.filePaths[0];
    });
    // ── File system reads ──────────────────────────────────────────────────
    electron_1.ipcMain.handle('read-file', async (_e, filePath) => {
        const buf = await fs.promises.readFile(filePath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    });
    // Range read — used by the SGA reader to load TOC + individual file
    // blobs lazily, avoiding 300+ MB IPC transfers per archive open.
    electron_1.ipcMain.handle('read-file-range', async (_e, filePath, start, length) => {
        const fd = await fs.promises.open(filePath, 'r');
        try {
            const buf = Buffer.alloc(length);
            const { bytesRead } = await fd.read(buf, 0, length, start);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
        }
        finally {
            await fd.close();
        }
    });
    electron_1.ipcMain.handle('file-stat', async (_e, filePath) => {
        try {
            const s = await fs.promises.stat(filePath);
            return { size: s.size };
        }
        catch {
            return null;
        }
    });
    electron_1.ipcMain.handle('list-dir', async (_e, dirPath) => {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
        }
        catch {
            return [];
        }
    });
    electron_1.ipcMain.handle('file-exists', (_e, filePath) => {
        return fs.existsSync(filePath);
    });
    // ── Load ──────────────────────────────────────────────────────────────
    if (process.env.NODE_ENV === 'development') {
        // In dev, Vite serves under the same base path it would for GitHub
        // Pages — load the explicit URL so we don't follow a 302 first.
        // HEADLESS_SCREENSHOT_BYPASS=1 → force ConnectScreen with no Viewport
        // (useful when host has no GPU)
        // HEADLESS_SCREENSHOT_EDITOR=1 → skip Connect, land in Editor with auto-
        //   detected install (used by automated screenshot smoke tests)
        const url = process.env.HEADLESS_SCREENSHOT_BYPASS
            ? 'http://localhost:5173/coh2-skin-editor/?screenshot=1'
            : process.env.HEADLESS_SCREENSHOT_EDITOR
                ? 'http://localhost:5173/coh2-skin-editor/?headless=editor'
                : 'http://localhost:5173/coh2-skin-editor/';
        mainWindow.loadURL(url);
        if (!process.env.HEADLESS_SCREENSHOT) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    }
    else {
        const search = process.env.HEADLESS_SCREENSHOT_BYPASS ? 'screenshot=1' :
            process.env.HEADLESS_SCREENSHOT_EDITOR ? 'headless=editor' : '';
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), search ? { search } : undefined);
    }
    // HEADLESS_SCREENSHOT=/path/to/out.png → wait for first paint, capture, quit.
    // Useful in CI / sandboxed sessions where the host's screenshot tool can't
    // see the Electron window. Uses Electron's own webContents.capturePage()
    // which works regardless of the windowing system.
    if (process.env.HEADLESS_SCREENSHOT) {
        const outPath = process.env.HEADLESS_SCREENSHOT;
        const delayMs = Number(process.env.HEADLESS_DELAY_MS ?? '6000');
        const grab = async () => {
            console.log('[screenshot] grabbing…');
            try {
                const img = await mainWindow.webContents.capturePage();
                const buf = img.toPNG();
                fs.writeFileSync(outPath, buf);
                const { width, height } = img.getSize();
                console.log(`[screenshot] wrote ${outPath} (${width}x${height}, ${buf.length} bytes)`);
            }
            catch (e) {
                console.error('[screenshot] failed', e);
            }
            finally {
                electron_1.app.quit();
            }
        };
        // Fire on first paint OR after a hard timeout, whichever comes first.
        let grabbed = false;
        const fire = () => { if (!grabbed) {
            grabbed = true;
            grab();
        } };
        mainWindow.webContents.on('did-finish-load', () => {
            console.log(`[screenshot] did-finish-load — waiting ${delayMs}ms for paint`);
            setTimeout(fire, delayMs);
        });
        // Hard fallback if did-finish-load never fires
        setTimeout(fire, delayMs + 15000);
    }
    mainWindow.on('closed', () => { mainWindow = null; });
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
