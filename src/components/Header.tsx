import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi'
import { CIRCLE_CONNECTOR_ID } from '@/lib/circleWallet'
import { ConnectKitButton } from 'connectkit'
import { ConnectButton } from '@/components/ConnectButton'
import { useQuery } from '@tanstack/react-query'
import { Bell, ChevronDown, Copy, ExternalLink, LogOut, Menu, TriangleAlert, X } from 'lucide-react'
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
  { to: '/bridge', label: 'Bridge', end: false },
  { to: '/list', label: 'Create Listing', end: false },
]

function NavItem({ to, end, id, children }: { to: string; end: boolean; id: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `relative whitespace-nowrap rounded-lg px-3.5 py-1.5 text-center text-sm font-semibold transition-colors ${isActive ? 'text-[var(--accent-ink)]' : 'text-[var(--ink)] hover:bg-[var(--tint-2)]'}`}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId={id} className="absolute inset-0 rounded-lg bg-[var(--accent)]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative">{children}</span>
        </>
      )}
    </NavLink>
  )
}

function AccountMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { disconnect } = useDisconnect()
  const { connector } = useAccount()
  const isCircle = connector?.id === CIRCLE_CONNECTOR_ID
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
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-ghost !min-h-11 !gap-1.5 !px-2.5 sm:!gap-2.5 sm:!px-3">
        <span className="tabular-nums whitespace-nowrap font-bold">
          {balance === undefined ? '…' : <><span className="sm:hidden">{fmtUsdc(balance).replace(/\.\d+$/, '')}</span><span className="hidden sm:inline">{fmtUsdc(balance)}</span></>}
        </span>
        <span className="hidden text-xs font-bold text-[var(--muted)] sm:inline">USDC</span>
        <span className="mono hidden whitespace-nowrap rounded-md bg-[var(--tint-2)] px-2 py-0.5 text-xs sm:inline">{shortAddr(address)}</span>
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="glass absolute right-0 z-40 mt-3 w-64 rounded-2xl p-2">
          <div className="px-3 py-2">
            <div className="label !mb-1">Connected</div>
            <div className="mono break-all text-xs">{address}</div>
            {isCircle && <div className="mt-1 text-xs font-medium text-[var(--muted)]">Circle Wallet, a smart account on Arc. Send test USDC to this address to trade.</div>}
            {auth.roles.length > 0 && <div className="mt-1 text-xs font-bold text-[var(--accent-text)]">Admin</div>}
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
      {!!data?.unread && <span className="absolute -right-2 -top-2 rounded-full border border-[var(--line)] bg-[var(--accent)] px-1.5 text-[10px] font-bold text-[var(--accent-ink)]">{data.unread}</span>}
    </Link>
  )
}

/** Phones: the four links live behind one menu button, so the header stays a single row. */
function MobileMenu() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="lg:hidden">
      <button className="btn btn-ghost !min-h-11 !px-3" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.button
              key="scrim"
              aria-label="Close menu"
              tabIndex={-1}
              className="fixed inset-x-0 bottom-0 top-[var(--header-h,4.25rem)] z-20 bg-[rgba(20,20,22,0.35)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.nav
              key="panel"
              id="mobile-nav"
              aria-label="Main"
              className="absolute inset-x-0 top-full z-30 border-b border-[var(--line)] bg-[var(--bg)] px-3 pb-3 pt-2 shadow-lg"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <ul className="mx-auto max-w-6xl space-y-1">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} end={n.end} className={({ isActive }) => `block rounded-lg px-3.5 py-3 text-base font-semibold ${isActive ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'hover:bg-[var(--tint-2)]'}`}>
                      {n.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Header() {
  const { data: cfg } = useConfig()
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Avantdex home">
          <Logo className="size-9 sm:size-10" />
          <span className="display text-lg max-[359px]:hidden sm:text-xl">Avantdex</span>
          {cfg?.chain_id === 5042002 && <span className="chip hidden sm:inline-flex" title="Running on Arc Testnet, test USDC only">Testnet</span>}
        </Link>
        <nav className="hidden gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavItem key={n.to} to={n.to} end={n.end} id="nav-desktop">
              {n.label}
            </NavItem>
          ))}
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <NotificationBell />
          <ConnectKitButton.Custom>
            {({ isConnected, address }) =>
              isConnected && address ? (
                <AccountMenu address={address} />
              ) : (
                <ConnectButton className="btn btn-primary !px-3.5 sm:!px-5">
                  Connect<span className="hidden sm:inline">&nbsp;Wallet</span>
                </ConnectButton>
              )
            }
          </ConnectKitButton.Custom>
          <MobileMenu />
        </div>
      </div>
    </header>
  )
}

export function NetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const { data: cfg, isError } = useConfig()
  const onBridge = useLocation().pathname.startsWith('/bridge') // the bridge asks the wallet to use other networks on purpose
  const bar = 'border-b border-[var(--line)] px-4 py-2 text-center text-sm font-bold'
  if (isError) {
    return (
      <div className={`${bar} bg-[var(--danger-bg)] text-[var(--danger)]`} role="alert">
        Cannot reach the Avantdex API. Market data is unavailable.
      </div>
    )
  }
  return (
    <>
      {cfg && cfg.chain_id === 5042002 && (
        <div className="border-b border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-center text-xs font-bold text-[var(--ink)] sm:px-4 sm:py-2 sm:text-sm" role="note" data-testid="testnet-banner">
          <span className="chip mr-2 align-middle" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Testnet</span>
          <span className="align-middle font-semibold">
            Avantdex is live on Arc Testnet (chain {cfg.chain_id}). Trades use test USDC with no real value and the contract is not audited.{' '}
            <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">Get test USDC</a>
          </span>
        </div>
      )}
      {cfg?.notice && <div className={`${bar} bg-[var(--accent)] text-[var(--accent-ink)]`}>{cfg.notice}</div>}
      {isConnected && chainId !== CHAIN_ID && !onBridge && (
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
