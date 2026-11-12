import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { ThemePicker } from '@/components/ThemePicker'
import { XLink } from '@/components/XIcon'
import { useConfig } from '@/hooks/useApp'
import { addrUrl, shortAddr } from '@/lib/format'

const TRADE: [string, string][] = [
  ['/explore', 'Market board'],
  ['/portfolio', 'Portfolio'],
  ['/list', 'Create listing'],
  ['/list/submit', 'Submit a project'],
  ['/list/request', 'Request a listing'],
]
const LEGAL: [string, string][] = [
  ['terms', 'Terms'],
  ['privacy', 'Privacy'],
  ['risk', 'Risk disclosure'],
  ['cookies', 'Cookies'],
  ['listing-policy', 'Listing policy'],
  ['rules', 'Trading and settlement rules'],
]

const link = 'underline-offset-4 hover:text-[var(--accent-text)] hover:underline'

export function Footer() {
  const { data: cfg } = useConfig()
  return (
    <footer className="mt-12 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-3 py-10 sm:px-4 lg:grid-cols-[1.3fr_1fr_1fr_1.2fr]">
        <div className="space-y-4">
          <Link to="/" className="inline-flex items-center gap-2.5" aria-label="Avantdex home">
            <Logo className="size-9" />
            <span className="display text-lg uppercase">Avantdex</span>
          </Link>
          <p className="max-w-xs text-sm font-medium text-[var(--muted)]">Order-book pre-market trading on Arc, settled in USDC with escrow.</p>
          <div className="flex flex-wrap items-center gap-2">
            <XLink label className="btn btn-ghost !min-h-10 !gap-2" />
            <ThemePicker up />
          </div>
        </div>

        <nav aria-label="Trade" className="space-y-3">
          <h2 className="text-sm font-bold">Trade</h2>
          <ul className="space-y-2 text-sm font-medium">
            {TRADE.map(([to, label]) => (
              <li key={to}>
                <Link to={to} className={link}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal" className="space-y-3">
          <h2 className="text-sm font-bold">Legal</h2>
          <ul className="space-y-2 text-sm font-medium">
            {LEGAL.map(([k, label]) => (
              <li key={k}>
                <Link to={`/legal/${k}`} className={link}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-3">
          <h2 className="text-sm font-bold">On-chain facts</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs font-bold text-[var(--muted)]">Network</dt>
              <dd className="font-medium">{cfg?.network ?? 'Arc Testnet'}</dd>
            </div>
            {cfg && (
              <>
                <div>
                  <dt className="text-xs font-bold text-[var(--muted)]">Exchange contract</dt>
                  <dd><a href={addrUrl(cfg.exchange_address)} target="_blank" rel="noopener noreferrer" className={`mono ${link}`}>{shortAddr(cfg.exchange_address)}</a></dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-[var(--muted)]">Fees, paid in USDC to</dt>
                  <dd><a href={addrUrl(cfg.fee_collector)} target="_blank" rel="noopener noreferrer" className={`mono ${link}`}>{shortAddr(cfg.fee_collector)}</a></dd>
                  <dd className="mt-0.5 text-xs font-medium text-[var(--muted)]">{cfg.buyer_fee_bps / 100}% buyer and {cfg.seller_fee_bps / 100}% seller, only on settled trades</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </div>
      <div className="border-t border-[var(--hair)]">
        <p className="mx-auto max-w-6xl px-3 py-4 text-xs font-medium text-[var(--muted)] sm:px-4">
          Testnet software, <b>not audited</b>. Tokens and pre-market positions are not investment advice and carry significant risk. Verification badges do not imply safety or guaranteed delivery.
        </p>
      </div>
    </footer>
  )
}
