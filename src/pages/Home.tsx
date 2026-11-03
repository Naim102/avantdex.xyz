import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUpRight, Briefcase, Compass, FileText, Megaphone, Search } from 'lucide-react'
import { MarketCard } from '@/components/MarketCard'
import { EmptyState, Skeleton } from '@/components/ui'
import { api, type Market } from '@/lib/api'

function Tile({ to, icon, title, body, color }: { to: string; icon: React.ReactNode; title: string; body: string; color?: string }) {
  return (
    <Link
      to={to}
      className="glass group flex items-center gap-4 rounded-3xl p-5 transition-all duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_var(--line)]"
      style={color ? { background: color, color: '#262627' } : undefined}
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-[#262627] bg-white text-[#262627]">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="display text-xl">{title}</div>
        <div className="text-sm font-medium opacity-80">{body}</div>
      </div>
      <ArrowUpRight className="size-6 shrink-0 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
    </Link>
  )
}

function SectionHead({ id, title, sub, action }: { id: string; title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="display text-3xl uppercase sm:text-4xl">
          {title}
        </h2>
        <p className="mt-1 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">{sub}</p>
      </div>
      {action}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data, isLoading, isError } = useQuery({ queryKey: ['markets', 'home'], queryFn: () => api.get<{ items: Market[] }>('/markets?tab=trending'), refetchInterval: 15000 })
  const markets = (data?.items ?? []).slice(0, 6)

  return (
    <div className="space-y-14">
      <section className="grid items-center gap-8 pt-2 lg:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <h1 className="display text-balance text-5xl uppercase leading-[0.95] sm:text-7xl">
            Trade tokens <span className="mark">before they launch</span>
          </h1>
          <p className="max-w-xl text-pretty text-lg font-medium text-[var(--muted)]">Order-book pre-market trading settled in USDC on Arc. Your funds stay in escrow until the token is delivered.</p>
          <form
            role="search"
            className="flex max-w-xl gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2" />
              <input className="field !min-h-14 !pl-12 text-base" placeholder="Search Tokens" aria-label="Search tokens" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
            </div>
            <button className="btn btn-primary !min-h-14 !px-6" type="submit">
              Search
            </button>
          </form>
        </div>
        <img src="/logo.png" alt="" aria-hidden="true" className="hidden size-44 rotate-[6deg] rounded-3xl border-2 border-[var(--line)] shadow-[8px_8px_0_var(--line)] lg:block" />
      </section>

      <section className="grid gap-5 sm:grid-cols-2" aria-label="Quick links">
        <Tile to="/explore" icon={<Compass className="size-7" />} title="Explore" body="Browse upcoming token markets" color="#28DF99" />
        <Tile to="/portfolio" icon={<Briefcase className="size-7" />} title="Portfolio" body="Orders, trades and settlement" color="#FFD84D" />
      </section>

      <section className="space-y-6" aria-labelledby="markets-h">
        <SectionHead
          id="markets-h"
          title="Marketplace"
          sub="Available Markets"
          action={
            <Link to="/explore" className="btn btn-ghost">
              Explore All <ArrowRight className="size-4" />
            </Link>
          }
        />
        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState title="Markets are unavailable" body="The Avantdex API could not be reached. Try again in a moment." />
        ) : markets.length === 0 ? (
          <EmptyState title="No markets yet" body="No project has an active market on Avantdex yet. Markets appear here after a project is approved, verified and activated." />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6" aria-labelledby="listing-h">
        <SectionHead id="listing-h" title="Create Listing" sub="Get a project onto Avantdex. This is not an order." />
        <div className="grid gap-5 sm:grid-cols-2">
          <Tile to="/list/submit" icon={<FileText className="size-7" />} title="Submit Your Project" body="For project owners and authorised team representatives" />
          <Tile to="/list/request" icon={<Megaphone className="size-7" />} title="Request a Listing" body="Suggest a project you would like to trade" />
        </div>
      </section>
    </div>
  )
}
