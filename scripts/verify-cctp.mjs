// Read-only check of the CCTP V2 contracts the bridge page relies on, on Arc Testnet and two source chains.
//   node scripts/verify-cctp.mjs
// It confirms: the message transmitter reports the expected CCTP domain, and the token messenger implementation
// contains the V2 seven-argument depositForBurn (and not the V1 four-argument one that Arc's exchange guide shows).
// Nothing is sent; it only reads code and storage over public RPC endpoints.
import { createPublicClient, getAddress, http, parseAbi, toFunctionSelector } from 'viem'

const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const EIP1967_IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const V2 = 'function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)'
const V2_HOOK = 'function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)'
const V1 = 'function depositForBurn(uint256,uint32,bytes32,address)'

const CHAINS = [
  ['Arc Testnet', 'https://rpc.testnet.arc.io', 26],
  ['Ethereum Sepolia', 'https://ethereum-sepolia-rpc.publicnode.com', 0],
  ['Base Sepolia', 'https://base-sepolia-rpc.publicnode.com', 6],
]

let bad = 0
for (const [name, rpc, domain] of CHAINS) {
  const c = createPublicClient({ transport: http(rpc) })
  const slot = await c.getStorageAt({ address: TOKEN_MESSENGER, slot: EIP1967_IMPLEMENTATION })
  const code = (await c.getCode({ address: getAddress('0x' + slot.slice(26)) })).toLowerCase()
  const has = (sig) => code.includes(toFunctionSelector(sig).slice(2))
  const local = await c.readContract({ address: MESSAGE_TRANSMITTER, abi: parseAbi(['function localDomain() view returns (uint32)']), functionName: 'localDomain' })
  const ok = has(V2) && has(V2_HOOK) && !has(V1) && Number(local) === domain
  if (!ok) bad++
  console.log(`${ok ? 'OK ' : 'BAD'} ${name}: localDomain ${local} (expected ${domain}), depositForBurn V2 ${has(V2)}, withHook ${has(V2_HOOK)}, V1 four-argument form ${has(V1)}`)
}
process.exit(bad ? 1 : 0)
