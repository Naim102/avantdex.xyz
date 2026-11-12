/**
 * Build-time replacement for the `wagmi/connectors` and `@wagmi/connectors` barrels (see vite.config.ts).
 *
 * ConnectKit imports only these four connectors, but the barrel also pulls in metaMask, porto, baseAccount
 * and gemini plus their dependency trees. Rollup has to parse all of that even though none of it ends up in
 * the bundle, which needs more than 1 GB of RAM and breaks builds on small servers.
 */
export { injected } from '@wagmi/core'
export { coinbaseWallet } from '../node_modules/@wagmi/connectors/dist/esm/coinbaseWallet.js'
export { safe } from '../node_modules/@wagmi/connectors/dist/esm/safe.js'
export { walletConnect } from '../node_modules/@wagmi/connectors/dist/esm/walletConnect.js'
