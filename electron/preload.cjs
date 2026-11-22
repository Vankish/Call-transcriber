const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  isDesktop: true,
  saveRecording: (payload) => ipcRenderer.invoke('recording:save', payload),
  convertRecording: (payload) => ipcRenderer.invoke('recording:convert', payload),
  saveVideoRecording: (payload) => ipcRenderer.invoke('recording:save-video', payload),
  saveSystemRecording: (payload) => ipcRenderer.invoke('recording:save-system', payload),
  openRecordingStream: (payload) => ipcRenderer.invoke('recording:stream-open', payload),
  appendRecordingStream: (payload) => ipcRenderer.invoke('recording:stream-append', payload),
  closeRecordingStream: (payload) => ipcRenderer.invoke('recording:stream-close', payload),
  getCrmConfig: () => ipcRenderer.invoke('crm:get-config'),
  saveCrmConfig: (cfg) => ipcRenderer.invoke('crm:save-config', cfg),
  takePendingDeal: () => ipcRenderer.invoke('crm:take-pending-deal'),
  onOpenDeal: (cb) => {
    const handler = (_e, deal) => cb(deal)
    ipcRenderer.on('crm:open-deal', handler)
    return () => ipcRenderer.removeListener('crm:open-deal', handler)
  },
  analyzeAndSendToCrm: (payload) => ipcRenderer.invoke('crm:analyze-and-send', payload),
  onCaptureSources: (cb) => ipcRenderer.on('capture:sources', (_e, sources) => cb(sources)),
  pickCaptureSource: (sourceId) => ipcRenderer.invoke('capture:pick-source', sourceId),
  setCaptureMode: (wantsVideo) => ipcRenderer.invoke('capture:set-mode', wantsVideo),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (payload) => ipcRenderer.invoke('config:save', payload),
  getLocalData: () => ipcRenderer.invoke('data:get'),
  saveLocalData: (payload) => ipcRenderer.invoke('data:save', payload),
  getProviderCatalog: () => ipcRenderer.invoke('providers:catalog'),
  testProvider: (payload) => ipcRenderer.invoke('providers:test', payload),
  transcribeAudio: (payload) => ipcRenderer.invoke('transcription:run', payload),
  generateSummary: (payload) => ipcRenderer.invoke('summary:generate', payload),
  prepareSummary: (payload) => ipcRenderer.invoke('summary:prepare', payload),
  // Devuelve la función para desuscribirse: sin ella, cada recarga en desarrollo
  // deja un oyente vivo y el mismo aviso se procesa varias veces.
  onSummaryProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('summary:progress', handler)
    return () => ipcRenderer.removeListener('summary:progress', handler)
  },
  deleteRecording: (payload) => ipcRenderer.invoke('recording:delete', payload),
  ensureRecordingDuration: (payload) => ipcRenderer.invoke('recording:ensure-duration', payload),
  recordingExists: (payload) => ipcRenderer.invoke('recording:exists', payload),
  readRecordingBytes: (payload) => ipcRenderer.invoke('recording:read-bytes', payload),
  writeRecordingBytes: (payload) => ipcRenderer.invoke('recording:write-bytes', payload),
  openOAuthWindow: (url) => ipcRenderer.invoke('auth:open-oauth-window', url),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  getRecordingsDir: () => ipcRenderer.invoke('recordings:get-dir'),
  openRecordingsFolder: () => ipcRenderer.invoke('shell:open-recordings-folder'),
  selectAudioFile: () => ipcRenderer.invoke('dialog:select-audio'),
  onMagicLinkTokens: (cb) => ipcRenderer.on('auth:magic-link-tokens', (_e, data) => cb(data)),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  openReleasesPage: () => ipcRenderer.invoke('updates:open-releases'),
  onUpdaterEvent: (cb) => ipcRenderer.on('updater:event', (_e, data) => cb(data)),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  // Grabación automática: el proceso principal avisa de que una llamada empieza o acaba.
  onCallEvent: (cb) => {
    const handler = (_e, ev) => cb(ev)
    ipcRenderer.on('call:event', handler)
    return () => ipcRenderer.removeListener('call:event', handler)
  },
  showWindow: () => ipcRenderer.invoke('window:show'),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  // Subida de audio y vídeo a la nube (frente C). La interfaz la conecta el frente B.
  cloudUploadStatus: () => ipcRenderer.invoke('cloud:upload-status'),
  cloudUploadList: () => ipcRenderer.invoke('cloud:upload-list'),
  cloudUploadEnqueue: (entries) => ipcRenderer.invoke('cloud:upload-enqueue', entries),
  cloudUploadPause: () => ipcRenderer.invoke('cloud:upload-pause'),
  cloudUploadResume: () => ipcRenderer.invoke('cloud:upload-resume'),
  cloudUploadRetry: (payload) => ipcRenderer.invoke('cloud:upload-retry', payload),
  cloudUploadRemove: (payload) => ipcRenderer.invoke('cloud:upload-remove', payload),
  cloudUploadSetRecording: (value) => ipcRenderer.invoke('cloud:upload-set-recording', value),
  onCloudUploadProgress: (cb) => {
    const handler = (_e, snapshot) => cb(snapshot)
    ipcRenderer.on('cloud:upload-progress', handler)
    return () => ipcRenderer.removeListener('cloud:upload-progress', handler)
  },
  cloudMigrationPlan: () => ipcRenderer.invoke('cloud:migration-plan'),
  cloudMigrationRun: (options) => ipcRenderer.invoke('cloud:migration-run', options),
  // Sesión de la nube y sincronización de datos (frente B). El token no llega
  // nunca aquí: la ventana solo ve el estado.
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudSignInPassword: (payload) => ipcRenderer.invoke('cloud:sign-in-password', payload),
  cloudSignInGoogle: () => ipcRenderer.invoke('cloud:sign-in-google'),
  cloudCancelGoogle: () => ipcRenderer.invoke('cloud:cancel-google'),
  cloudSignOut: () => ipcRenderer.invoke('cloud:sign-out'),
  cloudSyncNow: () => ipcRenderer.invoke('cloud:sync-now'),
  onCloudStatus: (cb) => {
    const handler = (_e, status) => cb(status)
    ipcRenderer.on('cloud:status', handler)
    return () => ipcRenderer.removeListener('cloud:status', handler)
  },
})
