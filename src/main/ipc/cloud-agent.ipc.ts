import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { cloudAgent as hostedCloudAgent } from '../services/cloud-agent'
import { localCloud } from '../services/local-cloud-service'
import { threatMonitor } from '../services/threat-monitor'

let hostedCloudDisabled = false

export function registerCloudAgentIpc(): void {
  // This fork is local-only. Neutralise the hosted agent before main/index.ts
  // reaches its legacy "start if API key exists" block. This also protects
  // users upgrading from an official Kudu install that still has a saved key.
  if (!hostedCloudDisabled) {
    hostedCloudDisabled = true
    hostedCloudAgent.stop()
    hostedCloudAgent.start = async () => {}
    void hostedCloudAgent.unlink().catch(() => {})
  }

  void localCloud.start().catch(() => {})

  ipcMain.handle(IPC.CLOUD_LINK, async () => {
    return localCloud.link()
  })

  ipcMain.handle(IPC.CLOUD_UNLINK, async () => {
    return localCloud.unlink()
  })

  ipcMain.handle(IPC.CLOUD_GET_STATUS, () => {
    return localCloud.getStatus()
  })

  ipcMain.handle(IPC.CLOUD_RECONNECT, async () => {
    return localCloud.reconnect()
  })

  ipcMain.handle(IPC.THREAT_MONITOR_GET_SNAPSHOT, () => {
    return threatMonitor.getThreatSnapshot()
  })
}
