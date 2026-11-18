import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, CalendarDays, Check, ChevronDown, Clock, Flag } from 'lucide-react'
import { Reveal } from '@/components/Reveal'
import { ROADMAP, type RoadmapStatus, type RoadmapStep } from '@/lib/roadmap'

const STATUS: Record<RoadmapStatus, { label: string; Icon: typeof Check }> = {
  completed: { label: 'Completed', Icon: Check },
  upcoming: { label: 'Upcoming', Icon: Clock },
  vision: { label: 'Long-term', Icon: Flag },
}

/**
 * One step. On phones the steps form a slim timeline (a dot and a rail on the left, the card beside it); from the
 * large breakpoint they are boxes in a grid. The date sits under the box. Details are folded until asked for.
 */
function Step({ step, open, onToggle, index }: { step: RoadmapStep; open: boolean; onToggle: () => void; index: number }) {
  const s = STATUS[step.status]
  const done = step.status === 'completed'
  const last = index === ROADMAP.length - 1
  return (
    <li className="relative flex min-w-0 flex-col pl-9 lg:pl-0">
      {/* phone timeline: dot and rail */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-3 grid size-6 place-items-center rounded-full border text-[10px] font-bold lg:hidden ${done ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)]'}`}
      >
        {done ? <Check className="size-3.5" /> : step.n}
      </span>
      {!last && <span aria-hidden="true" className={`absolute bottom-[-0.9rem] left-[11px] top-9 w-px lg:hidden ${done ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]'}`} />}

      <div className="relative flex flex-1 flex-col">
        <article
          className={`flex flex-1 flex-col rounded-xl border bg-[var(--surface)] px-3 py-2.5 shadow-[var(--shadow-sm)] lg:p-3 ${done ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
          aria-labelledby={`rm-${step.n}`}
        >
          <div className="flex items-start gap-2.5 lg:flex-wrap lg:gap-y-2">
            <span className={`display hidden size-8 shrink-0 place-items-center rounded-lg text-sm lg:order-1 lg:grid ${done ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--tint-2)] text-[var(--ink)]'}`} aria-hidden="true">
              {step.n}
            </span>
            <h3 id={`rm-${step.n}`} className="display min-w-0 flex-1 text-balance text-[0.9rem] leading-snug lg:order-3 lg:basis-full lg:text-sm">
              {step.title}
            </h3>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold lg:order-2 lg:ml-auto ${done ? 'border-[var(--accent)] bg-[var(--success-bg)] text-[var(--ink)]' : 'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)]'}`}
            >
              <s.Icon className="size-3" aria-hidden="true" />
              {s.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`rm-body-${step.n}`}
            className="mt-2 flex items-center gap-1 self-start text-xs font-semibold text-[var(--accent-text)]"
          >
            {open ? 'Hide details' : 'Details'}
            <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {open && (
            <div id={`rm-body-${step.n}`} className="mt-2 border-t border-[var(--hair)] pt-2">
              <ul className="list-disc space-y-1 pl-4 text-xs font-medium text-[var(--muted)] marker:text-[var(--accent-text)]">
                {step.points.map((p) => (
                  <li key={p} className="text-pretty">
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-2 rounded-lg bg-[var(--tint)] px-2.5 py-2 text-xs font-medium text-pretty">
                <b className="font-bold">Milestone:</b> {step.milestone}
              </p>
            </div>
          )}
        </article>
        {/* arrow to the next box in the same row (wide screens) */}
        {index % 4 !== 3 && index < 6 && (
          <span className="pointer-events-none absolute -right-[2.1rem] top-1/2 z-10 hidden size-7 -translate-y-1/2 place-items-center rounded-full border border-[var(--accent)] bg-[var(--bg)] text-[var(--accent-text)] lg:grid" aria-hidden="true">
            <ArrowRight className="size-3.5" />
          </span>
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold lg:mt-2">
        <CalendarDays className={`size-3.5 shrink-0 ${done ? 'text-[var(--accent-text)]' : 'text-[var(--muted)]'}`} aria-hidden="true" />
        <span>
          {step.dateLabel}: {step.date}
        </span>
      </p>
    </li>
  )
}

/** The line that carries the eye from the end of the first row to the start of the second (wide screens). */
function WrapConnector() {
  return (
    <li aria-hidden="true" className="relative hidden h-12 lg:col-span-4 lg:block">
      <span className="absolute inset-y-0 left-[calc((100%-7.5rem)/8)] right-[calc((100%-7.5rem)/8)]">
        <span className="absolute right-0 top-0 h-1/2 w-0.5 bg-[var(--accent)]" />
        <span className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-px bg-[var(--accent)]" />
        <span className="absolute bottom-0 left-0 h-1/2 w-0.5 bg-[var(--accent)]" />
        <span className="absolute -bottom-1 left-0 -translate-x-1/2 text-[var(--accent-text)]">
          <ArrowDown className="size-4" />
        </span>
      </span>
    </li>
  )
}

export function RoadmapDiagram({ allOpen = false }: { allOpen?: boolean }) {
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const isOpen = (n: string) => allOpen || opened.has(n)
  const toggle = (n: string) =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  return (
    <ol className="grid list-none grid-cols-1 gap-x-10 gap-y-3.5 p-0 lg:grid-cols-4 lg:gap-y-0" aria-label="Avantdex roadmap">
      {ROADMAP.map((step, i) => (
        <RoadmapItem key={step.n} step={step} index={i} open={isOpen(step.n)} onToggle={() => toggle(step.n)} />
      ))}
    </ol>
  )
}

function RoadmapItem({ step, index, open, onToggle }: { step: RoadmapStep; index: number; open: boolean; onToggle: () => void }) {
  return (
    <>
      <Step step={step} open={open} onToggle={onToggle} index={index} />
      {index === 3 && <WrapConnector />}
    </>
  )
}

/** Roadmap page: the same diagram with an "Expand all" switch. */
export function RoadmapWithControls() {
  const [all, setAll] = useState(false)
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn btn-ghost !min-h-9 !px-3 text-xs" aria-pressed={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <RoadmapDiagram allOpen={all} key={String(all)} />
    </div>
  )
}

/** Home page block, placed above the footer. */
export function RoadmapSection() {
  return (
    <section className="space-y-4" aria-labelledby="roadmap-h">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <h2 id="roadmap-h" className="display text-2xl sm:text-3xl">Roadmap</h2>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">Two steps done on testnet. The independent audit comes before mainnet.</p>
          </div>
          <Link to="/roadmap" className="link-line text-sm font-semibold">Full roadmap</Link>
        </div>
      </Reveal>
      <Reveal>
        <RoadmapDiagram />
      </Reveal>
    </section>
  )
}
