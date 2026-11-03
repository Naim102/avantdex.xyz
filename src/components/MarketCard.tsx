import { Link } from 'react-router-dom'
import { BadgeRow, StatusChip } from '@/components/ui'
import type { Market } from '@/lib/api'
import { fmtDay } from '@/lib/format'
import { fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

export function ProjectLogo({ name, url, size = 'size-12' }: { name: string; url?: string; size?: string }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-2xl object-cover`} loading="lazy" referrerPolicy="no-referrer" />
  const hue = 200 + ((name.charCodeAt(0) * 7) % 50)
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-2xl text-lg font-bold`} style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 28%), hsl(${hue + 20} 40% 16%))` }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label !mb-0.5">{label}</div>
      <div className="tabular-nums text-sm font-semibold">{value}</div>
    </div>
  )
}

export function MarketCard({ m }: { m: Market }) {
  const p = m.project
  const key = m.slug ?? String(m.onchain_id)
  const s = m.stats
  const dash = '—'
  return (
    <article className="glass flex flex-col gap-4 rounded-3xl p-5 transition-colors hover:border-[var(--border-strong)]">
      <Link to={`/market/${key}`} className="flex items-start gap-3">
        <ProjectLogo name={p?.name ?? '?'} url={p?.logo_url} />
        <div className="min-w-0 flex-1">
          <div className="display truncate text-lg font-semibold">{p?.name ?? 'Unnamed market'}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--subtle)]">
            <span className="mono font-semibold text-[var(--ink-2)]">{p?.token_symbol}</span>
            <StatusChip status={m.status} />
          </div>
        </div>
      </Link>
      {p && <BadgeRow badges={p.badges} compact />}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="Pre-market price" value={s.last_price ? `${fmtPricePerToken(s.last_price, m)} USDC` : dash} />
        <Stat label="Best bid" value={s.best_bid ? fmtPricePerToken(s.best_bid, m) : dash} />
        <Stat label="Best ask" value={s.best_ask ? fmtPricePerToken(s.best_ask, m) : dash} />
        <Stat label="24h volume" value={`${fmtUsdc(s.volume_24h ?? '0')} USDC`} />
        <Stat label="Open interest" value={`${fmtUsdc(s.open_interest ?? '0')} USDC`} />
        <Stat label="TGE" value={fmtDay(m.tge_date)} />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2">
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
