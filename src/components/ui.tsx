import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Info, Loader2, ShieldCheck, TriangleAlert, Check, X } from 'lucide-react'
import { BADGE_INFO, txUrl, shortAddr } from '@/lib/format'
import type { Badge } from '@/lib/api'
import type { TxState } from '@/hooks/useTx'
import { useAuth } from '@/hooks/useApp'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <Loader2 className="size-4 animate-spin" />
      {label && <span>{label}</span>}
    </span>
  )
}

type Tone = 'info' | 'ok' | 'warn' | 'error'
const TONES: Record<Tone, { c: string; bg: string }> = {
  info: { c: 'var(--ink)', bg: 'var(--surface)' },
  ok: { c: 'var(--ink)', bg: 'var(--success-bg)' },
  warn: { c: 'var(--ink)', bg: 'var(--warn-bg)' },
  error: { c: 'var(--ink)', bg: 'var(--danger-bg)' },
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const t = TONES[tone]
  const Icon = tone === 'error' || tone === 'warn' ? TriangleAlert : tone === 'ok' ? Check : Info
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className="flex gap-2.5 rounded-2xl border-2 border-[var(--line)] px-3.5 py-3 text-sm font-medium" style={{ color: t.c, background: t.bg }}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' }) {
  const bg = { neutral: 'var(--surface)', ok: 'var(--success-bg)', warn: 'var(--warn-bg)', bad: 'var(--danger-bg)', accent: 'var(--accent)' }[tone]
  const color = tone === 'accent' ? 'var(--accent-ink)' : 'var(--ink)'
  return (
    <span className="chip" style={{ color, background: bg }}>
      {children}
    </span>
  )
}

export function StatusChip({ status }: { status: string }) {
  const tone = ['Live', 'Settled', 'Completed', 'Filled', 'Approved'].includes(status)
    ? 'ok'
    : ['Open', 'Partially Filled', 'Settlement open', 'SettlementOpen', 'Submitted', 'Under Review', 'Verification', 'Market Setup', 'Setup', 'In Review'].includes(status)
      ? 'warn'
      : ['Defaulted', 'Rejected', 'Cancelled', 'Delisted', 'Suspended'].includes(status)
        ? 'bad'
        : 'neutral'
  const label = status === 'SettlementOpen' ? 'Settlement open' : status
  return (
    <Chip tone={tone}>
      <span className="size-2 rounded-full border border-[var(--line)] bg-current" style={{ color: tone === 'ok' ? 'var(--accent)' : tone === 'warn' ? '#FFC93C' : tone === 'bad' ? '#FF5A4F' : 'var(--subtle)' }} />
      {label}
    </Chip>
  )
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`glass animate-pulse rounded-3xl ${className}`} aria-hidden="true" style={{ background: 'var(--bg-2)' }} />
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="glass rounded-3xl p-8 text-center">
      <h3 className="display text-xl">{title}</h3>
      {body && <p className="mx-auto mt-2 max-w-md text-pretty text-sm font-medium text-[var(--muted)]">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-balance break-words text-[1.75rem] leading-none sm:text-5xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-pretty text-sm font-medium text-[var(--muted)] sm:text-base">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border-2 border-[var(--line)] bg-[var(--surface)] p-1.5" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={value === t}
          onClick={() => onChange(t)}
          className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-bold transition-colors ${value === t ? 'bg-[var(--ink)] text-[var(--bg)]' : 'text-[var(--ink)] hover:bg-[var(--tint-2)]'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(38,38,39,0.65)] p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass w-full max-w-lg rounded-3xl p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg border-2 border-[var(--line)] p-1 hover:bg-[var(--tint-2)]">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs font-medium text-[var(--muted)]">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs font-bold text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function TxPanel({ tx }: { tx: TxState }) {
  if (tx.phase === 'idle' && !tx.error && tx.steps.length === 0) return null
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      {tx.steps.map((s) => (
        <div key={s.hash} className="flex items-center justify-between gap-2 text-[var(--subtle)]">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3.5 text-[var(--success)]" /> {s.label}
          </span>
          <a href={txUrl(s.hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent-text)] hover:underline">
            {shortAddr(s.hash)} <ExternalLink className="size-3" />
          </a>
        </div>
      ))}
      {tx.phase === 'wallet' && <Notice>Confirm “{tx.label}” in your wallet…</Notice>}
      {tx.phase === 'confirming' && (
        <Notice>
          <Spinner label={`Waiting for “${tx.label}” to be confirmed…`} />
        </Notice>
      )}
      {tx.phase === 'error' && <Notice tone="error">{tx.error}</Notice>}
    </div>
  )
}

/** Verification badges with an explanation of what each one does and does not guarantee. */
export function BadgeRow({ badges, compact = false }: { badges: Badge[]; compact?: boolean }) {
  if (!badges.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => {
        const info = BADGE_INFO[b.badge]
        return (
          <span key={b.badge} className="chip group relative cursor-help" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }} tabIndex={0} title={`${info?.means} ${info?.not}`}>
            <ShieldCheck className="size-3" />
            {compact ? info?.label.split(' ')[0] : info?.label}
          </span>
        )
      })}
    </div>
  )
}

export function BadgeLegend() {
  return (
    <div className="space-y-3 text-sm">
      {Object.values(BADGE_INFO).map((i) => (
        <div key={i.label} className="glass-inner rounded-2xl p-3">
          <div className="flex items-center gap-1.5 font-bold text-[var(--accent-text)]">
            <ShieldCheck className="size-4" /> {i.label}
          </div>
          <p className="mt-1 text-[var(--ink-2)]">{i.means}</p>
          <p className="mt-1 text-[var(--subtle)]">{i.not}</p>
        </div>
      ))}
      <Notice tone="warn">A verification badge never implies investment safety, profitability or guaranteed token delivery.</Notice>
    </div>
  )
}

/** Wraps content that needs a connected wallet and, optionally, a signed-in session. */
export function WalletGate({ children, needSignIn = false, what = 'continue' }: { children: ReactNode; needSignIn?: boolean; what?: string }) {
  const { isConnected } = useAccount()
  const auth = useAuth()
  if (!isConnected) {
    return (
      <EmptyState
        title="Connect your wallet"
        body={`Connect a wallet on Arc Testnet to ${what}.`}
        action={
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button className="btn btn-primary" onClick={show}>
                Connect Wallet
              </button>
            )}
          </ConnectKitButton.Custom>
        }
      />
    )
  }
  if (needSignIn && !auth.signedIn) {
    return (
      <EmptyState
        title="Sign in with your wallet"
        body="Sign a message to prove you control this wallet. Signing does not authorize any transaction or token approval."
        action={
          <div className="space-y-3">
            <button className="btn btn-primary" disabled={auth.signing} onClick={() => void auth.signIn()}>
              {auth.signing ? <Spinner label="Check your wallet…" /> : 'Sign in'}
            </button>
            {auth.error && <Notice tone="error">{auth.error}</Notice>}
          </div>
        }
      />
    )
  }
  return <>{children}</>
}

export function useTicker(ms = 1000): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return n
}

export function DataTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-[var(--subtle)]">{empty ?? 'Nothing here yet.'}</p>
  return (
    <>
      {/* phones: one compact card per row (label on the left, value on the right) */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="glass-inner space-y-1.5 rounded-2xl p-3 text-sm">
            {r.map((c, j) =>
              head[j] ? (
                <div key={j} className="flex items-start justify-between gap-3">
                  <span className="shrink-0 pt-0.5 text-[11px] font-bold text-[var(--muted)]">{head[j]}</span>
                  <span className="min-w-0 break-words text-right font-medium">{c}</span>
                </div>
              ) : (
                <div key={j} className="flex flex-wrap justify-end gap-2 pt-1 empty:hidden">
                  {c}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--line)] text-xs text-[var(--muted)]">
              {head.map((h, k) => (
                <th key={`${h}${k}`} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hair)]">
            {rows.map((r, i) => (
              <tr key={i} className="row-hover align-top">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
