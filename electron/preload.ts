import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // CoH2 install detection
  detectCoh2:     (): Promise<string | null>   => ipcRenderer.invoke('detect-coh2'),
  pickDirectory:  (): Promise<string | null>   => ipcRenderer.invoke('pick-directory'),

  // File system
  readFile:      (p: string): Promise<ArrayBuffer>                                  => ipcRenderer.invoke('read-file', p),
  readFileRange: (p: string, start: number, length: number): Promise<ArrayBuffer>   => ipcRenderer.invoke('read-file-range', p, start, length),
  fileStat:      (p: string): Promise<{ size: number } | null>                      => ipcRenderer.invoke('file-stat', p),
  listDir:       (p: string): Promise<{ name: string; isDirectory: boolean }[]>     => ipcRenderer.invoke('list-dir', p),
  fileExists:    (p: string): Promise<boolean>                                      => ipcRenderer.invoke('file-exists', p),

  // Window controls
  windowMinimize:  (): Promise<void>    => ipcRenderer.invoke('window-minimize'),
  windowMaximize:  (): Promise<void>    => ipcRenderer.invoke('window-maximize'),
  windowClose:     (): Promise<void>    => ipcRenderer.invoke('window-close'),
  isMaximized:     (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
})
