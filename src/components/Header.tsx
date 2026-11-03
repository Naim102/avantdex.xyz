import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { useQuery } from '@tanstack/react-query'
import { Bell, ChevronDown, Copy, ExternalLink, LogOut, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { CHAIN_ID, useAuth, useConfig, useUsdc } from '@/hooks/useApp'
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
  `rounded-full px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${isActive ? 'bg-white/10 text-[var(--ink)]' : 'text-[var(--subtle)] hover:text-[var(--ink)]'}`

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

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="glass flex min-h-11 items-center gap-2.5 rounded-2xl py-1.5 pl-3 pr-2.5 text-sm transition-colors hover:border-[var(--border-strong)]">
        <span className="tabular-nums whitespace-nowrap font-semibold">{balance === undefined ? '…' : fmtUsdc(balance)}</span>
        <span className="text-xs text-[var(--subtle)]">USDC</span>
        <span className="mono hidden whitespace-nowrap rounded-lg bg-white/8 px-2 py-1 text-xs text-[var(--ink-2)] sm:inline">{shortAddr(address)}</span>
        <ChevronDown className="size-4 text-[var(--subtle)]" />
      </button>
      {open && (
        <div className="glass absolute right-0 z-40 mt-2 w-64 rounded-2xl p-2 shadow-2xl" style={{ background: 'rgba(20,37,59,0.97)' }}>
          <div className="px-3 py-2">
            <div className="label !mb-1">Connected</div>
            <div className="mono break-all text-xs text-[var(--ink-2)]">{address}</div>
            {auth.roles.length > 0 && <div className="mt-1 text-xs text-[var(--accent)]">Admin: {auth.roles.join(', ')}</div>}
          </div>
          <div className="my-1 h-px bg-white/10" />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(address)
              toast.success('Address copied')
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-white/8"
          >
            <Copy className="size-4" /> Copy address
          </button>
          <a href={addrUrl(address)} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-white/8">
            <ExternalLink className="size-4" /> View on explorer
          </a>
          {auth.roles.length > 0 && (
            <Link to="/admin" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-white/8">
              Admin dashboard
            </Link>
          )}
          <button
            onClick={() => {
              auth.signOut()
              disconnect()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-[var(--danger)] hover:bg-white/8"
          >
            <LogOut className="size-4" /> Disconnect
          </button>
        </div>
      )}
    </div>
  )
}

function Bell_() {
  const auth = useAuth()
  const { data } = useQuery({
    queryKey: ['notifications', auth.address],
    queryFn: () => api.get<{ unread: number }>('/notifications?limit=1'),
    enabled: auth.signedIn,
    refetchInterval: 15000,
  })
  if (!auth.signedIn) return null
  return (
    <Link to="/portfolio?tab=Notifications" className="glass relative flex size-11 items-center justify-center rounded-2xl" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
      <Bell className="size-4" />
      {!!data?.unread && <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-[#0d1b2f]">{data.unread}</span>}
    </Link>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[rgba(13,27,47,0.78)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Avantdex home">
          <Logo className="size-9" />
          <div className="leading-none">
            <div className="display text-lg font-bold">Avantdex</div>
            <div className="mt-1 hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--subtle)] xl:block">Pre-market trading</div>
          </div>
          <span className="chip ml-1 hidden whitespace-nowrap sm:inline-flex" style={{ color: 'var(--accent)' }}>
            Arc Network
          </span>
        </Link>
        <nav className="no-scrollbar hidden gap-1 overflow-x-auto lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Bell_ />
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
      <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden" aria-label="Main">
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
  if (isError) {
    return (
      <div className="bg-[rgba(232,109,122,0.12)] px-4 py-2 text-center text-sm text-[var(--danger)]" role="alert">
        Cannot reach the Avantdex API. Market data is unavailable.
      </div>
    )
  }
  return (
    <>
      {cfg?.notice && <div className="bg-[rgba(172,198,233,0.12)] px-4 py-2 text-center text-sm text-[var(--accent)]">{cfg.notice}</div>}
      {isConnected && chainId !== CHAIN_ID && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-[rgba(232,196,109,0.12)] px-4 py-2 text-sm text-[var(--warn)]" role="alert">
          <TriangleAlert className="size-4" /> Your wallet is on the wrong network. Avantdex runs on Arc Testnet.
          <button className="underline" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            Switch network
          </button>
        </div>
      )}
    </>
  )
}
