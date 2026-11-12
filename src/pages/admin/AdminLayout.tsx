import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
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
  { to: '/admin/roles', label: 'Admins' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
  { to: '/admin/settings', label: 'Settings' },
]

export default function AdminLayout() {
  const auth = useAuth()
  const { pathname } = useLocation()
  useEffect(() => {
    // on phones the section bar scrolls sideways: keep the current section in view
    document.querySelector('nav[aria-label="Admin sections"] [aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])
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
                  className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold ${isActive ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--ink)] hover:bg-[var(--tint-2)]'}`}
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
