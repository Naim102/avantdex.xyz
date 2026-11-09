import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
import { CountUp } from '@/components/CountUp'
import { MarketBoard } from '@/components/MarketBoard'
import { Reveal } from '@/components/Reveal'
import { EmptyState, Skeleton } from '@/components/ui'
import { UpcomingSection } from '@/components/UpcomingSection'
import { FaqSection, HeroPyramid, LifecycleSection, LiquiditySection } from '@/components/HomeSections'
import { useConfig } from '@/hooks/useApp'
import { api, type Market, type PlatformStats } from '@/lib/api'
import { fmtUsdc } from '@/lib/exchange'

const usePlatformStats = () => useQuery({ queryKey: ['platform-stats'], queryFn: () => api.get<PlatformStats>('/stats'), refetchInterval: 15000 })

const usd = (raw: string) => Number(raw) / 1e6
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Three headline numbers under the hero. Real values from the API; zero stays zero. */
function HeroStats() {
  const { data } = usePlatformStats()
  const items: { label: string; value: number; format: (n: number) => string; unit?: string }[] = data
    ? [
        { label: 'Live markets', value: data.markets_live, format: (n) => String(Math.round(n)) },
        { label: '24h volume', value: usd(data.volume_24h), format: money, unit: 'USDC' },
        { label: 'Open interest', value: usd(data.open_interest), format: money, unit: 'USDC' },
      ]
    : []
  return (
    <dl className="grid grid-cols-3 gap-4 border-t border-[var(--line)] pt-5 sm:max-w-xl" aria-label="Platform totals">
      {items.length === 0
        ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)
        : items.map((i) => (
            <div key={i.label}>
              <dd className="tabular-nums text-xl font-semibold sm:text-2xl">
                <CountUp value={i.value} format={i.format} />
                {i.unit && <span className="ml-1 text-xs font-medium text-[var(--muted)]">{i.unit}</span>}
              </dd>
              <dt className="text-xs font-medium text-[var(--muted)]">{i.label}</dt>
            </div>
          ))}
    </dl>
  )
}

/** The full set of platform totals. Computed from on-chain orders and trades, nothing estimated. */
function Ledger() {
  const { data, isLoading, isError } = usePlatformStats()
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
    <section className="glass p-4 sm:p-6" aria-labelledby="ledger-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ledger-h" className="display text-2xl">Platform ledger</h2>
        <span className="text-xs font-medium text-[var(--muted)]">Computed from on-chain orders and trades, nothing estimated</span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-4 h-28" />
      ) : isError || !data ? (
        <p className="py-6 text-sm font-medium text-[var(--muted)]">The ledger could not be loaded. The API is unreachable, try again in a moment.</p>
      ) : (
        <dl className="mt-5 grid gap-x-10 gap-y-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k} className="ledger-row">
              <dt className="font-medium text-[var(--muted)]">{k}</dt>
              <dd className="tabular-nums font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/** Live market counts per category; each one opens the board filtered to it. */
function Categories({ markets }: { markets: Market[] }) {
  const { data: cfg } = useConfig()
  const cats = cfg?.categories ?? []
  if (cats.length === 0) return null
  return (
    <section className="space-y-5" aria-labelledby="cat-h">
      <Reveal>
        <h2 id="cat-h" className="display text-3xl">Browse by category</h2>
      </Reveal>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cats.map((c, i) => {
          const n = markets.filter((m) => m.project?.category === c).length
          return (
            <Reveal key={c} delay={i * 0.04} y={12}>
              <Link to={`/explore?category=${encodeURIComponent(c)}`} className="glass hoverable block px-4 py-3.5">
                <span className="block text-sm font-semibold">{c}</span>
                <span className="text-xs text-[var(--muted)]"><span className="tabular-nums">{n}</span> live market{n === 1 ? '' : 's'}</span>
              </Link>
            </Reveal>
          )
        })}
      </div>
    </section>
  )
}

/** Fees in plain numbers, read from the API config (the contract constants). */
function Fees() {
  const { data: cfg } = useConfig()
  const buyer = cfg ? `${cfg.buyer_fee_bps / 100}%` : '0.5%'
  const seller = cfg ? `${cfg.seller_fee_bps / 100}%` : '0.5%'
  const rows: [string, string, string][] = [
    ['Buyer, on a settled trade', buyer, 'Held as a reserve while the trade is open and returned if it fails'],
    ['Seller, on a settled trade', seller, 'Taken from the payout when the seller delivers'],
    ['Cancelling an unfilled order', '0%', 'Everything locked comes back'],
    ['Listing a project, requesting a listing', '0%', 'Free'],
    ['A default or a refund', '0%', 'Collateral or the full payment goes back to its owner'],
  ]
  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_1.5fr] lg:gap-12" aria-labelledby="fees-h">
      <Reveal className="space-y-2">
        <h2 id="fees-h" className="display text-3xl">Fees, in plain numbers</h2>
        <p className="max-w-sm text-sm font-medium text-[var(--muted)]">One fee, charged only when a trade settles, paid in USDC to the fee collector address shown in the footer.</p>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="glass divide-y divide-[var(--hair)]">
          {rows.map(([k, v, note]) => (
            <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 sm:px-5">
              <span className="font-semibold">{k}</span>
              <span className="tabular-nums text-lg font-semibold">{v}</span>
              <span className="col-span-2 text-xs font-medium text-[var(--muted)]">{note}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

const OWNER_STEPS: [string, string][] = [
  ['Submit', 'Send the project, the team wallet and proof you may speak for it. Free.'],
  ['Review', 'An admin approves it. Verification badges are optional and describe one check each.'],
  ['Market opens', 'A market manager creates the market on-chain and activates it. Traders can then place orders.'],
]

function OwnerSection() {
  return (
    <section className="glass p-5 sm:p-8" aria-labelledby="listing-h">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:items-center">
        <Reveal className="space-y-4">
          <h2 id="listing-h" className="display text-3xl">Own a project that has not launched?</h2>
          <p className="max-w-md text-pretty font-medium text-[var(--muted)]">List it for free. Approval, verification and the start of trading are three separate steps, and you can see where yours is.</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/list/submit" className="btn btn-primary">Submit your project</Link>
            <Link to="/list/request" className="btn btn-ghost">Request a token listing</Link>
          </div>
        </Reveal>
        <ol className="grid gap-4 sm:grid-cols-3">
          {OWNER_STEPS.map(([t, d], i) => (
            <li key={t}>
              <Reveal delay={0.1 + i * 0.1} y={16}>
                <div className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--accent)] text-sm font-bold text-[var(--accent-ink)]">{i + 1}</span>
                  <h3 className="font-semibold">{t}</h3>
                </div>
                <p className="mt-2 text-sm font-medium text-[var(--muted)]">{d}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const ease = [0.22, 1, 0.36, 1] as const

export default function Home() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [q, setQ] = useState('')
  const { data, isLoading, isError } = useQuery({ queryKey: ['markets', 'home'], queryFn: () => api.get<{ items: Market[] }>('/markets?tab=trending'), refetchInterval: 15000 })
  const all = data?.items ?? []
  const markets = all.slice(0, 8)
  const rise = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay: 0.08 * i, ease } })

  return (
    <div className="space-y-20 sm:space-y-28">
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pt-6">
        <div className="space-y-7">
          <motion.h1 {...rise(0)} className="display text-balance text-[2.6rem] leading-[1.02] sm:text-6xl">
            Trade tokens <span className="text-[var(--accent-text)]">before they launch</span>
          </motion.h1>
          <motion.p {...rise(1)} className="max-w-lg text-pretty text-lg font-medium text-[var(--muted)]">
            An order book for tokens that do not exist yet, settled in USDC on Arc. Your funds stay in escrow until the token is delivered.
          </motion.p>
          <motion.div {...rise(2)} className="flex flex-wrap gap-3">
            <Link to="/explore" className="btn btn-primary !min-h-12 !px-6">Open the market board</Link>
            <Link to="/list" className="btn btn-ghost !min-h-12 !px-6">List your project</Link>
          </motion.div>
          <motion.div {...rise(3)}>
            <HeroStats />
          </motion.div>
        </div>
        <motion.div {...(reduce ? {} : { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.9, delay: 0.15, ease } })}>
          <HeroPyramid />
        </motion.div>
      </section>

      <section className="space-y-6" aria-labelledby="board-h">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="board-h" className="display text-3xl">Market board</h2>
              <p className="mt-1 text-sm font-medium text-[var(--muted)]">Last price, both sides of the book, volume and liquidity for each market.</p>
            </div>
            <form
              role="search"
              className="flex w-full gap-2 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault()
                void navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
              }}
            >
              <div className="relative flex-1 sm:w-72">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
                <input className="field !pl-10" placeholder="Search name or symbol" aria-label="Search tokens" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
              </div>
              <button className="btn btn-ghost" type="submit">Search</button>
            </form>
          </div>
        </Reveal>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : isError ? (
          <EmptyState title="Markets are unavailable" body="The Avantdex API could not be reached. Try again in a moment." />
        ) : markets.length === 0 ? (
          <EmptyState title="No market is trading yet" body="A project appears here once its market is created on-chain and activated. Approved projects are listed below as Coming soon." />
        ) : (
          <Reveal>
            <MarketBoard markets={markets} />
            <div className="mt-4 text-right">
              <Link to="/explore" className="link-line text-sm font-semibold">All markets and filters</Link>
            </div>
          </Reveal>
        )}
      </section>

      <Categories markets={all} />

      <LiquiditySection markets={all} />

      <Reveal>
        <Ledger />
      </Reveal>

      <LifecycleSection />

      <Fees />

      <UpcomingSection limit={6} />

      <OwnerSection />

      <FaqSection />
    </div>
  )
}
