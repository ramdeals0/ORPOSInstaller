export function StatusPill({ value }: { value?: string | null }) {
  if (!value) return <span className="status info">—</span>
  return <span className={`status ${value}`}>{value}</span>
}

export function PageHeader({
  title,
  actions,
}: {
  title: string
  actions?: React.ReactNode
}) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="row">{actions}</div>
    </div>
  )
}

export function Spinner() {
  return <span className="muted">Loading…</span>
}
