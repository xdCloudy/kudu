import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import type {
  InstalledProgram,
  StartupItem,
  StartupSafetyRating,
  StartupSafetyResult,
} from '../../shared/types'
import { listStartupItems } from '../ipc/startup-manager.ipc'
import { getInstalledProgramsFull } from './program-uninstaller'
import { logError, logInfo } from './logger'

const MODEL_FILE = 'MiniCPM5-1B-Q4_K_M.gguf'
const IDLE_UNLOAD_MS = 60_000
const SERVER_START_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 30_000
const CACHE_VERSION = 2

type SafetyKind = 'startup' | 'program'

interface CacheFile {
  version: number
  ratings: Record<string, StartupSafetyRating>
}

interface PendingAnalysis {
  key: string
  kind: SafetyKind
  name: string
  metadata: Record<string, unknown>
  fallback: StartupSafetyRating
}

interface LlamaReply {
  choices?: Array<{ message?: { content?: string } }>
}

function dataDir(): string {
  const dir = app.isPackaged
    ? app.getPath('userData')
    : join(app.getPath('userData'), 'Kudu-Dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function cachePath(): string {
  return join(dataDir(), 'local-ai-safety.json')
}

function loadCache(): CacheFile {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheFile
    if (raw?.version === CACHE_VERSION && raw.ratings && typeof raw.ratings === 'object') return raw
  } catch { /* first run/corrupt cache */ }
  return { version: CACHE_VERSION, ratings: {} }
}

function saveCache(cache: CacheFile): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    logError('Local AI: failed to persist safety cache', err)
  }
}

function stableKey(kind: SafetyKind, metadata: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${CACHE_VERSION}:${kind}:${JSON.stringify(metadata)}`)
    .digest('hex')
}

function clampScore(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score)))
}

function heuristicStartup(item: StartupItem): StartupSafetyRating {
  const text = `${item.name} ${item.displayName} ${item.publisher} ${item.command}`.toLowerCase()
  let score = 6
  const reasons: string[] = []

  if (item.stale) {
    score = 4
    reasons.push('startup target appears to be missing')
  }
  if (/microsoft|windows defender|nvidia|intel|amd|google|mozilla|valve|discord|spotify/.test(text)) {
    // Upstream derives some publisher names from paths/commands. Treat this as
    // a weak hint, never as proof of a valid code signature.
    score = Math.max(score, 7)
    reasons.push('recognised application/publisher hint')
  }
  if (/\\temp\\|\\downloads\\|appdata\\local\\temp|powershell|wscript|cscript|mshta/.test(text)) {
    score = Math.min(score, 4)
    reasons.push('startup command uses a higher-risk path or interpreter')
  }
  if (!item.publisher || item.publisher === 'Unknown') {
    score = Math.min(score, 6)
    reasons.push('publisher hint is unknown')
  }

  return {
    name: item.name,
    safetyScore: clampScore(score),
    description: reasons.length
      ? `Local heuristic: ${reasons.join('; ')}.`
      : 'Local heuristic: no obvious high-risk indicators in the available startup metadata.',
    analyzedAt: new Date().toISOString(),
  }
}

function heuristicProgram(program: InstalledProgram): StartupSafetyRating {
  const text = `${program.displayName} ${program.publisher} ${program.installLocation}`.toLowerCase()
  let score = 6
  const reasons: string[] = []

  if (/microsoft|nvidia|intel|amd|google|mozilla|valve|discord|spotify|adobe|github/.test(text)) {
    score = 7
    reasons.push('recognised application/publisher hint')
  }
  if (!program.publisher || program.publisher === 'Unknown') {
    score = Math.min(score, 6)
    reasons.push('publisher hint is unknown')
  }
  if (/\\temp\\|\\downloads\\/.test(program.installLocation.toLowerCase())) {
    score = Math.min(score, 4)
    reasons.push('unusual install location')
  }

  return {
    name: program.displayName,
    safetyScore: clampScore(score),
    description: reasons.length
      ? `Local heuristic: ${reasons.join('; ')}.`
      : 'Local heuristic: no obvious high-risk indicators in the available installed-program metadata.',
    analyzedAt: new Date().toISOString(),
  }
}

function runtimeDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'local-ai', 'runtime')
    : join(app.getAppPath(), 'resources', 'local-ai', 'runtime')
}

function modelPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'local-ai', 'models', MODEL_FILE)
    : join(app.getAppPath(), 'resources', 'local-ai', 'models', MODEL_FILE)
}

function findServerExecutable(): { exe: string; argsPrefix: string[] } | null {
  const dir = runtimeDir()
  const candidates = [
    { name: 'llama-server.exe', argsPrefix: [] },
    { name: 'llama-server', argsPrefix: [] },
    { name: 'llama.exe', argsPrefix: ['serve'] },
    { name: 'llama', argsPrefix: ['serve'] },
  ]
  for (const candidate of candidates) {
    const exe = join(dir, candidate.name)
    if (existsSync(exe)) return { exe, argsPrefix: candidate.argsPrefix }
  }
  return null
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close((err) => err ? reject(err) : resolve(port))
    })
  })
}

class LocalAiSafetyService {
  // Do not touch app.getPath() at module import time: Electron may import this
  // module before app.whenReady(). Load the cache on the first actual analysis.
  private cacheData: CacheFile | null = null
  private queued = new Set<string>()
  private queue: PendingAnalysis[] = []
  private workerRunning = false
  private server: ChildProcess | null = null
  private serverPort = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private unavailableReason: string | null = null

  private getCache(): CacheFile {
    if (!this.cacheData) this.cacheData = loadCache()
    return this.cacheData
  }

  async getStartupSafetyRatings(): Promise<StartupSafetyResult> {
    const cache = this.getCache()
    const items = await listStartupItems()
    const ratings: StartupSafetyRating[] = []
    let pending = 0

    for (const item of items) {
      const metadata = {
        name: item.name,
        displayName: item.displayName,
        publisherHint: item.publisher,
        command: item.command,
        source: item.source,
        enabled: item.enabled,
        impact: item.impact,
        stale: !!item.stale,
      }
      const key = stableKey('startup', metadata)
      const cached = cache.ratings[key]
      if (cached) {
        ratings.push(cached)
        continue
      }

      const fallback = heuristicStartup(item)
      ratings.push(fallback)
      if (!this.unavailableReason) {
        pending++
        this.enqueue({ key, kind: 'startup', name: item.name, metadata, fallback })
      }
    }

    return { ratings, pending }
  }

  async getInstalledProgramSafetyRatings(): Promise<StartupSafetyResult> {
    const cache = this.getCache()
    const programs = await getInstalledProgramsFull()
    const ratings: StartupSafetyRating[] = []
    let pending = 0

    for (const program of programs) {
      const metadata = {
        name: program.displayName,
        publisherHint: program.publisher,
        version: program.displayVersion,
        installLocation: program.installLocation,
        installDate: program.installDate,
        systemComponent: program.isSystemComponent,
        windowsInstaller: program.isWindowsInstaller,
      }
      const key = stableKey('program', metadata)
      const cached = cache.ratings[key]
      if (cached) {
        ratings.push(cached)
        continue
      }

      const fallback = heuristicProgram(program)
      ratings.push(fallback)
      if (!this.unavailableReason) {
        pending++
        this.enqueue({ key, kind: 'program', name: program.displayName, metadata, fallback })
      }
    }

    return { ratings, pending }
  }

  stop(): void {
    this.queue = []
    this.queued.clear()
    this.unavailableReason = null
    this.stopServer()
  }

  private enqueue(item: PendingAnalysis): void {
    if (this.queued.has(item.key) || this.getCache().ratings[item.key]) return
    this.queued.add(item.key)
    this.queue.push(item)
    if (!this.workerRunning) void this.runWorker()
  }

  private async runWorker(): Promise<void> {
    this.workerRunning = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!
        try {
          const refined = await this.refine(item)
          const cache = this.getCache()
          cache.ratings[item.key] = refined
          saveCache(cache)
          this.pushUpdate(item.kind)
        } catch (err) {
          logError(`Local AI: analysis failed for ${item.name}`, err)
          // If the bundled runtime/model is absent or cannot start, stop repeatedly
          // retrying every item. Heuristic ratings remain available immediately.
          if (!this.server) {
            this.unavailableReason = err instanceof Error ? err.message : String(err)
            this.queue = []
          }
        } finally {
          this.queued.delete(item.key)
        }
      }
    } finally {
      this.workerRunning = false
    }
  }

  private async refine(item: PendingAnalysis): Promise<StartupSafetyRating> {
    await this.ensureServer()
    this.bumpIdleTimer()

    const prompt = [
      'You are a local software safety classifier inside a system utility.',
      'Assess ONLY the supplied metadata. Do not claim malware unless the metadata supports it.',
      'The publisherHint field is unverified registry/path metadata, NOT a verified code signature.',
      'Score 1-10 where 10 is highly trustworthy/safe and 1 is strongly suspicious.',
      'Unknown/insufficient evidence should usually score 5-6.',
      'Return ONLY compact JSON with integer safetyScore and a description under 240 characters.',
      `Kind: ${item.kind}`,
      `Metadata: ${JSON.stringify(item.metadata)}`,
    ].join('\n')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`http://127.0.0.1:${this.serverPort}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'local-safety',
          temperature: 0.1,
          max_tokens: 160,
          messages: [
            { role: 'system', content: 'Return JSON only. Never include markdown.' },
            { role: 'user', content: prompt },
          ],
          response_format: {
            type: 'json_object',
            schema: {
              type: 'object',
              properties: {
                safetyScore: { type: 'integer', minimum: 1, maximum: 10 },
                description: { type: 'string', minLength: 1, maxLength: 240 },
              },
              required: ['safetyScore', 'description'],
              additionalProperties: false,
            },
          },
        }),
      })
      if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`)
      const body = await response.json() as LlamaReply
      const content = body.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error('llama.cpp returned an empty response')

      const parsed = JSON.parse(content) as { safetyScore?: unknown; description?: unknown }
      const score = typeof parsed.safetyScore === 'number'
        ? clampScore(parsed.safetyScore)
        : item.fallback.safetyScore
      const description = typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim().slice(0, 240)
        : item.fallback.description

      return {
        name: item.name,
        safetyScore: score,
        description,
        analyzedAt: new Date().toISOString(),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.serverPort) return

    const model = modelPath()
    if (!existsSync(model)) {
      throw new Error(`Bundled model missing: ${model}. Run npm run prepare:local-ai.`)
    }
    const runtime = findServerExecutable()
    if (!runtime) {
      throw new Error(`Bundled llama.cpp runtime missing in ${runtimeDir()}. Run npm run prepare:local-ai.`)
    }

    const port = await freeLoopbackPort()
    const args = [
      ...runtime.argsPrefix,
      '-m', model,
      '--alias', 'local-safety',
      '--host', '127.0.0.1',
      '--port', String(port),
      '-c', '4096',
      '-ngl', '0',
      '--no-webui',
    ]

    logInfo(`Local AI: starting embedded llama.cpp on loopback port ${port}`)
    this.server = spawn(runtime.exe, args, {
      cwd: runtimeDir(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.serverPort = port

    this.server.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) logInfo(`Local AI: ${text.slice(0, 400)}`)
    })
    this.server.once('exit', () => {
      this.server = null
      this.serverPort = 0
    })

    const deadline = Date.now() + SERVER_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!this.server || this.server.exitCode !== null) throw new Error('Embedded llama.cpp exited during startup')
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) return
      } catch { /* not ready yet */ }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    this.stopServer()
    throw new Error('Embedded llama.cpp did not become ready in time')
  }

  private bumpIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stopServer(), IDLE_UNLOAD_MS)
    this.idleTimer.unref?.()
  }

  private stopServer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.server && this.server.exitCode === null) {
      this.server.kill()
    }
    this.server = null
    this.serverPort = 0
  }

  private pushUpdate(kind: SafetyKind): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) return
    win.webContents.send(kind === 'startup' ? IPC.STARTUP_SAFETY_UPDATED : IPC.PROGRAM_SAFETY_UPDATED)
  }
}

export const localAiSafety = new LocalAiSafetyService()
