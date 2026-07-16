import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Schedule = {
  id: string
  fireAt: string
  timezone: string
  status: string
  job: {
    id: string
    releaseNumber: string
    createdBy: { username: string }
    targets: Array<{ id: string }>
  }
}

export function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [error, setError] = useState('')

  async function load() {
    const res = await api<{ schedules: Schedule[] }>('/api/v1/schedules')
    setSchedules(res.schedules)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function patch(id: string, status: 'DISABLED' | 'CANCELLED' | 'ACTIVE') {
    await api(`/api/v1/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    await load()
  }

  return (
    <div className="stack">
      <PageHeader title="Scheduled Jobs" />
      {error && <div className="error">{error}</div>}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Release</th>
              <th>Fire at</th>
              <th>TZ</th>
              <th>Status</th>
              <th>Targets</th>
              <th>By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/jobs/${s.job.id}`}>{s.job.releaseNumber}</Link></td>
                <td className="mono">{new Date(s.fireAt).toLocaleString()}</td>
                <td className="mono">{s.timezone}</td>
                <td><StatusPill value={s.status} /></td>
                <td>{s.job.targets.length}</td>
                <td>{s.job.createdBy.username}</td>
                <td className="row">
                  {s.status === 'ACTIVE' && (
                    <>
                      <button type="button" onClick={() => patch(s.id, 'DISABLED').catch((e) => setError(e.message))}>Disable</button>
                      <button className="danger" type="button" onClick={() => patch(s.id, 'CANCELLED').catch((e) => setError(e.message))}>Cancel</button>
                    </>
                  )}
                  {s.status === 'DISABLED' && (
                    <button type="button" onClick={() => patch(s.id, 'ACTIVE').catch((e) => setError(e.message))}>Enable</button>
                  )}
                </td>
              </tr>
            ))}
            {!schedules.length && <tr><td colSpan={7} className="muted">No schedules</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
