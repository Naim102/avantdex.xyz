// Read-only check of the CCTP V2 data the bridge page relies on. Nothing is sent to any chain.
//   node scripts/verify-cctp.mjs            checks and prints a result per check
//   node scripts/verify-cctp.mjs --table    also prints the testnet chain table in Markdown (for docs/CCTP.md)
//
// 1. The deployed contracts: Arc Testnet, Ethereum Sepolia and Base Sepolia report the expected CCTP domain, and the token
//    messenger implementation has the seven-argument V2 depositForBurn (not the four-argument V1 form that Arc's
//    exchange guide still shows).
// 2. The chain data the bridge uses (Circle's Bridge Kit) against Circle's documentation tables: every USDC address, and the
//    TokenMessengerV2 / MessageTransmitterV2 address of every domain, must match the docs.
// 3. Circle's attester public keys (Iris /v2/publicKeys): the V2 keys' addresses are enabled attesters of
//    MessageTransmitterV2 on chain, and the signature threshold is what the attestation check expects.
import { BridgeKit } from '@circle-fin/bridge-kit'
import { bytesToHex, createPublicClient, getAddress, hexToBytes, http, keccak256, parseAbi, toFunctionSelector } from 'viem'

const DOCS = 'https://developers.circle.com'
const IRIS = process.env.CCTP_API_URL ?? 'https://iris-api-sandbox.circle.com'
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const EIP1967_IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const V2 = 'function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)'
const V2_HOOK = 'function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)'
const V1 = 'function depositForBurn(uint256,uint32,bytes32,address)'

let bad = 0
const report = (ok, text) => {
  if (!ok) bad++
  console.log(`${ok ? 'OK ' : 'BAD'} ${text}`)
}
const text = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.text()
}

// ---------------------------------------------------------------- 1. deployed contracts
for (const [name, rpc, domain] of [
  ['Arc Testnet', 'https://rpc.testnet.arc.io', 26],
  ['Ethereum Sepolia', 'https://ethereum-sepolia-rpc.publicnode.com', 0],
  ['Base Sepolia', 'https://base-sepolia-rpc.publicnode.com', 6],
]) {
  const c = createPublicClient({ transport: http(rpc) })
  const slot = await c.getStorageAt({ address: TOKEN_MESSENGER, slot: EIP1967_IMPLEMENTATION })
  const code = (await c.getCode({ address: getAddress('0x' + slot.slice(26)) })).toLowerCase()
  const has = (sig) => code.includes(toFunctionSelector(sig).slice(2))
  const local = await c.readContract({ address: MESSAGE_TRANSMITTER, abi: parseAbi(['function localDomain() view returns (uint32)']), functionName: 'localDomain' })
  report(has(V2) && has(V2_HOOK) && !has(V1) && Number(local) === domain, `${name}: localDomain ${local} (expected ${domain}), depositForBurn V2 ${has(V2)}, withHook ${has(V2_HOOK)}, V1 four-argument form ${has(V1)}`)
}

// ---------------------------------------------------------------- 2. bridge data against the docs
const kit = new BridgeKit()
// chains the kit lists but Circle's docs tables do not: the bridge page does not offer them (src/lib/bridgeRoutes.ts)
const NOT_IN_CIRCLE_DOCS = ['HyperEVM_Testnet']
const all = kit.getSupportedChains({ isTestnet: true, chainType: 'evm' }).filter((c) => c.usdcAddress && c.cctp?.contracts?.v2)
const chains = all.filter((c) => !NOT_IN_CIRCLE_DOCS.includes(c.chain))
const usdcDoc = await text(`${DOCS}/stablecoins/usdc-contract-addresses.md`)
const docUsdc = new Map([...usdcDoc.matchAll(/\| ([^|\n]+?) \| \[`(0x[0-9a-fA-F]{40})`\]/g)].map((m) => [m[2].toLowerCase(), m[1].trim()]))
const missing = chains.filter((c) => !docUsdc.has(c.usdcAddress.toLowerCase()))
report(all.filter((c) => NOT_IN_CIRCLE_DOCS.includes(c.chain)).every((c) => !docUsdc.has(c.usdcAddress.toLowerCase())), `excluded from the page because Circle's docs do not list them: ${NOT_IN_CIRCLE_DOCS.join(', ')}`)
report(missing.length === 0 && chains.length > 20, `${chains.length} testnet chains: every USDC address of the bridge data is in Circle's USDC address table${missing.length ? ' (missing: ' + missing.map((c) => c.chain).join(', ') + ')' : ''}`)

const addrDoc = await text(`${DOCS}/cctp/references/contract-addresses.md`)
const testnet = addrDoc.slice(addrDoc.indexOf('## Testnet contract addresses'))
const section = (title) => {
  const start = testnet.indexOf(`### ${title}`)
  const end = testnet.indexOf('\n### ', start + 5)
  return new Map([...testnet.slice(start, end === -1 ? undefined : end).matchAll(/\| \*\*(.+?)\*\* \| (\d+) \| \[`(0x[0-9a-fA-F]{40})`\]/g)].map((m) => [Number(m[2]), m[3].toLowerCase()]))
}
const tm = section('TokenMessengerV2')
const mt = section('MessageTransmitterV2')
const wrong = chains.filter((c) => tm.get(c.cctp.domain) !== c.cctp.contracts.v2.tokenMessenger.toLowerCase() || mt.get(c.cctp.domain) !== c.cctp.contracts.v2.messageTransmitter.toLowerCase())
report(wrong.length === 0, `every TokenMessengerV2 and MessageTransmitterV2 address and CCTP domain of the bridge data matches Circle's contract address table${wrong.length ? ' (differs: ' + wrong.map((c) => c.chain).join(', ') + ')' : ''}`)
report(new Set(chains.map((c) => c.cctp.contracts.v2.tokenMessenger.toLowerCase())).size === 1, 'all testnet chains use the same TokenMessengerV2 address (the contracts are deployed at one address everywhere)')

// ---------------------------------------------------------------- 3. attesters
const addressOf = (pub) => getAddress('0x' + keccak256(bytesToHex(hexToBytes(pub).slice(1))).slice(26))
const keys = (await (await fetch(`${IRIS}/v2/publicKeys`)).json()).publicKeys
const v2 = keys.filter((k) => k.cctpVersion === 2).map((k) => addressOf(k.publicKey))
report(v2.length > 0, `${IRIS}/v2/publicKeys lists ${keys.length} keys, ${v2.length} for CCTP V2`)
const arc = createPublicClient({ transport: http('https://rpc.testnet.arc.io') })
const att = parseAbi(['function isEnabledAttester(address) view returns (bool)', 'function signatureThreshold() view returns (uint256)'])
const enabled = await Promise.all(v2.map((a) => arc.readContract({ address: MESSAGE_TRANSMITTER, abi: att, functionName: 'isEnabledAttester', args: [a] })))
const threshold = await arc.readContract({ address: MESSAGE_TRANSMITTER, abi: att, functionName: 'signatureThreshold' })
report(enabled.every(Boolean), `the V2 attester addresses derived from the public keys are enabled on Arc Testnet (${v2.join(', ')}); signature threshold ${threshold}`)

if (process.argv.includes('--table')) {
  console.log('\n| Network | Chain id | CCTP domain | USDC | Circle finishes transfers into it |\n|---|---|---|---|---|')
  for (const c of [...chains].sort((a, b) => a.cctp.domain - b.cctp.domain)) {
    console.log(`| ${c.name} | ${c.chainId} | ${c.cctp.domain} | \`${getAddress(c.usdcAddress)}\` | ${c.cctp.forwarderSupported?.destination ? 'yes' : 'no'} |`)
  }
}
process.exit(bad ? 1 : 0)
