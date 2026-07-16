import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { PageHeader } from '../components'

type Rule = {
  id?: string
  name: string
  minRegId: number
  maxRegId: number
  priority: number
  isActive: boolean
}

export function SettingsPage() {
  const { user } = useAuth()
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [rules, setRules] = useState<Rule[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const [s, r] = await Promise.all([
      api<{ settings: Record<string, unknown> }>('/api/v1/settings'),
      api<{ rules: Rule[] }>('/api/v1/settings/register-group-rules'),
    ])
    setSettings(s.settings)
    setRules(r.rules)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function saveRules() {
    await api('/api/v1/settings/register-group-rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    })
    setMessage('Register group rules saved and recomputed')
    await load()
  }

  async function saveSetting(key: string, valueJson: unknown) {
    await api(`/api/v1/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ valueJson }),
    })
    setMessage(`Saved ${key}`)
    await load()
  }

  const throttle = (settings.throttle as { default: number; min: number; max: number }) || { default: 10, min: 1, max: 20 }
  const defaultPaths = (settings.defaultPaths as Record<string, string>) || {}
  const logRules = (settings.logParsingRules as Record<string, unknown>) || {}
  const canEdit = user?.role === 'ADMIN'

  return (
    <div className="stack">
      <PageHeader title="Settings" />
      {error && <div className="error">{error}</div>}
      {message && <div className="panel" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>{message}</div>}
      {!canEdit && <div className="muted">Read-only for your role. Ask an Admin to change settings.</div>}

      <div className="panel stack">
        <h3>Register grouping rules</h3>
        {rules.map((rule, idx) => (
          <div className="form-grid" key={`${rule.name}-${idx}`}>
            <label>Name<input disabled={!canEdit} value={rule.name} onChange={(e) => {
              const next = [...rules]; next[idx] = { ...rule, name: e.target.value }; setRules(next)
            }} /></label>
            <label>Priority<input type="number" disabled={!canEdit} value={rule.priority} onChange={(e) => {
              const next = [...rules]; next[idx] = { ...rule, priority: Number(e.target.value) }; setRules(next)
            }} /></label>
            <label>Min reg id<input type="number" disabled={!canEdit} value={rule.minRegId} onChange={(e) => {
              const next = [...rules]; next[idx] = { ...rule, minRegId: Number(e.target.value) }; setRules(next)
            }} /></label>
            <label>Max reg id<input type="number" disabled={!canEdit} value={rule.maxRegId} onChange={(e) => {
              const next = [...rules]; next[idx] = { ...rule, maxRegId: Number(e.target.value) }; setRules(next)
            }} /></label>
          </div>
        ))}
        {canEdit && <button className="primary" type="button" onClick={() => saveRules().catch((e) => setError(e.message))}>Save grouping rules</button>}
      </div>

      <div className="panel stack">
        <h3>Throttle</h3>
        <div className="form-grid">
          <label>Default<input type="number" disabled={!canEdit} value={throttle.default} onChange={(e) => setSettings({ ...settings, throttle: { ...throttle, default: Number(e.target.value) } })} /></label>
          <label>Max<input type="number" disabled={!canEdit} value={throttle.max} onChange={(e) => setSettings({ ...settings, throttle: { ...throttle, max: Number(e.target.value) } })} /></label>
        </div>
        {canEdit && <button className="primary" type="button" onClick={() => saveSetting('throttle', settings.throttle).catch((e) => setError(e.message))}>Save throttle</button>}
      </div>

      <div className="panel stack">
        <h3>Default paths</h3>
        <div className="form-grid">
          {['currentInstallPath', 'remoteCopyPath', 'remoteUnzipPath'].map((key) => (
            <label key={key} className="full">
              {key}
              <input
                disabled={!canEdit}
                value={defaultPaths[key] || ''}
                onChange={(e) => setSettings({
                  ...settings,
                  defaultPaths: { ...defaultPaths, [key]: e.target.value },
                })}
              />
            </label>
          ))}
        </div>
        {canEdit && <button className="primary" type="button" onClick={() => saveSetting('defaultPaths', settings.defaultPaths).catch((e) => setError(e.message))}>Save paths</button>}
      </div>

      <div className="panel stack">
        <h3>Log parsing rules</h3>
        <div className="form-grid">
          <label className="full">Log glob
            <input
              disabled={!canEdit}
              value={String(logRules.logGlob || '')}
              onChange={(e) => setSettings({
                ...settings,
                logParsingRules: { ...logRules, logGlob: e.target.value },
              })}
            />
          </label>
          <label className="full">Success regex
            <input
              disabled={!canEdit}
              value={String(logRules.successRegex || '')}
              onChange={(e) => setSettings({
                ...settings,
                logParsingRules: { ...logRules, successRegex: e.target.value },
              })}
            />
          </label>
          <label className="full">Failure regex
            <input
              disabled={!canEdit}
              value={String(logRules.failureRegex || '')}
              onChange={(e) => setSettings({
                ...settings,
                logParsingRules: { ...logRules, failureRegex: e.target.value },
              })}
            />
          </label>
        </div>
        {canEdit && <button className="primary" type="button" onClick={() => saveSetting('logParsingRules', settings.logParsingRules).catch((e) => setError(e.message))}>Save log rules</button>}
      </div>
    </div>
  )
}
