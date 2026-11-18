/**
 * Circle CCTP bridge: the chains Avantdex offers and the helpers around them.
 * The transfer itself (approve, burn, attestation, mint) is run by Circle's Bridge Kit; Avantdex never holds funds.
 * Testnet only: these are the CCTP V2 testnet domains (docs/CCTP.md).
 */
import { arbitrumSepolia, arcTestnet, avalancheFuji, baseSepolia, optimismSepolia, polygonAmoy, sepolia } from 'viem/chains'
import type { Chain } from 'viem'
import type { BridgeChain } from '@circle-fin/bridge-kit' // type only: the kit itself loads with the bridge page

export type BridgeKey = `${BridgeChain}`
export const ARC_KEY: BridgeKey = 'Arc_Testnet'
export const IRIS = 'https://iris-api-sandbox.circle.com'

export interface BridgeRoute {
  /** Bridge Kit chain name. */
  key: BridgeKey
  label: string
  chain: Chain
  /** CCTP domain id (not the chain id). */
  domain: number
  txUrl: (hash: string) => string
  /** What the user needs a little of on this chain to pay gas. */
  gas: string
}

export const ARC_ROUTE: BridgeRoute = {
  key: ARC_KEY,
  label: 'Arc Testnet',
  chain: arcTestnet,
  domain: 26,
  txUrl: (h) => `https://explorer.testnet.arc.io/tx/${h}`,
  gas: 'USDC',
}

export const OTHER_ROUTES: BridgeRoute[] = [
  { key: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', chain: sepolia, domain: 0, txUrl: (h) => `https://sepolia.etherscan.io/tx/${h}`, gas: 'Sepolia ETH' },
  { key: 'Base_Sepolia', label: 'Base Sepolia', chain: baseSepolia, domain: 6, txUrl: (h) => `https://sepolia.basescan.org/tx/${h}`, gas: 'Base Sepolia ETH' },
  { key: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', chain: arbitrumSepolia, domain: 3, txUrl: (h) => `https://sepolia.arbiscan.io/tx/${h}`, gas: 'Arbitrum Sepolia ETH' },
  { key: 'Optimism_Sepolia', label: 'OP Sepolia', chain: optimismSepolia, domain: 2, txUrl: (h) => `https://sepolia-optimistic.etherscan.io/tx/${h}`, gas: 'OP Sepolia ETH' },
  { key: 'Avalanche_Fuji', label: 'Avalanche Fuji', chain: avalancheFuji, domain: 1, txUrl: (h) => `https://testnet.snowtrace.io/tx/${h}`, gas: 'Fuji AVAX' },
  { key: 'Polygon_Amoy_Testnet', label: 'Polygon Amoy', chain: polygonAmoy, domain: 7, txUrl: (h) => `https://amoy.polygonscan.com/tx/${h}`, gas: 'Amoy POL' },
]

export const ALL_ROUTES = [ARC_ROUTE, ...OTHER_ROUTES]
export const BRIDGE_CHAINS = OTHER_ROUTES.map((r) => r.chain)

export const routeByKey = (key: string): BridgeRoute => ALL_ROUTES.find((r) => r.key === key) ?? ARC_ROUTE

/** Smallest amount the form accepts: one USDC, the same floor as an order. */
export const MIN_BRIDGE_USDC = 1

/** "12.5" to base units, or null if it is not a number with at most 6 decimals. */
export function parseUsdc(value: string): bigint | null {
  const v = value.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null
  const [whole, frac = ''] = v.split('.')
  return BigInt(whole + frac.padEnd(6, '0'))
}

// ---------------------------------------------------------------- recent transfers (kept in this browser only)

export interface BridgeRecord {
  burnTx: string
  from: string
  to: string
  amount: string
  address: string
  at: number
}

const KEY = 'avantdex:bridge:v1'

export function loadRecords(address: string | undefined): BridgeRecord[] {
  if (!address) return []
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as BridgeRecord[]
    return all.filter((r) => r.address.toLowerCase() === address.toLowerCase()).sort((a, b) => b.at - a.at).slice(0, 8)
  } catch {
    return []
  }
}

export function saveRecord(r: BridgeRecord): void {
  try {
    const all = (JSON.parse(localStorage.getItem(KEY) ?? '[]') as BridgeRecord[]).filter((x) => x.burnTx !== r.burnTx)
    all.unshift(r)
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 40)))
  } catch {
    /* storage unavailable: the list is only a convenience */
  }
}

// ---------------------------------------------------------------- Circle attestation service (public, no key)

export interface IrisStatus {
  attested: boolean
  forwardState?: string
  mintTx?: string
}

/** Where a transfer stands, from its burn transaction. Null while Circle has not seen the burn yet. */
export async function fetchTransferStatus(sourceDomain: number, burnTx: string): Promise<IrisStatus | null> {
  const res = await fetch(`${IRIS}/v2/messages/${sourceDomain}?transactionHash=${burnTx}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Circle attestation service returned ${res.status}`)
  const body = (await res.json()) as { messages?: { status?: string; forwardState?: string; destinationMintTxHash?: string }[] }
  const m = body.messages?.[0]
  if (!m) return null
  return { attested: m.status === 'complete', forwardState: m.forwardState, mintTx: m.destinationMintTxHash }
}
