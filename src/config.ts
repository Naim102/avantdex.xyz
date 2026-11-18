/**
 * wagmi configuration
 */

import { http, createConfig, injected } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { registerChain } from './tracing'
import { circleWallet } from './lib/circleWallet'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
// VITE_RPC_URL overrides the Arc Testnet RPC (for example a local anvil node when testing).
const rpcUrl = (import.meta.env.VITE_RPC_URL as string | undefined) || undefined

registerChain(arcTestnet.id, rpcUrl ?? arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet is needed for ENS resolution (the bridge talks to other chains through the wallet itself)
  connectors: [injected(), circleWallet()],
  transports: {
    [arcTestnet.id]: http(rpcUrl),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
