import { app, BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/channels'
import type { BreachMonitorResult, CvePageResult, StartupSafetyResult } from '../../shared/types'
import type { CloudAgentState } from './cloud-agent-types'
import { getMachineId, getSettings } from './settings-store'
import { loadBlacklist } from './threat-blacklist-store'
import { threatMonitor } from './threat-monitor'
import { refreshLocalThreatFeed } from './local-threat-feed'
import { localAiSafety } from './local-ai-safety'
import { logError, logInfo } from './logger'

class LocalCloudService {
  private started = false
  private linkedAt: string | null = null
  private quitHookRegistered = false

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.linkedAt = this.linkedAt ?? new Date().toISOString()

    threatMonitor.setThreatCallback((snapshot) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) win.webContents.send(IPC.THREAT_MONITOR_UPDATED, snapshot)

      const settings = getSettings()
      if (settings.showThreatNotifications && Notification.isSupported()) {
        const total = snapshot.flaggedConnections.length + snapshot.flaggedDns.length
        if (total > 0) {
          new Notification({
            title: 'Kudu Local threat alert',
            body: `${total} suspicious network ${total === 1 ? 'match' : 'matches'} detected.`,
          }).show()
        }
      }
    })

    if (getSettings().cloud.shareThreatMonitor !== false) {
      // Refresh in the background; a cached list is loaded immediately by the monitor.
      await threatMonitor.start()
      void refreshLocalThreatFeed(false).catch((err) => logError('Local threat feed startup failed', err))
    }

    if (!this.quitHookRegistered) {
      this.quitHookRegistered = true
      app.on('before-quit', () => this.stop())
    }

    logInfo('Local security service started; hosted Kudu Cloud is not required')
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    threatMonitor.setThreatCallback(null)
    threatMonitor.stop()
    localAiSafety.stop()
  }

  getStatus(): CloudAgentState {
    const bl = loadBlacklist()
    return {
      status: this.started ? 'connected' : 'dormant',
      maskedApiKey: null,
      deviceId: getMachineId() || null,
      linkedAt: this.linkedAt,
      lastTelemetryAt: null,
      lastHealthReportAt: null,
      lastCommandAt: null,
      error: null,
      threatBlacklist: bl ? {
        version: bl.version,
        updatedAt: bl.updatedAt,
        domains: bl.domains.length,
        ips: bl.ips.length,
        cidrs: bl.cidrs.length,
      } : null,
    }
  }

  async link(_ignoredApiKey?: string): Promise<{ success: boolean; error?: string }> {
    await this.start()
    return { success: true }
  }

  async unlink(): Promise<void> {
    // Local mode has no account to unlink. Keep protection running.
    await this.start()
  }

  async reconnect(): Promise<void> {
    this.stop()
    await this.start()
    if (getSettings().cloud.shareThreatMonitor !== false) {
      await refreshLocalThreatFeed(true)
    }
  }

  getStartupSafetyRatings(): Promise<StartupSafetyResult> {
    return localAiSafety.getStartupSafetyRatings()
  }

  getInstalledProgramSafetyRatings(): Promise<StartupSafetyResult> {
    return localAiSafety.getInstalledProgramSafetyRatings()
  }

  async getVulnerabilities(
    _page?: number,
    _severity?: string,
    _search?: string,
  ): Promise<CvePageResult> {
    // Do not return an empty result here: that would incorrectly tell the user
    // the machine has no known CVEs. A trustworthy package/version matcher is
    // still needed before this can be localised safely.
    throw new Error('Local CVE matching is not implemented yet; no vulnerability result has been inferred.')
  }

  async getBreachMonitor(): Promise<BreachMonitorResult> {
    return { emails: [], limit: 0, usage: 0 }
  }

  async addBreachMonitorEmails(_emails: string[]): Promise<BreachMonitorResult> {
    throw new Error('Breach monitoring is disabled in the local-only build.')
  }

  async removeBreachMonitorEmail(_email: string): Promise<void> {
    throw new Error('Breach monitoring is disabled in the local-only build.')
  }

  async acknowledgeBreaches(_breachIds: string[]): Promise<{ status: string; acknowledged: number }> {
    throw new Error('Breach monitoring is disabled in the local-only build.')
  }
}

export const localCloud = new LocalCloudService()
