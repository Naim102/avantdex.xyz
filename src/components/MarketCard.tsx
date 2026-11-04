import { Link } from 'react-router-dom'
import { BadgeRow, StatusChip } from '@/components/ui'
import type { Market } from '@/lib/api'
import { fmtDay } from '@/lib/format'
import { fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

const SWATCHES = ['#28DF99', '#FFD84D', '#FF9C8F', '#8FD3FF', '#C9B6FF']

/** Project logo, or a flat brand-colored initial when the project has none. */
export function ProjectLogo({ name, url, size = 'size-12' }: { name: string; url?: string; size?: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-xl border-2 border-[var(--line)] object-cover`} loading="lazy" referrerPolicy="no-referrer" />
  const bg = SWATCHES[(name.charCodeAt(0) || 0) % SWATCHES.length]
  return (
    <div className={`${size} display flex shrink-0 items-center justify-center rounded-xl border-2 border-[var(--line)] text-xl text-[#262627]`} style={{ background: bg }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label !mb-0.5">{label}</div>
      <div className="tabular-nums text-sm font-bold">{value}</div>
    </div>
  )
}

export function MarketCard({ m }: { m: Market }) {
  const p = m.project
  const key = m.slug ?? String(m.onchain_id)
  const s = m.stats
  const dash = '—'
  return (
    <article className="glass flex flex-col gap-4 rounded-3xl p-4 sm:p-5 transition-all duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_var(--line)]">
      <Link to={`/market/${key}`} className="flex items-start gap-3">
        <ProjectLogo name={p?.name ?? '?'} url={p?.logo_url} />
        <div className="min-w-0 flex-1">
          <div className="display truncate text-xl">{p?.name ?? 'Unnamed market'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="mono text-sm font-bold">{p?.token_symbol}</span>
            <StatusChip status={m.status} />
          </div>
        </div>
      </Link>
      {p && <BadgeRow badges={p.badges} compact />}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y-2 border-dashed border-[var(--hair)] py-3 sm:grid-cols-3">
        <Stat label="Pre-market price" value={s.last_price ? `${fmtPricePerToken(s.last_price, m)} USDC` : dash} />
        <Stat label="Best bid" value={s.best_bid ? fmtPricePerToken(s.best_bid, m) : dash} />
        <Stat label="Best ask" value={s.best_ask ? fmtPricePerToken(s.best_ask, m) : dash} />
        <Stat label="24h volume" value={`${fmtUsdc(s.volume_24h ?? '0')} USDC`} />
        <Stat label="Open interest" value={`${fmtUsdc(s.open_interest ?? '0')} USDC`} />
        <Stat label="TGE" value={fmtDay(m.tge_date)} />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Link to={`/market/${key}?side=buy`} className="btn btn-primary">
          Buy
        </Link>
        <Link to={`/market/${key}?side=sell`} className="btn btn-ghost">
          Sell
        </Link>
      </div>
    </article>
  )
}
