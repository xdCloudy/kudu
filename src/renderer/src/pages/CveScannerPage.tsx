import { Bug, Database, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

export function CveScannerPage() {
  return (
    <div className="p-8 animate-fade-in max-w-4xl">
      <PageHeader
        title="Vulnerability Scanner"
        description="Local CVE matching is not enabled yet."
      />

      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.16)' }}
        >
          <Bug className="h-6 w-6 text-amber-400" strokeWidth={1.8} />
        </div>
        <h2 className="mb-2 text-[15px] font-semibold text-zinc-200">Matcher required before this can be trusted</h2>
        <p className="mx-auto max-w-xl text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Kudu can enumerate installed applications locally, but reliable CVE detection also needs an accurate package-to-CPE mapping and version-range matcher. This build deliberately refuses to infer matches from application names alone.
        </p>

        <div className="mx-auto mt-6 grid max-w-xl grid-cols-2 gap-3 text-left">
          <InfoCard
            icon={Database}
            title="Local database"
            text="Planned: cache a public CVE/CPE dataset on-device and refresh it periodically."
          />
          <InfoCard
            icon={ShieldAlert}
            title="Fail closed"
            text="Until matching is reliable, Kudu never reports an incorrect ‘0 vulnerabilities’ result."
          />
        </div>
      </div>
    </div>
  )
}

function InfoCard({ icon: Icon, title, text }: { icon: typeof Bug; title: string; text: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
    >
      <Icon className="mb-2 h-4 w-4 text-zinc-400" strokeWidth={1.8} />
      <h3 className="mb-1 text-[12px] font-medium text-zinc-300">{title}</h3>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{text}</p>
    </div>
  )
}
