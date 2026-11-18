import { Link } from 'react-router-dom'
import { BadgeRow, StatusChip } from '@/components/ui'
import { DepthBar, ProjectLogo } from '@/components/MarketParts'

export { ProjectLogo }
import type { Market } from '@/lib/api'
import { shortAddr, tgeDay } from '@/lib/format'
import { fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-0">
      <div className="label !mb-0.5">{label}</div>
      <div className={`tabular-nums truncate text-sm font-semibold ${tone === 'up' ? 'text-[var(--success)]' : tone === 'down' ? 'text-[var(--danger)]' : ''}`}>{value}</div>
    </div>
  )
}

export function MarketCard({ m }: { m: Market }) {
  const p = m.project
  const key = m.slug ?? String(m.onchain_id)
  const s = m.stats
  const dash = '–'
  const name = p?.name ?? `Market #${m.onchain_id}`
  const symbol = p?.token_symbol ?? (m.token_address ? shortAddr(m.token_address) : '')
  return (
    <article className="glass hoverable flex flex-col gap-4 p-4 sm:p-5">
      <Link to={`/market/${key}`} className="flex items-start gap-3">
        <ProjectLogo name={name} url={p?.logo_url} />
        <div className="min-w-0 flex-1">
          <div className="display truncate text-lg">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="mono text-sm font-semibold">{symbol}</span>
            <StatusChip status={m.status} />
          </div>
        </div>
      </Link>
      {p && <BadgeRow badges={p.badges} compact />}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--hair)] py-3 sm:grid-cols-3">
        <Stat label="Last price" value={s.last_price ? `${fmtPricePerToken(s.last_price, m)} USDC` : dash} />
        <Stat label="Best bid" value={s.best_bid ? fmtPricePerToken(s.best_bid, m) : dash} tone="up" />
        <Stat label="Best ask" value={s.best_ask ? fmtPricePerToken(s.best_ask, m) : dash} tone="down" />
        <Stat label="24h volume" value={`${fmtUsdc(s.volume_24h ?? '0')} USDC`} />
        <Stat label="Open interest" value={`${fmtUsdc(s.open_interest ?? '0')} USDC`} />
        <Stat label="TGE" value={tgeDay(m.tge_date, m.tge_tbd)} />
      </div>
      <div>
        <div className="label">Liquidity, buy side vs sell side (USDC)</div>
        <DepthBar bid={s.bid_depth} ask={s.ask_depth} wide />
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
