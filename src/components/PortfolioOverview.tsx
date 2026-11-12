import { Link } from 'react-router-dom'
import { ProjectLogo } from '@/components/MarketParts'
import { StatusChip } from '@/components/ui'
import type { Position } from '@/lib/api'
import { fmtDay, fmtDate, shortAddr } from '@/lib/format'
import { countdown } from '@/lib/format'
import { fmtLotsAsTokens, fmtUsdc } from '@/lib/exchange'

const tokens = (lots: number | string, p: Position) => fmtLotsAsTokens(String(lots), { lot_size: p.market.lot_size, token_decimals: p.market.token_decimals })
const sym = (p: Position) => p.market.symbol ?? shortAddr(p.market.token_address)
const name = (p: Position) => p.market.name ?? `Market #${p.market_onchain_id}`

/** One band with the four wallet figures, so the page opens with the money and nothing else. */
export function SummaryBand({ balance, lockedOrders, lockedTrades, claimable, openOrders, openTrades }: { balance?: string; lockedOrders: string; lockedTrades: string; claimable: string; openOrders: number; openTrades: number }) {
  const cells: [string, string, string][] = [
    ['USDC in your wallet', balance ?? '–', 'Free to use'],
    ['Locked in open orders', fmtUsdc(lockedOrders), `${openOrders} resting order${openOrders === 1 ? '' : 's'}, cancel any time`],
    ['Locked in trades', fmtUsdc(lockedTrades), `${openTrades} open trade${openTrades === 1 ? '' : 's'}, released at settlement`],
    ['Claimable', fmtUsdc(claimable), 'USDC a transfer could not deliver'],
  ]
  return (
    <div className="glass grid grid-cols-2 gap-px overflow-hidden bg-[var(--line)] lg:grid-cols-4" role="group" aria-label="Wallet summary">
      {cells.map(([label, value, sub]) => (
        <div key={label} className="bg-[var(--surface)] p-4 sm:p-5">
          <div className="label !mb-1">{label}</div>
          <div className="tabular-nums text-2xl font-semibold">{value}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{sub}</div>
        </div>
      ))}
    </div>
  )
}

/** What each market is waiting for, in plain words. */
function stage(p: Position, nowMs: number): { text: string; tone: 'info' | 'warn' | 'ok' } {
  const m = p.market
  if (m.status === 'SettlementOpen' && m.settlement_deadline) {
    const left = Math.floor((new Date(m.settlement_deadline).getTime() - nowMs) / 1000)
    return left > 0 ? { text: `Settlement open, ${countdown(left)} left`, tone: 'warn' } : { text: 'Settlement deadline passed', tone: 'warn' }
  }
  if (m.status === 'Completed') return { text: 'Completed', tone: 'ok' }
  if (m.status === 'Cancelled') return { text: 'Cancelled: trades are refundable', tone: 'warn' }
  if (m.tge_date) return { text: `TGE ${fmtDay(m.tge_date)}`, tone: 'info' }
  return { text: `Trading until ${fmtDay(m.trading_end)}`, tone: 'info' }
}

function Amount({ lots, p, sign, none = '–' }: { lots: number; p: Position; sign: '+' | '-'; none?: string }) {
  if (!lots) return <span className="text-[var(--subtle)]">{none}</span>
  return (
    <span className={`tabular-nums font-semibold ${sign === '+' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
      {sign}
      {tokens(lots, p)} <span className="text-xs font-medium">{sym(p)}</span>
    </span>
  )
}

/**
 * The core of the page: for every token, how many you will receive or have to deliver from trades (guaranteed by escrow)
 * and how many could still come from resting orders (not guaranteed, they may never match).
 */
export function TokenAllocation({ positions, nowMs }: { positions: Position[]; nowMs: number }) {
  if (positions.length === 0) {
    return (
      <section className="glass p-6 text-center" aria-labelledby="alloc-h">
        <h3 id="alloc-h" className="display text-xl">Your token allocation</h3>
        <p className="mx-auto mt-2 max-w-md text-sm font-medium text-[var(--muted)]">You have no trades or resting orders yet. When you buy or sell, each token appears here with how many you will receive or deliver.</p>
        <Link to="/explore" className="btn btn-primary mt-4">Open the market board</Link>
      </section>
    )
  }
  return (
    <section className="space-y-3" aria-labelledby="alloc-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="alloc-h" className="display text-xl">Your token allocation</h3>
        <p className="text-xs font-medium text-[var(--muted)]">Trades are locked in by escrow. Resting orders are not guaranteed to fill.</p>
      </div>

      <div className="glass hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
              <th className="px-4 py-2.5 font-semibold">Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">You receive</th>
              <th className="px-3 py-2.5 text-right font-semibold">You deliver</th>
              <th className="px-3 py-2.5 text-right font-semibold">USDC locked in trades</th>
              <th className="px-3 py-2.5 font-semibold">Resting orders</th>
              <th className="px-4 py-2.5 font-semibold">Next</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hair)]">
            {positions.map((p) => {
              const st = stage(p, nowMs)
              const lockedTrades = BigInt(p.pay_locked) + BigInt(p.collateral_locked)
              return (
                <tr key={p.market_onchain_id} className="row-hover align-top">
                  <td className="px-4 py-3">
                    <Link to={`/market/${p.market.slug ?? p.market_onchain_id}`} className="flex items-center gap-3">
                      <ProjectLogo name={name(p)} url={p.market.logo_url} size="size-9" />
                      <span className="min-w-0">
                        <span className="block max-w-[11rem] truncate font-semibold">{name(p)}</span>
                        <span className="mono text-xs text-[var(--muted)]">{sym(p)}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Amount lots={p.to_receive_lots} p={p} sign="+" />
                    {p.received_lots > 0 && <span className="block text-xs text-[var(--muted)]">{tokens(p.received_lots, p)} already received</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Amount lots={p.to_deliver_lots} p={p} sign="-" />
                    {p.to_deliver_lots > 0 && <span className="block text-xs text-[var(--muted)]">earns {fmtUsdc(p.sale_net)} USDC</span>}
                    {p.delivered_lots > 0 && <span className="block text-xs text-[var(--muted)]">{tokens(p.delivered_lots, p)} already delivered</span>}
                  </td>
                  <td className="tabular-nums px-3 py-3 text-right font-semibold">
                    {lockedTrades > 0n ? fmtUsdc(lockedTrades) : <span className="text-[var(--subtle)]">–</span>}
                    {lockedTrades > 0n && <span className="block text-xs font-medium text-[var(--muted)]">{p.open_trades} trade{p.open_trades === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {p.open_orders === 0 ? (
                      <span className="text-[var(--subtle)]">None</span>
                    ) : (
                      <>
                        {p.open_buy_lots > 0 && <span className="block">Buy up to <b className="tabular-nums">{tokens(p.open_buy_lots, p)} {sym(p)}</b></span>}
                        {p.open_sell_lots > 0 && <span className="block">Sell up to <b className="tabular-nums">{tokens(p.open_sell_lots, p)} {sym(p)}</b></span>}
                        <span className="block text-[var(--muted)]">{fmtUsdc(p.locked_in_orders)} USDC locked</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <StatusChip status={p.market.status} />
                    <span className={`mt-1 block font-semibold ${st.tone === 'warn' ? 'text-[var(--warn)]' : ''}`}>{st.text}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {positions.map((p) => {
          const st = stage(p, nowMs)
          return (
            <article key={p.market_onchain_id} className="glass space-y-3 p-4">
              <Link to={`/market/${p.market.slug ?? p.market_onchain_id}`} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <ProjectLogo name={name(p)} url={p.market.logo_url} size="size-9" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{name(p)}</span>
                    <span className="mono text-xs text-[var(--muted)]">{sym(p)}</span>
                  </span>
                </span>
                <StatusChip status={p.market.status} />
              </Link>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="label !mb-0.5">You receive</dt><dd><Amount lots={p.to_receive_lots} p={p} sign="+" /></dd></div>
                <div><dt className="label !mb-0.5">You deliver</dt><dd><Amount lots={p.to_deliver_lots} p={p} sign="-" /></dd></div>
                <div><dt className="label !mb-0.5">USDC locked in trades</dt><dd className="tabular-nums font-semibold">{fmtUsdc(BigInt(p.pay_locked) + BigInt(p.collateral_locked))}</dd></div>
                <div>
                  <dt className="label !mb-0.5">Resting orders</dt>
                  <dd className="text-xs">{p.open_orders === 0 ? 'None' : `${p.open_buy_lots ? `Buy ${tokens(p.open_buy_lots, p)} ${sym(p)} ` : ''}${p.open_sell_lots ? `Sell ${tokens(p.open_sell_lots, p)} ${sym(p)}` : ''}`}</dd>
                </div>
              </dl>
              <p className={`text-xs font-semibold ${st.tone === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--muted)]'}`}>{st.text}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}

interface Todo {
  key: string
  title: string
  detail: string
  to: string
  tone: 'warn' | 'info'
}

/** Things that need the wallet owner: deliver before a deadline, claim a default, take a refund. Empty when all is calm. */
export function NeedsYou({ positions, nowMs }: { positions: Position[]; nowMs: number }) {
  const todo: Todo[] = []
  for (const p of positions) {
    const m = p.market
    const dl = m.settlement_deadline ? new Date(m.settlement_deadline).getTime() : null
    if (m.status === 'SettlementOpen' && p.to_deliver_lots > 0) {
      todo.push({
        key: `d${p.market_onchain_id}`, tone: 'warn', to: '/portfolio?tab=Settlement%20Status',
        title: `Deliver ${tokens(p.to_deliver_lots, p)} ${sym(p)}`,
        detail: dl && dl > nowMs ? `Before ${fmtDate(m.settlement_deadline)}. Approve the token, then settle, or you lose your collateral.` : 'The deadline passed. You can still settle until the buyer claims the default.',
      })
    }
    if (m.status === 'SettlementOpen' && p.to_receive_lots > 0) {
      todo.push({
        key: `r${p.market_onchain_id}`, tone: dl && dl <= nowMs ? 'warn' : 'info', to: '/portfolio?tab=Settlement%20Status',
        title: `${tokens(p.to_receive_lots, p)} ${sym(p)} on the way`,
        detail: dl && dl <= nowMs ? 'The deadline passed. If the seller has not delivered, claim your payment plus their collateral.' : `The seller delivers before ${fmtDate(m.settlement_deadline)}.`,
      })
    }
    if (m.status === 'Cancelled' && p.open_trades > 0) {
      todo.push({ key: `c${p.market_onchain_id}`, tone: 'warn', to: '/portfolio?tab=Settlement%20Status', title: `${name(p)} was cancelled`, detail: 'Your open trades are refundable in full with no fee.' })
    }
  }
  if (todo.length === 0) return null
  return (
    <section className="glass p-4 sm:p-5" aria-labelledby="todo-h">
      <h3 id="todo-h" className="display text-xl">Needs you</h3>
      <ul className="mt-2 divide-y divide-[var(--hair)]">
        {todo.map((t) => (
          <li key={t.key}>
            <Link to={t.to} className="grid gap-x-4 py-3 hover:bg-[var(--tint)] sm:grid-cols-[1fr_auto]">
              <span>
                <span className={`block text-sm font-semibold ${t.tone === 'warn' ? 'text-[var(--warn)]' : ''}`}>{t.title}</span>
                <span className="block text-xs text-[var(--muted)]">{t.detail}</span>
              </span>
              <span className="text-xs font-semibold underline underline-offset-4 sm:self-center">Open settlement status</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
