import { useCallback, useEffect, useState } from 'react'
import {
  BrainCircuit,
  CheckCircle2,
  Database,
  Radar,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

type LocalStatus = {
  status: string
  deviceId: string | null
  linkedAt: string | null
  error: string | null
  threatBlacklist: {
    version: string
    updatedAt: string
    domains: number
    ips: number
    cidrs: number
  } | null
}

export function CloudPage() {
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await window.kudu?.cloudGetStatus?.()
      if (next) setStatus(next as LocalStatus)
    } catch {
      // The status card below remains conservative if IPC is unavailable.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const restartLocalServices = async () => {
    setRefreshing(true)
    try {
      await window.kudu?.cloudReconnect?.()
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const active = status?.status === 'connected'
  const threatRules = status?.threatBlacklist
    ? status.threatBlacklist.domains + status.threatBlacklist.ips + status.threatBlacklist.cidrs
    : 0

  return (
    <div className="animate-fade-in max-w-4xl">
      <PageHeader
        title="Local Security"
        description="Cloud-dependent security features run on this device. No Kudu account, API key, subscription, or hosted Kudu backend is used."
        action={
          <button
            type="button"
            onClick={restartLocalServices}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            Refresh local services
          </button>
        }
      />

      <div
        className="mb-6 flex items-center justify-between rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)' }}
          >
            <Shield className={`h-5 w-5 ${active ? 'text-green-400' : 'text-red-400'}`} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-100">Local engine</h2>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {active ? 'Active — all supported services are running locally.' : 'Starting local services…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: active ? '#4ade80' : 'var(--text-muted)' }}>
          {active ? <CheckCircle2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4 animate-spin" />}
          {active ? 'Local' : 'Starting'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FeatureCard
          icon={Radar}
          title="Threat monitoring"
          state={status?.threatBlacklist ? 'active' : 'loading'}
          description={status?.threatBlacklist
            ? `${threatRules.toLocaleString()} cached threat rules · ${status.threatBlacklist.version}`
            : 'Loading the cached threat list and refreshing it from public threat intelligence.'}
        />

        <FeatureCard
          icon={BrainCircuit}
          title="Local AI safety"
          state="active"
          description="MiniCPM5-1B Q4 runs through an embedded llama.cpp runtime. Heuristic ratings are instant; the LLM refines uncached results in the background."
        />

        <FeatureCard
          icon={Database}
          title="Vulnerability scanner"
          state="pending"
          description="Local CVE matching is intentionally disabled until a trustworthy package/version matcher is wired in. Kudu will not report a false zero-vulnerability result."
        />

        <FeatureCard
          icon={XCircle}
          title="Breach monitoring"
          state="disabled"
          description="Disabled in this local-only build. No email addresses are sent to Kudu or another breach-monitoring backend."
        />
      </div>

      <div
        className="mt-6 rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="mb-2 text-[13px] font-semibold text-zinc-200">What stays on this PC</h3>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          AI prompts and safety ratings, threat-list cache, scan results, and local security state stay in Kudu's application data. The only recurring network fetch added by this fork is the public threat-intelligence list refresh; cached protection continues to work while offline.
        </p>
      </div>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  state,
}: {
  icon: typeof Shield
  title: string
  description: string
  state: 'active' | 'loading' | 'pending' | 'disabled'
}) {
  const stateLabel = {
    active: 'Active',
    loading: 'Loading',
    pending: 'Not wired yet',
    disabled: 'Disabled',
  }[state]

  const stateColor = {
    active: '#4ade80',
    loading: '#facc15',
    pending: '#facc15',
    disabled: '#a1a1aa',
  }[state]

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
          >
            <Icon className="h-[17px] w-[17px] text-zinc-300" strokeWidth={1.8} />
          </div>
          <h3 className="text-[13px] font-semibold text-zinc-200">{title}</h3>
        </div>
        <span className="text-[11px] font-medium" style={{ color: stateColor }}>{stateLabel}</span>
      </div>
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
    </div>
  )
}
