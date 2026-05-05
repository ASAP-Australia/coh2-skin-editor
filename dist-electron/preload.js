"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // CoH2 install detection
    detectCoh2: () => electron_1.ipcRenderer.invoke('detect-coh2'),
    pickDirectory: () => electron_1.ipcRenderer.invoke('pick-directory'),
    // File system
    readFile: (p) => electron_1.ipcRenderer.invoke('read-file', p),
    readFileRange: (p, start, length) => electron_1.ipcRenderer.invoke('read-file-range', p, start, length),
    fileStat: (p) => electron_1.ipcRenderer.invoke('file-stat', p),
    listDir: (p) => electron_1.ipcRenderer.invoke('list-dir', p),
    fileExists: (p) => electron_1.ipcRenderer.invoke('file-exists', p),
    // Window controls
    windowMinimize: () => electron_1.ipcRenderer.invoke('window-minimize'),
    windowMaximize: () => electron_1.ipcRenderer.invoke('window-maximize'),
    windowClose: () => electron_1.ipcRenderer.invoke('window-close'),
    isMaximized: () => electron_1.ipcRenderer.invoke('window-is-maximized'),
});
