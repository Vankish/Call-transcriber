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
})
