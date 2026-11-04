import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { exchangeAbi } from '@/lib/exchangeAbi'
import { api, qs, type AppConfig, type Market, type MatchPlan } from '@/lib/api'
import { MARKET_STATUS_LABEL, fee, fmtUsdc, lotTokens, marketTradable, parseOrderInput, pricePerToken } from '@/lib/exchange'
import { useUsdc } from '@/hooks/useApp'
import { useTx } from '@/hooks/useTx'
import { Field, Notice, Spinner, TxPanel, WalletGate } from '@/components/ui'

const EXPIRIES = [
  { id: '1h', label: '1 hour', secs: 3600 },
  { id: '1d', label: '1 day', secs: 86400 },
  { id: '7d', label: '7 days', secs: 7 * 86400 },
  { id: 'end', label: 'Until trading ends', secs: 0 },
] as const

/** Price cap/floor for a market-style order: best opposite price moved by the slippage allowance, snapped to the tick. */
function capPrice(side: 'buy' | 'sell', best: bigint, slipBps: bigint, tick: bigint): bigint {
  if (side === 'buy') {
    const raw = (best * (10_000n + slipBps) + 9_999n) / 10_000n
    return ((raw + tick - 1n) / tick) * tick // round up
  }
  const raw = (best * (10_000n - slipBps)) / 10_000n
  const snapped = (raw / tick) * tick // round down
  return snapped < tick ? tick : snapped
}

export function TradePanel({ market, cfg, initialSide, pick }: { market: Market; cfg: AppConfig; initialSide: 'buy' | 'sell'; pick?: { price: string; nonce: number } }) {
  const { address } = useAccount()
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide)
  const [type, setType] = useState<'limit' | 'market'>('limit')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('')
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]['id']>('7d')
  const [slip, setSlip] = useState('2')
  const [fullFill, setFullFill] = useState(true)
  const tx = useTx()
  const { balance, allowance } = useUsdc()
  const symbol = market.project?.token_symbol ?? 'tokens'
  const tradable = marketTradable(market)

  // adopt a price picked in the order book (adjusting state during render, keyed by the pick)
  const [lastPick, setLastPick] = useState(pick?.nonce)
  if (pick && pick.nonce !== lastPick) {
    setLastPick(pick.nonce)
    setType('limit')
    setPrice(pricePerToken(BigInt(pick.price), market))
  }

  const tick = BigInt(market.tick_size)
  const stats = market.stats
  const bestOpposite = side === 'buy' ? stats.best_ask : stats.best_bid

  // book-derived best price may be stale; the match plan below is fetched live
  const liveBook = useQuery({ queryKey: ['orderbook-best', market.onchain_id], queryFn: () => api.get<{ best_bid: string | null; best_ask: string | null }>(`/markets/${market.onchain_id}/orderbook`), refetchInterval: 8000 })
  const liveBest = side === 'buy' ? liveBook.data?.best_ask : liveBook.data?.best_bid
  const best = liveBest ?? bestOpposite ?? null

  const slipBps = useMemo(() => {
    const n = Number(slip)
    return BigInt(Math.min(Math.max(Number.isFinite(n) ? Math.round(n * 100) : 0, 0), 5000))
  }, [slip])

  const parsedLimit = parseOrderInput(type === 'limit' ? price : '1', qty, market)
  let priceLot: bigint | undefined = parsedLimit.priceLot
  let error = parsedLimit.error
  if (type === 'market') {
    priceLot = undefined
    if (!best) error = error ?? 'No liquidity on the other side of the book to take.'
    else priceLot = capPrice(side, BigInt(best), slipBps, tick)
    // price is derived, so re-validate size without the dummy price
    const q = parseOrderInput('', qty, market)
    error = q.error
    if (!best) error = 'No liquidity on the other side of the book to take.'
  }
  const lots = parsedLimit.lots

  const planQ = useQuery({
    queryKey: ['plan', market.onchain_id, side, priceLot?.toString(), lots?.toString(), address],
    queryFn: () => api.get<MatchPlan>(`/markets/${market.onchain_id}/match-plan${qs({ side, price: priceLot?.toString(), lots: lots?.toString(), address })}`),
    enabled: priceLot !== undefined && lots !== undefined && !error,
    refetchInterval: 8000,
  })
  const plan = planQ.data

  const calc = useMemo(() => {
    if (priceLot === undefined || lots === undefined || error || !plan) return null
    let fillValue = 0n
    let fillFee = 0n
    let filled = 0n
    for (const mk of plan.makers) {
      const v = BigInt(mk.price) * BigInt(mk.lots)
      fillValue += v
      fillFee += fee(v) // the contract floors the fee per fill
      filled += BigInt(mk.lots)
    }
    const rest = type === 'limit' ? lots - filled : 0n
    const restValue = rest * priceLot
    const restLock = side === 'buy' ? restValue + fee(restValue) : restValue
    const fillPull = side === 'buy' ? fillValue + fillFee : fillValue
    return { fillValue, fillFee, filled, rest, restValue, restLock, total: fillPull + restLock, discarded: type === 'market' ? lots - filled : 0n }
  }, [plan, priceLot, lots, error, side, type])

  const insufficientBalance = calc && balance !== undefined && balance < calc.total
  const needsApproval = calc && allowance !== undefined && allowance < calc.total

  const approve = () =>
    calc &&
    tx.run('Approve USDC', { address: cfg.usdc_address, abi: erc20Abi, functionName: 'approve', args: [cfg.exchange_address, calc.total] })

  const submit = async () => {
    if (!calc || priceLot === undefined || lots === undefined || market.onchain_id === null) return
    const secs = EXPIRIES.find((e) => e.id === expiry)?.secs ?? 0
    const end = Math.floor(new Date(market.trading_end).getTime() / 1000)
    const exp = type === 'market' || secs === 0 ? end : Math.min(Math.floor(Date.now() / 1000) + secs, end)
    const ioc = type === 'market'
    const minFill = ioc ? (fullFill ? lots : 1n) : 0n
    const receipt = await tx.run('Place order', {
      address: cfg.exchange_address,
      abi: exchangeAbi,
      functionName: 'placeOrder',
      args: [BigInt(market.onchain_id), side === 'buy' ? 0 : 1, priceLot, lots, BigInt(exp), ioc, minFill, plan?.maker_ids.map((i) => BigInt(i)) ?? []],
    })
    if (receipt) {
      toast.success('Order confirmed on-chain')
      setQty('')
    }
  }

  const sideBtn = (s: 'buy' | 'sell') => (
    <button type="button" onClick={() => setSide(s)} aria-pressed={side === s} className={`flex-1 rounded-lg py-2.5 text-sm font-extrabold uppercase tracking-wide transition-colors ${side === s ? (s === 'buy' ? 'bg-[var(--accent)] text-[#262627]' : 'bg-[#FF5A4F] text-[#262627]') : 'text-[var(--ink)] hover:bg-[var(--tint-2)]'}`}>
      {s === 'buy' ? 'Buy' : 'Sell'}
    </button>
  )

  return (
    <div className="glass space-y-4 rounded-3xl p-4 sm:p-5">
      <div className="flex gap-1 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-1" role="group" aria-label="Order side">
        {sideBtn('buy')}
        {sideBtn('sell')}
      </div>
      <div className="flex gap-1 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-1" role="group" aria-label="Order type">
        {(['limit', 'market'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={`flex-1 rounded-lg py-2 text-sm font-bold ${type === t ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--ink)] hover:bg-[var(--tint-2)]'}`}>
            {t === 'limit' ? 'Limit' : 'Market'}
          </button>
        ))}
      </div>

      {!tradable.ok && <Notice tone="warn">{tradable.reason}</Notice>}

      <WalletGate what="place orders">
        <div className="space-y-4">
          {type === 'limit' ? (
            <Field label={`Price (USDC per ${symbol})`} htmlFor="price" hint={`Tick: ${pricePerToken(tick, market)} USDC`}>
              <input id="price" className="field tabular-nums" inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setPrice(e.target.value)} />
            </Field>
          ) : (
            <div className="space-y-3">
              <Notice>
                Market orders are immediate-or-cancel with a price protection: they never trade beyond your slippage limit and never rest on the book.
              </Notice>
              <Field label="Max slippage (%)" htmlFor="slip" hint={best && priceLot ? `Price ${side === 'buy' ? 'cap' : 'floor'}: ${pricePerToken(priceLot, market)} USDC per ${symbol}` : undefined}>
                <input id="slip" className="field tabular-nums" inputMode="decimal" value={slip} onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setSlip(e.target.value)} />
              </Field>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--ink-2)]">
                <input type="checkbox" className="mt-1 size-4 accent-[#28DF99]" checked={fullFill} onChange={(e) => setFullFill(e.target.checked)} />
                <span>Require the full quantity (otherwise accept any partial fill)</span>
              </label>
            </div>
          )}
          <Field label={`Quantity (${symbol})`} htmlFor="qty" hint={`Lot size ${lotTokens(market)} ${symbol} · min ${market.min_lots} · max ${market.max_lots} lots`} error={qty || price ? error : undefined}>
            <input id="qty" className="field tabular-nums" inputMode="decimal" placeholder="0" value={qty} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setQty(e.target.value)} />
          </Field>
          {type === 'limit' && (
            <Field label="Order expires" htmlFor="exp">
              <select id="exp" className="field" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
                {EXPIRIES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {calc && lots !== undefined && priceLot !== undefined && (
            <div className="glass-inner space-y-2 rounded-2xl p-4 text-sm" aria-live="polite">
              {calc.filled > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--subtle)]">Fills now ({calc.filled.toString()} lot{calc.filled === 1n ? '' : 's'}, at maker prices)</span>
                  <span className="tabular-nums">{fmtUsdc(calc.fillValue)} USDC</span>
                </div>
              )}
              {side === 'buy' && calc.filled > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--subtle)]">Fee reserve (0.5%, only if the trade settles)</span>
                  <span className="tabular-nums">{fmtUsdc(calc.fillFee, 4)} USDC</span>
                </div>
              )}
              {calc.rest > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--subtle)]">Rests on the book ({calc.rest.toString()} lot{calc.rest === 1n ? '' : 's'})</span>
                  <span className="tabular-nums">{fmtUsdc(calc.restLock, 4)} USDC</span>
                </div>
              )}
              {calc.discarded > 0n && <div className="text-[var(--warn)]">{calc.discarded.toString()} lot(s) cannot be filled and will not be placed.</div>}
              <div className="flex justify-between border-t border-[var(--hair)] pt-2 font-semibold">
                <span>{side === 'buy' ? 'You lock' : 'You lock as collateral'}</span>
                <span className="tabular-nums">{fmtUsdc(calc.total, 4)} USDC</span>
              </div>
              {side === 'sell' ? (
                <p className="text-xs text-[var(--subtle)]">
                  Collateral equals the trade value. After TGE you deliver the token to receive payment plus your collateral, minus a 0.5% fee. If you do not deliver before the deadline the buyer receives your collateral.
                </p>
              ) : (
                <p className="text-xs text-[var(--subtle)]">
                  Your payment stays in escrow. A 0.5% fee is charged only when the trade settles; it is returned if the trade fails. Cancelling an unfilled order refunds everything with no fee.
                </p>
              )}
              {side === 'sell' && <p className="text-xs text-[var(--subtle)]">The seller fee of 0.5% is deducted from your payout at settlement.</p>}
            </div>
          )}
          {calc && calc.filled === 0n && type === 'market' && <Notice tone="warn">Nothing can be filled within your slippage limit right now.</Notice>}
          {insufficientBalance && (
            <Notice tone="error">
              Your USDC balance is below the amount to lock. Get test USDC from{' '}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
                faucet.circle.com
              </a>
              .
            </Notice>
          )}
          <TxPanel tx={tx} />
          {needsApproval && !insufficientBalance ? (
            <button className="btn btn-primary w-full" disabled={tx.busy || !tradable.ok} onClick={() => void approve()}>
              {tx.busy ? <Spinner label={tx.phase === 'wallet' ? 'Confirm in wallet…' : 'Confirming…'} /> : `Approve ${fmtUsdc(calc?.total ?? 0n, 4)} USDC`}
            </button>
          ) : (
            <button className="btn btn-primary w-full" disabled={!calc || !!error || tx.busy || !!insufficientBalance || !tradable.ok || (type === 'market' && calc.filled === 0n)} onClick={() => void submit()}>
              {tx.busy ? <Spinner label={tx.phase === 'wallet' ? 'Confirm in wallet…' : 'Confirming…'} /> : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol}`}
            </button>
          )}
          <p className="text-center text-[11px] text-[var(--subtle)]">
            Market {MARKET_STATUS_LABEL[market.status] ?? market.status} · testnet, unaudited
          </p>
        </div>
      </WalletGate>
    </div>
  )
}
