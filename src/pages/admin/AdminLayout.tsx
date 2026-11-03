import { NavLink, Outlet } from 'react-router-dom'
import { Notice, PageTitle, WalletGate } from '@/components/ui'
import { useAuth } from '@/hooks/useApp'

export const ADMIN_SECTIONS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/applications', label: 'Applications' },
  { to: '/admin/verification', label: 'Verification' },
  { to: '/admin/approved', label: 'Approved Projects' },
  { to: '/admin/live-markets', label: 'Live Markets' },
  { to: '/admin/market-management', label: 'Market Management' },
  { to: '/admin/settlement', label: 'Settlement Management' },
  { to: '/admin/disputes', label: 'Disputes' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/roles', label: 'Admin Roles' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
  { to: '/admin/settings', label: 'Settings' },
]

export default function AdminLayout() {
  const auth = useAuth()
  return (
    <div className="space-y-6">
      <PageTitle title="Admin" subtitle="Restricted area. Every action is role-checked on the server and written to the audit log. Admins cannot move users' escrowed funds." />
      <WalletGate needSignIn what="open the admin dashboard">
        {auth.signedIn && auth.roles.length === 0 ? (
          <Notice tone="error">This wallet has no admin role.</Notice>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
            <nav className="glass no-scrollbar flex gap-1 overflow-x-auto rounded-3xl p-2 lg:flex-col lg:self-start" aria-label="Admin sections">
              {ADMIN_SECTIONS.map((s) => (
                <NavLink
                  key={s.to}
                  to={s.to}
                  end={s.end}
                  className={({ isActive }) => `whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/12 text-[var(--ink)]' : 'text-[var(--subtle)] hover:text-[var(--ink)]'}`}
                >
                  {s.label}
                </NavLink>
              ))}
            </nav>
            <div className="min-w-0 space-y-4">
              <Outlet />
            </div>
          </div>
        )}
      </WalletGate>
    </div>
  )
}
