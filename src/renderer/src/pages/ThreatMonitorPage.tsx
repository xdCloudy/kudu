import { useEffect } from 'react'
import { Clock, Globe, Radar, ShieldCheck, Wifi } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { useThreatMonitorStore } from '@/stores/threat-monitor-store'
import type { FlaggedConnection, FlaggedDnsEntry } from '@shared/types'

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function ThreatMonitorPage() {
  const snapshot = useThreatMonitorStore((s) => s.snapshot)
  const loaded = useThreatMonitorStore((s) => s.loaded)
  const load = useThreatMonitorStore((s) => s.load)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  if (!loaded) {
    return (
      <div className="p-8">
        <PageHeader
          title="Threat Monitor"
          description="Local network checks against the cached public threat-intelligence list."
        />
        <div className="flex items-center justify-center py-20 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Loading local threat monitor…
        </div>
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="p-8">
        <PageHeader
          title="Threat Monitor"
          description="Local network checks against the cached public threat-intelligence list."
        />
        <EmptyState
          icon={Radar}
          title="Threat list is not ready yet"
          description="Kudu is loading the cached list or refreshing it from public threat intelligence. Cached protection resumes automatically once a list is available."
        />
      </div>
    )
  }

  const { flaggedConnections, flaggedDns, blacklistVersion, lastConnectionScanAt, lastDnsScanAt } = snapshot
  const totalThreats = flaggedConnections.length + flaggedDns.length

  return (
    <div className="p-8">
      <PageHeader
        title="Threat Monitor"
        description="Runs locally. No Kudu Cloud account or subscription is used."
      />

      <div
        className="mb-6 flex flex-wrap items-center gap-5 rounded-xl px-5 py-3.5 text-[12px]"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
      >
        {blacklistVersion && (
          <span style={{ color: 'var(--text-muted)' }}>
            Threat list <span className="font-medium text-zinc-400">{blacklistVersion}</span>
          </span>
        )}
        {lastConnectionScanAt && (
          <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <Clock className="h-3 w-3" />
            Connections scanned {formatTime(lastConnectionScanAt)}
          </span>
        )}
        {lastDnsScanAt && (
          <span className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <Clock className="h-3 w-3" />
            DNS scanned {formatTime(lastDnsScanAt)}
          </span>
        )}
        <span
          className="ml-auto font-medium"
          style={{ color: totalThreats > 0 ? '#ef4444' : '#22c55e' }}
        >
          {totalThreats > 0 ? `${totalThreats} threat ${totalThreats === 1 ? 'match' : 'matches'} detected` : 'No threat matches detected'}
        </span>
      </div>

      {totalThreats === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No threat matches detected"
          description="Current network activity does not match the locally cached threat list. This is one signal, not a guarantee that every connection is safe."
        />
      )}

      {flaggedConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-zinc-300">
            <Wifi className="h-4 w-4 text-red-400" strokeWidth={2} />
            Flagged connections
            <Count value={flaggedConnections.length} />
          </h2>
          <div className="space-y-1.5">
            {flaggedConnections.map((conn, i) => (
              <ConnectionRow key={`${conn.remoteAddress}:${conn.remotePort}-${i}`} conn={conn} />
            ))}
          </div>
        </section>
      )}

      {flaggedDns.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-zinc-300">
            <Globe className="h-4 w-4 text-red-400" strokeWidth={2} />
            Flagged DNS entries
            <Count value={flaggedDns.length} />
          </h2>
          <div className="space-y-1.5">
            {flaggedDns.map((entry, i) => (
              <DnsRow key={`${entry.domain}-${i}`} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Count({ value }: { value: number }) {
  return (
    <span
      className="ml-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
      style={{ background: '#ef4444', color: '#fff' }}
    >
      {value}
    </span>
  )
}

function ConnectionRow({ conn }: { conn: FlaggedConnection }) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-xl px-4 py-3 text-[12px]"
      style={{ background: 'var(--bg-subtle)', border: '1px solid rgba(239,68,68,0.16)' }}
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-zinc-300">
          {conn.processName || 'Unknown process'} → {conn.remoteAddress}:{conn.remotePort}
        </div>
        <div className="mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
          Matched {conn.matchedRule}
        </div>
      </div>
      <div className="text-right" style={{ color: 'var(--text-muted)' }}>
        <div>{conn.protocol}</div>
        <div className="mt-1">{formatTime(conn.detectedAt)}</div>
      </div>
    </div>
  )
}

function DnsRow({ entry }: { entry: FlaggedDnsEntry }) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-xl px-4 py-3 text-[12px]"
      style={{ background: 'var(--bg-subtle)', border: '1px solid rgba(239,68,68,0.16)' }}
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-zinc-300">{entry.domain}</div>
        <div className="mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
          Matched {entry.matchedRule}{entry.resolvedAddress ? ` · ${entry.resolvedAddress}` : ''}
        </div>
      </div>
      <div className="text-right" style={{ color: 'var(--text-muted)' }}>
        {formatTime(entry.detectedAt)}
      </div>
    </div>
  )
}
