// Unit test for src/lib/cctp.ts and src/lib/bridgeRoutes.ts: message parsing, the Iris polling loop, the check of an
// attestation against Circle's attester keys, and the chain list. No network, no wallet.
//   node scripts/test-cctp.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { concat, encodePacked, keccak256, numberToHex, pad, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'

const dir = mkdtempSync(join(tmpdir(), 'cctp-'))
const bundle = async (entry) => {
  const out = join(dir, entry.split('/').pop().replace('.ts', '.mjs'))
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', alias: { '@': resolve('src') } })
  return import(pathToFileURL(out).href)
}
const cctp = await bundle('src/lib/cctp.ts')
const routes = await bundle('src/lib/bridgeRoutes.ts')

let n = 0
const test = async (name, fn) => {
  await fn()
  n++
  console.log('PASS', name)
}

/** A real-shaped CCTP V2 burn message: header (148 bytes) + burn body (228 bytes). */
function makeMessage({ source = 6, dest = 26, nonce = '0x' + '11'.repeat(32), recipient, amount = 5_000_000n, feeExecuted = 0n }) {
  const w = (a) => pad(a, { size: 32 })
  const header = encodePacked(
    ['uint32', 'uint32', 'uint32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint32', 'uint32'],
    [1, source, dest, nonce, w('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'), w('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'), '0x' + '00'.repeat(32), 2000, 2000],
  )
  const body = concat([
    numberToHex(1, { size: 4 }),
    w('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    w(recipient),
    numberToHex(amount, { size: 32 }),
    w('0x00000000000000000000000000000000000000aa'),
    numberToHex(0n, { size: 32 }),
    numberToHex(feeExecuted, { size: 32 }),
    numberToHex(0n, { size: 32 }),
  ])
  return concat([header, body])
}

const RECIPIENT = '0x1D77c052aA76e90478695535e8283f3F5986cDDB'

await test('a V2 message is read field by field', async () => {
  const m = cctp.parseMessage(makeMessage({ recipient: RECIPIENT, amount: 7_500_000n, feeExecuted: 1000n }))
  assert.equal(m.version, 1)
  assert.equal(m.sourceDomain, 6)
  assert.equal(m.destinationDomain, 26)
  assert.equal(m.nonce, '0x' + '11'.repeat(32))
  assert.equal(m.minFinalityThreshold, 2000)
  const b = cctp.parseBurnBody(m.body)
  assert.equal(b.mintRecipient, RECIPIENT)
  assert.equal(b.amount, 7_500_000n)
  assert.equal(b.feeExecuted, 1000n)
  assert.equal(b.burnToken, '0x036CbD53842c5426634e7929541eC2318f3dCF7e')
  assert.throws(() => cctp.parseMessage('0x1234'), /too short/)
  assert.throws(() => cctp.parseBurnBody('0x12'), /burn message/)
})

await test("Circle's published public keys give the attester addresses that are enabled on chain", async () => {
  // the V2 keys of https://iris-api-sandbox.circle.com/v2/publicKeys; both addresses were read as enabled attesters
  // on Arc Testnet, Ethereum Sepolia and Base Sepolia (scripts/verify-cctp.mjs repeats that check)
  assert.equal(cctp.attesterAddress('0x04bea91197b05e88b24dd660a7ae7e4724177da8a150bbd46616d9d5aa1f359e345a6b43234af1df89cfce475e2fab48b7f5fbed71b0273457421ef32b6f31ca5c'), '0x8867a67cDa4BC788C6E819BaeaEc60b867865287')
  assert.equal(cctp.attesterAddress('0x043ab8156da6402db09667050b9a28d644fb11491567fc8c1f956367ca4b7840b8d2798e1a3170e5d7ef763ed745a477b10dab75c19dedd2f84258c37fd0072386'), '0x49fD63506E0D88E07511aD95bAe7B2A31aF98b28')
  assert.throws(() => cctp.attesterAddress('0x1234'), /uncompressed/)
})

// two attesters of our own, in a published-keys list that also holds a V1 key that must be ignored
const attesters = [0, 1, 2].map(() => {
  const pk = generatePrivateKey()
  const account = privateKeyToAccount(pk)
  const publicKey = '0x' + Buffer.from(secp256k1.getPublicKey(pk.slice(2), false)).toString('hex')
  return { pk, address: account.address, publicKey, account }
})
const [a1, a2, v1only] = attesters
const keys = [
  { publicKey: a1.publicKey, cctpVersion: 2 },
  { publicKey: a2.publicKey, cctpVersion: 2 },
  { publicKey: v1only.publicKey, cctpVersion: 1 },
]
const sign = async (account, message) => account.sign({ hash: keccak256(message) })
const ascending = (list) => [...list].sort((x, y) => (BigInt(x.address) < BigInt(y.address) ? -1 : 1))

await test('an attestation signed by the published V2 attesters is accepted', async () => {
  const message = makeMessage({ recipient: RECIPIENT })
  const att = concat(await Promise.all(ascending([a1, a2]).map((a) => sign(a.account, message))))
  assert.deepEqual(await cctp.verifyAttestation({ message, attestation: att, keys, threshold: 2 }), { ok: true, signers: ascending([a1, a2]).map((a) => a.address) })
  const one = await sign(a1.account, message)
  assert.equal((await cctp.verifyAttestation({ message, attestation: one, keys, threshold: 1 })).ok, true)
  assert.equal((await cctp.verifyAttestation({ message, attestation: one, keys })).ok, true)
})

await test('a bad attestation is explained', async () => {
  const message = makeMessage({ recipient: RECIPIENT })
  const sigs = await Promise.all(ascending([a1, a2]).map((a) => sign(a.account, message)))
  const bad = async (att, threshold, k = keys) => cctp.verifyAttestation({ message, attestation: att, keys: k, threshold })
  assert.match((await bad(concat([...sigs].reverse()), 2)).reason, /increasing signer order/)
  assert.match((await bad(sigs[0], 2)).reason, /wants 2 signatures and the attestation has 1/)
  assert.match((await bad('0x1234', 1)).reason, /whole number of 65-byte/)
  assert.match((await bad(await sign(v1only.account, message), 1)).reason, /not one of Circle's published attesters/)
  assert.match((await bad(await sign(privateKeyToAccount(generatePrivateKey()), message), 1)).reason, /not one of Circle's published attesters/)
  assert.match((await bad(sigs[0], 1, [])).reason, /no V2 attester keys/)
  const other = makeMessage({ recipient: RECIPIENT, amount: 9n })
  assert.equal((await cctp.verifyAttestation({ message: other, attestation: concat(sigs), keys, threshold: 2 })).ok, false)
})

const realFetch = globalThis.fetch
const withFetch = async (handler, fn) => {
  globalThis.fetch = handler
  try {
    return await fn()
  } finally {
    globalThis.fetch = realFetch
  }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

await test('polling waits through "not found", "pending" and a server error, then returns the attested message', async () => {
  const message = makeMessage({ recipient: RECIPIENT })
  const att = await sign(a1.account, message)
  let calls = 0
  const urls = []
  const seen = []
  const out = await withFetch(
    async (url) => {
      urls.push(String(url))
      calls++
      if (calls === 1) return json(404, { error: 'Message not found' })
      if (calls === 2) return json(500, {})
      if (calls === 3) return json(200, { messages: [{ status: 'pending_confirmations', attestation: 'PENDING', message }] })
      return json(200, { messages: [{ status: 'complete', attestation: att, message }] })
    },
    () => cctp.waitForAttestation('https://iris.example/', 6, '0xabc', { intervalMs: 5, onTick: (ms, m) => seen.push(m?.status ?? null) }),
  )
  assert.equal(calls, 4)
  assert.equal(urls[0], 'https://iris.example/v2/messages/6?transactionHash=0xabc')
  assert.deepEqual(seen, [null, null, 'pending_confirmations', 'complete'])
  assert.equal(out.attestation, att)
})

await test('polling stops on abort and on timeout', async () => {
  const ctl = new AbortController()
  await withFetch(
    async () => json(404, {}),
    async () => {
      setTimeout(() => ctl.abort(), 30)
      await assert.rejects(() => cctp.waitForAttestation('https://iris.example', 6, '0xabc', { intervalMs: 10, signal: ctl.signal }), (e) => e.name === 'AbortError')
      await assert.rejects(() => cctp.waitForAttestation('https://iris.example', 6, '0xabc', { intervalMs: 5, timeoutMs: 20 }), /not attested this burn yet/)
    },
  )
})

await test('the public key list is read from the Iris base URL', async () => {
  let url
  const list = await withFetch(
    async (u) => ((url = String(u)), json(200, { publicKeys: keys })),
    () => cctp.fetchPublicKeys('https://iris.example///'),
  )
  assert.equal(url, 'https://iris.example/v2/publicKeys')
  assert.equal(list.length, 3)
  await withFetch(async () => json(503, {}), () => assert.rejects(() => cctp.fetchPublicKeys('https://iris.example'), /answered 503/))
})

await test('amounts: six decimals, nothing else', async () => {
  assert.equal(cctp.parseUsdc('12.5'), 12_500_000n)
  assert.equal(cctp.parseUsdc('0.000001'), 1n)
  assert.equal(cctp.parseUsdc('7'), 7_000_000n)
  for (const bad of ['', 'abc', '1.1234567', '-1', '1,5', '1e3', ' ']) assert.equal(cctp.parseUsdc(bad), null)
})

await test('the chain list keeps only testnets with USDC, CCTP V2 and an RPC, Arc first, the usual networks next', async () => {
  const mk = (chain, domain, over = {}) => ({
    chain, name: chain.replace(/_/g, ' '), chainId: domain + 1000, isTestnet: true, explorerUrl: `https://scan.example/${chain}/tx/{hash}`, rpcEndpoints: ['https://rpc.example/' + chain],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, usdcAddress: '0x' + String(domain).padStart(40, '0'),
    cctp: { domain, contracts: { v2: { tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' } }, forwarderSupported: { source: false, destination: true } }, ...over,
  })
  const list = routes.buildRoutes([
    mk('Zeta_Testnet', 50), mk('Base_Sepolia', 6), mk('Arc_Testnet', 26), mk('Ethereum_Sepolia', 0), mk('Alpha_Testnet', 51),
    mk('HyperEVM_Testnet', 19), mk('No_Usdc', 60, { usdcAddress: null }), mk('Mainnet_Thing', 61, { isTestnet: false }), mk('No_V2', 62, { cctp: { domain: 62, contracts: {} } }), mk('No_Rpc', 63, { rpcEndpoints: [] }),
    mk('Arbitrum_Sepolia', 3, { cctp: { domain: 3, contracts: { v2: { tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' } }, forwarderSupported: { source: false, destination: false } } }),
  ])
  assert.deepEqual(list.map((r) => r.key), ['Arc_Testnet', 'Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia', 'Alpha_Testnet', 'Zeta_Testnet'])
  const arc = list[0]
  assert.equal(arc.txUrl('0xabc'), 'https://explorer.testnet.arc.io/tx/0xabc')
  assert.equal(list[1].txUrl('0xabc'), 'https://scan.example/Ethereum_Sepolia/tx/0xabc')
  assert.equal(list[1].addressUrl('0xdef'), 'https://scan.example/Ethereum_Sepolia/address/0xdef')
  assert.equal(list[1].primary, true)
  assert.equal(list[4].primary, false)
  assert.equal(list[3].forwarderDestination, false)
  assert.equal(list[1].wait, 'about 15 to 19 minutes')
  assert.equal(arc.wait, 'under a second')
  assert.equal(routes.routeChain(list[2]).id, 6 + 1000)
})

console.log(`\n${n} passed`)
