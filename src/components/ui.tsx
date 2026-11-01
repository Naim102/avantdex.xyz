import { useState, type ReactNode } from 'react'
import { useReadContracts } from 'wagmi'
import { Link } from 'react-router-dom'
import { erc20Abi, formatUnits } from 'viem'
import { Boxes, Check, ExternalLink, Info, KeyRound, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CHAIN_ID,
  LISTING_STATUS,
  ORDER_STATUS,
  assetShort,
  imageSrc,
  isDirectType,
  shortAddr,
  type Listing,
} from '@/lib/allocx'
import type { TxState } from '@/hooks/useTx'

export function StatusBadge({ kind, status }: { kind: 'listing' | 'order'; status: number }) {
  const label = kind === 'listing' ? LISTING_STATUS[status] : ORDER_STATUS[status]
  const tone =
    label === 'Active' || label === 'Completed' || label === 'Sold'
      ? { c: 'var(--success)', bg: 'rgba(141,216,159,0.12)' }
      : label === 'Pending' || label === 'Funded'
        ? { c: 'var(--warn)', bg: 'rgba(232,196,109,0.12)' }
        : { c: 'var(--subtle)', bg: 'rgba(255,255,255,0.06)' }
  return (
    <span className="chip" style={{ color: tone.c, background: tone.bg, borderColor: 'transparent' }}>
      <span className="size-1.5 rounded-full" style={{ background: tone.c }} />
      {kind === 'listing' && label === 'Pending' ? 'In escrow' : label}
    </span>
  )
}

export function Price({ value, size = 'md' }: { value: bigint; size?: 'md' | 'lg' }) {
  const n = formatUsdc(value)
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`display font-bold tabular-nums ${size === 'lg' ? 'text-4xl' : 'text-xl'}`}>{n}</span>
      <span className="text-xs font-semibold text-[var(--subtle)]">USDC</span>
    </span>
  )
}

/** Generated mark for listings without an image. Deterministic from the asset address. */
export function AssetThumb({ listing, className = '' }: { listing: Pick<Listing, 'assetContract' | 'assetType' | 'imageUri' | 'name'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  const src = imageSrc(listing.imageUri)
  if (src && !failed) {
    return (
      <div className={`overflow-hidden bg-[var(--surface-muted)] ${className}`}>
        <img src={src} alt={listing.name} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      </div>
    )
  }
  const seed = parseInt(listing.assetContract.slice(2, 8), 16)
  const hue = 200 + (seed % 40)
  const Icon = isDirectType(listing.assetType) ? KeyRound : Boxes
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 22%), hsl(${hue + 20} 40% 12%))` }}
    >
      <div className="absolute -right-8 -top-8 size-32 rounded-full border border-white/10" />
      <div className="absolute -bottom-10 -left-6 size-36 rounded-full border border-white/8" />
      <Icon className="size-9 text-[var(--accent)] opacity-80" strokeWidth={1.5} />
      <span className="mono absolute bottom-2 left-3 text-[10px] text-white/45">{shortAddr(listing.assetContract)}</span>
    </div>
  )
}

/** Shows the amount for token listings using the token's own symbol and decimals. */
export function AssetAmount({ listing }: { listing: Pick<Listing, 'assetType' | 'assetContract' | 'amount' | 'tokenId'> }) {
  const isErc20 = listing.assetType === 0
  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: listing.assetContract, abi: erc20Abi, functionName: 'symbol', chainId: CHAIN_ID },
      { address: listing.assetContract, abi: erc20Abi, functionName: 'decimals', chainId: CHAIN_ID },
    ],
    query: { enabled: isErc20, staleTime: 60_000 },
  })
  if (listing.assetType === 0) {
    const symbol = data?.[0]?.status === 'success' ? String(data[0].result) : 'tokens'
    const dec = data?.[1]?.status === 'success' ? Number(data[1].result) : 18
    return <>{Number(formatUnits(listing.amount, dec)).toLocaleString('en-US', { maximumFractionDigits: 6 })} {symbol}</>
  }
  if (listing.assetType === 1) return <>Token #{listing.tokenId.toString()}</>
  if (listing.assetType === 2) return <>{listing.amount.toString()} × ID {listing.tokenId.toString()}</>
  return <>{listing.assetType === 3 ? 'Contract owner role' : 'DEFAULT_ADMIN_ROLE'}</>
}

export function AssetTypeChip({ type }: { type: number }) {
  return <span className="chip">{assetShort(type)}</span>
}

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link
      to={`/listing/${listing.id}`}
      className="glass group flex flex-col overflow-hidden rounded-3xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
    >
      <div className="relative">
        <AssetThumb listing={listing} className="aspect-[16/10] w-full" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <AssetTypeChip type={listing.assetType} />
        </div>
        <div className="absolute right-3 top-3">
          <StatusBadge kind="listing" status={listing.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="display truncate text-lg font-semibold text-balance">{listing.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-pretty text-[var(--subtle)]">
          {listing.description || 'No description provided.'}
        </p>
        <div className="mt-3 text-xs text-[var(--muted)]">
          <AssetAmount listing={listing} />
        </div>
        <div className="mt-4 flex items-end justify-between border-t border-white/8 pt-3">
          <Price value={listing.price} />
          <span className="mono text-xs text-[var(--subtle)]">by {shortAddr(listing.seller)}</span>
        </div>
      </div>
    </Link>
  )
}

export function ListingGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <ListingGrid>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass h-72 animate-pulse rounded-3xl" />
      ))}
    </ListingGrid>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center rounded-3xl px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white/6">
        <Boxes className="size-6 text-[var(--accent)]" strokeWidth={1.5} />
      </div>
      <h3 className="display text-xl font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-pretty text-[var(--subtle)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const map = {
    info: { c: 'var(--accent)', bg: 'rgba(172,198,233,0.08)', Icon: Info },
    warn: { c: 'var(--warn)', bg: 'rgba(232,196,109,0.08)', Icon: TriangleAlert },
    error: { c: 'var(--danger)', bg: 'rgba(232,109,122,0.08)', Icon: TriangleAlert },
    ok: { c: 'var(--success)', bg: 'rgba(141,216,159,0.08)', Icon: ShieldCheck },
  }[tone]
  return (
    <div className="flex gap-2.5 rounded-2xl border p-3.5 text-sm text-pretty" style={{ background: map.bg, borderColor: `color-mix(in srgb, ${map.c} 30%, transparent)` }}>
      <map.Icon className="mt-0.5 size-4 shrink-0" style={{ color: map.c }} />
      <div className="text-[var(--ink-2)]">{children}</div>
    </div>
  )
}

export function LegalNote() {
  return (
    <Notice>
      AllocX transfers <strong>onchain</strong> tokens and contract admin rights only. Onchain ownership is not legal ownership of a company, brand, or
      intellectual property.
    </Notice>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-4 animate-spin" /> {label}
    </span>
  )
}

/** Real transaction state only: wallet prompt, confirming, confirmed (with hash), or error. */
export function TxPanel({ tx }: { tx: Pick<TxState, 'phase' | 'label' | 'hash' | 'error' | 'steps'> }) {
  if (tx.phase === 'idle' && tx.steps.length === 0) return null
  return (
    <div className="glass-inner space-y-2 rounded-2xl p-3.5 text-sm" role="status" aria-live="polite">
      {tx.steps.map((s) => (
        <div key={s.hash} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[var(--success)]">
            <Check className="size-4" /> {s.label}
          </span>
          <a href={buildTxExplorerUrl(CHAIN_ID, s.hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
            {shortAddr(s.hash)} <ExternalLink className="size-3" />
          </a>
        </div>
      ))}
      {tx.phase === 'wallet' && (
        <div className="flex items-center gap-2 text-[var(--ink-2)]">
          <Loader2 className="size-4 animate-spin" /> {tx.label}: confirm in your wallet…
        </div>
      )}
      {tx.phase === 'confirming' && tx.hash && (
        <div className="flex items-center justify-between gap-3 text-[var(--ink-2)]">
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {tx.label}: waiting for confirmation…
          </span>
          <a href={buildTxExplorerUrl(CHAIN_ID, tx.hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
            {shortAddr(tx.hash)} <ExternalLink className="size-3" />
          </a>
        </div>
      )}
      {tx.phase === 'error' && tx.error && (
        <div className="flex items-start gap-2 text-[var(--danger)]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {tx.error}
        </div>
      )}
    </div>
  )
}
