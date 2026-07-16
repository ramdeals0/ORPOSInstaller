import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Summary = {
  totals: {
    machines: number
    reachable: number
    readyForDeploy: number
    deploymentsInProgress: number
    deploymentFailures: number
    rollbackSuccesses: number
    rollbackFailures: number
  }
  recentJobs: Array<{
    id: string
    releaseNumber: string
    status: string
    executionMode: string
    createdAt: string
    createdBy: string
    progress: string
  }>
  deploymentsByStore: Array<{ storeCode: string; count: number; failed: number; succeeded: number }>
  deploymentsByRegisterGroup: Array<{ registerGroupName: string; count: number; failed: number; succeeded: number }>
}

export function DashboardPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Summary>('/api/v1/dashboard/summary')
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Loading dashboard…</div>

  const kpis = [
    ['Total machines', data.totals.machines],
    ['Reachable', data.totals.reachable],
    ['Ready', data.totals.readyForDeploy],
    ['In progress', data.totals.deploymentsInProgress],
    ['Failures', data.totals.deploymentFailures],
    ['Rollback OK', data.totals.rollbackSuccesses],
    ['Rollback fail', data.totals.rollbackFailures],
  ] as const

  return (
    <div className="stack">
      <PageHeader title="Dashboard" actions={<span className="badge internal">INTERNAL</span>} />
      <div className="grid-kpis">
        {kpis.map(([label, value]) => (
          <div className="kpi" key={label}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Recent job activity</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Release</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Progress</th>
                <th>By</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recentJobs.map((job) => (
                <tr key={job.id}>
                  <td><Link to={`/jobs/${job.id}`}>{job.releaseNumber}</Link></td>
                  <td className="mono">{job.executionMode}</td>
                  <td><StatusPill value={job.status} /></td>
                  <td className="mono">{job.progress}</td>
                  <td>{job.createdBy}</td>
                  <td className="mono">{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!data.recentJobs.length && (
                <tr><td colSpan={6} className="muted">No jobs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Deployments by store</h3>
          <table>
            <thead><tr><th>Store</th><th>Total</th><th>OK</th><th>Failed</th></tr></thead>
            <tbody>
              {data.deploymentsByStore.map((s) => (
                <tr key={s.storeCode}>
                  <td>{s.storeCode}</td>
                  <td>{s.count}</td>
                  <td>{s.succeeded}</td>
                  <td>{s.failed}</td>
                </tr>
              ))}
              {!data.deploymentsByStore.length && <tr><td colSpan={4} className="muted">No completed targets yet</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Deployments by register group</h3>
          <table>
            <thead><tr><th>Group</th><th>Total</th><th>OK</th><th>Failed</th></tr></thead>
            <tbody>
              {data.deploymentsByRegisterGroup.map((g) => (
                <tr key={g.registerGroupName}>
                  <td>{g.registerGroupName}</td>
                  <td>{g.count}</td>
                  <td>{g.succeeded}</td>
                  <td>{g.failed}</td>
                </tr>
              ))}
              {!data.deploymentsByRegisterGroup.length && <tr><td colSpan={4} className="muted">No completed targets yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
