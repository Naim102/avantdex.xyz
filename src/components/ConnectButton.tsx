import { useState, type ReactNode } from 'react'
import { useConnect } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Fingerprint, Fuel, KeyRound, Wallet } from 'lucide-react'
import { Chip, Modal, Notice, Spinner } from '@/components/ui'
import { useConfig } from '@/hooks/useApp'
import { describeCircleError } from '@/lib/circleProvider'
import { CIRCLE_CONNECTOR_ID, passkeysSupported, setCircleIntent } from '@/lib/circleWallet'

const CIRCLE_WALLET_DOCS = 'https://developers.circle.com/wallets/modular'

/** The Circle Wallet card: sign in with a passkey, or create a wallet. Shows its real status. */
function CircleCard({ onDone }: { onDone: () => void }) {
  const { data: cfg } = useConfig()
  const { connectAsync, connectors } = useConnect()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState<'login' | 'register' | null>(null)
  const [error, setError] = useState<string>()
  const enabled = !!cfg?.circle_wallet?.enabled
  const connector = connectors.find((c) => c.id === CIRCLE_CONNECTOR_ID)
  const nameOk = /^[A-Za-z0-9._-]{3,32}$/.test(username.trim())

  const run = async (mode: 'login' | 'register') => {
    if (!connector) return
    setError(undefined)
    setBusy(mode)
    setCircleIntent(mode === 'login' ? { mode } : { mode, username: username.trim() })
    try {
      await connectAsync({ connector })
      onDone()
    } catch (e) {
      setError(describeCircleError(e, window.location.hostname))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border-2 border-[var(--accent)] bg-[var(--tint)] p-4" aria-labelledby="circle-wallet-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="circle-wallet-h" className="display text-lg">Circle Wallet</h3>
        <Chip tone="accent">Recommended</Chip>
      </div>
      <p className="mt-1.5 text-sm font-medium text-[var(--muted)]">
        Made for USDC on Arc. Sign in with a passkey instead of a seed phrase, and let Circle sponsor the network fee.
      </p>
      <ul className="mt-3 space-y-2 text-sm font-medium">
        <li className="flex items-start gap-2">
          <Fingerprint className="mt-0.5 size-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
          Passkey sign-in with your fingerprint, face or device PIN. No seed phrase to lose.
        </li>
        <li className="flex items-start gap-2">
          <Fuel className="mt-0.5 size-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
          Circle Gas Station can pay gas, so a new wallet does not need USDC just to start.
        </li>
        <li className="flex items-start gap-2">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
          You keep control: the account is a smart wallet that only your passkey can sign for.
        </li>
      </ul>

      {!enabled ? (
        <p className="mt-3 text-xs font-medium text-[var(--subtle)]" data-testid="circle-off">
          Passkey sign-in is not set up on this server yet (the operator adds a Circle Client Key). Until then, pick any wallet below.{' '}
          <a className="underline" href={CIRCLE_WALLET_DOCS} target="_blank" rel="noopener noreferrer">How Circle wallets work</a>
        </p>
      ) : !passkeysSupported() ? (
        <div className="mt-3">
          <Notice tone="warn">This browser does not support passkeys. Use another browser, or pick a wallet below.</Notice>
        </div>
      ) : (
        <div className="mt-4 space-y-3" data-testid="circle-on">
          <button type="button" className="btn btn-primary w-full !gap-2" disabled={!!busy || !connector} onClick={() => void run('login')}>
            {busy === 'login' ? <Spinner label="Waiting for your passkey…" /> : <><Fingerprint className="size-4" aria-hidden="true" /> Sign in with passkey</>}
          </button>
          <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            <label className="label" htmlFor="circle-username">New here? Create a wallet</label>
            <div className="flex gap-2">
              <input
                id="circle-username"
                className="field"
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={32}
                autoComplete="username"
                disabled={!!busy}
              />
              <button type="button" className="btn btn-ghost" disabled={!!busy || !connector || !nameOk} onClick={() => void run('register')}>
                {busy === 'register' ? <Spinner /> : 'Create'}
              </button>
            </div>
            <p className="text-xs font-medium text-[var(--muted)]">3 to 32 letters, digits, dots, dashes or underscores. Your device then asks you to save a passkey.</p>
          </div>
          <p className="text-xs font-medium text-[var(--subtle)]">
            Your wallet address on Arc is a smart account. After sign-in, send it test USDC from{' '}
            <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">faucet.circle.com</a>.
          </p>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </section>
  )
}

/** Shown before the wallet list: the wallet Avantdex recommends, then every other wallet. */
function ConnectDialog({ open, onClose, onOther }: { open: boolean; onClose: () => void; onOther: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Connect a wallet">
      <div className="space-y-4">
        <CircleCard onDone={onClose} />
        <button type="button" className="btn btn-ghost w-full !gap-2" onClick={onOther}>
          <Wallet className="size-4" aria-hidden="true" />
          Choose another wallet
        </button>
        <p className="text-center text-xs font-medium text-[var(--subtle)]">
          MetaMask, Coinbase Wallet, WalletConnect and other browser or mobile wallets. Avantdex runs on Arc Testnet.
        </p>
      </div>
    </Modal>
  )
}

/** The one place a wallet connection starts. Same look as a button; opens the dialog above. */
export function ConnectButton({ className = 'btn btn-primary', children = 'Connect Wallet' }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <ConnectKitButton.Custom>
      {({ show }) => (
        <>
          <button type="button" className={className} onClick={() => setOpen(true)}>
            {children}
          </button>
          <ConnectDialog
            open={open}
            onClose={() => setOpen(false)}
            onOther={() => {
              setOpen(false)
              show?.()
            }}
          />
        </>
      )}
    </ConnectKitButton.Custom>
  )
}
