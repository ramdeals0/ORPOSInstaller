import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PageHeader, StatusPill } from '../components'

type Machine = {
  id: string
  hostname: string
  registerId: number
  registerIdPadded: string
  registerGroupName: string
  reachabilityStatus: string
  winrmStatus: string
  readyForDeploy: boolean
  lastDeploymentStatus?: string | null
  lastDeploymentAt?: string | null
  store: { id: string; storeCode: string; storeNumber?: number | null; name?: string | null }
}

export function MachinesPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Machine[]>([])
  const [stores, setStores] = useState<Array<{ id: string; storeCode: string; storeNumber?: number | null }>>([])
  const [groups, setGroups] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Machine | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({
    q: '',
    storeId: '',
    registerGroup: '',
    registerIdMin: '',
    registerIdMax: '',
    reachabilityStatus: '',
    lastDeploymentStatus: '',
  })

  async function load() {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v) })
    const res = await api<{ items: Machine[] }>(`/api/v1/machines?${params}`)
    setItems(res.items)
  }

  useEffect(() => {
    Promise.all([
      load(),
      api<{ stores: Array<{ id: string; storeCode: string; storeNumber?: number | null }> }>('/api/v1/stores').then((r) => setStores(r.stores)),
      api<{ rules: Array<{ name: string }> }>('/api/v1/settings/register-group-rules').then((r) =>
        setGroups(r.rules.map((rule) => rule.name)),
      ),
    ]).catch((e) => setError(e.message))
  }, [])

  const allSelected = useMemo(() => items.length > 0 && items.every((m) => selected.has(m.id)), [items, selected])

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(items.map((m) => m.id)))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function probe() {
    await api('/api/v1/machines/probe', {
      method: 'POST',
      body: JSON.stringify({ machineIds: selected.size ? [...selected] : undefined }),
    })
    await load()
  }

  return (
    <div className="stack">
      <PageHeader
        title="Machine Inventory"
        actions={(
          <>
            <button type="button" onClick={() => load().catch((e) => setError(e.message))}>Refresh</button>
            <button type="button" onClick={() => probe().catch((e) => setError(e.message))}>Probe</button>
            <button
              className="primary"
              type="button"
              disabled={!selected.size}
              onClick={() => navigate(`/deployments/new?machines=${[...selected].join(',')}`)}
            >
              Deploy selected ({selected.size})
            </button>
          </>
        )}
      />
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div className="filters">
          <label>Search<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
          <label>Store
            <select value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value })}>
              <option value="">All</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.storeCode}{s.storeNumber != null ? ` (${s.storeNumber})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>Group
            <select value={filters.registerGroup} onChange={(e) => setFilters({ ...filters, registerGroup: e.target.value })}>
              <option value="">All</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value="Unassigned">Unassigned</option>
            </select>
          </label>
          <label>Reg min<input value={filters.registerIdMin} onChange={(e) => setFilters({ ...filters, registerIdMin: e.target.value })} /></label>
          <label>Reg max<input value={filters.registerIdMax} onChange={(e) => setFilters({ ...filters, registerIdMax: e.target.value })} /></label>
          <label>Online
            <select value={filters.reachabilityStatus} onChange={(e) => setFilters({ ...filters, reachabilityStatus: e.target.value })}>
              <option value="">All</option>
              <option value="REACHABLE">REACHABLE</option>
              <option value="UNREACHABLE">UNREACHABLE</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </label>
          <div className="row" style={{ alignItems: 'end' }}>
            <button type="button" className="primary" onClick={() => load().catch((e) => setError(e.message))}>Apply</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th>Hostname</th>
                <th>Store</th>
                <th>Reg</th>
                <th>Group</th>
                <th>Reachable</th>
                <th>WinRM</th>
                <th>Ready</th>
                <th>Last deploy</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} /></td>
                  <td><button type="button" style={{ border: 'none', background: 'none', color: 'var(--brand)', padding: 0 }} onClick={() => setDetail(m)}>{m.hostname}</button></td>
                  <td className="mono">{m.store.storeCode}{m.store.storeNumber != null ? ` · ${m.store.storeNumber}` : ''}</td>
                  <td className="mono">{m.registerIdPadded}</td>
                  <td>{m.registerGroupName}</td>
                  <td><StatusPill value={m.reachabilityStatus} /></td>
                  <td><StatusPill value={m.winrmStatus} /></td>
                  <td>{m.readyForDeploy ? 'Yes' : 'No'}</td>
                  <td><StatusPill value={m.lastDeploymentStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <>
          <div className="backdrop" onClick={() => setDetail(null)} />
          <aside className="drawer">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{detail.hostname}</h2>
              <button type="button" onClick={() => setDetail(null)}>Close</button>
            </div>
            <div className="stack" style={{ marginTop: '1rem' }}>
              <div>
                <span className="muted">Store</span>
                <div>
                  <span className="mono">{detail.store.storeCode}</span>
                  {detail.store.storeNumber != null ? ` · #${detail.store.storeNumber}` : ''}
                  {detail.store.name ? ` · ${detail.store.name}` : ''}
                </div>
              </div>
              <div><span className="muted">Register</span><div className="mono">{detail.registerIdPadded}</div></div>
              <div><span className="muted">Group</span><div>{detail.registerGroupName}</div></div>
              <div><span className="muted">Reachability</span><div><StatusPill value={detail.reachabilityStatus} /></div></div>
              <div><span className="muted">WinRM</span><div><StatusPill value={detail.winrmStatus} /></div></div>
              <div><span className="muted">Last deployment</span><div><StatusPill value={detail.lastDeploymentStatus} /></div></div>
              <Link className="primary" style={{ display: 'inline-block', textAlign: 'center', padding: '0.55rem', borderRadius: 8, background: 'var(--brand)', color: 'white' }} to={`/deployments/new?machines=${detail.id}`}>
                Deploy this machine
              </Link>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
