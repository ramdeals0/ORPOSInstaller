import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PageHeader } from '../components'

type Log = {
  id: string
  level: string
  message: string
  source: string
  createdAt: string
  job?: { id: string; releaseNumber: string } | null
  target?: { id: string; machine: { hostname: string } } | null
}

export function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  async function load(query = q) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    const res = await api<{ logs: Log[] }>(`/api/v1/logs?${params}`)
    setLogs(res.logs)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  return (
    <div className="stack">
      <PageHeader title="Logs & History" />
      {error && <div className="error">{error}</div>}
      <div className="panel stack">
        <div className="row">
          <label style={{ flex: 1 }}>
            Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="message contains…" />
          </label>
          <button className="primary" type="button" style={{ alignSelf: 'end' }} onClick={() => load().catch((e) => setError(e.message))}>Search</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Level</th>
                <th>Source</th>
                <th>Job</th>
                <th>Host</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="mono">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="mono">{log.level}</td>
                  <td>{log.source}</td>
                  <td>{log.job ? <Link to={`/jobs/${log.job.id}`}>{log.job.releaseNumber}</Link> : '—'}</td>
                  <td className="mono">{log.target?.machine.hostname || '—'}</td>
                  <td>{log.message}</td>
                </tr>
              ))}
              {!logs.length && <tr><td colSpan={6} className="muted">No logs</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
