/**
 * An EIP-1193 provider backed by a Circle smart account, so the rest of the app (wagmi, viem) can use a Circle Wallet
 * like any browser wallet.
 *
 * - `personal_sign` is signed by the account (the passkey prompt appears); the API verifies it with ERC-1271 / ERC-6492.
 * - `eth_sendTransaction` becomes a user operation sent through Circle's bundler. Circle Gas Station is asked to pay
 *   the fee first; if it cannot, the wallet pays in its own USDC (Arc's gas token). A cancelled passkey prompt is
 *   never retried.
 * - Everything else (reads) goes to the public Arc RPC.
 *
 * The dependencies are passed in so this file has no SDK import and can be tested on its own.
 */
import type { Address, Hex } from 'viem'

export interface SmartAccountLike {
  address: Address
  signMessage(args: { message: { raw: Hex } }): Promise<Hex>
}

export interface Call {
  to: Address
  data?: Hex
  value?: bigint
}

export interface BundlerLike {
  sendUserOperation(args: { account: SmartAccountLike; calls: Call[]; paymaster?: boolean }): Promise<Hex>
  waitForUserOperationReceipt(args: { hash: Hex }): Promise<{ success: boolean; reason?: string; receipt: { transactionHash: Hex } }>
}

export interface RpcLike {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export interface CircleProviderDeps {
  account: SmartAccountLike
  bundler: BundlerLike
  publicClient: RpcLike
  chainId: number
  /** Ask Circle Gas Station to sponsor each transaction first. */
  paymaster: boolean
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
}

/** The passkey prompt was dismissed or timed out (a DOMException from the browser's WebAuthn API). */
export function isPasskeyCancelled(e: unknown): boolean {
  const x = e as { name?: string; message?: string; cause?: unknown }
  if (x?.name === 'NotAllowedError' || x?.name === 'AbortError') return true
  if (/not allowed|user cancel|user rejected|user denied/i.test(x?.message ?? '')) return true
  return x?.cause !== undefined && x.cause !== e ? isPasskeyCancelled(x.cause) : false
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function createCircleProvider(deps: CircleProviderDeps): Eip1193 {
  const { account, bundler, publicClient, chainId } = deps
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  const send = async (calls: Call[]): Promise<Hex> => {
    const once = (paymaster: boolean) => bundler.sendUserOperation({ account, calls, paymaster })
    if (!deps.paymaster) return once(false)
    try {
      return await once(true)
    } catch (e) {
      if (isPasskeyCancelled(e)) throw e
      return once(false) // sponsorship is not available: the account pays with its own USDC
    }
  }

  const request: Eip1193['request'] = async ({ method, params = [] }) => {
    switch (method) {
      case 'eth_chainId':
        return `0x${chainId.toString(16)}`
      case 'net_version':
        return String(chainId)
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return [account.address]
      case 'wallet_switchEthereumChain': {
        const wanted = Number((params[0] as { chainId?: string } | undefined)?.chainId)
        if (wanted === chainId) return null
        throw new ProviderError('Circle Wallet works on Arc only.', 4902)
      }
      case 'personal_sign': {
        const [data, from] = params as [Hex, Address | undefined]
        if (from && !same(from, account.address)) throw new ProviderError('That address is not this wallet.', 4100)
        return account.signMessage({ message: { raw: data } })
      }
      case 'eth_sendTransaction': {
        const tx = params[0] as { from?: Address; to?: Address; data?: Hex; value?: string | number }
        if (tx.from && !same(tx.from, account.address)) throw new ProviderError('That address is not this wallet.', 4100)
        if (!tx.to) throw new ProviderError('Deploying a contract is not supported from a Circle Wallet.', 4200)
        const value = tx.value === undefined ? undefined : BigInt(tx.value)
        const hash = await send([{ to: tx.to, data: tx.data, value: value && value > 0n ? value : undefined }])
        const done = await bundler.waitForUserOperationReceipt({ hash })
        if (!done.success) throw new ProviderError(`The transaction reverted${done.reason ? `: ${done.reason}` : ''}.`, -32000)
        return done.receipt.transactionHash
      }
      case 'eth_signTypedData_v4':
      case 'eth_signTypedData':
      case 'eth_sign':
      case 'eth_signTransaction':
      case 'eth_sendRawTransaction':
        throw new ProviderError(`${method} is not supported by Circle Wallet.`, 4200)
      default:
        return publicClient.request({ method, params })
    }
  }

  return {
    request,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },
  }
}

/** A short, plain explanation for the errors a passkey login or a Circle transaction can raise. */
export function describeCircleError(e: unknown, host: string): string {
  const x = e as { name?: string; message?: string; code?: number | string }
  const msg = x?.message ?? ''
  if (isPasskeyCancelled(e)) return 'The passkey prompt was cancelled. Nothing was changed.'
  if (x?.name === 'SecurityError') return `Passkeys are tied to one domain, and ${host} is not registered as the Passkey Domain in Circle Console.`
  if (x?.name === 'InvalidStateError') return 'A passkey already exists for this device. Use "Sign in with passkey" instead.'
  if (/401|403|unauthori[sz]ed|invalid.*(key|token|credentials)|forbidden/i.test(msg)) return 'Circle rejected the Client Key. The operator must check CIRCLE_CLIENT_KEY (a testnet key starts with TEST_API_KEY:) and the Passkey Domain in Circle Console.'
  if (/AA21|prefund|insufficient/i.test(msg)) return 'Circle could not sponsor this transaction and the wallet has no USDC for gas. Send a little test USDC to your Circle Wallet address.'
  if (/AA23|AA24|signature/i.test(msg)) return 'The passkey signature was not accepted. Try again.'
  return msg ? msg.slice(0, 220) : 'Circle Wallet could not complete the request.'
}
