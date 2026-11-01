import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ASSET_TYPES } from '@/lib/allocx'
import { useListings } from '@/hooks/useMarket'
import { EmptyState, ListingCard, ListingGrid, Notice, SkeletonGrid } from '@/components/ui'

type StatusFilter = 'active' | 'all'
type Sort = 'newest' | 'low' | 'high'

export default function Explore() {
  const { listings, isLoading, isError } = useListings()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<number | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [sort, setSort] = useState<Sort>('newest')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = listings.filter((l) => {
      if (status === 'active' && l.status !== 1) return false
      if (type !== 'all' && l.assetType !== type) return false
      if (!q) return true
      return [l.name, l.description, l.seller, l.assetContract].some((v) => v.toLowerCase().includes(q))
    })
    if (sort === 'low') out.sort((a, b) => (a.price > b.price ? 1 : a.price < b.price ? -1 : 0))
    if (sort === 'high') out.sort((a, b) => (b.price > a.price ? 1 : b.price < a.price ? -1 : 0))
    return out
  }, [listings, query, type, status, sort])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-4xl font-bold">Explore</h1>
        <p className="mt-1 text-[var(--subtle)]">Every listing is read live from the AllocX contract on Arc Testnet.</p>
      </div>

      <div className="glass space-y-4 rounded-3xl p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--subtle)]" />
            <input
              className="field !pl-10"
              placeholder="Search by name, description, seller or contract"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search listings"
            />
          </div>
          <select className="field md:w-44" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
          </select>
          <select className="field md:w-40" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
            <option value="active">Available</option>
            <option value="all">All statuses</option>
          </select>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {[{ id: 'all' as const, short: 'All types' }, ...ASSET_TYPES].map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`chip !min-h-9 shrink-0 !px-3.5 !text-xs transition-colors ${type === t.id ? '!border-[var(--accent)] !bg-[rgba(172,198,233,0.14)] !text-[var(--accent)]' : 'hover:border-[var(--border-strong)]'}`}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>

      {isError && <Notice tone="error">Could not read listings from Arc Testnet. Check your connection and retry.</Notice>}

      {isLoading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={listings.length === 0 ? 'No listings yet' : 'No matching listings'}
          body={listings.length === 0 ? 'Nothing has been listed on AllocX yet.' : 'Try a different search or clear the filters.'}
          action={
            <Link to="/create" className="btn btn-primary">
              List Asset
            </Link>
          }
        />
      ) : (
        <>
          <div className="text-sm text-[var(--subtle)] tabular-nums">{filtered.length} listing{filtered.length === 1 ? '' : 's'}</div>
          <ListingGrid>
            {filtered.map((l) => (
              <ListingCard key={l.id.toString()} listing={l} />
            ))}
          </ListingGrid>
        </>
      )}
    </div>
  )
}
