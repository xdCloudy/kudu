import { beforeEach, describe, expect, it, vi } from 'vitest'

const handleMap = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, handler)
    }),
  },
}))

vi.mock('../../shared/channels', () => ({
  IPC: {
    CLOUD_LINK: 'cloud:link',
    CLOUD_UNLINK: 'cloud:unlink',
    CLOUD_GET_STATUS: 'cloud:get-status',
    CLOUD_RECONNECT: 'cloud:reconnect',
    THREAT_MONITOR_GET_SNAPSHOT: 'threat-monitor:get-snapshot',
  },
}))

vi.mock('../services/cloud-agent', () => ({
  cloudAgent: {
    start: vi.fn(),
    stop: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../services/local-cloud-service', () => ({
  localCloud: {
    start: vi.fn().mockResolvedValue(undefined),
    link: vi.fn(),
    unlink: vi.fn(),
    getStatus: vi.fn(),
    reconnect: vi.fn(),
  },
}))

vi.mock('../services/threat-monitor', () => ({
  threatMonitor: {
    getThreatSnapshot: vi.fn(),
  },
}))

import { registerCloudAgentIpc } from './cloud-agent.ipc'
import { localCloud } from '../services/local-cloud-service'
import { threatMonitor } from '../services/threat-monitor'

const mockLocalCloud = localCloud as unknown as {
  start: ReturnType<typeof vi.fn>
  link: ReturnType<typeof vi.fn>
  unlink: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
  reconnect: ReturnType<typeof vi.fn>
}

const mockThreatMonitor = threatMonitor as unknown as {
  getThreatSnapshot: ReturnType<typeof vi.fn>
}

function invoke(channel: string, ...args: unknown[]) {
  const handler = handleMap.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler({}, ...args)
}

describe('local security IPC', () => {
  beforeEach(() => {
    handleMap.clear()
    vi.clearAllMocks()
  })

  it('registers all local security handlers', () => {
    registerCloudAgentIpc()
    expect(handleMap.has('cloud:link')).toBe(true)
    expect(handleMap.has('cloud:unlink')).toBe(true)
    expect(handleMap.has('cloud:get-status')).toBe(true)
    expect(handleMap.has('cloud:reconnect')).toBe(true)
    expect(handleMap.has('threat-monitor:get-snapshot')).toBe(true)
    expect(mockLocalCloud.start).toHaveBeenCalled()
  })

  it('does not require or forward an API key', async () => {
    mockLocalCloud.link.mockResolvedValue({ success: true })
    registerCloudAgentIpc()

    const result = await invoke('cloud:link', 'legacy-key-is-ignored')

    expect(result).toEqual({ success: true })
    expect(mockLocalCloud.link).toHaveBeenCalledWith()
  })

  it('delegates status to the local service', () => {
    const expected = { status: 'connected', maskedApiKey: null }
    mockLocalCloud.getStatus.mockReturnValue(expected)
    registerCloudAgentIpc()

    expect(invoke('cloud:get-status')).toEqual(expected)
    expect(mockLocalCloud.getStatus).toHaveBeenCalledOnce()
  })

  it('delegates refresh to the local service', async () => {
    mockLocalCloud.reconnect.mockResolvedValue(undefined)
    registerCloudAgentIpc()

    await invoke('cloud:reconnect')
    expect(mockLocalCloud.reconnect).toHaveBeenCalledOnce()
  })

  it('keeps threat snapshot retrieval local', () => {
    const snapshot = {
      flaggedConnections: [],
      flaggedDns: [],
      blacklistVersion: 'spamhaus-drop-test',
      lastConnectionScanAt: null,
      lastDnsScanAt: null,
    }
    mockThreatMonitor.getThreatSnapshot.mockReturnValue(snapshot)
    registerCloudAgentIpc()

    expect(invoke('threat-monitor:get-snapshot')).toEqual(snapshot)
    expect(mockThreatMonitor.getThreatSnapshot).toHaveBeenCalledOnce()
  })
})
