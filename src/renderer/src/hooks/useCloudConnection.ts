import { useEffect, useState } from 'react'

export type CloudConnectionState = 'checking' | 'connected' | 'disconnected' | 'subscription-required' | 'authorization-error'

export function cloudConnectionStateFromStatus(status: { status?: string; error?: string | null } | undefined): CloudConnectionState {
  if (status?.status === 'connected') return 'connected'

  const error = status?.error?.toLowerCase() ?? ''
  if (error.includes('subscription') || error.includes('http 402')) return 'subscription-required'
  if (error.includes('access denied') || error.includes('api key') || error.includes('http 401') || error.includes('http 403')) {
    return 'authorization-error'
  }

  return 'disconnected'
}

/**
 * Tracks the embedded local security service. The `enabled` argument is kept
 * for renderer API compatibility with upstream pages, but local mode does not
 * require an API key and therefore always queries the live service status.
 */
export function useCloudConnection(_enabled: boolean): CloudConnectionState {
  const [state, setState] = useState<CloudConnectionState>('checking')

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const status = await window.kudu?.cloudGetStatus?.()
        if (!cancelled) setState(cloudConnectionStateFromStatus(status))
      } catch {
        if (!cancelled) setState('disconnected')
      }
    }

    void refresh()
    const timer = window.setInterval(refresh, 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return state
}
