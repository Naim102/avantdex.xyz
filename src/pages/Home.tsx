import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Briefcase, Compass, Megaphone, Search, FileText } from 'lucide-react'
import { MarketCard } from '@/components/MarketCard'
import { EmptyState, Skeleton } from '@/components/ui'
import { api, type Market } from '@/lib/api'

function Card({ to, icon, title, body }: { to: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link to={to} className="glass group flex items-center gap-4 rounded-3xl p-5 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-[var(--accent)]">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="display text-lg font-semibold">{title}</div>
        <div className="text-sm text-[var(--subtle)]">{body}</div>
      </div>
      <ArrowRight className="size-5 text-[var(--subtle)] transition-transform group-hover:translate-x-1" />
    </Link>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data, isLoading, isError } = useQuery({ queryKey: ['markets', 'home'], queryFn: () => api.get<{ items: Market[] }>('/markets?tab=trending'), refetchInterval: 15000 })
  const markets = (data?.items ?? []).slice(0, 6)

  return (
    <div className="space-y-12">
      <section className="space-y-6 pt-4 text-center">
        <h1 className="display mx-auto max-w-3xl text-balance text-4xl font-bold sm:text-6xl">
          Trade tokens <span className="text-[var(--accent)]">before they launch</span>
        </h1>
        <p className="mx-auto max-w-xl text-pretty text-[var(--subtle)]">Order-book pre-market trading settled in USDC on Arc. Funds stay in escrow until the token is delivered.</p>
        <form
          role="search"
          className="relative mx-auto max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            void navigate(`/explore${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
          }}
        >
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--subtle)]" />
          <input className="field !min-h-14 !rounded-2xl !pl-12 text-base" placeholder="Search Tokens" aria-label="Search tokens" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card to="/explore" icon={<Compass className="size-6" />} title="Explore" body="Browse upcoming token markets" />
        <Card to="/portfolio" icon={<Briefcase className="size-6" />} title="Portfolio" body="Orders, trades and settlement" />
      </section>

      <section className="space-y-5" aria-labelledby="markets-h">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="markets-h" className="display text-2xl font-bold">
              Marketplace
            </h2>
            <p className="text-sm text-[var(--subtle)]">Available Markets</p>
          </div>
          <Link to="/explore" className="btn btn-ghost">
            Explore All <ArrowRight className="size-4" />
          </Link>
        </div>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState title="Markets are unavailable" body="The Avantdex API could not be reached. Try again in a moment." />
        ) : markets.length === 0 ? (
          <EmptyState title="No markets yet" body="No project has an active market on Avantdex yet. Markets appear here after a project is approved, verified and activated." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5" aria-labelledby="listing-h">
        <div>
          <h2 id="listing-h" className="display text-2xl font-bold">
            Create Listing
          </h2>
          <p className="text-sm text-[var(--subtle)]">Get a project onto Avantdex. This is not an order.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card to="/list/submit" icon={<FileText className="size-6" />} title="Submit Your Project" body="For project owners and authorised team representatives" />
          <Card to="/list/request" icon={<Megaphone className="size-6" />} title="Request a Listing" body="Suggest a project you would like to trade" />
        </div>
      </section>
    </div>
  )
}
