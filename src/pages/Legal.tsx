import { Link, useParams } from 'react-router-dom'
import { Notice, PageTitle } from '@/components/ui'
import { useConfig } from '@/hooks/useApp'

const PAGES: Record<string, { title: string; body: string[] }> = {
  terms: { title: 'Terms & Conditions', body: ['Placeholder. The Terms & Conditions must be drafted and reviewed by qualified counsel before any real-value launch.'] },
  privacy: { title: 'Privacy Policy', body: ['Placeholder. Avantdex stores wallet addresses, order and trade data copied from a public blockchain, and text you type into forms. It does not store private keys.', 'The final policy, retention periods and data-protection roles must be defined by qualified counsel.'] },
  risk: {
    title: 'Risk Disclosure',
    body: [
      'Avantdex is unaudited testnet software. Do not use it with real value.',
      'A seller may choose not to deliver tokens. If that happens the buyer receives their payment plus the seller’s collateral instead of tokens.',
      'A token may launch late, change, or never launch. If a market is cancelled or never settles, funds are refunded without a platform fee.',
      'Prices can move sharply between the trade and the token launch.',
      'USDC on Arc can refuse transfers to or from blocklisted addresses. In that case amounts are held as claimable balances.',
      'Verification badges describe specific checks. They never imply investment safety, profitability or guaranteed token delivery.',
      'The final risk disclosure must be reviewed by qualified counsel.',
    ],
  },
  cookies: { title: 'Cookie Policy', body: ['Avantdex uses no analytics or advertising cookies. A short-lived session token is kept in your browser session storage after you sign in with your wallet.'] },
  'listing-policy': { title: 'Listing Policy', body: ['Placeholder. Projects are reviewed (approval), checked (verification badges) and activated (market creation) as three separate steps. The criteria must be defined and reviewed by counsel.'] },
  rules: {
    title: 'Trading & Settlement Rules',
    body: [
      'Placing an order locks USDC in escrow on-chain. Trades execute at the resting order’s price.',
      'After the token launch a market manager opens settlement with the token address. The seller delivers the token atomically and receives payment plus collateral minus the platform fee.',
      'If the seller does not deliver before the settlement deadline, the buyer can claim payment plus the seller’s collateral. The seller can still settle until the buyer claims.',
      'Cancelled or abandoned markets are refunded in full, with no fee and no penalty.',
      'Admins cannot move escrowed funds.',
    ],
  },
}

export default function Legal() {
  const { page = 'terms' } = useParams()
  const { data: cfg } = useConfig()
  const p = PAGES[page]
  if (!p) return <Notice tone="error">Page not found.</Notice>
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title={p.title} />
      <Notice tone="warn">Draft — not legal advice. This page has not been reviewed by qualified counsel. No legal entity, jurisdiction, restricted-country list or regulatory approval is stated here.</Notice>
      <div className="glass space-y-3 rounded-3xl p-6 text-pretty text-[var(--ink-2)]">
        {p.body.map((t) => (
          <p key={t}>{t}</p>
        ))}
        {page === 'rules' && cfg && (
          <p>
            Platform fees: 0.5% buyer and 0.5% seller on successful (settled) trades only, paid to <span className="mono break-all">{cfg.fee_collector}</span>. Order cancellations, project listings, listing requests and failed transactions carry no platform fee.
          </p>
        )}
      </div>
      <nav className="flex flex-wrap gap-3 text-sm text-[var(--accent-text)]">
        {Object.entries(PAGES).map(([k, v]) => (
          <Link key={k} to={`/legal/${k}`} className="underline">
            {v.title}
          </Link>
        ))}
      </nav>
    </div>
  )
}
