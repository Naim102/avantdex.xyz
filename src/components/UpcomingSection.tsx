import { useQuery } from '@tanstack/react-query'
import { BadgeRow, Chip } from '@/components/ui'
import { ProjectLogo } from '@/components/MarketCard'
import { api, type ProjectPublic } from '@/lib/api'
import { fmtDay } from '@/lib/format'

type Upcoming = ProjectPublic & { status: string }

export function useUpcoming() {
  return useQuery({ queryKey: ['upcoming-projects'], queryFn: () => api.get<{ items: Upcoming[] }>('/projects/upcoming'), refetchInterval: 30000 })
}

function UpcomingCard({ p }: { p: Upcoming }) {
  return (
    <article className="glass flex flex-col gap-3 rounded-3xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ProjectLogo name={p.name} url={p.logo_url} />
        <div className="min-w-0 flex-1">
          <div className="display truncate text-xl">{p.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="mono text-sm font-bold">{p.token_symbol}</span>
            <Chip tone="accent">{p.status === 'Market Setup' ? 'Market opening' : 'Approved'}</Chip>
          </div>
        </div>
      </div>
      <BadgeRow badges={p.badges} compact />
      {p.description && <p className="line-clamp-3 text-pretty text-sm font-medium text-[var(--muted)]">{p.description}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-[var(--hair)] pt-3 text-sm">
        <span className="font-bold text-[var(--subtle)]">TGE {fmtDay(p.tge_date)}</span>
        <span className="font-bold text-[var(--muted)]">Trading not open yet</span>
      </div>
    </article>
  )
}

/** Approved projects whose market has not been activated yet. Nothing here can be traded. */
export function UpcomingSection({ limit, title = 'Coming soon' }: { limit?: number; title?: string }) {
  const { data } = useUpcoming()
  const items = (data?.items ?? []).slice(0, limit)
  if (items.length === 0) return null
  return (
    <section className="space-y-4" aria-label={title}>
      <div>
        <h2 className="display text-2xl uppercase sm:text-3xl">{title}</h2>
        <p className="mt-1 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">Approved projects, markets open soon</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <UpcomingCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  )
}
