import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  DEFAULT_BACKUP_RULE,
  DEFAULT_INSTALL_PATH,
  DEFAULT_REMOTE_COPY,
  DEFAULT_REMOTE_UNZIP,
  previewBackupPath,
} from '@orpos/shared'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Machine = {
  id: string
  hostname: string
  registerId: number
  registerGroupName: string
  store: { id: string; storeCode: string }
}

type PrecheckResult = {
  machineId: string
  hostname: string
  ok: boolean
  checks: Array<{ key: string; ok: boolean; message: string }>
}

export function NewDeploymentPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselected = useMemo(() => (params.get('machines') || '').split(',').filter(Boolean), [params])

  const [machines, setMachines] = useState<Machine[]>([])
  const [stores, setStores] = useState<Array<{ id: string; storeCode: string }>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(preselected))
  const [storeFilter, setStoreFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [precheck, setPrecheck] = useState<PrecheckResult[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    releaseNumber: '13.4.9',
    installerZipPath: '\\\\fileserver\\orpos\\13.4.9\\client.zip',
    antPropertiesPath: '\\\\fileserver\\orpos\\props\\ant.installer.properties',
    remoteCopyPath: DEFAULT_REMOTE_COPY,
    remoteUnzipPath: DEFAULT_REMOTE_UNZIP,
    currentInstallPath: DEFAULT_INSTALL_PATH,
    backupNamingRule: DEFAULT_BACKUP_RULE,
    throttleLimit: 10,
  })

  useEffect(() => {
    Promise.all([
      api<{ items: Machine[] }>('/api/v1/machines?pageSize=200').then((r) => setMachines(r.items)),
      api<{ stores: Array<{ id: string; storeCode: string }> }>('/api/v1/stores').then((r) => setStores(r.stores)),
    ]).catch((e) => setError(e.message))
  }, [])

  const visible = machines.filter((m) => {
    if (storeFilter && m.store.id !== storeFilter) return false
    if (groupFilter && m.registerGroupName !== groupFilter) return false
    return true
  })

  const backupPreview = previewBackupPath(form.currentInstallPath, form.backupNamingRule)

  async function runPrecheck() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ results: PrecheckResult[] }>('/api/v1/deployments/precheck', {
        method: 'POST',
        body: JSON.stringify({
          installerZipPath: form.installerZipPath,
          antPropertiesPath: form.antPropertiesPath,
          remoteCopyPath: form.remoteCopyPath,
          remoteUnzipPath: form.remoteUnzipPath,
          currentInstallPath: form.currentInstallPath,
          machineIds: [...selected],
        }),
      })
      setPrecheck(res.results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Precheck failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selected.size) {
      setError('Select at least one machine')
      return
    }
    setBusy(true)
    setError('')
    try {
      const executionMode = dryRun ? 'DRY_RUN' : scheduleMode ? 'SCHEDULED' : 'RUN_NOW'
      const res = await api<{ job: { id: string } }>('/api/v1/deployments', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          executionMode,
          scheduledFor: scheduleMode ? scheduledFor : null,
          timezone: 'UTC',
          machineIds: [...selected],
          autoRollback: true,
        }),
      })
      navigate(`/jobs/${res.job.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <PageHeader
        title="New Deployment"
        actions={(
          <>
            <button type="button" disabled={busy || !selected.size} onClick={runPrecheck}>Run prechecks</button>
            <button className="primary" type="submit" disabled={busy || !selected.size}>
              {dryRun ? 'Start dry run' : scheduleMode ? 'Schedule' : 'Run now'}
            </button>
          </>
        )}
      />
      {error && <div className="error">{error}</div>}

      <div className="panel stack">
        <h3>Release & artifacts</h3>
        <div className="form-grid">
          <label>Release number<input value={form.releaseNumber} onChange={(e) => setForm({ ...form, releaseNumber: e.target.value })} required /></label>
          <label>Throttle (5–20)<input type="number" min={1} max={20} value={form.throttleLimit} onChange={(e) => setForm({ ...form, throttleLimit: Number(e.target.value) })} /></label>
          <label className="full">Installer ZIP path<input value={form.installerZipPath} onChange={(e) => setForm({ ...form, installerZipPath: e.target.value })} required /></label>
          <label className="full">ant.installer.properties path<input value={form.antPropertiesPath} onChange={(e) => setForm({ ...form, antPropertiesPath: e.target.value })} required /></label>
        </div>
      </div>

      <div className="panel stack">
        <h3>Remote paths</h3>
        <div className="form-grid">
          <label>Remote copy path<input value={form.remoteCopyPath} onChange={(e) => setForm({ ...form, remoteCopyPath: e.target.value })} /></label>
          <label>Remote unzip path<input value={form.remoteUnzipPath} onChange={(e) => setForm({ ...form, remoteUnzipPath: e.target.value })} /></label>
          <label>Current install path<input value={form.currentInstallPath} onChange={(e) => setForm({ ...form, currentInstallPath: e.target.value })} /></label>
          <label>Backup naming rule<input value={form.backupNamingRule} onChange={(e) => setForm({ ...form, backupNamingRule: e.target.value })} /></label>
          <div className="full muted mono">Backup preview: {backupPreview}</div>
        </div>
      </div>

      <div className="panel stack">
        <h3>Execution</h3>
        <div className="row">
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="checkbox" checked={dryRun} onChange={(e) => { setDryRun(e.target.checked); if (e.target.checked) setScheduleMode(false) }} />
            Dry run
          </label>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="checkbox" checked={scheduleMode} disabled={dryRun} onChange={(e) => setScheduleMode(e.target.checked)} />
            Schedule instead of run now
          </label>
          {scheduleMode && (
            <label style={{ minWidth: 240 }}>
              Fire at (local input → UTC)
              <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} required={scheduleMode} />
            </label>
          )}
        </div>
      </div>

      <div className="panel stack">
        <h3>Targets ({selected.size} selected)</h3>
        <div className="filters">
          <label>Store
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.storeCode}</option>)}
            </select>
          </label>
          <label>Register group
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="">All groups</option>
              <option>Front End Registers</option>
              <option>Service Desk</option>
            </select>
          </label>
          <div className="row" style={{ alignItems: 'end' }}>
            <button type="button" onClick={() => setSelected(new Set(visible.map((m) => m.id)))}>Select visible</button>
            <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th></th><th>Hostname</th><th>Store</th><th>Reg</th><th>Group</th></tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(m.id)) next.delete(m.id)
                          else next.add(m.id)
                          return next
                        })
                      }}
                    />
                  </td>
                  <td>{m.hostname}</td>
                  <td>{m.store.storeCode}</td>
                  <td className="mono">{String(m.registerId).padStart(3, '0')}</td>
                  <td>{m.registerGroupName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {precheck && (
        <div className="panel stack">
          <h3>Precheck preview</h3>
          <table>
            <thead>
              <tr><th>Hostname</th><th>Result</th><th>Failed checks</th></tr>
            </thead>
            <tbody>
              {precheck.map((r) => (
                <tr key={r.machineId}>
                  <td>{r.hostname}</td>
                  <td><StatusPill value={r.ok ? 'SUCCEEDED' : 'FAILED'} /></td>
                  <td className="mono">{r.checks.filter((c) => !c.ok).map((c) => c.key).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  )
}
