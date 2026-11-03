import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { ProjectLogo } from '@/components/MarketCard'
import { OrderBook } from '@/components/OrderBook'
import { TradePanel } from '@/components/TradePanel'
import { MyOrdersTable } from '@/components/MyOrders'
import { BadgeLegend, BadgeRow, EmptyState, Modal, Notice, Skeleton, StatusChip, Tabs } from '@/components/ui'
import { api, type ApiOrder, type ApiTrade, type Market, type OrderBookData } from '@/lib/api'
import { useConfig } from '@/hooks/useApp'
import { addrUrl, fmtDate, fmtDay, shortAddr, timeAgo, txUrl } from '@/lib/format'
import { fmtLotsAsTokens, fmtPricePerToken, fmtUsdc, lotTokens, pricePerToken } from '@/lib/exchange'

const TABS = ['Order Book', 'Recent Trades', 'About', 'Rules'] as const

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label !mb-0.5">{label}</div>
      <div className="tabular-nums text-base font-semibold">{value}</div>
    </div>
  )
}

export default function MarketDetail() {
  const { key = '' } = useParams()
  const [sp] = useSearchParams()
  const { address } = useAccount()
  const { data: cfg } = useConfig()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Order Book')
  const [pick, setPick] = useState<{ price: string; nonce: number }>()
  const [legend, setLegend] = useState(false)
  const initialSide = sp.get('side') === 'sell' ? 'sell' : 'buy'

  const marketQ = useQuery({ queryKey: ['market', key], queryFn: () => api.get<Market>(`/markets/${key}`), refetchInterval: 8000, retry: false })
  const m = marketQ.data
  const oid = m?.onchain_id
  const bookQ = useQuery({ queryKey: ['orderbook', oid], queryFn: () => api.get<OrderBookData>(`/markets/${oid}/orderbook`), enabled: oid != null, refetchInterval: 5000 })
  const tradesQ = useQuery({ queryKey: ['trades', oid], queryFn: () => api.get<{ items: ApiTrade[] }>(`/markets/${oid}/trades?limit=50`), enabled: oid != null, refetchInterval: 8000 })
  const mineQ = useQuery({
    queryKey: ['my-orders', address, oid],
    queryFn: () => api.get<{ items: ApiOrder[] }>(`/portfolio/${address}/orders?limit=100`),
    enabled: !!address && oid != null,
    refetchInterval: 8000,
  })
  const myOpen = useMemo(() => (mineQ.data?.items ?? []).filter((o) => o.market_onchain_id === oid && (o.status === 'Open' || o.status === 'Partially Filled')), [mineQ.data, oid])
  const myPrices = useMemo(() => new Set(myOpen.map((o) => o.price)), [myOpen])

  if (marketQ.isError) {
    return (
      <EmptyState
        title="Market not found"
        body="This market does not exist or is not public yet."
        action={
          <Link to="/explore" className="btn btn-primary">
            Back to Explore
          </Link>
        }
      />
    )
  }
  if (!m || !cfg) return <Skeleton className="h-[32rem]" />
  const p = m.project
  const s = m.stats

  return (
    <div className="space-y-6">
      <Link to="/explore" className="inline-flex items-center gap-1.5 text-sm text-[var(--subtle)] hover:text-[var(--ink)]">
        <ArrowLeft className="size-4" /> Explore
      </Link>

      <header className="glass space-y-4 rounded-3xl p-5">
        <div className="flex flex-wrap items-start gap-4">
          <ProjectLogo name={p?.name ?? '?'} url={p?.logo_url} size="size-16" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-3xl font-bold">{p?.name}</h1>
              <span className="mono text-lg text-[var(--ink-2)]">{p?.token_symbol}</span>
              <StatusChip status={m.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {p && <BadgeRow badges={p.badges} />}
              <button className="text-xs text-[var(--accent-text)] underline" onClick={() => setLegend(true)}>
                What do badges mean?
              </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Last price" value={s.last_price ? `${fmtPricePerToken(s.last_price, m)} USDC` : '—'} />
          <Stat label="Best bid" value={s.best_bid ? fmtPricePerToken(s.best_bid, m) : '—'} />
          <Stat label="Best ask" value={s.best_ask ? fmtPricePerToken(s.best_ask, m) : '—'} />
          <Stat label="24h volume" value={`${fmtUsdc(s.volume_24h ?? '0')} USDC`} />
          <Stat label="Total volume" value={`${fmtUsdc(s.volume_total ?? '0')} USDC`} />
          <Stat label="TGE" value={fmtDay(m.tge_date)} />
        </div>
        <Notice>Badges do not imply investment safety, profitability or guaranteed token delivery. This is unaudited testnet software.</Notice>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-4">
          <Tabs label="Market sections" tabs={TABS} value={tab} onChange={setTab} />
          {tab === 'Order Book' && (
            <OrderBook book={bookQ.data} market={m} myPrices={myPrices} onPick={(price) => setPick({ price, nonce: Date.now() })} />
          )}
          {tab === 'Recent Trades' && (
            <div className="glass overflow-hidden rounded-3xl">
              <div className="grid grid-cols-4 gap-2 border-b border-[var(--hair)] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Time</span>
                <span className="text-right">Tx</span>
              </div>
              {(tradesQ.data?.items ?? []).length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[var(--subtle)]">No trades yet.</p>
              ) : (
                tradesQ.data?.items.map((t) => (
                  <div key={t.id} className="grid grid-cols-4 gap-2 px-3 py-2 text-sm tabular-nums">
                    <span className="font-semibold">{fmtPricePerToken(t.price, m)}</span>
                    <span className="text-right">{fmtLotsAsTokens(t.lots, m)}</span>
                    <span className="text-right text-[var(--subtle)]">{timeAgo(t.created_at)}</span>
                    <a href={txUrl(t.tx_hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center justify-end gap-1 text-xs text-[var(--accent-text)] hover:underline">
                      {shortAddr(t.tx_hash)} <ExternalLink className="size-3" />
                    </a>
                  </div>
                ))
              )}
            </div>
          )}
          {tab === 'About' && p && (
            <div className="glass space-y-4 rounded-3xl p-5 text-sm">
              <p className="whitespace-pre-line text-pretty text-[var(--muted)]">{p.description || 'No description provided.'}</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="label">Category</dt>
                  <dd>{p.category}</dd>
                </div>
                <div>
                  <dt className="label">Blockchain</dt>
                  <dd>{p.blockchain || '—'}</dd>
                </div>
                <div>
                  <dt className="label">Supply</dt>
                  <dd className="whitespace-pre-line">{p.supply_info || '—'}</dd>
                </div>
                <div>
                  <dt className="label">Allocation</dt>
                  <dd className="whitespace-pre-line">{p.allocation_info || '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="label">TGE</dt>
                  <dd className="whitespace-pre-line">{p.tge_info || fmtDay(m.tge_date)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {[p.website, ...p.socials, ...p.documentation].filter(Boolean).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="chip hover:border-[var(--border-strong)]">
                    {u.replace(/^https:\/\//, '').slice(0, 40)} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
              <div className="text-xs text-[var(--subtle)]">
                Token contract: {m.token_address && m.token_address !== '0x0000000000000000000000000000000000000000' ? (
                  <a className="mono text-[var(--accent-text)] hover:underline" href={addrUrl(m.token_address)} target="_blank" rel="noopener noreferrer">
                    {m.token_address}
                  </a>
                ) : (
                  'not set until settlement opens'
                )}
              </div>
            </div>
          )}
          {tab === 'Rules' && (
            <div className="glass space-y-4 rounded-3xl p-5 text-sm text-[var(--ink-2)]">
              <h3 className="display text-lg font-semibold">How this market works</h3>
              <ul className="list-disc space-y-2 pl-5 text-pretty">
                <li>Orders are on-chain. Placing an order locks USDC: buyers lock payment plus a 0.5% fee reserve, sellers lock collateral equal to the trade value.</li>
                <li>Trades execute at the resting order's price. Partial fills are supported. Cancelling an open order refunds everything with no fee.</li>
                <li>After the token launch (TGE) a market manager opens settlement with the token address. The seller delivers the token atomically: token and USDC move in one transaction.</li>
                <li>If the seller does not deliver before the settlement deadline, the buyer claims their payment plus the seller's collateral. The seller can still settle until the buyer claims.</li>
                <li>If the market is cancelled or never settles, everyone is refunded in full with no fee.</li>
                <li>Admins cannot move escrowed funds.</li>
              </ul>
              <h3 className="display text-lg font-semibold">Fees (paid in USDC to {shortAddr(cfg.fee_collector)})</h3>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--hair)]">
                  {[['Buyer (successful trade)', '0.5%'], ['Seller (successful trade)', '0.5%'], ['Unfilled order cancellation', '0%'], ['Project listing', '0%'], ['Community listing request', '0%'], ['Failed transaction', '0% platform fee']].map(([a, b]) => (
                    <tr key={a}>
                      <td className="py-2">{a}</td>
                      <td className="py-2 text-right font-semibold">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="display text-lg font-semibold">Market parameters</h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div><dt className="label">Lot size</dt><dd>{lotTokens(m)} {p?.token_symbol}</dd></div>
                <div><dt className="label">Tick size</dt><dd>{pricePerToken(BigInt(m.tick_size), m)} USDC per token</dd></div>
                <div><dt className="label">Order size</dt><dd>{m.min_lots} – {m.max_lots} lots</dd></div>
                <div><dt className="label">Trading window</dt><dd>{fmtDate(m.trading_start)} → {fmtDate(m.trading_end)}</dd></div>
                <div><dt className="label">Settlement deadline</dt><dd>{fmtDate(m.settlement_deadline)}</dd></div>
                <div><dt className="label">Exchange contract</dt><dd><a className="mono text-[var(--accent-text)] hover:underline" href={addrUrl(cfg.exchange_address)} target="_blank" rel="noopener noreferrer">{shortAddr(cfg.exchange_address)}</a></dd></div>
              </dl>
              <Notice tone="warn">Testnet software, not audited. A seller may default if the token price rises sharply; the buyer then receives payment plus collateral instead of tokens. Not investment advice.</Notice>
            </div>
          )}
          {address && (
            <div className="glass rounded-3xl p-5">
              <h3 className="display mb-3 text-lg font-semibold">Your open orders</h3>
              <MyOrdersTable orders={myOpen} market={m} empty="You have no open orders in this market." />
            </div>
          )}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <TradePanel key={initialSide} market={m} cfg={cfg} initialSide={initialSide} pick={pick} />
        </aside>
      </div>

      <Modal open={legend} onClose={() => setLegend(false)} title="Verification badges">
        <BadgeLegend />
      </Modal>
    </div>
  )
}
