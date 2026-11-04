import { fmtUsdc } from '@/lib/exchange'

const SWATCHES = ['#28DF99', '#FFD84D', '#FF9C8F', '#8FD3FF', '#C9B6FF']

/** Project logo, or a flat colored initial when the project has none. */
export function ProjectLogo({ name, url, size = 'size-12' }: { name: string; url?: string; size?: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-xl border-2 border-[var(--line)] object-cover`} loading="lazy" referrerPolicy="no-referrer" />
  const bg = SWATCHES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % SWATCHES.length]
  return (
    <div className={`${size} display flex shrink-0 items-center justify-center rounded-xl border-2 border-[var(--line)] text-lg text-[#262627]`} style={{ background: bg }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

/**
 * Resting liquidity on each side of the book, as a split bar. Real numbers: the USDC value of the unfilled part of
 * every live order. Empty books say so instead of drawing an empty bar.
 */
export function DepthBar({ bid, ask, wide = false }: { bid?: string; ask?: string; wide?: boolean }) {
  const b = BigInt(bid ?? '0')
  const a = BigInt(ask ?? '0')
  if (b === 0n && a === 0n) return <span className="text-xs font-medium text-[var(--subtle)]">No open orders</span>
  const pct = Number((b * 100n) / (b + a))
  return (
    <div className={wide ? 'w-full' : 'w-32'} title={`Buy side ${fmtUsdc(b)} USDC, sell side ${fmtUsdc(a)} USDC`}>
      <div className="flex h-2.5 overflow-hidden rounded-sm border-[1.5px] border-[var(--line)]" role="img" aria-label={`Buy side ${pct}%, sell side ${100 - pct}%`}>
        <div style={{ width: `${pct}%`, background: 'var(--success)' }} />
        <div className="flex-1" style={{ background: 'var(--danger)' }} />
      </div>
      <div className="tabular-nums mt-1 flex justify-between text-[11px] font-medium text-[var(--muted)]">
        <span>{fmtUsdc(b, 0)}</span>
        <span>{fmtUsdc(a, 0)}</span>
      </div>
    </div>
  )
}

