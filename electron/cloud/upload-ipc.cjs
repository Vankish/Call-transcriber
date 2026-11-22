// ── Canales IPC de la subida a la nube ───────────────────────────────────────
//
// Lo mínimo para que la interfaz (frente B) maneje la cola y la migración. Vive
// aquí y no en main.cjs para que main.cjs solo tenga que registrarlo y avisar
// de cuándo se graba.
//
// La sesión no es cosa de este módulo: hasta que la capa de sesión llame a
// `setCallConvex(fn)` la cola se queda en "esperando sesión" y no sube nada.
//
// Seguridad: la ventana solo puede pedir que se suban archivos de la carpeta de
// grabaciones o que una entrevista tenga enlazados. Si aceptara cualquier ruta,
// una página comprometida podría subir el config.json con las claves de IA.

const path = require('node:path')
const { createUploadQueue } = require('./upload-queue.cjs')
const { planMigration, runMigration } = require('./upload-migrate.cjs')

const PATH_FIELDS = ['recordingFilePath', 'systemAudioFilePath', 'videoFilePath']

function registerUploadIpc({ ipcMain, app, ffmpegPath, readData, recordingsRoot, getWindow, log }) {
  let queue = null
  let lastPlan = null
  const recordingBy = { streams: false, app: false }

  const send = (channel, payload) => {
    const w = getWindow?.()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  // Se crea al primer uso (o al arrancar) y no al cargar main.cjs: userData no
  // es definitivo hasta que Electron ha leído el nombre de la app.
  let ready = null
  const ensure = () => {
    if (!ready) {
      ready = app.whenReady().then(async () => {
        const userData = app.getPath('userData')
        queue = createUploadQueue({
          storeFile: path.join(userData, 'cloud-upload-queue.json'),
          tmpDir: path.join(userData, 'cloud-upload-tmp'),
          ffmpegPath,
          emit: (snapshot) => send('cloud:upload-progress', snapshot),
          log,
        })
        await queue.load()
        queue.setRecording(recordingBy.streams || recordingBy.app)
        void queue.start()
        return queue
      })
    }
    return ready
  }

  const setRecordingFrom = (source, value) => {
    recordingBy[source] = !!value
    queue?.setRecording(recordingBy.streams || recordingBy.app)
  }

  async function allowedPaths() {
    const data = await readData()
    const set = new Set()
    for (const iv of data?.interviews || []) {
      for (const f of PATH_FIELDS) if (iv[f]) set.add(path.resolve(iv[f]).toLowerCase())
    }
    return set
  }

  const relTo = (root, file) => path.relative(root, file).split(path.sep).join('/')
  const isInside = (root, file) => {
    const rel = path.relative(root, file)
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  }

  ipcMain.handle('cloud:upload-status', async () => (await ensure()).status())
  ipcMain.handle('cloud:upload-list', async () => (await ensure()).list())

  // [{ filePath, interviewLocalId, kind: 'mix'|'system'|'video', durationSec? }]
  // La misma comprobación de rutas para la ventana y para la sincronización
  // (frente B), que encola los archivos de cada entrevista nueva al subirla.
  async function enqueueChecked(entries) {
    const q = await ensure()
    const root = path.resolve(recordingsRoot())
    const linked = await allowedPaths()
    const ok = []
    let rejected = 0
    for (const e of Array.isArray(entries) ? entries : []) {
      const file = e?.filePath ? path.resolve(String(e.filePath)) : null
      if (!file) { rejected++; continue }
      const inside = isInside(root, file)
      if (!inside && !linked.has(file.toLowerCase())) { rejected++; continue }
      ok.push({
        filePath: file,
        interviewLocalId: String(e.interviewLocalId || ''),
        kind: e.kind,
        // La ruta relativa la calcula el proceso principal, no la ventana.
        localRelPath: inside ? relTo(root, file) : `_importados/${path.basename(file)}`,
        durationSec: Number(e.durationSec) || null,
      })
    }
    const r = await q.enqueue(ok)
    return { ...r, skipped: r.skipped + rejected }
  }
  ipcMain.handle('cloud:upload-enqueue', (_event, entries) => enqueueChecked(entries))

  ipcMain.handle('cloud:upload-pause', async () => { await (await ensure()).pause(); return { ok: true } })
  ipcMain.handle('cloud:upload-resume', async () => { await (await ensure()).resume(); return { ok: true } })
  ipcMain.handle('cloud:upload-retry', async (_event, payload) => (await ensure()).retry(payload?.id))
  ipcMain.handle('cloud:upload-remove', async (_event, payload) => (await ensure()).remove(String(payload?.id || '')))
  ipcMain.handle('cloud:upload-set-recording', (_event, value) => { setRecordingFrom('app', value); return { ok: true } })

  // Calcula (y recuerda) el plan sin tocar nada. Devuelve el plan entero: la
  // interfaz enseña los totales y, si se le pide, la lista de huérfanos.
  ipcMain.handle('cloud:migration-plan', async () => {
    const data = await readData()
    lastPlan = await planMigration({ data: data || {}, root: recordingsRoot() })
    return lastPlan
  })

  // Ejecuta el último plan enseñado (o uno nuevo si no hay): mete sus archivos
  // en la cola. { includeExternal?: boolean }
  ipcMain.handle('cloud:migration-run', async (_event, options) => {
    const q = await ensure()
    if (!lastPlan) lastPlan = await planMigration({ data: (await readData()) || {}, root: recordingsRoot() })
    return runMigration(q, lastPlan, { includeExternal: !!options?.includeExternal })
  })

  void ensure()

  return {
    /** La capa de sesión (frente B) la llama al entrar y con null al salir. */
    setCallConvex: async (fn) => (await ensure()).setCallConvex(fn),
    /** Lo usa la sincronización para subir los archivos de las entrevistas nuevas. */
    enqueue: enqueueChecked,
    /** main.cjs avisa de que hay pistas grabándose. */
    setRecordingStreams: (value) => setRecordingFrom('streams', value),
    /** Al cerrar la app. Lo que esté a medias se reanuda en el próximo arranque. */
    stop: async () => { if (queue) await queue.stop() },
  }
}

module.exports = { registerUploadIpc }
