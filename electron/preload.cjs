const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  isDesktop: true,
  saveRecording: (payload) => ipcRenderer.invoke('recording:save', payload),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (payload) => ipcRenderer.invoke('config:save', payload),
  transcribeAudio: (payload) => ipcRenderer.invoke('transcription:run', payload),
  generateSummary: (payload) => ipcRenderer.invoke('summary:generate', payload),
  deleteRecording: (payload) => ipcRenderer.invoke('recording:delete', payload),
  openOAuthWindow: (url) => ipcRenderer.invoke('auth:open-oauth-window', url),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  getRecordingsDir: () => ipcRenderer.invoke('recordings:get-dir'),
  openRecordingsFolder: () => ipcRenderer.invoke('shell:open-recordings-folder'),
  selectAudioFile: () => ipcRenderer.invoke('dialog:select-audio'),
  onMagicLinkTokens: (cb) => ipcRenderer.on('auth:magic-link-tokens', (_e, data) => cb(data)),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdaterEvent: (cb) => ipcRenderer.on('updater:event', (_e, data) => cb(data)),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
})
