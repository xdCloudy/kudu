import { loadBlacklist, saveBlacklist } from './threat-blacklist-store'
import { threatMonitor } from './threat-monitor'
import { logError, logInfo } from './logger'

const DROP_V4_URL = 'https://www.spamhaus.org/drop/drop_v4.json'
const DROP_V6_URL = 'https://www.spamhaus.org/drop/drop_v6.json'
const REFRESH_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 30_000
const MAX_FEED_BYTES = 10 * 1024 * 1024

interface DropRow {
  cidr?: unknown
}

async function fetchCidrs(url: string): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, application/x-ndjson, text/plain',
        'User-Agent': 'Kudu-Local/1.0',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const length = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
      throw new Error('feed exceeds size limit')
    }

    const text = await response.text()
    if (text.length > MAX_FEED_BYTES) throw new Error('feed exceeds size limit')

    const cidrs: string[] = []
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      try {
        const row = JSON.parse(line) as DropRow
        if (typeof row.cidr === 'string' && row.cidr.length <= 100) cidrs.push(row.cidr)
      } catch {
        // Some mirrors may return a normal JSON array instead of NDJSON.
        // That form is handled below if no NDJSON rows were parsed.
      }
    }

    if (cidrs.length > 0) return cidrs

    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('unexpected feed format')
    return parsed
      .map((row) => row && typeof row === 'object' ? (row as DropRow).cidr : undefined)
      .filter((cidr): cidr is string => typeof cidr === 'string' && cidr.length <= 100)
  } finally {
    clearTimeout(timeout)
  }
}

function cacheFresh(): boolean {
  const current = loadBlacklist()
  if (!current || !current.version.startsWith('spamhaus-drop-')) return false
  const updated = Date.parse(current.updatedAt)
  return Number.isFinite(updated) && Date.now() - updated < REFRESH_MS
}

/**
 * Refresh the local threat list from Spamhaus DROP. The data is cached in the
 * normal Kudu blacklist store so monitoring keeps working when offline.
 */
export async function refreshLocalThreatFeed(force = false): Promise<void> {
  if (!force && cacheFresh()) {
    await threatMonitor.reloadBlacklist()
    return
  }

  try {
    const [v4, v6] = await Promise.all([fetchCidrs(DROP_V4_URL), fetchCidrs(DROP_V6_URL)])
    const cidrs = [...new Set([...v4, ...v6])]
    if (cidrs.length === 0) throw new Error('threat feed returned no CIDRs')

    const now = new Date()
    saveBlacklist({
      version: `spamhaus-drop-${now.toISOString().slice(0, 10)}`,
      updatedAt: now.toISOString(),
      domains: [],
      ips: [],
      cidrs,
    })
    logInfo(`Local threat feed updated (${cidrs.length} CIDRs)`)
    await threatMonitor.reloadBlacklist()
  } catch (err) {
    // A stale cache is preferable to disabling protection because the network
    // happens to be unavailable during startup.
    logError('Local threat feed refresh failed; keeping cached list', err)
    if (loadBlacklist()) await threatMonitor.reloadBlacklist()
  }
}
