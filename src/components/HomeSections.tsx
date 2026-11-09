import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Reveal } from '@/components/Reveal'
import { ThreeCanvas } from '@/components/three/ThreeCanvas'
import { buildPyramid, landscapeBuilder, type Tower } from '@/components/three/scenes'
import { Logo } from '@/components/Logo'
import { api, type Market } from '@/lib/api'
import { fmtUsdc, fmtLotsAsTokens, fmtPricePerToken } from '@/lib/exchange'
import { timeAgo } from '@/lib/format'

// ------------------------------------------------------------------ hero pyramid

/** The brand pyramid. It turns and pulls apart as the page scrolls past the hero. */
export function HeroPyramid() {
  const reduce = useReducedMotion() ?? false
  const { scrollY } = useScroll()
  const progress = useTransform(scrollY, [0, 900], [0, 1])
  return (
    <div className="relative h-[20rem] sm:h-[26rem] lg:h-[31rem]">
      <ThreeCanvas
        build={buildPyramid}
        progress={progress}
        reducedMotion={reduce}
        label="A striped pyramid, the Avantdex mark, in 3D. It turns as you scroll."
        className="absolute inset-0"
        fallback={<div className="flex h-full items-center justify-center"><Logo className="size-24" /></div>}
      />
    </div>
  )
}

// ------------------------------------------------------------------ liquidity landscape + latest trades

interface RecentTrade {
  id: number
  lots: string
  price: string
  value: string
  status: string
  created_at: string
  market: { slug: string | null; onchain_id: number; name: string | null; symbol: string | null; lot_size: string; token_decimals: number }
}

function LatestTrades() {
  const { data, isLoading } = useQuery({ queryKey: ['recent-trades'], queryFn: () => api.get<{ items: RecentTrade[] }>('/trades/recent?limit=8'), refetchInterval: 15000 })
  const items = data?.items ?? []
  return (
    <div className="glass p-4 sm:p-5">
      <h3 className="display text-lg">Latest trades</h3>
      {isLoading ? (
        <p className="py-6 text-sm text-[var(--muted)]">Loading trades.</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-sm font-medium text-[var(--muted)]">No trade has matched yet. The first one will show here with a link to its market.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--hair)] text-sm">
          {items.map((t) => (
            <li key={t.id}>
              <Link to={`/market/${t.market.slug ?? t.market.onchain_id}`} className="grid grid-cols-[1fr_auto] gap-x-3 py-2.5 hover:bg-[var(--tint)]">
                <span className="truncate font-bold">{t.market.name ?? `Market #${t.market.onchain_id}`}</span>
                <span className="tabular-nums font-semibold">{fmtPricePerToken(t.price, t.market)} USDC</span>
                <span className="text-xs text-[var(--muted)]">{fmtLotsAsTokens(t.lots, t.market)} {t.market.symbol ?? 'tokens'} · {timeAgo(t.created_at)}</span>
                <span className="tabular-nums text-right text-xs text-[var(--muted)]">{fmtUsdc(t.value)} USDC</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Buy-side and sell-side liquidity of every market as towers; the view turns while the section scrolls by. */
export function LiquiditySection({ markets }: { markets: Market[] }) {
  const reduce = useReducedMotion() ?? false
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const towers: Tower[] = useMemo(
    () => markets.slice(0, 8).map((m) => ({ symbol: m.project?.token_symbol ?? `#${m.onchain_id}`, bid: Number(m.stats.bid_depth ?? 0) / 1e6, ask: Number(m.stats.ask_depth ?? 0) / 1e6 })),
    [markets],
  )
  const key = JSON.stringify(towers)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const build = useMemo(() => landscapeBuilder(towers), [key])
  const empty = towers.length === 0 || towers.every((t) => t.bid === 0 && t.ask === 0)
  const tallest = Math.max(...towers.flatMap((t) => [t.bid, t.ask]), 0)
  return (
    <section ref={ref} className="grid gap-6 lg:grid-cols-[1.6fr_1fr]" aria-labelledby="liq-h">
      <div className="space-y-4">
        <div>
          <h2 id="liq-h" className="display text-3xl">Where the liquidity sits</h2>
          <p className="mt-1 max-w-xl text-sm font-medium text-[var(--muted)]">
            One pair of towers per market. Green is USDC waiting to buy, red is USDC worth of tokens offered for sale, all on one scale. Scroll and the view turns.
          </p>
        </div>
        <div className="glass relative h-[22rem] overflow-hidden sm:h-[26rem]">
          {empty ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm font-medium text-[var(--muted)]">No resting orders yet, so there is nothing to draw. Orders placed on any market appear here.</div>
          ) : (
            <ThreeCanvas
              build={build}
              progress={scrollYProgress}
              reducedMotion={reduce}
              label={`Liquidity towers for ${towers.length} markets. ${towers.map((t) => `${t.symbol}: buy ${t.bid.toFixed(2)}, sell ${t.ask.toFixed(2)} USDC`).join('; ')}.`}
              className="absolute inset-0"
              fallback={<p className="p-6 text-sm text-[var(--muted)]">3D view is not available in this browser. The numbers are in the market board above.</p>}
            />
          )}
          {!empty && <p className="pointer-events-none absolute bottom-3 right-4 text-xs font-bold text-[var(--muted)]">Tallest tower: {fmtUsdc(String(Math.round(tallest * 1e6)))} USDC</p>}
        </div>
      </div>
      <Reveal className="self-end">
        <LatestTrades />
      </Reveal>
    </section>
  )
}

// ------------------------------------------------------------------ life of a trade

const STEPS: { n: string; title: string; body: string; note: string }[] = [
  { n: '1', title: 'Place an order', body: 'Buyers lock payment plus a 0.5% fee reserve. Sellers lock collateral equal to the trade value. The money sits in the exchange contract, not with Avantdex.', note: 'Cancel an unfilled order any time, with no fee.' },
  { n: '2', title: 'Match', body: 'A taker names the resting orders to fill. The trade happens at the resting order price and can fill partly. Both sides are now locked in.', note: 'A fill creates a trade with its own deadline.' },
  { n: '3', title: 'The token launches', body: 'After the token launch (TGE) a market manager opens settlement with the token contract address and a delivery deadline.', note: 'Trading stops while settlement is open.' },
  { n: '4', title: 'The seller delivers', body: 'Token and USDC change hands in one transaction, verified by balance. The 0.5% buyer fee and 0.5% seller fee are charged now.', note: 'Fees go in USDC to the fee collector.' },
  { n: '5', title: 'If it goes wrong', body: 'No delivery by the deadline: the buyer claims their payment plus the seller collateral. Market cancelled or abandoned: everyone is refunded in full.', note: 'Defaults and refunds carry no platform fee.' },
]

/** Scroll-driven walk through a trade. On wide screens the section pins and the steps advance as you scroll. */
export function LifecycleSection() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  useEffect(() => scrollYProgress.on('change', (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length))))), [scrollYProgress])
  const bar = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <section ref={ref} className="relative lg:h-[250vh]" aria-labelledby="life-h">
      <div className="lg:sticky lg:top-24 lg:grid lg:grid-cols-[1fr_1.25fr] lg:items-start lg:gap-12">
        <div className="space-y-4 pb-6">
          <h2 id="life-h" className="display text-3xl">The life of a trade</h2>
          <p className="max-w-md text-pretty font-medium text-[var(--muted)]">Everything below is enforced by the contract. The team cannot change the rules of a trade that is already open.</p>
          <div className="hidden lg:block" aria-hidden="true">
            <div className="display text-[9rem] leading-none text-[var(--accent)] [-webkit-text-stroke:2px_var(--ink)]">{STEPS[active].n}</div>
            <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-sm border border-[var(--line)]">
              <motion.div className="h-full origin-left bg-[var(--accent)]" style={{ scaleX: reduce ? (active + 1) / STEPS.length : bar }} />
            </div>
          </div>
        </div>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.n} aria-current={i === active ? 'step' : undefined}>
              <Reveal delay={i * 0.04} y={14}>
                <div className={`glass p-4 transition-colors duration-300 sm:p-5 ${i === active ? 'lg:bg-[var(--accent)] lg:text-[var(--accent-ink)]' : ''}`}>
                  <div className="flex items-baseline gap-3">
                    <span className="display text-2xl">{s.n}</span>
                    <h3 className="display text-xl">{s.title}</h3>
                  </div>
                  <p className="mt-2 text-sm font-medium">{s.body}</p>
                  <p className={`mt-2 text-xs font-bold ${i === active ? 'lg:text-[var(--accent-ink)]' : 'text-[var(--muted)]'}`}>{s.note}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ FAQ

const FAQ: [string, string][] = [
  ['Who holds my money while an order is open?', 'The exchange contract. Avantdex admins have no function that moves or redirects escrowed funds. You can cancel an unfilled order and get everything back.'],
  ['What does a seller risk?', 'Collateral equal to the trade value. If the token is not delivered before the deadline, the buyer claims the payment plus that collateral. A seller who expects the token price to jump should think twice.'],
  ['When are fees charged?', 'Only when a trade settles: 0.5% from the buyer and 0.5% from the seller, in USDC. Cancelling, listing a project, requesting a listing, a default or a refund costs no platform fee.'],
  ['What if the token never launches?', 'A manager can cancel the market and every trade becomes refundable, with no fee. If a market is never settled, anyone can refund its trades 90 days after trading ended.'],
  ['What are lots and ticks?', 'A lot is the smallest quantity you can trade and a tick is the smallest price step. Both are fixed when the market is created and shown on the market page under Rules.'],
  ['Does a verified badge mean a project is safe?', 'No. A badge describes one specific check, such as that the contract address was confirmed through an official channel. It says nothing about safety, profit or delivery.'],
  ['Is this audited, and is it real money?', 'No. Avantdex runs on Arc Testnet, which uses test USDC. The contract has not been audited, so do not use it with value you cannot lose.'],
]

export function FaqSection() {
  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_1.6fr]" aria-labelledby="faq-h">
      <Reveal>
        <h2 id="faq-h" className="display text-3xl">Questions traders ask</h2>
        <p className="mt-2 max-w-sm text-sm font-medium text-[var(--muted)]">Short answers. The full rules are on the Trading and settlement rules page.</p>
        <Link to="/legal/rules" className="mt-3 inline-block text-sm font-bold underline decoration-2 underline-offset-4 hover:text-[var(--accent-text)]">Read the rules</Link>
      </Reveal>
      <Reveal delay={0.08}>
        <div className="glass divide-y divide-[var(--hair)]">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-1 font-bold outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--focus)]">
                {q}
                <span className="display text-xl transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="pb-1 pt-2 text-sm font-medium text-[var(--muted)]">{a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
