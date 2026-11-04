import { Link } from 'react-router-dom'
import { StatusChip } from '@/components/ui'
import { DepthBar, ProjectLogo } from '@/components/MarketParts'
import type { Market } from '@/lib/api'
import { fmtDay, shortAddr } from '@/lib/format'
import { fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

export const marketKey = (m: Market) => m.slug ?? String(m.onchain_id)
export const marketName = (m: Market) => m.project?.name ?? `Market #${m.onchain_id}`
/** Markets created on-chain without a project record show their token address instead of a symbol. */
export const marketSymbol = (m: Market) => m.project?.token_symbol ?? (m.token_address ? shortAddr(m.token_address) : '')

function Num({ v, unit }: { v: string; unit?: string }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      {v}
      {unit && <span className="ml-1 text-[11px] text-[var(--subtle)]">{unit}</span>}
    </span>
  )
}

/** Every market on one screen: price, both sides of the book, volume, open interest, liquidity split and TGE. */
export function MarketBoard({ markets }: { markets: Market[] }) {
  const dash = '–'
  return (
    <>
      <div className="glass hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--line)] text-xs text-[var(--muted)]">
              {['Token', 'Last price', 'Best bid', 'Best ask', '24h volume', 'Open interest', 'Liquidity (buy / sell, USDC)', 'TGE', ''].map((h, i) => (
                <th key={i} className={`px-3 py-2.5 font-bold ${i >= 1 && i <= 5 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hair)]">
            {markets.map((m) => {
              const s = m.stats
              const key = marketKey(m)
              return (
                <tr key={m.id} className="row-hover align-middle">
                  <td className="px-3 py-3">
                    <Link to={`/market/${key}`} className="flex items-center gap-3">
                      <ProjectLogo name={marketName(m)} url={m.project?.logo_url} size="size-9" />
                      <span className="min-w-0">
                        <span className="block max-w-[14rem] truncate font-bold">{marketName(m)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="mono text-xs text-[var(--muted)]">{marketSymbol(m)}</span>
                          <StatusChip status={m.status} />
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold"><Num v={s.last_price ? fmtPricePerToken(s.last_price, m) : dash} /></td>
                  <td className="px-3 py-3 text-right text-[var(--success)]"><Num v={s.best_bid ? fmtPricePerToken(s.best_bid, m) : dash} /></td>
                  <td className="px-3 py-3 text-right text-[var(--danger)]"><Num v={s.best_ask ? fmtPricePerToken(s.best_ask, m) : dash} /></td>
                  <td className="px-3 py-3 text-right"><Num v={fmtUsdc(s.volume_24h ?? '0')} /></td>
                  <td className="px-3 py-3 text-right"><Num v={fmtUsdc(s.open_interest ?? '0')} /></td>
                  <td className="px-3 py-3"><DepthBar bid={s.bid_depth} ask={s.ask_depth} /></td>
                  <td className="px-3 py-3 whitespace-nowrap text-[var(--muted)]">{fmtDay(m.tge_date)}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <Link to={`/market/${key}?side=buy`} className="btn btn-primary !min-h-9 !px-3">Buy</Link>
                      <Link to={`/market/${key}?side=sell`} className="btn btn-ghost !min-h-9 !px-3">Sell</Link>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {markets.map((m) => {
          const s = m.stats
          const key = marketKey(m)
          return (
            <article key={m.id} className="glass space-y-3 p-3.5">
              <Link to={`/market/${key}`} className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <ProjectLogo name={marketName(m)} url={m.project?.logo_url} size="size-10" />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{marketName(m)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="mono text-xs text-[var(--muted)]">{marketSymbol(m)}</span>
                      <StatusChip status={m.status} />
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="label !mb-0">Last price</span>
                  <Num v={s.last_price ? fmtPricePerToken(s.last_price, m) : dash} />
                </span>
              </Link>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="label !mb-0">Bid</span><span className="text-[var(--success)]"><Num v={s.best_bid ? fmtPricePerToken(s.best_bid, m) : dash} /></span></div>
                <div><span className="label !mb-0">Ask</span><span className="text-[var(--danger)]"><Num v={s.best_ask ? fmtPricePerToken(s.best_ask, m) : dash} /></span></div>
                <div><span className="label !mb-0">24h volume</span><Num v={fmtUsdc(s.volume_24h ?? '0')} /></div>
              </div>
              <DepthBar bid={s.bid_depth} ask={s.ask_depth} wide />
              <div className="grid grid-cols-2 gap-2">
                <Link to={`/market/${key}?side=buy`} className="btn btn-primary !min-h-10">Buy</Link>
                <Link to={`/market/${key}?side=sell`} className="btn btn-ghost !min-h-10">Sell</Link>
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
