// Unit test for src/lib/circleProvider.ts (the EIP-1193 wrapper around a Circle smart account), with fake accounts.
//   node scripts/test-circle-provider.mjs
// It bundles the TypeScript file with esbuild (already installed with Vite) and runs plain assertions: no browser,
// no network, no Circle credentials.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'circle-provider-'))
const out = join(dir, 'provider.mjs')
await build({ entryPoints: ['src/lib/circleProvider.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' })
const { createCircleProvider, describeCircleError, isPasskeyCancelled, ProviderError } = await import(pathToFileURL(out).href)

const ADDRESS = '0x1111111111111111111111111111111111111111'
const TARGET = '0x2222222222222222222222222222222222222222'
const HASH = '0x' + 'ab'.repeat(32)
const TX = '0x' + 'cd'.repeat(32)

function make(over = {}) {
  const log = { signed: [], sent: [], reads: [] }
  const deps = {
    account: { address: ADDRESS, signMessage: async (a) => (log.signed.push(a.message.raw), '0xsigned') },
    bundler: {
      sendUserOperation: async (a) => (log.sent.push({ calls: a.calls, paymaster: a.paymaster }), HASH),
      waitForUserOperationReceipt: async () => ({ success: true, receipt: { transactionHash: TX } }),
    },
    publicClient: { request: async (a) => (log.reads.push(a.method), '0xread') },
    chainId: 5042002,
    paymaster: true,
    ...over,
  }
  return { p: createCircleProvider(deps), log, deps }
}

let n = 0
const test = async (name, fn) => {
  await fn()
  n++
  console.log('PASS', name)
}

await test('reports the account and the Arc chain id', async () => {
  const { p } = make()
  assert.deepEqual(await p.request({ method: 'eth_accounts' }), [ADDRESS])
  assert.deepEqual(await p.request({ method: 'eth_requestAccounts' }), [ADDRESS])
  assert.equal(await p.request({ method: 'eth_chainId' }), '0x4cef52')
  assert.equal(await p.request({ method: 'net_version' }), '5042002')
})

await test('personal_sign signs the exact bytes the app sent', async () => {
  const { p, log } = make()
  const hex = '0x' + Buffer.from('Sign in to Avantdex', 'utf8').toString('hex')
  assert.equal(await p.request({ method: 'personal_sign', params: [hex, ADDRESS.toUpperCase().replace('0X', '0x')] }), '0xsigned')
  assert.deepEqual(log.signed, [hex])
  await assert.rejects(() => p.request({ method: 'personal_sign', params: [hex, TARGET] }), (e) => e instanceof ProviderError && e.code === 4100)
})

await test('eth_sendTransaction becomes one sponsored user operation and returns the chain transaction hash', async () => {
  const { p, log } = make()
  const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from: ADDRESS, to: TARGET, data: '0xdeadbeef', value: '0x0', gas: '0x5208', maxFeePerGas: '0x1' }] })
  assert.equal(hash, TX)
  assert.equal(log.sent.length, 1)
  assert.deepEqual(log.sent[0], { calls: [{ to: TARGET, data: '0xdeadbeef', value: undefined }], paymaster: true })
})

await test('a value transfer keeps its value', async () => {
  const { p, log } = make()
  await p.request({ method: 'eth_sendTransaction', params: [{ to: TARGET, value: '0xde0b6b3a7640000' }] })
  assert.equal(log.sent[0].calls[0].value, 1000000000000000000n)
})

await test('when Gas Station cannot sponsor, the wallet pays with its own USDC', async () => {
  let calls = 0
  const { p, log } = make({
    bundler: {
      sendUserOperation: async (a) => {
        calls++
        if (a.paymaster) throw new Error('paymaster policy not found')
        log.sent.push({ paymaster: a.paymaster })
        return HASH
      },
      waitForUserOperationReceipt: async () => ({ success: true, receipt: { transactionHash: TX } }),
    },
  })
  assert.equal(await p.request({ method: 'eth_sendTransaction', params: [{ to: TARGET, data: '0x' }] }), TX)
  assert.equal(calls, 2)
  assert.deepEqual(log.sent, [{ paymaster: false }])
})

await test('a cancelled passkey prompt is not retried', async () => {
  let calls = 0
  const cancelled = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
  const { p } = make({
    bundler: {
      sendUserOperation: async () => {
        calls++
        throw cancelled
      },
      waitForUserOperationReceipt: async () => ({ success: true, receipt: { transactionHash: TX } }),
    },
  })
  await assert.rejects(() => p.request({ method: 'eth_sendTransaction', params: [{ to: TARGET }] }), cancelled)
  assert.equal(calls, 1)
})

await test('paymaster disabled: a single attempt without sponsorship', async () => {
  const { p, log } = make({ paymaster: false })
  await p.request({ method: 'eth_sendTransaction', params: [{ to: TARGET }] })
  assert.deepEqual(log.sent.map((s) => s.paymaster), [false])
})

await test('a reverted user operation is an error, not a hash', async () => {
  const { p } = make({ bundler: { sendUserOperation: async () => HASH, waitForUserOperationReceipt: async () => ({ success: false, reason: 'OrderNotOpen', receipt: { transactionHash: TX } }) } })
  await assert.rejects(() => p.request({ method: 'eth_sendTransaction', params: [{ to: TARGET }] }), /reverted: OrderNotOpen/)
})

await test('refuses what a smart account cannot do', async () => {
  const { p } = make()
  await assert.rejects(() => p.request({ method: 'eth_sendTransaction', params: [{ data: '0x6000' }] }), /Deploying a contract/)
  await assert.rejects(() => p.request({ method: 'eth_sendTransaction', params: [{ from: TARGET, to: TARGET }] }), (e) => e.code === 4100)
  for (const method of ['eth_signTypedData_v4', 'eth_sign', 'eth_signTransaction', 'eth_sendRawTransaction']) {
    await assert.rejects(() => p.request({ method, params: [] }), (e) => e.code === 4200)
  }
})

await test('only Arc: switching to the same chain works, to another chain is refused', async () => {
  const { p } = make()
  assert.equal(await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x4cef52' }] }), null)
  await assert.rejects(() => p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }), (e) => e.code === 4902)
})

await test('reads go to the public RPC', async () => {
  const { p, log } = make()
  assert.equal(await p.request({ method: 'eth_getBalance', params: [ADDRESS, 'latest'] }), '0xread')
  assert.deepEqual(log.reads, ['eth_getBalance'])
})

await test('error messages are plain', async () => {
  assert.ok(isPasskeyCancelled(Object.assign(new Error('x'), { name: 'NotAllowedError' })))
  assert.ok(isPasskeyCancelled(new Error('User rejected the request')))
  assert.ok(!isPasskeyCancelled(new Error('gas too low')))
  assert.match(describeCircleError(Object.assign(new Error('x'), { name: 'SecurityError' }), 'avantdex.xyz'), /avantdex\.xyz is not registered as the Passkey Domain/)
  assert.match(describeCircleError(new Error('Request failed with status 401'), 'h'), /Client Key/)
  assert.match(describeCircleError(new Error('An unknown RPC error occurred. Details: Returned error: Invalid credentials.'), 'h'), /Client Key/)
  assert.match(describeCircleError(new Error('AA21 didn\'t pay prefund'), 'h'), /no USDC for gas/)
  assert.match(describeCircleError(Object.assign(new Error('x'), { name: 'InvalidStateError' }), 'h'), /already exists/)
})

writeFileSync(join(dir, 'done'), 'ok')
console.log(`\n${n} passed`)
