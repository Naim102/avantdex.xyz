import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useAccount, useDisconnect, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ChevronDown, Copy, ExternalLink, LogOut, TriangleAlert } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID, shortAddr } from '@/lib/allocx'
import { useUsdcBalance } from '@/hooks/useMarket'
import { Logo } from '@/components/Logo'
import { toast } from 'sonner'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/explore', label: 'Explore', end: false },
  { to: '/create', label: 'Create Listing', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
    isActive ? 'bg-white/10 text-[var(--ink)]' : 'text-[var(--subtle)] hover:text-[var(--ink)]'
  }`

function AccountMenu({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { disconnect } = useDisconnect()
  const { balance, isLoading } = useUsdcBalance()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    toast.success('Address copied')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="glass flex min-h-11 items-center gap-2.5 rounded-2xl py-1.5 pl-3 pr-2.5 text-sm transition-colors hover:border-[var(--border-strong)]"
      >
        <TokenUSDC variant="branded" size={18} />
        <span className="tabular-nums font-semibold">{isLoading || balance === undefined ? '…' : Number(formatUsdc(balance)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        <span className="mono hidden rounded-lg bg-white/8 px-2 py-1 text-xs text-[var(--ink-2)] sm:inline">{shortAddr(address)}</span>
        <ChevronDown className="size-4 text-[var(--subtle)]" />
      </button>
      {open && (
        <div className="glass absolute right-0 z-40 mt-2 w-64 rounded-2xl p-2 shadow-2xl" style={{ background: 'rgba(20,37,59,0.96)' }}>
          <div className="px-3 py-2">
            <div className="label !mb-1">Connected</div>
            <div className="mono break-all text-xs text-[var(--ink-2)]">{address}</div>
          </div>
          <div className="my-1 h-px bg-white/10" />
          <button onClick={() => void copy()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-white/8">
            <Copy className="size-4" /> Copy address
          </button>
          <a
            href={buildAddressExplorerUrl(CHAIN_ID, address)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-white/8"
          >
            <ExternalLink className="size-4" /> View on explorer
          </a>
          <button
            onClick={() => {
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

export function NetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === CHAIN_ID) return null
  return (
    <div className="border-b border-[rgba(232,196,109,0.3)] bg-[rgba(232,196,109,0.1)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2 text-[var(--warn)]">
          <TriangleAlert className="size-4" /> Your wallet is on the wrong network. AllocX runs on Arc Testnet.
        </span>
        <button className="btn btn-primary !min-h-9 !py-1.5" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
          {isPending ? 'Check your wallet…' : 'Switch to Arc Testnet'}
        </button>
      </div>
    </div>
  )
}

export function Header() {
  const { address, isConnected, chainId } = useAccount()
  const onArc = isConnected && chainId === CHAIN_ID

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[rgba(13,27,47,0.82)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <div className="leading-none">
            <div className="display text-xl font-bold">AllocX</div>
            <div className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--subtle)] sm:block">List. Buy. Transfer.</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {isConnected && (
            <span className="chip hidden lg:inline-flex">
              <span className={`size-1.5 rounded-full ${onArc ? 'bg-[var(--success)]' : 'bg-[var(--warn)]'}`} />
              {onArc ? 'Arc Testnet' : 'Wrong network'}
            </span>
          )}
          {isConnected && address ? (
            <AccountMenu address={address} />
          ) : (
            <ConnectKitButton.Custom>
              {({ show, isConnecting }) => (
                <button className="btn btn-primary" onClick={show} disabled={isConnecting}>
                  {isConnecting ? 'Connecting…' : 'Connect Wallet'}
                </button>
              )}
            </ConnectKitButton.Custom>
          )}
        </div>
      </div>
      <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2.5 md:hidden" aria-label="Main mobile">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

