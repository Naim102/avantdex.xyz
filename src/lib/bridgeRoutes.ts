/**
 * The networks the Bridge page offers, built from Circle's own chain data (the Bridge Kit ships the CCTP V2 domain,
 * the USDC address, the CCTP contract addresses and the public RPC endpoints of every supported chain, and
 * `scripts/verify-cctp.mjs` checks that data against Circle's documentation tables).
 * Testnet only. Mainnet needs its own run of this builder and a confirmation step for real funds.
 */
import { defineChain, type Address, type Chain } from 'viem'

/** The chain fields this page needs, as the Bridge Kit describes them. */
export interface KitChain {
  chain: string
  name: string
  chainId: number
  isTestnet: boolean
  explorerUrl: string
  rpcEndpoints?: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  usdcAddress?: string | null
  cctp?: {
    domain: number
    contracts?: { v2?: { tokenMessenger: string; messageTransmitter: string } }
    forwarderSupported?: { source: boolean; destination: boolean }
  }
}

export interface Route {
  /** Bridge Kit chain name, for example "Base_Sepolia". */
  key: string
  label: string
  chainId: number
  /** CCTP domain id (not the chain id). */
  domain: number
  usdc: Address
  tokenMessenger: Address
  messageTransmitter: Address
  rpc: string[]
  native: { symbol: string; decimals: number; name: string }
  txUrl: (hash: string) => string
  addressUrl: (address: string) => string
  /** Circle's Forwarding Service can finish a transfer that ends on this chain. */
  forwarderDestination: boolean
  /** Shown first in the list. */
  primary: boolean
  /** How long a Standard transfer from this chain takes to be attested, as Circle documents it. */
  wait: string
}

export const ARC_KEY = 'Arc_Testnet'

/** The networks most people use, in the order they are listed. */
export const PRIMARY_KEYS = ['Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia', 'Optimism_Sepolia', 'Avalanche_Fuji', 'Polygon_Amoy_Testnet']

/**
 * Chains the Bridge Kit lists but Circle's documentation tables do not (checked by scripts/verify-cctp.mjs): their USDC
 * address and contracts cannot be confirmed from Circle's pages, so the page does not offer them.
 */
export const NOT_IN_CIRCLE_DOCS = ['HyperEVM_Testnet']

const SLOW = 'about 15 to 19 minutes'
/** Standard transfer attestation times from Circle's "Finality and block confirmations" page. */
const WAIT: Record<string, string> = {
  Ethereum_Sepolia: SLOW,
  Arbitrum_Sepolia: SLOW,
  Base_Sepolia: SLOW,
  Optimism_Sepolia: SLOW,
  Codex_Testnet: SLOW,
  Plume_Testnet: SLOW,
  Unichain_Sepolia: SLOW,
  World_Chain_Sepolia: SLOW,
  X_Layer_Testnet: SLOW,
  Edge_Testnet: 'about 16 to 21 minutes',
  Ink_Testnet: 'about 30 minutes',
  Morph_Testnet: 'about 20 to 30 minutes',
  Linea_Sepolia: 'several hours (6 to 32)',
  Arc_Testnet: 'under a second',
  Avalanche_Fuji: 'about 8 seconds',
  Polygon_Amoy_Testnet: 'about 8 seconds',
  Cronos_Testnet: 'about a second',
  HyperEVM_Testnet: 'about 5 seconds',
  Injective_Testnet: 'about a second',
  Monad_Testnet: 'about 5 seconds',
  Pharos_Testnet: 'about 7 seconds',
  Plasma_Testnet: 'about a second',
  Sei_Testnet: 'about 5 seconds',
  Sonic_Testnet: 'about 8 seconds',
  XDC_Apothem: 'about 10 seconds',
}

const base = (explorerUrl: string) => explorerUrl.replace(/\/tx\/\{hash\}.*$/, '')

/** Turns the kit's chain list into routes: only EVM testnets that have USDC and CCTP V2 contracts and an RPC. */
export function buildRoutes(chains: KitChain[]): Route[] {
  const out: Route[] = []
  for (const c of chains) {
    const v2 = c.cctp?.contracts?.v2
    if (!c.isTestnet || !c.usdcAddress || !v2 || !c.rpcEndpoints?.length || c.cctp === undefined || NOT_IN_CIRCLE_DOCS.includes(c.chain)) continue
    const root = base(c.explorerUrl)
    const arc = c.chain === ARC_KEY
    out.push({
      key: c.chain,
      label: c.name,
      chainId: c.chainId,
      domain: c.cctp.domain,
      usdc: c.usdcAddress as Address,
      tokenMessenger: v2.tokenMessenger as Address,
      messageTransmitter: v2.messageTransmitter as Address,
      rpc: c.rpcEndpoints,
      native: { symbol: c.nativeCurrency.symbol, decimals: c.nativeCurrency.decimals, name: c.nativeCurrency.name },
      // Arc's explorer is the one the rest of the site links to
      txUrl: (h) => (arc ? `https://explorer.testnet.arc.io/tx/${h}` : c.explorerUrl.replace('{hash}', h)),
      addressUrl: (a) => (arc ? `https://explorer.testnet.arc.io/address/${a}` : `${root}/address/${a}`),
      forwarderDestination: !!c.cctp.forwarderSupported?.destination,
      primary: PRIMARY_KEYS.includes(c.chain),
      wait: WAIT[c.chain] ?? 'a few seconds to several minutes',
    })
  }
  return out.sort((a, b) => {
    if (a.key === ARC_KEY) return -1
    if (b.key === ARC_KEY) return 1
    const pa = PRIMARY_KEYS.indexOf(a.key)
    const pb = PRIMARY_KEYS.indexOf(b.key)
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
    return a.label.localeCompare(b.label)
  })
}

/** A viem chain for a route, used for the wallet's switch/add request and for reads. */
export function routeChain(r: Route): Chain {
  return defineChain({
    id: r.chainId,
    name: r.label,
    nativeCurrency: r.native,
    rpcUrls: { default: { http: r.rpc } },
    blockExplorers: { default: { name: 'Explorer', url: r.txUrl('').replace(/\/tx\/$/, '') } },
  })
}
