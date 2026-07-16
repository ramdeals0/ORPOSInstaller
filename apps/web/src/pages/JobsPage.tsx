import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Job = {
  id: string
  releaseNumber: string
  status: string
  executionMode: string
  createdAt: string
  createdBy: { username: string }
  progress: { total: number; terminal: number }
}

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ jobs: Job[] }>('/api/v1/deployments')
      .then((r) => setJobs(r.jobs))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="stack">
      <PageHeader
        title="Deployment Jobs"
        actions={<Link className="primary" style={{ padding: '0.5rem 0.85rem', borderRadius: 8, background: 'var(--brand)', color: 'white' }} to="/deployments/new">New deployment</Link>}
      />
      {error && <div className="error">{error}</div>}
      <div className="panel table-wrap">
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
            {jobs.map((job) => (
              <tr key={job.id}>
                <td><Link to={`/jobs/${job.id}`}>{job.releaseNumber}</Link></td>
                <td className="mono">{job.executionMode}</td>
                <td><StatusPill value={job.status} /></td>
                <td className="mono">{job.progress.terminal}/{job.progress.total}</td>
                <td>{job.createdBy.username}</td>
                <td className="mono">{new Date(job.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {!jobs.length && <tr><td colSpan={6} className="muted">No jobs yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
