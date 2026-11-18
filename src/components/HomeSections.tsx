import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Reveal } from '@/components/Reveal'
import { ThreeCanvas } from '@/components/three/ThreeCanvas'
import { buildPyramid } from '@/components/three/scenes'
import { CountUp } from '@/components/CountUp'
import { Logo } from '@/components/Logo'
import { ProjectLogo } from '@/components/MarketParts'
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
    <motion.div
      className="relative h-[20rem] sm:h-[26rem] lg:h-[31rem]"
      animate={reduce ? undefined : { y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <ThreeCanvas
        build={buildPyramid}
        progress={progress}
        reducedMotion={reduce}
        label="A striped pyramid, the Avantdex mark, in 3D. It turns as you scroll."
        className="absolute inset-0"
        fallback={<div className="flex h-full items-center justify-center"><Logo className="size-24" /></div>}
      />
    </motion.div>
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

/** Resting liquidity per market: how deep each book is (bar length) and how it splits between buyers and sellers (colors). */
function LiquidityChart({ markets }: { markets: Market[] }) {
  const reduce = useReducedMotion()
  const rows = markets
    .map((m) => {
      const bid = Number(m.stats.bid_depth ?? 0) / 1e6
      const ask = Number(m.stats.ask_depth ?? 0) / 1e6
      return { m, bid, ask, total: bid + ask }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
  if (rows.length === 0) {
    return <div className="glass flex h-60 items-center justify-center p-6 text-center text-sm font-medium text-[var(--muted)]">No resting orders yet, so there is nothing to draw. Orders placed on any market appear here.</div>
  }
  const maxTotal = Math.max(...rows.map((r) => r.total))
  const bidTotal = rows.reduce((n, r) => n + r.bid, 0)
  const askTotal = rows.reduce((n, r) => n + r.ask, 0)
  const buyShare = Math.round((bidTotal / (bidTotal + askTotal)) * 100)
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const grow = (pct: number) => ({
    initial: reduce ? false : { width: 0 },
    whileInView: { width: `${pct}%` },
    viewport: { once: true, margin: '0px 0px -10% 0px' } as const,
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const },
    style: reduce ? { width: `${pct}%` } : undefined,
  })
  return (
    <div className="glass lift overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-3">
        <div className="bg-[var(--surface)] px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]"><span className="size-2 rounded-full bg-[var(--success)]" aria-hidden="true" />Buy side</div>
          <div className="mt-1 text-2xl font-semibold"><CountUp className="tabular-nums" value={bidTotal} format={money} /> <span className="text-xs font-medium text-[var(--muted)]">USDC</span></div>
        </div>
        <div className="bg-[var(--surface)] px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]"><span className="size-2 rounded-full bg-[var(--danger)]" aria-hidden="true" />Sell side</div>
          <div className="mt-1 text-2xl font-semibold"><CountUp className="tabular-nums" value={askTotal} format={money} /> <span className="text-xs font-medium text-[var(--muted)]">USDC</span></div>
        </div>
        <div className="col-span-2 bg-[var(--surface)] px-5 py-4 sm:col-span-1">
          <div className="flex items-baseline justify-between text-xs font-semibold text-[var(--muted)]">
            <span>Balance</span>
            <span className="tabular-nums text-[var(--ink)]">{buyShare}% buy / {100 - buyShare}% sell</span>
          </div>
          <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" role="img" aria-label={`${buyShare}% of resting liquidity is on the buy side`}>
            <motion.div className="h-full bg-[var(--success)]" {...grow(buyShare)} />
            <div className="h-full flex-1 bg-[var(--danger)]" />
          </div>
        </div>
      </div>

      <div className="hidden gap-5 border-t border-[var(--line)] px-5 py-2.5 text-xs font-semibold text-[var(--muted)] md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7.5rem]">
        <span>Market</span>
        <span>Depth, buy and sell</span>
        <span className="text-right">Total depth</span>
      </div>
      <ul className="divide-y divide-[var(--hair)] border-t border-[var(--line)] md:border-t-0">
        {rows.map(({ m, bid, ask, total }) => {
          const share = (bid / total) * 100
          const width = (total / maxTotal) * 100
          return (
            <li key={m.id}>
              <Link
                to={`/market/${m.slug ?? m.onchain_id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 px-5 py-3.5 transition-colors hover:bg-[var(--tint)] md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7.5rem]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ProjectLogo name={m.project?.name ?? `M${m.onchain_id}`} url={m.project?.logo_url} size="size-9" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{m.project?.name ?? `Market #${m.onchain_id}`}</span>
                    <span className="mono text-xs text-[var(--muted)]">{m.project?.token_symbol}</span>
                  </span>
                </span>
                <span className="tabular-nums text-right text-sm font-semibold md:order-3">
                  {money(total)}
                  <span className="block text-xs font-medium text-[var(--muted)]">
                    <span className="text-[var(--success)]">{money(bid)}</span> / <span className="text-[var(--danger)]">{money(ask)}</span>
                  </span>
                </span>
                <span className="col-span-2 md:order-2 md:col-span-1">
                  <span className="block h-3 w-full rounded-[6px] bg-[var(--tint)]" role="img" aria-label={`${share.toFixed(0)}% buy side, ${(100 - share).toFixed(0)}% sell side, ${money(total)} USDC in total`}>
                    <motion.span className="flex h-full gap-0.5 overflow-hidden rounded-[6px]" {...grow(width)}>
                      <span className="h-full bg-[var(--success)]" style={{ width: `${share}%` }} />
                      <span className="h-full flex-1 bg-[var(--danger)]" />
                    </motion.span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">Bar length compares markets on one scale (the deepest is {money(maxTotal)} USDC). Colors show how each book splits between buyers and sellers, in USDC.</p>
    </div>
  )
}

/** Where the resting liquidity sits, next to the latest matched trades. */
export function LiquiditySection({ markets }: { markets: Market[] }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]" aria-labelledby="liq-h">
      <div className="space-y-4">
        <div>
          <h2 id="liq-h" className="display text-3xl">Where the liquidity sits</h2>
          <p className="mt-1 max-w-xl text-sm font-medium text-[var(--muted)]">
            Resting orders on each side of every market. Funds behind these orders are already locked in escrow.
          </p>
        </div>
        <Reveal>
          <LiquidityChart markets={markets} />
        </Reveal>
      </div>
      <Reveal className="self-start">
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
  ['Which tokens can be listed?', 'Only tokens that are, or will be, deployed on Arc. Trades are settled on Arc in USDC, and the seller delivers the token on Arc, so a token that launches on another chain cannot be settled here.'],
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
