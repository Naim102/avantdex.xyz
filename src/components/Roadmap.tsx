import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, CalendarDays, Check, ChevronDown, Clock, Flag } from 'lucide-react'
import { Chip } from '@/components/ui'
import { Reveal } from '@/components/Reveal'
import { ROADMAP, type RoadmapStatus, type RoadmapStep } from '@/lib/roadmap'

const STATUS: Record<RoadmapStatus, { label: string; tone: 'ok' | 'neutral'; Icon: typeof Check }> = {
  completed: { label: 'Completed', tone: 'ok', Icon: Check },
  upcoming: { label: 'Upcoming', tone: 'neutral', Icon: Clock },
  vision: { label: 'Long-term vision', tone: 'neutral', Icon: Flag },
}

/** One box: number, status, the topic, the points behind it. The date sits under the box. */
function Step({ step, open, index }: { step: RoadmapStep; open: boolean; index: number }) {
  const s = STATUS[step.status]
  const done = step.status === 'completed'
  return (
    <li className="flex min-w-0 flex-col">
      <div className="relative flex flex-1 flex-col">
        <article
          className={`flex flex-1 flex-col rounded-2xl border bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] ${done ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
          aria-labelledby={`rm-${step.n}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`display grid size-10 place-items-center rounded-xl text-lg ${done ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--tint-2)] text-[var(--ink)]'}`}>{step.n}</span>
            <Chip tone={s.tone}>
              <s.Icon className="size-3.5" aria-hidden="true" />
              {s.label}
            </Chip>
          </div>
          <h3 id={`rm-${step.n}`} className="display mt-3 text-balance text-base leading-snug">
            {step.title}
          </h3>
          <details className="group mt-3 border-t border-[var(--hair)] pt-3" open={open}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-[var(--accent-text)] [&::-webkit-details-marker]:hidden">
              What is included
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm font-medium text-[var(--muted)] marker:text-[var(--accent-text)]">
              {step.points.map((p) => (
                <li key={p} className="text-pretty">
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-xl bg-[var(--tint)] p-3 text-sm font-medium text-pretty">
              <b className="font-bold">Milestone:</b> {step.milestone}
            </p>
          </details>
        </article>
        {/* arrow to the next box in the same row (wide screens) */}
        {index % 4 !== 3 && index < 6 && (
          <span className="pointer-events-none absolute -right-[2.2rem] top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--accent)] bg-[var(--bg)] text-[var(--accent-text)] lg:grid" aria-hidden="true">
            <ArrowRight className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm font-bold">
        <CalendarDays className={`size-4 shrink-0 ${done ? 'text-[var(--accent-text)]' : 'text-[var(--muted)]'}`} aria-hidden="true" />
        <span>
          {step.dateLabel}: {step.date}
        </span>
      </p>
      {/* arrow to the next box when the boxes are stacked */}
      {index < ROADMAP.length - 1 && (
        <span className="mx-auto mt-3 grid h-8 w-8 place-items-center rounded-full border border-[var(--accent)] text-[var(--accent-text)] lg:hidden" aria-hidden="true">
          <ArrowDown className="size-4" />
        </span>
      )}
    </li>
  )
}

/** The line that carries the eye from the end of the first row to the start of the second. */
function WrapConnector() {
  return (
    <li aria-hidden="true" className="relative hidden h-16 lg:col-span-4 lg:block">
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

export function RoadmapDiagram({ open = false }: { open?: boolean }) {
  return (
    <ol className="grid list-none grid-cols-1 gap-x-10 gap-y-0 p-0 lg:grid-cols-4 lg:gap-y-0" aria-label="Avantdex roadmap">
      {ROADMAP.map((step, i) => (
        <RoadmapItem key={step.n} step={step} index={i} open={open} />
      ))}
    </ol>
  )
}

function RoadmapItem({ step, index, open }: { step: RoadmapStep; index: number; open: boolean }) {
  return (
    <>
      <Step step={step} open={open} index={index} />
      {index === 3 && <WrapConnector />}
    </>
  )
}

/** Home page block, placed above the footer. */
export function RoadmapSection() {
  return (
    <section className="space-y-6" aria-labelledby="roadmap-h">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="roadmap-h" className="display text-3xl">Roadmap</h2>
            <p className="mt-1 max-w-2xl text-sm font-medium text-[var(--muted)]">From foundation to ecosystem expansion. Two steps are done on testnet; the independent audit comes before anything runs on mainnet.</p>
          </div>
          <Link to="/roadmap" className="link-line text-sm font-semibold">Open the full roadmap</Link>
        </div>
      </Reveal>
      <Reveal>
        <RoadmapDiagram />
      </Reveal>
    </section>
  )
}
