const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { tr } = require('./i18n.cjs')

// ── Enlace con el CRM de Orbit ────────────────────────────────────────────────
// Una llamada comercial se analiza con Claude Code abierto en la carpeta de
// Orbit, no con el modelo de los resúmenes: así lee el guion de discovery, el
// ICP y las notas del lead antes de rellenar nada. Lo que sale se manda al CRM
// por su API de entrada (packages/orbit-gtm/convex/inboundApi.ts).
//
// La clave del CRM vive en su propio archivo local, igual que las de IA: nunca
// en la nube ni en el repositorio.

const CRM_FILE = (userData) => path.join(userData, 'call-transcriber-crm.json')

const DEFAULTS = {
  apiUrl: '',
  apiKey: '',
  orbitDir: 'D:\\Claude Code proyects\\orbit',
  vaultDir: path.join(os.homedir(), '.claude', 'projects', 'C--Users-Usuari', 'memory'),
}

async function readCrmConfig(userData) {
  try {
    return { ...DEFAULTS, ...JSON.parse(await fs.readFile(CRM_FILE(userData), 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

async function saveCrmConfig(userData, cfg) {
  const clean = {
    apiUrl: String(cfg.apiUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || '').trim(),
    orbitDir: String(cfg.orbitDir || '').trim(),
    vaultDir: String(cfg.vaultDir || '').trim(),
  }
  await fs.writeFile(CRM_FILE(userData), JSON.stringify(clean, null, 2), 'utf-8')
  return clean
}

// Claude Code se instala en ~/.local/bin; desde un acceso directo el PATH no
// siempre lo incluye, así que se prueba esa ruta primero.
async function claudeExecutable() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  try { await fs.access(local); return local } catch { return 'claude' }
}

const CAMPOS = ['spinSituation', 'spinProblem', 'spinImplication', 'spinNeedPayoff', 'singleSalesObjective', 'nextStep']

function buildPrompt({ candidateName, deal, transcript, callDate, vaultDir }) {
  const yaRelleno = CAMPOS.filter(c => deal?.[c]?.trim()).map(c => `- ${c}: ${deal[c]}`).join('\n') || '(ninguno)'
  return [
    'Eres el asistente comercial de David en Upskill. Acaba de tener una llamada de venta de Orbit y tienes que rellenar el trato del CRM a partir de la transcripción.',
    '',
    'Antes de escribir, lee el contexto que ya existe (solo lectura, no modifiques ningún archivo):',
    `- La memoria de David está en ${vaultDir}. Mira MEMORY.md, el guion base de discovery (proyectos/upskill/ventas/upskill-guion-base-discovery.md) y el ICP (proyectos/upskill/mercado/upskill-icp-orbit-donde-enfocar.md).`,
    `- Busca en esa memoria notas previas de este lead por su nombre o su empresa (indices/upskill-leads.md y proyectos/upskill/leads/).`,
    '',
    `Lead: ${candidateName || 'sin nombre'}${deal?.company ? ` · empresa: ${deal.company}` : ''}`,
    `Fecha de la llamada: ${callDate}`,
    'Campos del trato que ya tienen valor (no los repitas ni los contradigas sin motivo):',
    yaRelleno,
    '',
    'Reglas:',
    '- Todo en español de España.',
    '- Solo lo que se dijo en la llamada o consta en las notas. Si algo no salió, deja el campo vacío ("") en vez de inventarlo.',
    '- SPIN: situación (cómo trabajan hoy), problema (qué les duele), implicación (qué les cuesta ese problema), beneficio (qué ganarían resolviéndolo, dicho por ellos).',
    '- singleSalesObjective: el objetivo concreto de venta con esta cuenta, en una frase.',
    '- nextStep: el siguiente paso acordado, con fecha si se dijo.',
    '- nota: resumen de la llamada para el CRM, en texto plano con guiones, sin tablas. Incluye datos duros (equipo, volumen, presupuesto, quién decide, plazos) y las objeciones.',
    '',
    'Responde ÚNICAMENTE con un objeto JSON, sin texto antes ni después y sin bloque de código:',
    '{"spinSituation":"","spinProblem":"","spinImplication":"","spinNeedPayoff":"","singleSalesObjective":"","nextStep":"","nota":""}',
    '',
    '--- TRANSCRIPCIÓN ---',
    transcript,
  ].join('\n')
}

// El JSON a veces llega envuelto en ``` o con una frase delante: se recorta al
// primer objeto completo.
function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(tr('Claude no devolvió el JSON esperado'))
  return JSON.parse(text.slice(start, end + 1))
}

async function analyzeCall(cfg, payload, log) {
  if (!cfg.orbitDir) throw new Error(tr('Falta la carpeta de Orbit en Configuración → CRM'))
  await fs.access(cfg.orbitDir).catch(() => { throw new Error(tr('No existe la carpeta de Orbit: {ruta}', { ruta: cfg.orbitDir })) })
  const exe = await claudeExecutable()
  const args = ['-p', '--output-format', 'json', '--allowedTools', 'Read,Grep,Glob']
  if (cfg.vaultDir) args.push('--add-dir', cfg.vaultDir)
  const prompt = buildPrompt({ ...payload, vaultDir: cfg.vaultDir })

  const started = Date.now()
  const stdout = await new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE heredado haría que un hijo basado en Electron no arrancara.
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const proc = spawn(exe, args, { cwd: cfg.orbitDir, env, windowsHide: true })
    let out = ''
    let err = ''
    // Leer el contexto y la transcripción de una llamada larga le lleva un par de
    // minutos; pasados diez algo se ha quedado colgado.
    const timer = setTimeout(() => { proc.kill(); reject(new Error(tr('Claude tardó más de 10 minutos y se canceló'))) }, 10 * 60_000)
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(new Error(tr('No se pudo abrir Claude Code ({msg}). ¿Está instalado en este PC?', { msg: e.message }))) })
    proc.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(tr('Claude Code salió con error {code}: {msg}', { code, msg: (err || out).slice(-400) })))
    })
    proc.stdin.end(prompt)
  })
  const envelope = JSON.parse(stdout)
  if (envelope.is_error) throw new Error(`Claude Code: ${String(envelope.result).slice(0, 400)}`)
  const fields = extractJson(String(envelope.result ?? ''))
  log.info(`[crm] llamada analizada con Claude en ${Math.round((Date.now() - started) / 1000)} s`)
  const clean = {}
  for (const c of [...CAMPOS, 'nota']) clean[c] = typeof fields[c] === 'string' ? fields[c].trim() : ''
  return clean
}

// Los registros que la API de entrada ya acepta hoy (syncRecordValidator.ts).
// Los campos SPIN del trato todavía no tienen registro propio: van dentro de la
// nota hasta que exista `deal.fill`.
function buildRecords({ interviewId, candidateName, deal, callAt, durationMin, analysis }) {
  const contact = {
    email: deal.contactEmail || null,
    linkedinUrl: deal.linkedinUrl || null,
    fullName: candidateName || null,
  }
  const ref = (type) => ({ externalType: type, externalId: interviewId })
  const spin = [
    ['Situación', analysis.spinSituation],
    ['Problema', analysis.spinProblem],
    ['Implicación', analysis.spinImplication],
    ['Beneficio', analysis.spinNeedPayoff],
    ['Objetivo de venta', analysis.singleSalesObjective],
    ['Próximo paso', analysis.nextStep],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
  const body = [`Llamada del ${new Date(callAt).toLocaleDateString('es-ES')} (Call Transcriber)`, '', analysis.nota, spin && `\n${spin}`].filter(Boolean).join('\n')

  return [
    {
      type: 'meeting.upsert',
      ref: ref('call'),
      data: { title: `Llamada con ${candidateName || deal.company || 'lead'}`, type: 'other', scheduledAt: callAt, durationMin: durationMin || null, status: 'held' },
      attendees: [{ email: contact.email, fullName: contact.fullName }],
    },
    { type: 'stage.signal', ref: ref('call-held'), contact, at: callAt, signal: { kind: 'meeting_held' } },
    { type: 'note.add', ref: ref('call-note'), contact, body },
  ]
}

async function sendToCrm(cfg, payload) {
  if (!cfg.apiUrl || !cfg.apiKey) return { sent: false, reason: tr('Sin clave del CRM: el resultado se queda solo en la app') }
  const records = buildRecords(payload)
  const res = await fetch(`${cfg.apiUrl}/api/v1/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ records }),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text).error ?? text } catch { /* texto plano */ }
    throw new Error(tr('El CRM respondió {status}: {msg}', { status: res.status, msg: String(msg).slice(0, 300) }))
  }
  return { sent: true }
}

// calltranscriber://deal/<id>?name=…&company=…&email=…&linkedin=…
// El botón del CRM manda lo que sabe del trato en el propio enlace, para que la
// ficha se pueda crear aunque el CRM todavía no tenga forma de consultarse.
function parseDealLink(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'calltranscriber:') return null
    const parts = `${u.host}${u.pathname}`.split('/').filter(Boolean)
    if (parts[0] !== 'deal' || !parts[1]) return null
    const q = (k) => (u.searchParams.get(k) || '').trim()
    return { dealId: decodeURIComponent(parts[1]), name: q('name'), company: q('company'), email: q('email'), linkedin: q('linkedin'), stage: q('stage') }
  } catch {
    return null
  }
}

module.exports = { readCrmConfig, saveCrmConfig, analyzeCall, sendToCrm, parseDealLink }
