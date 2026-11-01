import { Link } from 'react-router-dom'
import { ArrowRight, Handshake, Lock, ShieldCheck } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import { useListings, useOrders } from '@/hooks/useMarket'
import { EmptyState, LegalNote, ListingCard, ListingGrid, SkeletonGrid } from '@/components/ui'

const STEPS = [
  { Icon: Lock, title: 'Pay into escrow', body: 'Your USDC is held by the escrow contract, never by the seller.' },
  { Icon: Handshake, title: 'Seller authorizes', body: 'The seller explicitly approves and hands over the asset or rights.' },
  { Icon: ShieldCheck, title: 'Verified, then released', body: 'Payment is released only after the transfer is verified onchain. Otherwise you are refunded.' },
]

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-inner rounded-2xl px-4 py-3">
      <div className="display text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">{label}</div>
    </div>
  )
}

export default function Home() {
  const { listings, isLoading } = useListings()
  const { orders } = useOrders()

  const active = listings.filter((l) => l.status === 1)
  const featured = [...active].sort((a, b) => (b.price > a.price ? 1 : b.price < a.price ? -1 : 0)).slice(0, 3)
  const featuredIds = new Set(featured.map((l) => l.id))
  const recent = listings.filter((l) => !featuredIds.has(l.id)).slice(0, 6)
  const completed = orders.filter((o) => o.status === 2)
  const volume = completed.reduce((sum, o) => sum + o.price, 0n)

  return (
    <div className="space-y-14">
      <section className="glass relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border border-white/8" />
        <div className="pointer-events-none absolute -right-10 -top-10 size-72 rounded-full border border-white/10" />
        <div className="relative max-w-2xl">
          <span className="chip mb-5">Built on Arc, settled in USDC</span>
          <h1 className="display text-5xl font-bold leading-[1.02] text-balance sm:text-6xl">
            List. Buy. <span className="text-[var(--accent)]">Transfer.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-[var(--muted)]">
            A simple marketplace for tokens, NFTs, and onchain project rights. Payment sits in escrow until the transfer is verified onchain.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/create" className="btn btn-primary">
              List Asset
            </Link>
            <Link to="/explore" className="btn btn-ghost">
              Explore listings <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
        <div className="relative mt-10 grid max-w-xl grid-cols-3 gap-3">
          <Stat label="Active listings" value={active.length.toString()} />
          <Stat label="Sales" value={completed.length.toString()} />
          <Stat label="USDC volume" value={Number(formatUsdc(volume)).toLocaleString('en-US', { maximumFractionDigits: 2 })} />
        </div>
      </section>

      {isLoading ? (
        <SkeletonGrid count={3} />
      ) : listings.length === 0 ? (
        <EmptyState
          title="No listings yet"
          body="The marketplace is live on Arc Testnet. Be the first to list a supported asset."
          action={
            <Link to="/create" className="btn btn-primary">
              Create the first listing
            </Link>
          }
        />
      ) : (
        <>
          {featured.length > 0 && (
            <section>
              <h2 className="display mb-4 text-2xl font-semibold">Featured</h2>
              <ListingGrid>
                {featured.map((l) => (
                  <ListingCard key={l.id.toString()} listing={l} />
                ))}
              </ListingGrid>
            </section>
          )}
          {recent.length > 0 && (
            <section>
              <div className="mb-4 flex items-end justify-between">
                <h2 className="display text-2xl font-semibold">Recent listings</h2>
                <Link to="/explore" className="text-sm font-semibold text-[var(--accent)] hover:underline">
                  View all
                </Link>
              </div>
              <ListingGrid>
                {recent.map((l) => (
                  <ListingCard key={l.id.toString()} listing={l} />
                ))}
              </ListingGrid>
            </section>
          )}
        </>
      )}

      <section>
        <h2 className="display mb-4 text-2xl font-semibold">How a sale works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ Icon, title, body }, i) => (
            <div key={title} className="glass rounded-3xl p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl bg-white/7">
                  <Icon className="size-5 text-[var(--accent)]" strokeWidth={1.75} />
                </div>
                <span className="display text-sm font-semibold text-[var(--subtle)]">0{i + 1}</span>
              </div>
              <h3 className="display text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm text-pretty text-[var(--subtle)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <LegalNote />
    </div>
  )
}
