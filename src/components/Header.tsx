import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { useQuery } from '@tanstack/react-query'
import { Bell, ChevronDown, Copy, ExternalLink, LogOut, Moon, Sun, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { CHAIN_ID, useAuth, useConfig, useUsdc } from '@/hooks/useApp'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { addrUrl, shortAddr } from '@/lib/format'
import { fmtUsdc } from '@/lib/exchange'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/explore', label: 'Explore', end: false },
  { to: '/portfolio', label: 'Portfolio', end: false },
  { to: '/list', label: 'Create Listing', end: false },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-lg border-2 px-3.5 py-1.5 text-sm font-bold transition-colors ${
    isActive ? 'border-[var(--line)] bg-[var(--accent)] text-[#262627]' : 'border-transparent text-[var(--ink)] hover:border-[var(--line)] hover:bg-[var(--surface)]'
  }`

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button onClick={toggle} className="btn btn-ghost !min-h-11 !px-3" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}

function AccountMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { disconnect } = useDisconnect()
  const auth = useAuth()
  const { balance } = useUsdc()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-[var(--tint-2)]'
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-ghost !min-h-11 !gap-2.5 !px-3">
        <span className="tabular-nums whitespace-nowrap font-bold">{balance === undefined ? '…' : fmtUsdc(balance)}</span>
        <span className="text-xs font-bold text-[var(--muted)]">USDC</span>
        <span className="mono hidden whitespace-nowrap rounded-md bg-[var(--tint-2)] px-2 py-0.5 text-xs sm:inline">{shortAddr(address)}</span>
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="glass absolute right-0 z-40 mt-3 w-64 rounded-2xl p-2">
          <div className="px-3 py-2">
            <div className="label !mb-1">Connected</div>
            <div className="mono break-all text-xs">{address}</div>
            {auth.roles.length > 0 && <div className="mt-1 text-xs font-bold text-[var(--accent-text)]">Admin: {auth.roles.join(', ')}</div>}
          </div>
          <div className="my-1 h-0.5 bg-[var(--hair)]" />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(address)
              toast.success('Address copied')
            }}
            className={item}
          >
            <Copy className="size-4" /> Copy address
          </button>
          <a href={addrUrl(address)} target="_blank" rel="noopener noreferrer" className={item}>
            <ExternalLink className="size-4" /> View on explorer
          </a>
          {auth.roles.length > 0 && (
            <Link to="/admin" onClick={() => setOpen(false)} className={item}>
              Admin dashboard
            </Link>
          )}
          <button
            onClick={() => {
              auth.signOut()
              disconnect()
              setOpen(false)
            }}
            className={`${item} text-[var(--danger)]`}
          >
            <LogOut className="size-4" /> Disconnect
          </button>
        </div>
      )}
    </div>
  )
}

function NotificationBell() {
  const auth = useAuth()
  const { data } = useQuery({
    queryKey: ['notifications', auth.address],
    queryFn: () => api.get<{ unread: number }>('/notifications?limit=1'),
    enabled: auth.signedIn,
    refetchInterval: 15000,
  })
  if (!auth.signedIn) return null
  return (
    <Link to="/portfolio?tab=Notifications" className="btn btn-ghost relative !min-h-11 !px-3" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
      <Bell className="size-4" />
      {!!data?.unread && <span className="absolute -right-2 -top-2 rounded-full border-2 border-[var(--line)] bg-[var(--accent)] px-1.5 text-[10px] font-extrabold text-[#262627]">{data.unread}</span>}
    </Link>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-[var(--line)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Avantdex home">
          <Logo className="size-10" />
          <span className="display text-xl font-bold uppercase tracking-tight">Avantdex</span>
          <span className="chip ml-1 hidden !bg-[var(--warn-bg)] sm:inline-flex">Arc Network</span>
        </Link>
        <nav className="no-scrollbar hidden gap-1 overflow-x-auto lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NotificationBell />
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) =>
              isConnected && address ? (
                <AccountMenu address={address} />
              ) : (
                <button className="btn btn-primary" onClick={show}>
                  Connect Wallet
                </button>
              )
            }
          </ConnectKitButton.Custom>
        </div>
      </div>
      <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2.5 lg:hidden" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

export function NetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const { data: cfg, isError } = useConfig()
  const bar = 'border-b-2 border-[var(--line)] px-4 py-2 text-center text-sm font-bold'
  if (isError) {
    return (
      <div className={`${bar} bg-[var(--danger-bg)] text-[var(--danger)]`} role="alert">
        Cannot reach the Avantdex API. Market data is unavailable.
      </div>
    )
  }
  return (
    <>
      {cfg?.notice && <div className={`${bar} bg-[var(--accent)] text-[#262627]`}>{cfg.notice}</div>}
      {isConnected && chainId !== CHAIN_ID && (
        <div className={`${bar} flex flex-wrap items-center justify-center gap-3 bg-[var(--warn-bg)] text-[var(--warn)]`} role="alert">
          <TriangleAlert className="size-4" /> Your wallet is on the wrong network. Avantdex runs on Arc Testnet.
          <button className="underline" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            Switch network
          </button>
        </div>
      )}
    </>
  )
}
