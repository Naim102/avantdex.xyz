import { exchangeAbi } from '@/lib/exchangeAbi'
import type { ApiOrder, Market } from '@/lib/api'
import { useConfig } from '@/hooks/useApp'
import { useTx } from '@/hooks/useTx'
import { DataTable, Spinner, StatusChip, TxPanel } from '@/components/ui'
import { fmtDate, shortAddr, txUrl } from '@/lib/format'
import { fmtLotsAsTokens, fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

type MarketLike = Pick<Market, 'lot_size' | 'token_decimals'> | undefined

/** Orders with a cancel/cleanup action. `market` is optional: without it sizes are shown in lots. */
export function MyOrdersTable({ orders, market, markets, empty }: { orders: ApiOrder[]; market?: MarketLike; markets?: Record<number, MarketLike>; empty: string }) {
  const { data: cfg } = useConfig()
  const tx = useTx()
  const cancel = (id: number) => cfg && tx.run(`Cancel order #${id}`, { address: cfg.exchange_address, abi: exchangeAbi, functionName: 'cancelOrder', args: [BigInt(id)] })
  const cleanup = (id: number) => cfg && tx.run(`Clean up expired order #${id}`, { address: cfg.exchange_address, abi: exchangeAbi, functionName: 'expireOrders', args: [[BigInt(id)]] })

  return (
    <div className="space-y-3">
      <DataTable
        empty={empty}
        head={['Order', 'Side', 'Price', 'Filled / Size', 'Locked', 'Status', 'Expires', '']}
        rows={orders.map((o) => {
          const m = market ?? markets?.[o.market_onchain_id]
          const open = o.chain_status === 'Open'
          const expired = o.status === 'Expired' && open
          return [
            <a key="t" href={txUrl(o.tx_hash)} target="_blank" rel="noopener noreferrer" className="mono text-[var(--accent)] hover:underline" title={shortAddr(o.tx_hash)}>
              #{o.id}
            </a>,
            <span key="s" className={o.side === 'buy' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
              {o.side === 'buy' ? 'Buy' : 'Sell'}
            </span>,
            <span key="p" className="tabular-nums">{m ? fmtPricePerToken(o.price, m) : `${fmtUsdc(o.price)}/lot`}</span>,
            <span key="f" className="tabular-nums">{m ? `${fmtLotsAsTokens(o.filled, m)} / ${fmtLotsAsTokens(o.lots, m)}` : `${o.filled} / ${o.lots} lots`}</span>,
            <span key="l" className="tabular-nums">{fmtUsdc(o.locked, 4)}</span>,
            <StatusChip key="st" status={o.status} />,
            <span key="e" className="text-xs text-[var(--subtle)]">{fmtDate(o.expiry)}</span>,
            open ? (
              <button key="c" className="btn btn-ghost !min-h-9 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void (expired ? cleanup(o.id) : cancel(o.id))}>
                {tx.busy ? <Spinner /> : expired ? 'Clean up' : 'Cancel'}
              </button>
            ) : null,
          ]
        })}
      />
      <TxPanel tx={tx} />
    </div>
  )
}
