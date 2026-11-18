/**
 * Circle CCTP V2 pieces that need no SDK: contract ABIs, message parsing, the Iris attestation client and the
 * check of an attestation against Circle's published attester public keys.
 *
 * A Standard transfer burns USDC on the source chain, waits for Circle to attest the burn (Iris API), then calls
 * `receiveMessage(message, attestation)` on the destination chain's MessageTransmitterV2, which mints USDC.
 */
import {
  bytesToHex,
  concat,
  getAddress,
  hexToBigInt,
  hexToBytes,
  keccak256,
  pad,
  parseAbi,
  recoverAddress,
  size,
  slice,
  type Address,
  type Hex,
} from 'viem'

/** minFinalityThreshold of a Standard transfer: wait for the source chain's finality, no CCTP fee. */
export const STANDARD_FINALITY = 2000
export const ZERO_BYTES32: Hex = `0x${'00'.repeat(32)}`

export const tokenMessengerAbi = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
])

export const messageTransmitterAbi = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function usedNonces(bytes32 nonce) view returns (uint256)',
  'function signatureThreshold() view returns (uint256)',
  'event MessageSent(bytes message)',
])

export const addressToBytes32 = (a: Address): Hex => pad(a, { size: 32 })
export const bytes32ToAddress = (b: Hex): Address => getAddress(`0x${b.slice(-40)}`)

// ---------------------------------------------------------------- message layout (V2)

export interface CctpMessage {
  version: number
  sourceDomain: number
  destinationDomain: number
  nonce: Hex
  sender: Hex
  recipient: Hex
  destinationCaller: Hex
  minFinalityThreshold: number
  finalityThresholdExecuted: number
  body: Hex
}

const HEADER = 148

/** Header fields of a CCTP V2 message: 148 bytes, then the message body. */
export function parseMessage(message: Hex): CctpMessage {
  if (size(message) < HEADER) throw new Error('This is not a CCTP V2 message (too short).')
  const u32 = (at: number) => Number(hexToBigInt(slice(message, at, at + 4)))
  return {
    version: u32(0),
    sourceDomain: u32(4),
    destinationDomain: u32(8),
    nonce: slice(message, 12, 44),
    sender: slice(message, 44, 76),
    recipient: slice(message, 76, 108),
    destinationCaller: slice(message, 108, 140),
    minFinalityThreshold: u32(140),
    finalityThresholdExecuted: u32(144),
    body: slice(message, HEADER),
  }
}

export interface BurnBody {
  burnToken: Address
  mintRecipient: Address
  amount: bigint
  messageSender: Address
  maxFee: bigint
  feeExecuted: bigint
}

/** The burn message body (TokenMessengerV2): who gets how much USDC, and the fee taken. */
export function parseBurnBody(body: Hex): BurnBody {
  if (size(body) < 228) throw new Error('This is not a USDC burn message.')
  const word = (at: number) => slice(body, at, at + 32)
  return {
    burnToken: bytes32ToAddress(word(4)),
    mintRecipient: bytes32ToAddress(word(36)),
    amount: hexToBigInt(word(68)),
    messageSender: bytes32ToAddress(word(100)),
    maxFee: hexToBigInt(word(132)),
    feeExecuted: hexToBigInt(word(164)),
  }
}

// ---------------------------------------------------------------- Iris (Circle's attestation service)

export interface IrisMessage {
  message?: Hex
  attestation?: string
  status?: string
  eventNonce?: string
  forwardState?: string
  forwardTxHash?: Hex
  destinationMintTxHash?: Hex
  delayReason?: string | null
}

export class IrisError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'IrisError'
  }
}

const trim = (u: string) => u.replace(/\/+$/, '')

/** The message and attestation for a burn transaction. Null until Circle has seen the burn. */
export async function fetchMessage(iris: string, sourceDomain: number, burnTx: string, signal?: AbortSignal): Promise<IrisMessage | null> {
  const res = await fetch(`${trim(iris)}/v2/messages/${sourceDomain}?transactionHash=${burnTx}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new IrisError(`Circle's attestation service answered ${res.status}.`, res.status)
  const body = (await res.json()) as { messages?: IrisMessage[] }
  return body.messages?.[0] ?? null
}

/** True when Circle has signed the burn: the attestation is a real signature, not the PENDING placeholder. */
export const isAttested = (m: IrisMessage | null): m is IrisMessage & { message: Hex; attestation: Hex } =>
  !!m && m.status === 'complete' && typeof m.attestation === 'string' && m.attestation.startsWith('0x') && !!m.message

export interface PublicKey {
  publicKey: Hex
  cctpVersion: number
}

export async function fetchPublicKeys(iris: string, signal?: AbortSignal): Promise<PublicKey[]> {
  const res = await fetch(`${trim(iris)}/v2/publicKeys`, { signal })
  if (!res.ok) throw new IrisError(`Circle's public key list answered ${res.status}.`, res.status)
  const body = (await res.json()) as { publicKeys?: PublicKey[] }
  return body.publicKeys ?? []
}

export interface WaitOptions {
  signal?: AbortSignal
  intervalMs?: number
  timeoutMs?: number
  /** Called after every check with the time waited so far. */
  onTick?: (elapsedMs: number, seen: IrisMessage | null) => void
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Stopped', 'AbortError'))
    })
  })

/** Polls Iris until the burn is attested. A failed poll (network, 5xx) is retried; it never counts as an answer. */
export async function waitForAttestation(iris: string, sourceDomain: number, burnTx: string, opts: WaitOptions = {}): Promise<IrisMessage & { message: Hex; attestation: Hex }> {
  const { signal, intervalMs = 4000, timeoutMs = 90 * 60_000, onTick } = opts
  const start = Date.now()
  for (;;) {
    let seen: IrisMessage | null = null
    try {
      seen = await fetchMessage(iris, sourceDomain, burnTx, signal)
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e
      // a hiccup of the service or the network: ask again
    }
    onTick?.(Date.now() - start, seen)
    if (isAttested(seen)) return seen
    if (Date.now() - start > timeoutMs) throw new Error("Circle has not attested this burn yet. Come back later: the transfer is safe and can be finished from Recent transfers.")
    await sleep(intervalMs, signal)
  }
}

// ---------------------------------------------------------------- attestation check

/** The Ethereum address of an uncompressed secp256k1 public key (0x04 + x + y), as CCTP registers its attesters. */
export function attesterAddress(publicKey: Hex): Address {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Not an uncompressed public key.')
  return getAddress(`0x${keccak256(bytesToHex(bytes.slice(1))).slice(26)}`)
}

export interface AttestationCheck {
  ok: boolean
  reason?: string
  signers: Address[]
}

/**
 * Checks, without sending anything, that an attestation was signed by Circle's V2 attesters: it is a run of 65-byte
 * signatures over keccak256(message), each from a published attester, in strictly increasing signer order (the order
 * the MessageTransmitter requires), and, when the threshold is known, exactly that many.
 * The contract repeats this check on chain; this one only explains a bad attestation before a transaction is paid for.
 */
export async function verifyAttestation(args: { message: Hex; attestation: Hex; keys: PublicKey[]; threshold?: number }): Promise<AttestationCheck> {
  const { message, attestation, keys, threshold } = args
  const allowed = new Set(keys.filter((k) => k.cctpVersion === 2).map((k) => attesterAddress(k.publicKey)))
  if (allowed.size === 0) return { ok: false, reason: 'Circle published no V2 attester keys.', signers: [] }
  const n = size(attestation)
  if (n === 0 || n % 65 !== 0) return { ok: false, reason: `The attestation has ${n} bytes; it must be a whole number of 65-byte signatures.`, signers: [] }
  if (threshold !== undefined && n / 65 !== threshold) return { ok: false, reason: `The destination wants ${threshold} signatures and the attestation has ${n / 65}.`, signers: [] }
  const hash = keccak256(message)
  const signers: Address[] = []
  for (let i = 0; i < n / 65; i++) {
    signers.push(await recoverAddress({ hash, signature: slice(attestation, i * 65, (i + 1) * 65) }))
  }
  for (let i = 0; i < signers.length; i++) {
    if (!allowed.has(signers[i])) return { ok: false, reason: `Signer ${signers[i]} is not one of Circle's published attesters.`, signers }
    if (i > 0 && BigInt(signers[i]) <= BigInt(signers[i - 1])) return { ok: false, reason: 'The signatures are not in increasing signer order.', signers }
  }
  return { ok: true, signers }
}

/** Test helper and documentation of the format: join signatures the way Iris returns them. */
export const joinSignatures = (sigs: Hex[]): Hex => concat(sigs)

// ---------------------------------------------------------------- transfers remembered in this browser

export interface BridgeRecord {
  burnTx: string
  from: string
  to: string
  amount: string
  address: string
  /** "self": the user finishes on the destination chain; "circle": Circle's Forwarding Service does. */
  mode: 'self' | 'circle'
  at: number
}

const KEY = 'avantdex:bridge:v2'

export function loadRecords(address: string | undefined): BridgeRecord[] {
  if (!address) return []
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as BridgeRecord[]
    return all.filter((r) => r.address.toLowerCase() === address.toLowerCase()).sort((a, b) => b.at - a.at).slice(0, 10)
  } catch {
    return []
  }
}

export function saveRecord(r: BridgeRecord): void {
  try {
    const all = (JSON.parse(localStorage.getItem(KEY) ?? '[]') as BridgeRecord[]).filter((x) => x.burnTx !== r.burnTx)
    all.unshift(r)
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)))
  } catch {
    /* storage unavailable: the list is only a convenience */
  }
}

/** "12.5" to base units (6 decimals), or null if it is not a number with at most 6 decimals. */
export function parseUsdc(value: string): bigint | null {
  const v = value.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null
  const [whole, frac = ''] = v.split('.')
  return BigInt(whole + frac.padEnd(6, '0'))
}

/** Smallest amount the form accepts: one USDC, the same floor as an order. */
export const MIN_BRIDGE_USDC = 1
