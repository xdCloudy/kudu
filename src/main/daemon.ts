import { app } from 'electron'
import { localCloud } from './services/local-cloud-service'
import { setDaemonMode } from './services/logger'
import { initAutoUpdater } from './services/auto-updater'

function log(msg: string): void {
  const ts = new Date().toISOString()
  process.stdout.write(`[${ts}] ${msg}\n`)
}

/**
 * Headless local-security mode. No Kudu Cloud API key, account, telemetry
 * upload, remote commands, or hosted backend is used.
 *
 * Usage:
 *   kudu --daemon
 */
export async function runDaemon(): Promise<void> {
  setDaemonMode(true)

  if (process.argv.includes('--api-key')) {
    log('Note: --api-key is ignored in this local-only build.')
  }

  log(`Kudu local daemon v${app.getVersion()} starting`)
  log(`Platform: ${process.platform} (${process.arch})`)
  log(`PID: ${process.pid}`)
  log(`Config: ${app.getPath('userData')}`)

  initAutoUpdater({ daemon: true })

  log('Starting local security service...')
  await localCloud.start()

  const state = localCloud.getStatus()
  if (state.status !== 'connected') {
    log(`Error: Local security service failed to start (status: ${state.status})`)
    app.exit(1)
    return
  }
  log(`Local security status: ${state.status}`)
  log(`Device ID: ${state.deviceId}`)

  const shutdown = (): void => {
    log('Shutting down...')
    localCloud.stop()
    log('Local security service stopped. Goodbye.')
    app.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  setInterval(() => {
    const s = localCloud.getStatus()
    const threatList = s.threatBlacklist?.version ?? 'not loaded'
    log(`Heartbeat — status: ${s.status}, threat list: ${threatList}`)
  }, 5 * 60 * 1000)

  log('Local daemon running. Press Ctrl+C to stop.')
}
