import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ExternalLink } from 'lucide-react'
import { MyOrdersTable } from '@/components/MyOrders'
import { DataTable, EmptyState, Field, Modal, Notice, PageTitle, Spinner, StatusChip, Tabs, TxPanel, WalletGate, useTicker } from '@/components/ui'
import { api, type ApiOrder, type ApiTrade, type AppConfig, type Market } from '@/lib/api'
import { CHAIN_ID, useAuth, useConfig, useUsdc } from '@/hooks/useApp'
import { useTx } from '@/hooks/useTx'
import { exchangeAbi } from '@/lib/exchangeAbi'
import { countdown, fmtDate, shortAddr, timeAgo, txUrl } from '@/lib/format'
import { fmtLotsAsTokens, fmtPricePerToken, fmtUsdc } from '@/lib/exchange'

const TABS = [
  'Overview',
  'Open Orders',
  'My Buy Orders',
  'My Sell Orders',
  'Partially Filled',
  'Filled',
  'Cancelled',
  'Expired',
  'Trade History',
  'Settlement Status',
  'Completed Transactions',
  'Notifications',
] as const
type Tab = (typeof TABS)[number]

const ABANDON_MS = 90 * 86400 * 1000

interface Summary {
  open_orders: number
  open_trades: number
  locked_in_orders: string
  locked_in_trades: string
  claimable: string
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass rounded-3xl p-5">
      <div className="label">{label}</div>
      <div className="display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--subtle)]">{sub}</div>}
    </div>
  )
}

function TradeRow({ t, address, cfg, onDispute }: { t: ApiTrade; address: string; cfg: AppConfig; onDispute: (t: ApiTrade) => void }) {
  const tx = useTx()
  const now = useTicker()
  const m = t.market
  const isSeller = t.role === 'seller'
  const lotSize = BigInt(m?.lot_size ?? '1')
  const tokenAmount = BigInt(t.lots) * lotSize
  const marketOpen = m?.status === 'SettlementOpen'
  const deadline = m?.settlement_deadline ? new Date(m.settlement_deadline).getTime() : null
  const refundable = m?.status === 'Cancelled'
  const tokenAddr = m?.token_address && m.token_address !== '0x0000000000000000000000000000000000000000' ? (m.token_address as `0x${string}`) : undefined

  const tokenBal = useReadContract({ address: tokenAddr, abi: erc20Abi, functionName: 'balanceOf', args: [address as `0x${string}`], chainId: CHAIN_ID, query: { enabled: !!tokenAddr && isSeller && marketOpen && t.status === 'Open', refetchInterval: 6000 } })
  const tokenAllow = useReadContract({ address: tokenAddr, abi: erc20Abi, functionName: 'allowance', args: [address as `0x${string}`, cfg.exchange_address], chainId: CHAIN_ID, query: { enabled: !!tokenAddr && isSeller && marketOpen && t.status === 'Open', refetchInterval: 6000 } })

  const send = (label: string, fn: string, id = t.id) => tx.run(label, { address: cfg.exchange_address, abi: exchangeAbi, functionName: fn, args: [BigInt(id)] })

  let action: React.ReactNode = null
  let hint = ''
  if (t.status === 'Open') {
    if (refundable) {
      action = (
        <button className="btn btn-primary !min-h-9 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void send('Refund trade', 'refundTrade')}>
          {tx.busy ? <Spinner /> : 'Refund'}
        </button>
      )
      hint = 'Market cancelled: refund in full, no fee.'
    } else if (!marketOpen) {
      hint = m?.status === 'Live' || m?.status === 'Suspended' ? 'Waiting for the token launch and for settlement to open.' : ''
    } else if (isSeller) {
      const short = tokenBal.data !== undefined && tokenBal.data < tokenAmount
      const needApprove = tokenAllow.data !== undefined && tokenAllow.data < tokenAmount
      if (short) hint = `You need ${fmtLotsAsTokens(t.lots, m )} ${m?.symbol ?? 'tokens'} in your wallet to settle.`
      else if (needApprove && tokenAddr)
        action = (
          <button className="btn btn-primary !min-h-9 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void tx.run('Approve token', { address: tokenAddr, abi: erc20Abi, functionName: 'approve', args: [cfg.exchange_address, tokenAmount] })}>
            {tx.busy ? <Spinner /> : 'Approve token'}
          </button>
        )
      else
        action = (
          <button className="btn btn-primary !min-h-9 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void send('Settle trade', 'settleTrade')}>
            {tx.busy ? <Spinner /> : 'Settle'}
          </button>
        )
      if (deadline) hint = hint || (deadline > now ? `Deliver before ${fmtDate(m?.settlement_deadline)}` : 'Deadline passed: the buyer may claim your collateral. You can still settle until they do.')
    } else {
      if (deadline && deadline > now) hint = `Waiting for the seller. You can claim the default in ${countdown(Math.floor((deadline - now) / 1000))}.`
      else
        action = (
          <button className="btn btn-danger !min-h-9 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void send('Claim default', 'claimDefault')}>
            {tx.busy ? <Spinner /> : 'Claim default'}
          </button>
        )
      if (!deadline || deadline <= now) hint = 'The seller did not deliver in time: claim your payment plus their collateral.'
    }
  }

  return (
    <div className="glass-inner space-y-2 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{m?.name ?? `Market ${t.market_onchain_id}`}</span> <span className="mono text-xs text-[var(--subtle)]">{m?.symbol}</span>
          <div className="text-xs text-[var(--subtle)]">
            Trade #{t.id} · you are the {t.role} · {timeAgo(t.created_at)}
          </div>
        </div>
        <StatusChip status={t.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><div className="label !mb-0">Size</div><span className="tabular-nums">{m ? fmtLotsAsTokens(t.lots, m ) : t.lots}</span></div>
        <div><div className="label !mb-0">Price</div><span className="tabular-nums">{m ? fmtPricePerToken(t.price, m ) : t.price}</span></div>
        <div><div className="label !mb-0">Value</div><span className="tabular-nums">{fmtUsdc(t.value)} USDC</span></div>
        <div>
          <div className="label !mb-0">Fee</div>
          <span className="tabular-nums">{t.status === 'Settled' ? `${fmtUsdc(t.role === 'buyer' ? t.buyer_fee : t.seller_fee, 4)} USDC` : t.status === 'Open' ? '0.5% at settlement' : '0 (no fee)'}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--subtle)]">
        <div className="flex flex-wrap gap-3">
          <a href={txUrl(t.tx_hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
            matched {shortAddr(t.tx_hash)} <ExternalLink className="size-3" />
          </a>
          {t.closed_tx_hash && (
            <a href={txUrl(t.closed_tx_hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
              {t.status.toLowerCase()} {shortAddr(t.closed_tx_hash)} <ExternalLink className="size-3" />
            </a>
          )}
          <button className="underline" onClick={() => onDispute(t)}>
            Open dispute ticket
          </button>
        </div>
        {action}
      </div>
      {hint && <p className="text-xs text-[var(--ink-2)]">{hint}</p>}
      <TxPanel tx={tx} />
    </div>
  )
}

function TradeList({ trades, address, cfg, empty, onDispute }: { trades: ApiTrade[]; address: string; cfg: AppConfig; empty: string; onDispute: (t: ApiTrade) => void }) {
  if (!trades.length) return <EmptyState title={empty} />
  return (
    <div className="space-y-3">
      {trades.map((t) => (
        <TradeRow key={t.id} t={t} address={address} cfg={cfg} onDispute={onDispute} />
      ))}
    </div>
  )
}

function DisputeModal({ trade, onClose }: { trade: ApiTrade | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false })
  const submit = async () => {
    if (!trade) return
    setState({ busy: true })
    try {
      await api.post('/disputes', { trade_id: trade.id, reason, evidence: evidence.split('\n').map((s) => s.trim()).filter(Boolean) })
      setState({ busy: false, done: true })
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Failed' })
    }
  }
  return (
    <Modal open={!!trade} onClose={onClose} title={`Dispute ticket · trade #${trade?.id ?? ''}`}>
      <WalletGate needSignIn what="open a ticket">
        {state.done ? (
          <Notice tone="ok">Ticket opened. Support will review it. A ticket cannot move funds: settlement, default and refund outcomes are decided by the contract.</Notice>
        ) : (
          <div className="space-y-3">
            <Notice>Tickets are an off-chain support process and cannot move funds. Price movement is not a valid dispute reason.</Notice>
            <Field label="What happened?" htmlFor="reason">
              <textarea id="reason" className="field min-h-24" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label="Evidence links (https://, one per line)" htmlFor="ev">
              <textarea id="ev" className="field min-h-16" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </Field>
            {state.error && <Notice tone="error">{state.error}</Notice>}
            <button className="btn btn-primary w-full" disabled={state.busy || !reason.trim()} onClick={() => void submit()}>
              {state.busy ? <Spinner /> : 'Submit ticket'}
            </button>
          </div>
        )}
      </WalletGate>
    </Modal>
  )
}

function Notifications() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['notifications-list'], queryFn: () => api.get<{ items: { id: number; title: string; body: string; link: string; read: boolean; created_at: string }[]; unread: number }>('/notifications?limit=100') })
  const readAll = async () => {
    await api.post('/notifications/read-all')
    void qc.invalidateQueries({ queryKey: ['notifications'] })
    void qc.invalidateQueries({ queryKey: ['notifications-list'] })
  }
  if (!data?.items.length) return <EmptyState title="No notifications" body="You will see matches, settlements and refunds here." />
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button className="btn btn-ghost" onClick={() => void readAll()}>
          Mark all read
        </button>
      </div>
      {data.items.map((n) => (
        <div key={n.id} className={`glass-inner rounded-2xl p-3 ${n.read ? 'opacity-70' : ''}`}>
          <div className="flex justify-between gap-2">
            <span className="font-semibold">{n.title}</span>
            <span className="text-xs text-[var(--subtle)]">{timeAgo(n.created_at)}</span>
          </div>
          {n.body && <p className="text-sm text-[var(--subtle)]">{n.body}</p>}
        </div>
      ))}
    </div>
  )
}

export default function Portfolio() {
  const { address } = useAccount()
  const { data: cfg } = useConfig()
  const [sp, setSp] = useSearchParams()
  const tab: Tab = TABS.find((t) => t === sp.get('tab')) ?? 'Overview'
  const [dispute, setDispute] = useState<ApiTrade | null>(null)
  const { balance } = useUsdc()
  const tx = useTx()
  const auth = useAuth()

  const ordersQ = useQuery({ queryKey: ['portfolio-orders', address], queryFn: () => api.get<{ items: ApiOrder[] }>(`/portfolio/${address}/orders`), enabled: !!address, refetchInterval: 8000 })
  const tradesQ = useQuery({ queryKey: ['portfolio-trades', address], queryFn: () => api.get<{ items: ApiTrade[] }>(`/portfolio/${address}/trades`), enabled: !!address, refetchInterval: 8000 })
  const summaryQ = useQuery({ queryKey: ['portfolio-summary', address], queryFn: () => api.get<Summary>(`/portfolio/${address}/summary`), enabled: !!address, refetchInterval: 8000 })
  const marketsQ = useQuery({ queryKey: ['markets', 'all-portfolio'], queryFn: () => api.get<{ items: Market[] }>('/markets'), enabled: !!address })
  const markets = useMemo(() => Object.fromEntries((marketsQ.data?.items ?? []).filter((m) => m.onchain_id !== null).map((m) => [m.onchain_id as number, m])), [marketsQ.data])

  const orders = ordersQ.data?.items ?? []
  const nowMs = useTicker(30_000)
  const trades = (tradesQ.data?.items ?? []).map((t) => {
    // treat abandoned markets (90 days past trading end without settlement) as refundable
    const m = t.market
    const mk = markets[t.market_onchain_id]
    if (m && mk && !['SettlementOpen', 'Completed', 'Cancelled'].includes(m.status) && nowMs > new Date(mk.trading_end).getTime() + ABANDON_MS) return { ...t, market: { ...m, status: 'Cancelled' } }
    return t
  })

  const filter = (f: (o: ApiOrder) => boolean) => orders.filter(f)
  const claimable = BigInt(summaryQ.data?.claimable ?? '0')

  const tabOrders: Partial<Record<Tab, { items: ApiOrder[]; empty: string }>> = {
    'Open Orders': { items: filter((o) => o.status === 'Open' || o.status === 'Partially Filled'), empty: 'No open orders.' },
    'My Buy Orders': { items: filter((o) => o.side === 'buy'), empty: 'You have not placed any buy orders.' },
    'My Sell Orders': { items: filter((o) => o.side === 'sell'), empty: 'You have not placed any sell orders.' },
    'Partially Filled': { items: filter((o) => o.status === 'Partially Filled'), empty: 'No partially filled orders.' },
    Filled: { items: filter((o) => o.status === 'Filled'), empty: 'No filled orders.' },
    Cancelled: { items: filter((o) => o.status === 'Cancelled'), empty: 'No cancelled orders.' },
    Expired: { items: filter((o) => o.status === 'Expired'), empty: 'No expired orders.' },
  }

  const currentOrders = tabOrders[tab]

  return (
    <div className="space-y-6">
      <PageTitle title="Portfolio" subtitle="Your orders, trades and settlement status. Every row links to its on-chain transaction." />
      <WalletGate what="see your portfolio">
        {address && cfg && (
          <div className="space-y-6">
            <Tabs label="Portfolio sections" tabs={TABS} value={tab} onChange={(t) => setSp(t === 'Overview' ? {} : { tab: t }, { replace: true })} />

            {tab === 'Overview' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Card label="USDC balance" value={balance === undefined ? '…' : `${fmtUsdc(balance)}`} sub="In your wallet" />
                  <Card label="Locked in open orders" value={fmtUsdc(summaryQ.data?.locked_in_orders ?? '0')} sub={`${summaryQ.data?.open_orders ?? 0} open order(s)`} />
                  <Card label="Locked in trades" value={fmtUsdc(summaryQ.data?.locked_in_trades ?? '0')} sub={`${summaryQ.data?.open_trades ?? 0} open trade(s) awaiting settlement`} />
                  <Card label="Claimable" value={fmtUsdc(claimable)} sub="USDC that could not be sent automatically" />
                </div>
                {claimable > 0n && (
                  <div className="glass space-y-3 rounded-3xl p-5">
                    <Notice tone="warn">{fmtUsdc(claimable, 4)} USDC is waiting for you. A transfer to your wallet was refused (for example while an address is blocklisted). Withdraw it here.</Notice>
                    <button className="btn btn-primary" disabled={tx.busy} onClick={() => void tx.run('Withdraw claimable USDC', { address: cfg.exchange_address, abi: exchangeAbi, functionName: 'withdrawClaimable' })}>
                      {tx.busy ? <Spinner /> : 'Withdraw claimable USDC'}
                    </button>
                    <TxPanel tx={tx} />
                  </div>
                )}
                <Notice>Escrowed funds can only leave the contract through settlement, a default claim, a refund or an order cancellation. No admin can move them.</Notice>
              </div>
            )}

            {currentOrders && <MyOrdersTable orders={currentOrders.items} markets={markets} empty={currentOrders.empty} />}

            {tab === 'Trade History' && (
              <div className="glass rounded-3xl p-4">
                <DataTable
                  empty="No trades yet."
                  head={['Trade', 'Market', 'Role', 'Size', 'Price', 'Value', 'Status', 'Time']}
                  rows={trades.map((t) => [
                    <a key="i" href={txUrl(t.tx_hash)} target="_blank" rel="noopener noreferrer" className="mono text-[var(--accent)] hover:underline">#{t.id}</a>,
                    t.market?.symbol ?? t.market_onchain_id,
                    t.role,
                    t.market ? fmtLotsAsTokens(t.lots, t.market ) : t.lots,
                    t.market ? fmtPricePerToken(t.price, t.market ) : t.price,
                    `${fmtUsdc(t.value)} USDC`,
                    <StatusChip key="s" status={t.status} />,
                    <span key="d" className="text-xs text-[var(--subtle)]">{fmtDate(t.created_at)}</span>,
                  ])}
                />
              </div>
            )}

            {tab === 'Settlement Status' && (
              <TradeList trades={trades.filter((t) => t.status === 'Open')} address={address} cfg={cfg} empty="No trades awaiting settlement." onDispute={setDispute} />
            )}
            {tab === 'Completed Transactions' && (
              <TradeList trades={trades.filter((t) => t.status !== 'Open')} address={address} cfg={cfg} empty="No completed transactions yet." onDispute={setDispute} />
            )}
            {tab === 'Notifications' && (
              <WalletGate needSignIn what="see notifications">
                {auth.signedIn ? <Notifications /> : null}
              </WalletGate>
            )}
          </div>
        )}
      </WalletGate>
      <DisputeModal trade={dispute} onClose={() => setDispute(null)} />
    </div>
  )
}
