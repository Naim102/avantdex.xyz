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
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const span = hi - lo || Math.max(hi * 0.1, 0.000001)
  const maxSize = Math.max(...[...bids, ...asks].map((p) => p.size), 1)
  const x = (p: number) => (hi === lo ? W / 2 : PAD.l + ((p - lo) / span) * (W - PAD.l - PAD.r))
  const y = (v: number) => H - PAD.b - (v / maxSize) * (H - PAD.b - PAD.t)
  const base = y(0)

  /** step outline from the best price outward, closed down to the axis */
  const area = (pts: Pt[]) => {
    if (!pts.length) return ''
    let d = `M ${x(pts[0].price)} ${base} L ${x(pts[0].price)} ${y(pts[0].size)}`
    for (let i = 1; i < pts.length; i++) d += ` L ${x(pts[i].price)} ${y(pts[i - 1].size)} L ${x(pts[i].price)} ${y(pts[i].size)}`
    return `${d} L ${x(pts[pts.length - 1].price)} ${base} Z`
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
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={`Depth chart. ${fmt(bidTotal)} tokens wanted on the buy side and ${fmt(askTotal)} offered on the sell side, between ${fmt(lo)} and ${fmt(hi)} USDC per token.`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--line)" strokeWidth="2" />
        {[0.5, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(maxSize * f)} y2={y(maxSize * f)} stroke="var(--hair)" strokeWidth="1" strokeDasharray="4 4" />
        ))}
        <path d={area(bids)} fill="var(--success)" fillOpacity="0.22" stroke="var(--success)" strokeWidth="2" strokeLinejoin="round" />
        <path d={area(asks)} fill="var(--danger)" fillOpacity="0.22" stroke="var(--danger)" strokeWidth="2" strokeLinejoin="round" />
        <text x={PAD.l} y={H - 6} fontSize="11" fill="var(--muted)" className="tabular-nums">{fmt(lo)}</text>
        <text x={W - PAD.r} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end" className="tabular-nums">{fmt(hi)} USDC / token</text>
        <text x={PAD.l} y={PAD.t + 2} fontSize="11" fill="var(--muted)" className="tabular-nums">{fmt(maxSize)}</text>
      </svg>
    </section>
  )
}
