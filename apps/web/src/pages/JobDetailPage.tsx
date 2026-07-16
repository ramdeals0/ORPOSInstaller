import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Step = {
  stepKey: string
  status: string
  message?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

type Target = {
  id: string
  status: string
  attemptNumber: number
  logVerdict: string
  rollbackResult?: string | null
  matchedLogPath?: string | null
  errorMessage?: string | null
  backupPath?: string | null
  machine: { hostname: string; registerGroupName: string; store: { storeCode: string } }
  steps: Step[]
}

type Detail = {
  job: {
    id: string
    releaseNumber: string
    status: string
    executionMode: string
    throttleLimit: number
    installerZipPath: string
    currentInstallPath: string
    createdAt: string
    createdBy: { username: string }
  }
  targets: Target[]
  summary: { counts: Record<string, number> }
}

export function JobDetailPage() {
  const { jobId } = useParams()
  const [data, setData] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<Target | null>(null)
  const [logs, setLogs] = useState<Array<{ createdAt: string; level: string; message: string; rawChunk?: string | null }>>([])
  const [error, setError] = useState('')

  async function load() {
    const detail = await api<Detail>(`/api/v1/deployments/${jobId}`)
    setData(detail)
    if (selected) {
      const refreshed = detail.targets.find((t) => t.id === selected.id) ?? detail.targets[0] ?? null
      setSelected(refreshed)
    } else if (detail.targets[0]) {
      setSelected(detail.targets[0])
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
    const id = setInterval(() => {
      load().catch(() => undefined)
    }, 2500)
    return () => clearInterval(id)
  }, [jobId])

  useEffect(() => {
    if (!selected || !jobId) return
    api<{ logs: typeof logs }>(`/api/v1/deployments/${jobId}/targets/${selected.id}/logs`)
      .then((r) => setLogs(r.logs))
      .catch(() => undefined)
  }, [selected?.id, jobId, selected?.status])

  async function retryFailed() {
    await api(`/api/v1/deployments/${jobId}/retry`, { method: 'POST', body: '{}' })
    await load()
  }

  async function cancel() {
    await api(`/api/v1/deployments/${jobId}/cancel`, { method: 'POST', body: '{}' })
    await load()
  }

  async function exportCsv() {
    const csv = await api<string>(`/api/v1/deployments/${jobId}/export?format=csv`)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deployment-${jobId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Loading job…</div>

  return (
    <div className="stack">
      <PageHeader
        title={`Job ${data.job.releaseNumber}`}
        actions={(
          <>
            <Link to="/jobs">All jobs</Link>
            <button type="button" onClick={() => exportCsv().catch((e) => setError(e.message))}>Export</button>
            <button type="button" onClick={() => retryFailed().catch((e) => setError(e.message))}>Retry failed</button>
            <button className="danger" type="button" onClick={() => cancel().catch((e) => setError(e.message))}>Cancel</button>
          </>
        )}
      />

      <div className="panel">
        <div className="row">
          <StatusPill value={data.job.status} />
          <span className="mono">{data.job.executionMode}</span>
          <span className="muted">Throttle {data.job.throttleLimit}</span>
          <span className="muted">by {data.job.createdBy.username}</span>
          <span className="mono muted">{new Date(data.job.createdAt).toLocaleString()}</span>
        </div>
        <p className="mono muted" style={{ marginBottom: 0 }}>{data.job.installerZipPath}</p>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          {Object.entries(data.summary.counts).map(([k, v]) => (
            <span key={k} className="badge">{k}: {v}</span>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Targets</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>Store</th>
                  <th>Attempt</th>
                  <th>Status</th>
                  <th>Verdict</th>
                  <th>Rollback</th>
                </tr>
              </thead>
              <tbody>
                {data.targets.map((t) => (
                  <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer', background: selected?.id === t.id ? '#eef4ff' : undefined }}>
                    <td>{t.machine.hostname}</td>
                    <td>{t.machine.store.storeCode}</td>
                    <td className="mono">{t.attemptNumber}</td>
                    <td><StatusPill value={t.status} /></td>
                    <td><StatusPill value={t.logVerdict} /></td>
                    <td className="mono">{t.rollbackResult || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel stack">
          <h3>{selected ? selected.machine.hostname : 'Select a target'}</h3>
          {selected && (
            <>
              {selected.errorMessage && <div className="error">{selected.errorMessage}</div>}
              <div className="muted mono">{selected.matchedLogPath || selected.backupPath || ''}</div>
              <div className="timeline">
                {selected.steps.map((s) => (
                  <div className="timeline-item" key={s.stepKey}>
                    <div>
                      <StatusPill value={s.status} />
                      <div className="mono muted">{s.stepKey}</div>
                    </div>
                    <div>
                      <div>{s.message || '—'}</div>
                      <div className="mono muted">
                        {s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : ''}
                        {s.finishedAt ? ` → ${new Date(s.finishedAt).toLocaleTimeString()}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <h4>Raw logs</h4>
              <div className="log-box">
                {logs.map((l) => `[${new Date(l.createdAt).toLocaleTimeString()}] ${l.level} ${l.message}${l.rawChunk ? `\n${l.rawChunk}` : ''}`).join('\n') || 'No logs yet'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
