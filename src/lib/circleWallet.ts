/**
 * Circle Wallet as a wagmi connector: passkey sign-in to a Circle smart account on Arc.
 *
 * Credentials: a Circle Console Client Key (public, meant for browsers) and the site's domain registered as the
 * Passkey Domain. The key is set on the API (`CIRCLE_CLIENT_KEY`) and arrives through /api/config, so changing it
 * needs no rebuild. The SDK is loaded only when someone uses the wallet.
 *
 * What is stored in the browser: the passkey's public identifiers (credential id, public key, domain), never a secret.
 * The private key lives in the user's authenticator; every signature needs the user's fingerprint, face or PIN.
 */
import { createConnector, type Config } from 'wagmi'
import { createPublicClient, type Address } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { createCircleProvider, type Eip1193 } from '@/lib/circleProvider'

export const CIRCLE_CONNECTOR_ID = 'circleWallet'
// A small fingerprint mark, so the wallet list of the connect modal has an icon for it.
const ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#28df99"/><g fill="none" stroke="#262627" stroke-width="2" stroke-linecap="round"><path d="M9 14a7 7 0 0 1 14 0v2"/><path d="M12 24c1-2 1-4 1-8a3 3 0 0 1 6 0c0 3 0 6 2 9"/><path d="M16 16v3c0 2 0 3-1 5"/></g></svg>',
  )
const STORE = 'avantdex:circle-wallet:v1'

export type CircleIntent = { mode: 'login' } | { mode: 'register'; username: string }
let intent: CircleIntent = { mode: 'login' }
/** Set by the connect dialog just before it calls `connect`. */
export const setCircleIntent = (i: CircleIntent) => {
  intent = i
}

interface StoredCredential {
  id: string
  publicKey: `0x${string}`
  rpId?: string
  username?: string
}

const readStored = (): StoredCredential | null => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as StoredCredential | null
    return v && typeof v.id === 'string' && typeof v.publicKey === 'string' ? v : null
  } catch {
    return null
  }
}

interface CircleSetup {
  chainId: number
  clientUrl: string
  clientKey: string
  paymaster: boolean
}

let setupPromise: Promise<CircleSetup> | null = null
function loadSetup(): Promise<CircleSetup> {
  setupPromise ??= fetch('/api/config')
    .then((r) => {
      if (!r.ok) throw new Error('The Avantdex API is not reachable.')
      return r.json() as Promise<{ chain_id: number; circle_wallet?: { enabled: boolean; client_url: string; client_key: string; paymaster: boolean } }>
    })
    .then((c) => {
      if (!c.circle_wallet?.enabled) throw new Error('Circle Wallet sign-in is not set up on this server yet.')
      return { chainId: c.chain_id, clientUrl: c.circle_wallet.client_url, clientKey: c.circle_wallet.client_key, paymaster: c.circle_wallet.paymaster }
    })
    .catch((e: unknown) => {
      setupPromise = null // try again next time (the server may have been starting)
      throw e
    })
  return setupPromise
}

export const passkeysSupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined'

interface Session {
  provider: Eip1193
  address: Address
  chainId: number
}

async function openSession(wagmi: Config, reconnecting: boolean): Promise<Session> {
  if (!passkeysSupported()) throw new Error('This browser does not support passkeys.')
  const setup = await loadSetup()
  const chain = setup.chainId === arc.id ? arc : arcTestnet
  const path = chain.id === arc.id ? 'arc' : 'arcTestnet'

  const [sdk, aa] = await Promise.all([import('@circle-fin/modular-wallets-core'), import('viem/account-abstraction')])
  const passkeyTransport = sdk.toPasskeyTransport(setup.clientUrl, setup.clientKey)
  const modularTransport = sdk.toModularTransport(`${setup.clientUrl}/${path}`, setup.clientKey)

  let stored: StoredCredential | null
  if (reconnecting) {
    stored = readStored()
    if (!stored) throw new Error('No Circle Wallet on this browser.')
  } else {
    const wanted = intent
    intent = { mode: 'login' } // an intent is used once: a later connect from another list defaults to signing in
    const credential =
      wanted.mode === 'register'
        ? await sdk.toWebAuthnCredential({ transport: passkeyTransport, mode: sdk.WebAuthnMode.Register, username: wanted.username })
        : await sdk.toWebAuthnCredential({ transport: passkeyTransport, mode: sdk.WebAuthnMode.Login })
    stored = { id: credential.id, publicKey: credential.publicKey, rpId: credential.rpId, username: wanted.mode === 'register' ? wanted.username : undefined }
    localStorage.setItem(STORE, JSON.stringify(stored))
  }

  const client = createPublicClient({ chain, transport: modularTransport })
  const owner = aa.toWebAuthnAccount({ credential: { id: stored.id, publicKey: stored.publicKey }, rpId: stored.rpId })
  const account = await sdk.toCircleSmartAccount({ client, owner, ...(stored.username ? { name: stored.username } : {}) })
  const bundler = aa.createBundlerClient({ chain, transport: modularTransport })

  const provider = createCircleProvider({
    account,
    bundler: bundler as never,
    // reads use the app's own Arc RPC, like every other wallet
    publicClient: wagmi.getClient({ chainId: chain.id }) as never,
    chainId: chain.id,
    paymaster: setup.paymaster,
  })
  return { provider, address: account.address, chainId: chain.id }
}

/**
 * wagmi asks a connector for its provider before it reconnects after a page load, and skips the connector when that
 * fails. So while a wallet is remembered but not yet opened, hand out this placeholder; real requests wait for
 * `connect`, which rebuilds the session.
 */
const waiting: Eip1193 = {
  request: () => Promise.reject(new Error('Circle Wallet is not connected.')),
  on() {},
  removeListener() {},
}

export function circleWallet() {
  return createConnector<Eip1193>((config) => {
    let session: Session | null = null
    return {
      id: CIRCLE_CONNECTOR_ID,
      name: 'Circle Wallet',
      icon: ICON,
      type: CIRCLE_CONNECTOR_ID,
      async connect(parameters) {
        session = await openSession(config as unknown as Config, !!parameters?.isReconnecting)
        return { accounts: [session.address], chainId: session.chainId } as never
      },
      disconnect() {
        session = null
        localStorage.removeItem(STORE)
        return Promise.resolve()
      },
      getAccounts() {
        return Promise.resolve(session ? [session.address] : [])
      },
      getChainId() {
        return Promise.resolve(session?.chainId ?? arcTestnet.id)
      },
      getProvider() {
        if (session) return Promise.resolve(session.provider)
        // nothing remembered on this browser: not a candidate for reconnecting (and the SDK is never loaded)
        return readStored() ? Promise.resolve(waiting) : Promise.reject(new Error('Circle Wallet is not connected.'))
      },
      isAuthorized() {
        return Promise.resolve(readStored() !== null)
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        session = null
        config.emitter.emit('disconnect')
      },
    }
  })
}
