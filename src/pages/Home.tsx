import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { MarketBoard } from '@/components/MarketBoard'
import { EmptyState, Skeleton } from '@/components/ui'
import { UpcomingSection } from '@/components/UpcomingSection'
import { api, type Market, type PlatformStats } from '@/lib/api'
import { fmtUsdc } from '@/lib/exchange'

/** Platform totals, all computed by the API from indexed chain data. Zeros are shown as zeros. */
function Ledger() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['platform-stats'], queryFn: () => api.get<PlatformStats>('/stats'), refetchInterval: 15000 })
  const rows: [string, string][] = data
    ? [
        ['Live markets', String(data.markets_live)],
        ['Open orders', String(data.open_orders)],
        ['Buy-side liquidity', `${fmtUsdc(data.bid_depth)} USDC`],
        ['Sell-side liquidity', `${fmtUsdc(data.ask_depth)} USDC`],
        ['24h volume', `${fmtUsdc(data.volume_24h)} USDC`],
        ['Total volume', `${fmtUsdc(data.volume_total)} USDC`],
        ['Open interest', `${fmtUsdc(data.open_interest)} USDC`],
        ['Settled trades', `${data.trades_settled} of ${data.trades_total}`],
        ['Fees paid to collector', `${fmtUsdc(data.fees_paid, 4)} USDC`],
      ]
    : []
  return (
    <section className="glass lift p-4 sm:p-5" aria-labelledby="ledger-h">
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-[var(--line)] pb-3">
        <h2 id="ledger-h" className="display text-xl">Platform ledger</h2>
        <span className="text-xs font-medium text-[var(--muted)]">Arc Testnet, live</span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-4 h-60" />
      ) : isError || !data ? (
        <p className="py-8 text-sm font-medium text-[var(--muted)]">The ledger could not be loaded. The API is unreachable, try again in a moment.</p>
      ) : (
        <dl className="mt-3 space-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="ledger-row">
              <dt className="font-medium text-[var(--muted)]">{k}</dt>
              <dd className="tabular-nums font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 text-xs text-[var(--subtle)]">Computed from on-chain orders and trades. Nothing on this panel is estimated.</p>
    </section>
  )
}

const RULES: [string, string][] = [
  ['Seller locks collateral', 'Equal to the trade value, taken when the order is placed.'],
  ['Buyer locks payment', 'The trade value plus a 0.5% fee reserve. The fee is only charged if the trade settles.'],
  ['Delivery is atomic', 'The seller sends the token and receives USDC in one transaction, or nothing moves.'],
  ['No delivery by the deadline', 'The buyer claims their payment plus the seller collateral.'],
  ['Market cancelled', 'Everyone is refunded in full, with no fee.'],
  ['Admins', 'No role can move or redirect escrowed funds.'],
]

export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data, isLoading, isError } = useQuery({ queryKey: ['markets', 'home'], queryFn: () => api.get<{ items: Market[] }>('/markets?tab=trending'), refetchInterval: 15000 })
  const markets = (data?.items ?? []).slice(0, 8)

  return (
    <div className="space-y-14 sm:space-y-16">
      <section className="grid items-start gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
        <div className="space-y-6 pt-1 lg:pt-4">
          <h1 className="display text-balance text-[2.5rem] leading-[0.98] sm:text-6xl">
            Trade tokens <span className="mark">before they launch</span>
          </h1>
          <p className="max-w-xl text-pretty text-lg font-medium text-[var(--muted)]">
            An order book for tokens that do not exist yet, settled in USDC on Arc. Your funds stay in escrow until the token is delivered.
          </p>
          <form
            role="search"
            className="flex max-w-xl gap-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              void navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
              <input className="field !min-h-12 !pl-11" placeholder="Find a token by name or symbol" aria-label="Search tokens" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
            </div>
            <button className="btn btn-primary !min-h-12 !px-5" type="submit">
              Search
            </button>
          </form>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-bold">
            <Link to="/explore" className="underline decoration-2 underline-offset-4 hover:text-[var(--accent-text)]">Open the market board</Link>
            <Link to="/portfolio" className="underline decoration-2 underline-offset-4 hover:text-[var(--accent-text)]">Check your orders and trades</Link>
          </div>
        </div>
        <Ledger />
      </section>

      <section className="space-y-5" aria-labelledby="board-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="board-h" className="display text-3xl">Market board</h2>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">Last price, both sides of the book, volume and liquidity for each market.</p>
          </div>
          <Link to="/explore" className="btn btn-ghost">All markets and filters</Link>
        </div>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : isError ? (
          <EmptyState title="Markets are unavailable" body="The Avantdex API could not be reached. Try again in a moment." />
        ) : markets.length === 0 ? (
          <EmptyState title="No market is trading yet" body="A project appears here once its market is created on-chain and activated. Approved projects are listed below as Coming soon." />
        ) : (
          <MarketBoard markets={markets} />
        )}
      </section>

      <UpcomingSection limit={6} />

      <section className="grid gap-8 lg:grid-cols-[1fr_1.3fr] lg:gap-12" aria-labelledby="safe-h">
        <div className="space-y-3">
          <h2 id="safe-h" className="display text-3xl">What happens to your money</h2>
          <p className="max-w-md text-pretty font-medium text-[var(--muted)]">
            Orders are on-chain, so the rules below are enforced by the contract and not by the team. The contract is testnet software and has not been audited.
          </p>
        </div>
        <dl className="glass divide-y divide-[var(--hair)]">
          {RULES.map(([t, d]) => (
            <div key={t} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
              <dt className="font-bold">{t}</dt>
              <dd className="text-sm font-medium text-[var(--muted)]">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]" aria-labelledby="listing-h">
        <div className="glass flex flex-col justify-between gap-6 p-5 sm:p-6" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <div className="space-y-2">
            <h2 id="listing-h" className="display text-3xl">Own a project that has not launched?</h2>
            <p className="max-w-lg text-pretty font-medium">Submit it for review. Listing is free. Approval, verification and the start of trading are three separate steps, and you can see where yours is.</p>
          </div>
          <div>
            <Link to="/list/submit" className="btn !bg-[var(--surface)] !text-[var(--ink)]">Submit your project</Link>
          </div>
        </div>
        <div className="glass flex flex-col justify-between gap-5 p-5 sm:p-6">
          <div className="space-y-2">
            <h3 className="display text-xl">Want a token that is not here?</h3>
            <p className="text-sm font-medium text-[var(--muted)]">Tell us which project you would trade. Requests are counted per token, and they never create a market by themselves.</p>
          </div>
          <div>
            <Link to="/list/request" className="btn btn-ghost">Request a listing</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
