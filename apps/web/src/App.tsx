import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { MachinesPage } from './pages/MachinesPage'
import { NewDeploymentPage } from './pages/NewDeploymentPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { JobsPage } from './pages/JobsPage'
import { SchedulesPage } from './pages/SchedulesPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>ORPOS Deploy</strong>
          <span>INTERNAL · WINRM</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/machines">Machines</NavLink>
          <NavLink to="/deployments/new">New Deployment</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/schedules">Scheduled</NavLink>
          <NavLink to="/logs">Logs</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div>
            <div>{user?.displayName || user?.username}</div>
            <div className="mono">{user?.role}</div>
          </div>
          <button type="button" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="login-page"><Spinnerish /></div>
  if (!user) return <Navigate to="/login" replace />
  return <Shell>{children}</Shell>
}

function Spinnerish() {
  return <div className="panel">Loading…</div>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/machines" element={<Protected><MachinesPage /></Protected>} />
      <Route path="/deployments/new" element={<Protected><NewDeploymentPage /></Protected>} />
      <Route path="/jobs" element={<Protected><JobsPage /></Protected>} />
      <Route path="/jobs/:jobId" element={<Protected><JobDetailPage /></Protected>} />
      <Route path="/schedules" element={<Protected><SchedulesPage /></Protected>} />
      <Route path="/logs" element={<Protected><LogsPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
