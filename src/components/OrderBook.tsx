import type { Level, Market, OrderBookData } from '@/lib/api'
import { fmtLotsAsTokens, fmtPricePerToken } from '@/lib/exchange'

function Row({ lv, side, max, market, mine, onPick }: { lv: Level; side: 'bid' | 'ask'; max: number; market: Market; mine: boolean; onPick: (priceLot: string, side: 'bid' | 'ask') => void }) {
  const width = max > 0 ? Math.max(4, Math.round((Number(lv.cumulative_lots) / max) * 100)) : 0
  const color = side === 'bid' ? 'rgba(141,216,159,0.16)' : 'rgba(232,109,122,0.16)'
  return (
    <button type="button" onClick={() => onPick(lv.price, side)} className="relative grid w-full grid-cols-3 gap-2 px-3 py-1.5 text-left text-sm tabular-nums hover:bg-white/6" aria-label={`${side === 'bid' ? 'Bid' : 'Ask'} ${fmtPricePerToken(lv.price, market)} USDC, ${fmtLotsAsTokens(lv.lots, market)} tokens`}>
      <span className="absolute inset-y-0 right-0" style={{ width: `${width}%`, background: color }} aria-hidden="true" />
      <span className={`relative font-semibold ${side === 'bid' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
        {fmtPricePerToken(lv.price, market)}
        {mine && <span className="ml-1 text-[var(--accent)]" title="You have an order at this price">●</span>}
      </span>
      <span className="relative text-right">{fmtLotsAsTokens(lv.lots, market)}</span>
      <span className="relative text-right text-[var(--subtle)]">{fmtLotsAsTokens(lv.cumulative_lots, market)}</span>
    </button>
  )
}

/** Aggregated resting orders. Every row is an on-chain order with funds locked in escrow. */
export function OrderBook({ book, market, myPrices, onPick }: { book?: OrderBookData; market: Market; myPrices: Set<string>; onPick: (priceLot: string, side: 'bid' | 'ask') => void }) {
  if (!book) return <div className="glass h-80 animate-pulse rounded-3xl" aria-hidden="true" />
  const max = Math.max(Number(book.bids[book.bids.length - 1]?.cumulative_lots ?? 0), Number(book.asks[book.asks.length - 1]?.cumulative_lots ?? 0))
  const asks = [...book.asks].reverse() // best ask nearest the spread
  const empty = book.asks.length === 0 && book.bids.length === 0
  return (
    <div className="glass overflow-hidden rounded-3xl">
      <div className="grid grid-cols-3 gap-2 border-b border-white/8 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
        <span>Price (USDC)</span>
        <span className="text-right">Size ({market.project?.token_symbol ?? 'tokens'})</span>
        <span className="text-right">Total</span>
      </div>
      {empty ? (
        <p className="px-4 py-10 text-center text-sm text-[var(--subtle)]">No orders yet. Place the first one.</p>
      ) : (
        <>
          <div>{asks.map((l) => <Row key={`a${l.price}`} lv={l} side="ask" max={max} market={market} mine={myPrices.has(l.price)} onPick={onPick} />)}</div>
          <div className="flex items-center justify-between border-y border-white/8 bg-white/4 px-3 py-2 text-xs">
            <span className="text-[var(--subtle)]">Spread</span>
            <span className="tabular-nums font-semibold">{book.spread ? `${fmtPricePerToken(book.spread, market)} USDC` : '—'}</span>
          </div>
          <div>{book.bids.map((l) => <Row key={`b${l.price}`} lv={l} side="bid" max={max} market={market} mine={myPrices.has(l.price)} onPick={onPick} />)}</div>
        </>
      )}
      <div className="border-t border-white/8 px-3 py-2 text-[11px] text-[var(--subtle)]">Built from on-chain orders{book.last_indexed_block ? ` · indexed to block ${book.last_indexed_block}` : ''}. Orders you see are funded in escrow.</div>
    </div>
  )
}
