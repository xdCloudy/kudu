import { MailX, Shield } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export function BreachMonitorPage() {
  return (
    <div className="p-8 animate-fade-in max-w-4xl">
      <PageHeader
        title="Breach Monitor"
        description="Disabled in the local-only Kudu build."
      />

      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
        >
          <MailX className="h-6 w-6 text-zinc-400" strokeWidth={1.8} />
        </div>
        <h2 className="mb-2 text-[15px] font-semibold text-zinc-200">No breach-data backend</h2>
        <p className="mx-auto max-w-lg text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Email breach lookup requires an external breach corpus. This fork does not send email addresses to Kudu Cloud or another provider, so the feature is intentionally disabled rather than returning incomplete results.
        </p>

        <div
          className="mx-auto mt-6 flex max-w-md items-start gap-3 rounded-xl p-4 text-left"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-green-400" strokeWidth={1.8} />
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Nothing is uploaded and no Kudu subscription is required. Other local protection features continue to operate normally.
          </p>
        </div>
      </div>
    </div>
  )
}
