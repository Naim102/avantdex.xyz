/**
 * A CCTP V2 Standard transfer run by the user's own wallet, step by step:
 *
 *   1. approve USDC for the token messenger on the source chain (skipped if already approved),
 *   2. burn it with `depositForBurn` (Standard finality, no CCTP fee),
 *   3. wait until Circle's Iris service has attested the burn,
 *   4. check the attestation against Circle's published attester keys (informational, the contract checks too),
 *   5. switch the wallet to the destination chain and call `receiveMessage(message, attestation)`, which mints.
 *
 * Nothing here holds funds or keys: every transaction is signed in the user's wallet. A transfer that stops after the
 * burn is finished later with `completeTransfer` from the burn transaction hash alone.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  fallback,
  formatUnits,
  http,
  parseGwei,
  type Address,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from 'viem'
import { ARC_KEY, routeChain, type Route } from '@/lib/bridgeRoutes'
import {
  STANDARD_FINALITY,
  ZERO_BYTES32,
  addressToBytes32,
  fetchPublicKeys,
  messageTransmitterAbi,
  parseBurnBody,
  parseMessage,
  tokenMessengerAbi,
  verifyAttestation,
  waitForAttestation,
} from '@/lib/cctp'

export type StepId = 'approve' | 'burn' | 'attest' | 'check' | 'mint'
export type StepState = 'active' | 'done' | 'skipped' | 'error'
export type Progress = (id: StepId, state: StepState, info?: { tx?: Hex; note?: string }) => void

export type Provider = EIP1193Provider

export interface Deps {
  provider: Provider
  account: Address
  /** Base URL of Circle's Iris API. */
  iris: string
  signal?: AbortSignal
  pollMs?: number
  /** Replaces the public client of a route (used by tests). */
  publicClient?: (route: Route) => PublicClient
}

/** An error with a reason a person can act on. `code` is for the UI and the tests. */
export class BridgeError extends Error {
  constructor(
    readonly code: 'balance' | 'gas' | 'recipient' | 'domain' | 'reverted' | 'wallet' | 'switch',
    message: string,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

const usdc = (n: bigint) => formatUnits(n, 6)

export function clientFor(deps: Deps, route: Route): PublicClient {
  if (deps.publicClient) return deps.publicClient(route)
  return createPublicClient({ chain: routeChain(route), transport: fallback(route.rpc.map((u) => http(u))) })
}

/** Makes the wallet use `route`'s chain, adding it first when the wallet does not know it. */
export async function switchTo(provider: Provider, route: Route): Promise<void> {
  const want = route.chainId
  const now = Number(await provider.request({ method: 'eth_chainId' }))
  if (now === want) return
  const chainId = `0x${want.toString(16)}`
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (e) {
    const x = e as { code?: number; message?: string }
    if (x.code === 4001) throw new BridgeError('switch', `You did not switch your wallet to ${route.label}.`)
    if (x.code !== 4902 && !/unrecogni|not added|unknown chain|add.*chain/i.test(x.message ?? '')) throw e
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: route.label, nativeCurrency: route.native, rpcUrls: route.rpc, blockExplorerUrls: [route.txUrl('').replace(/\/tx\/$/, '')] }],
    })
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
    } catch {
      /* some wallets switch by themselves after adding */
    }
  }
  if (Number(await provider.request({ method: 'eth_chainId' })) !== want) throw new BridgeError('switch', `Your wallet is not on ${route.label}. Switch the network in your wallet and try again.`)
}

/** Arc drops transactions priced under 20 gwei, so they are always priced above it. Other chains use the wallet's own estimate. */
async function fees(route: Route, pub: PublicClient): Promise<{ maxFeePerGas?: bigint }> {
  if (route.key !== ARC_KEY) return {}
  const floor = parseGwei('20')
  try {
    const { maxFeePerGas } = await pub.estimateFeesPerGas()
    return { maxFeePerGas: maxFeePerGas && maxFeePerGas > floor ? maxFeePerGas : floor }
  } catch {
    return { maxFeePerGas: floor }
  }
}

async function receiptOk(pub: PublicClient, hash: Hex): Promise<void> {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (r.status !== 'success') throw new BridgeError('reverted', 'The transaction was mined but reverted on-chain.')
}

// ---------------------------------------------------------------- 1 to 2: approve and burn

export async function burnStandard(deps: Deps, from: Route, to: Route, amount: bigint, progress: Progress): Promise<{ burnTx: Hex }> {
  const { account } = deps
  const pub = clientFor(deps, from)
  await switchTo(deps.provider, from)
  const wallet = createWalletClient({ account, chain: routeChain(from), transport: custom(deps.provider) })

  const balance = await pub.readContract({ address: from.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
  if (balance < amount) throw new BridgeError('balance', `You have ${usdc(balance)} USDC on ${from.label}, not ${usdc(amount)}.`)

  const allowance = await pub.readContract({ address: from.usdc, abi: erc20Abi, functionName: 'allowance', args: [account, from.tokenMessenger] })
  if (allowance < amount) {
    progress('approve', 'active')
    const { request } = await pub.simulateContract({ account, address: from.usdc, abi: erc20Abi, functionName: 'approve', args: [from.tokenMessenger, amount] })
    const approveTx = await wallet.writeContract({ ...request, ...(await fees(from, pub)) } as never)
    await receiptOk(pub, approveTx)
    progress('approve', 'done', { tx: approveTx })
  } else {
    progress('approve', 'skipped', { note: 'Already approved' })
  }

  progress('burn', 'active')
  const args = [amount, to.domain, addressToBytes32(account), from.usdc, ZERO_BYTES32, 0n, STANDARD_FINALITY] as const
  const { request } = await pub.simulateContract({ account, address: from.tokenMessenger, abi: tokenMessengerAbi, functionName: 'depositForBurn', args })
  const burnTx = await wallet.writeContract({ ...request, ...(await fees(from, pub)) } as never)
  await receiptOk(pub, burnTx)
  progress('burn', 'done', { tx: burnTx })
  return { burnTx }
}

// ---------------------------------------------------------------- 3 to 5: attestation and mint

export interface Completed {
  /** USDC that reached the recipient: the burned amount minus the fee Circle took (zero for Standard). */
  minted: bigint
  mintTx?: Hex
  /** The message had already been received (by this user earlier, or by anyone: the caller is not restricted). */
  alreadyDone: boolean
}

const waited = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export async function completeTransfer(deps: Deps, from: Route, to: Route, burnTx: string, progress: Progress): Promise<Completed> {
  const { account } = deps

  progress('attest', 'active', { note: 'Waiting for Circle' })
  const found = await waitForAttestation(deps.iris, from.domain, burnTx, {
    signal: deps.signal,
    intervalMs: deps.pollMs,
    onTick: (ms, seen) => progress('attest', 'active', { note: `${seen ? 'Circle is signing' : 'Waiting for Circle'} (${waited(ms)})` }),
  })
  progress('attest', 'done')

  const message = parseMessage(found.message)
  if (message.destinationDomain !== to.domain) throw new BridgeError('domain', `This burn was addressed to CCTP domain ${message.destinationDomain}, not ${to.label} (${to.domain}).`)
  const body = parseBurnBody(message.body)
  if (body.mintRecipient.toLowerCase() !== account.toLowerCase()) throw new BridgeError('recipient', `This transfer pays ${body.mintRecipient}, not your connected wallet. Connect that wallet to finish it.`)
  const minted = body.amount - body.feeExecuted

  const pub = clientFor(deps, to)
  const used = await pub.readContract({ address: to.messageTransmitter, abi: messageTransmitterAbi, functionName: 'usedNonces', args: [message.nonce] })
  if (used !== 0n) {
    progress('check', 'skipped')
    progress('mint', 'done', { note: 'This transfer was already completed' })
    return { minted, alreadyDone: true }
  }

  progress('check', 'active')
  try {
    const [keys, threshold] = await Promise.all([
      fetchPublicKeys(deps.iris, deps.signal),
      pub.readContract({ address: to.messageTransmitter, abi: messageTransmitterAbi, functionName: 'signatureThreshold' }),
    ])
    const r = await verifyAttestation({ message: found.message, attestation: found.attestation, keys, threshold: Number(threshold) })
    progress('check', r.ok ? 'done' : 'skipped', { note: r.ok ? `Signed by ${r.signers.length} of Circle's attesters` : `Not confirmed here: ${r.reason} The contract checks it again.` })
  } catch {
    progress('check', 'skipped', { note: 'Could not fetch Circle’s keys. The contract checks the attestation anyway.' })
  }

  await switchTo(deps.provider, to)
  const gas = await pub.getBalance({ address: account })
  if (gas === 0n) throw new BridgeError('gas', `You have no ${to.native.symbol} on ${to.label} to pay for the last step. Get a little ${to.native.symbol} there, then finish this transfer from Recent transfers.`)

  progress('mint', 'active')
  const wallet = createWalletClient({ account, chain: routeChain(to), transport: custom(deps.provider) })
  const { request } = await pub.simulateContract({ account, address: to.messageTransmitter, abi: messageTransmitterAbi, functionName: 'receiveMessage', args: [found.message, found.attestation] })
  const mintTx = await wallet.writeContract({ ...request, ...(await fees(to, pub)) } as never)
  await receiptOk(pub, mintTx)
  progress('mint', 'done', { tx: mintTx })
  return { minted, mintTx, alreadyDone: false }
}

/** A read-only client for a route (balances, nonces). */
export const publicClientFor = (route: Route): PublicClient => clientFor({} as Deps, route)

/** Has this burn already been received on the destination chain? Used by Recent transfers; null when it cannot be told. */
export async function isReceived(deps: Pick<Deps, 'publicClient'>, to: Route, nonce: Hex): Promise<boolean | null> {
  try {
    const used = await clientFor(deps as Deps, to).readContract({ address: to.messageTransmitter, abi: messageTransmitterAbi, functionName: 'usedNonces', args: [nonce] })
    return used !== 0n
  } catch {
    return null
  }
}
