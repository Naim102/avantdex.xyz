import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MarketCard } from '@/components/MarketCard'
import { EmptyState, PageTitle, Skeleton, Tabs } from '@/components/ui'
import { api, qs, type Market } from '@/lib/api'
import { useConfig } from '@/hooks/useApp'

const TABS = ['All Markets', 'Trending', 'New Listings', 'Upcoming TGE', 'Closing Soon', 'Settled'] as const
const TAB_KEY: Record<(typeof TABS)[number], string> = {
  'All Markets': 'all',
  Trending: 'trending',
  'New Listings': 'new',
  'Upcoming TGE': 'upcoming_tge',
  'Closing Soon': 'closing_soon',
  Settled: 'settled',
}
const STATUSES = ['Live', 'Suspended', 'SettlementOpen', 'Completed', 'Cancelled']

export default function Explore() {
  const [sp, setSp] = useSearchParams()
  const { data: cfg } = useConfig()
  const tab = TABS.find((t) => TAB_KEY[t] === sp.get('tab')) ?? 'All Markets'
  const q = sp.get('q') ?? ''
  const category = sp.get('category') ?? ''
  const status = sp.get('status') ?? ''
  const sort = sp.get('sort') ?? ''
  const badge = sp.get('badge') ?? ''

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['markets', tab, q, category, status, sort, badge],
    queryFn: () => api.get<{ items: Market[] }>(`/markets${qs({ tab: TAB_KEY[tab], q, category, status, sort, badge })}`),
    refetchInterval: 15000,
  })
  const items = data?.items ?? []
  const filtered = !!(q || category || status || sort || badge)

  return (
    <div className="space-y-6">
      <PageTitle title="Explore Markets" subtitle="Every market is read from the Avantdex exchange contract on Arc Testnet. Fields without data show a dash, never an invented number." />
      <Tabs label="Market views" tabs={TABS} value={tab} onChange={(t) => set('tab', TAB_KEY[t] === 'all' ? '' : TAB_KEY[t])} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="field lg:col-span-2" placeholder="Search name or symbol" aria-label="Search" value={q} onChange={(e) => set('q', e.target.value)} maxLength={60} />
        <select className="field" aria-label="Category" value={category} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {(cfg?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="field" aria-label="Market status" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'SettlementOpen' ? 'Settlement open' : s}
            </option>
          ))}
        </select>
        <select className="field" aria-label="Sort" value={sort} onChange={(e) => set('sort', e.target.value)}>
          <option value="">Default sort</option>
          <option value="volume">Volume</option>
          <option value="newest">Newest</option>
          <option value="tge">TGE date</option>
          <option value="best_bid">Best bid</option>
          <option value="best_ask">Best ask</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--subtle)]">Badge:</span>
        {[['', 'Any'], ['verified_project', 'Verified Project'], ['contract_verified', 'Contract Verified'], ['allocation_verified', 'Allocation Verified']].map(([v, l]) => (
          <button key={v} onClick={() => set('badge', v)} className={`chip ${badge === v ? '!border-[var(--accent)] !text-[var(--accent)]' : ''}`} aria-pressed={badge === v}>
            {l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState title="Markets are unavailable" body="The Avantdex API could not be reached." />
      ) : items.length === 0 ? (
        <EmptyState title={filtered || tab !== 'All Markets' ? 'No matching markets' : 'No markets yet'} body={filtered || tab !== 'All Markets' ? 'Try a different tab or clear the filters.' : 'Markets appear here after a project is approved, verified and activated.'} />
      ) : (
        <>
          <p className="text-sm text-[var(--subtle)]" aria-live="polite">
            {items.length} market{items.length === 1 ? '' : 's'}
          </p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
