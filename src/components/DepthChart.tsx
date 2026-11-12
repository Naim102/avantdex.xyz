import { DepthBar } from '@/components/MarketParts'
import type { Market, OrderBookData } from '@/lib/api'
import { fmtUsdc, lotTokens, pricePerToken } from '@/lib/exchange'

interface Pt {
  price: number
  size: number
}

const W = 640
const H = 190
const PAD = { l: 8, r: 8, t: 10, b: 22 }

/** Cumulative size at each price, walking away from the spread. Built only from live on-chain orders. */
function levels(side: OrderBookData['bids'], m: Market): Pt[] {
  const perLot = Number(lotTokens(m))
  return side.map((l) => ({ price: Number(pricePerToken(BigInt(l.price), m)), size: Number(l.cumulative_lots) * perLot }))
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 })

/** Buy side vs sell side of the book: liquidity split plus a depth chart (how much size sits at each price). */
export function DepthChart({ book, market }: { book: OrderBookData; market: Market }) {
  const bids = levels(book.bids, market)
  const asks = levels(book.asks, market)
  const s = market.stats
  if (!bids.length && !asks.length) return null

  const prices = [...bids, ...asks].map((p) => p.price)
  const rawLo = Math.min(...prices)
  const rawHi = Math.max(...prices)
  const span = rawHi - rawLo || Math.max(rawHi * 0.1, 0.000001)
  // a little room on both sides so a single price level still has a visible width
  const lo = rawLo - span * 0.12
  const hi = rawHi + span * 0.12
  const maxSize = Math.max(...[...bids, ...asks].map((p) => p.size), 1)
  const x = (p: number) => PAD.l + ((p - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
  const y = (v: number) => H - PAD.b - (v / maxSize) * (H - PAD.b - PAD.t)
  const base = y(0)

  /** step outline from the best price outward, then flat to the chart edge and down to the axis */
  const area = (pts: Pt[], edge: number) => {
    if (!pts.length) return ''
    let d = `M ${x(pts[0].price)} ${base} L ${x(pts[0].price)} ${y(pts[0].size)}`
    for (let i = 1; i < pts.length; i++) d += ` L ${x(pts[i].price)} ${y(pts[i - 1].size)} L ${x(pts[i].price)} ${y(pts[i].size)}`
    return `${d} L ${edge} ${y(pts[pts.length - 1].size)} L ${edge} ${base} Z`
  }
  const bidTotal = bids.length ? bids[bids.length - 1].size : 0
  const askTotal = asks.length ? asks[asks.length - 1].size : 0

  return (
    <section className="glass p-4 sm:p-5" aria-labelledby="depth-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="depth-h" className="display text-lg">Buy side vs sell side</h3>
        <span className="text-xs font-medium text-[var(--muted)]">Resting orders only, funds already locked</span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1fr]">
        <div>
          <div className="label">Liquidity (USDC)</div>
          <DepthBar bid={s.bid_depth} ask={s.ask_depth} wide />
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            <span className="font-bold text-[var(--success)]">Buy {fmtUsdc(s.bid_depth ?? '0')}</span> · <span className="font-bold text-[var(--danger)]">Sell {fmtUsdc(s.ask_depth ?? '0')}</span> · {s.open_orders ?? 0} open order{s.open_orders === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <div className="label">Size ({market.project?.token_symbol ?? 'tokens'})</div>
          <p className="tabular-nums text-sm font-semibold">
            <span className="text-[var(--success)]">{fmt(bidTotal)} wanted</span> · <span className="text-[var(--danger)]">{fmt(askTotal)} offered</span>
          </p>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={`Depth chart. ${fmt(bidTotal)} tokens wanted on the buy side and ${fmt(askTotal)} offered on the sell side, between ${fmt(rawLo)} and ${fmt(rawHi)} USDC per token.`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--line-strong)" strokeWidth="1.5" />
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(maxSize * f)} y2={y(maxSize * f)} stroke="var(--hair)" strokeWidth="1" strokeDasharray="4 4" />
        ))}
        <path d={area(bids, PAD.l)} fill="var(--success)" fillOpacity="0.22" stroke="var(--success)" strokeWidth="2" strokeLinejoin="round" />
        <path d={area(asks, W - PAD.r)} fill="var(--danger)" fillOpacity="0.22" stroke="var(--danger)" strokeWidth="2" strokeLinejoin="round" />
        <text x={x(rawLo)} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="middle" className="tabular-nums">{fmt(rawLo)}</text>
        <text x={x(rawHi)} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="middle" className="tabular-nums">{fmt(rawHi)} USDC / token</text>
        <text x={PAD.l} y={PAD.t + 2} fontSize="11" fill="var(--muted)" className="tabular-nums">{fmt(maxSize)}</text>
      </svg>
    </section>
  )
}
