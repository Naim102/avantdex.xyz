// End-to-end test of the direct CCTP V2 Standard transfer (src/lib/directBridge.ts) against the REAL CCTP contracts,
// on local forks of two public testnets. Nothing real is touched: the forks are throw-away copies in Docker.
//
//   node scripts/test-bridge-fork.mjs
//
// Needs Docker and internet access (the forks read state from public RPCs). What it does:
//   * forks Base Sepolia and Ethereum Sepolia with anvil (Docker, ports 18545 and 18546),
//   * funds a test account with USDC on the Base fork (impersonating the USDC master minter),
//   * on the Ethereum fork, makes ONE attester key of ours the only attester of MessageTransmitterV2 (impersonating its
//     attester manager), because only Circle can sign real attestations and Circle does not know a fork's burns,
//   * serves a fake Iris API on this machine that answers like Circle's: not found, pending, then the message with its
//     nonce filled in and an attestation signed by our key; plus /v2/publicKeys,
//   * runs approve, depositForBurn, attestation polling, the attestation check and receiveMessage with the real
//     contracts, and checks the balances on both forks.
// The contracts, ABIs, message layout and call arguments are therefore the real ones; only the signer of the attestation is ours.
import assert from 'node:assert/strict'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { BridgeKit } from '@circle-fin/bridge-kit'
import { concat, decodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, numberToHex, parseAbi, slice, toEventSelector } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const IMAGE = 'ghcr.io/foundry-rs/foundry:v1.7.1'
const FORKS = {
  base: { name: 'cctp-fork-base', port: 18545, url: 'https://sepolia.base.org', key: 'Base_Sepolia' },
  eth: { name: 'cctp-fork-eth', port: 18546, url: 'https://ethereum-sepolia-rpc.publicnode.com', key: 'Ethereum_Sepolia' },
}
const IRIS_PORT = 18600
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // anvil dev account 0: public, unlocked on every fork
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ forks
const sh = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString()
const stopForks = () => Object.values(FORKS).forEach((f) => { try { sh(`docker rm -f ${f.name}`) } catch {} })
const rpcUrl = (f) => `http://127.0.0.1:${f.port}`
async function rpc(f, method, params = []) {
  const res = await fetch(rpcUrl(f), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = await res.json()
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code })
  return j.result
}
async function startForks() {
  stopForks()
  for (const f of Object.values(FORKS)) {
    // fork a few blocks behind the head: load-balanced public RPCs answer "block not found" for the newest one
    const head = BigInt((await (await fetch(f.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })).json()).result)
    sh(`docker run -d --rm --name ${f.name} -p ${f.port}:8545 --entrypoint anvil ${IMAGE} --host 0.0.0.0 --fork-url ${f.url} --fork-block-number ${head - 60n}`)
  }
  for (const f of Object.values(FORKS)) {
    for (let i = 0; ; i++) {
      try { await rpc(f, 'eth_blockNumber'); break } catch { if (i > 60) throw new Error('fork did not start: ' + f.name); await sleep(1000) }
    }
  }
}

// ------------------------------------------------------------ the code under test, bundled from TypeScript
const dir = mkdtempSync(join(tmpdir(), 'bridge-fork-'))
async function bundle(entry) {
  const out = join(dir, entry.split('/').pop().replace('.ts', '.mjs'))
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', alias: { '@': resolve('src') } })
  return import(pathToFileURL(out).href)
}
const engine = await bundle('src/lib/directBridge.ts')
const { buildRoutes } = await bundle('src/lib/bridgeRoutes.ts')

// ------------------------------------------------------------ test bookkeeping
let n = 0
const test = async (name, fn) => {
  await fn()
  n++
  console.log('PASS', name)
}

try {
  console.log('starting two forks (first start can take a minute)...')
  await startForks()

  const kit = new BridgeKit()
  const all = buildRoutes(kit.getSupportedChains({ isTestnet: true, chainType: 'evm' }))
  const base = { ...all.find((r) => r.key === FORKS.base.key), rpc: [rpcUrl(FORKS.base)] }
  const eth = { ...all.find((r) => r.key === FORKS.eth.key), rpc: [rpcUrl(FORKS.eth)] }
  assert.ok(base.usdc && eth.usdc && base.tokenMessenger)

  const call = (f, to, abi, functionName, args = []) => rpc(f, 'eth_call', [{ to, data: encodeFunctionData({ abi: parseAbi(abi), functionName, args }) }, 'latest'])
  const send = async (f, from, to, abi, functionName, args = []) => {
    const hash = await rpc(f, 'eth_sendTransaction', [{ from, to, data: encodeFunctionData({ abi: parseAbi(abi), functionName, args }) }])
    let r = null
    for (let i = 0; i < 60 && !r; i++) { r = await rpc(f, 'eth_getTransactionReceipt', [hash]); if (!r) await sleep(500) }
    assert.ok(r, `${functionName}: no receipt`)
    assert.equal(r.status, '0x1', `${functionName} reverted`)
    return r
  }
  const usdcBalance = async (f, route, who) => BigInt(await call(f, route.usdc, ['function balanceOf(address) view returns (uint256)'], 'balanceOf', [who]))
  const addr = (hex) => '0x' + hex.slice(-40)
  const impersonate = async (f, who) => { await rpc(f, 'anvil_impersonateAccount', [who]); await rpc(f, 'anvil_setBalance', [who, '0x56BC75E2D63100000']) }

  // ---------------------------------------------------------- set the scene
  await test('fund the test account with USDC on the Base fork (real FiatToken, impersonated master minter)', async () => {
    const mm = addr(await call(FORKS.base, base.usdc, ['function masterMinter() view returns (address)'], 'masterMinter'))
    await impersonate(FORKS.base, mm)
    await send(FORKS.base, mm, base.usdc, ['function configureMinter(address,uint256)'], 'configureMinter', [ACCOUNT, 10n ** 12n])
    const had = await usdcBalance(FORKS.base, base, ACCOUNT) // the public dev account may already hold some test USDC
    await send(FORKS.base, ACCOUNT, base.usdc, ['function mint(address,uint256)'], 'mint', [ACCOUNT, 100_000_000n])
    assert.equal(await usdcBalance(FORKS.base, base, ACCOUNT), had + 100_000_000n)
  })

  const attester = privateKeyToAccount(generatePrivateKey())
  const attesterPublicKey = (() => {
    // uncompressed public key of our attester, as Circle publishes it
    return attester.publicKey
  })()
  await test('make our key the only attester of the real MessageTransmitterV2 on the Ethereum fork', async () => {
    const mt = eth.messageTransmitter
    const manager = addr(await call(FORKS.eth, mt, ['function attesterManager() view returns (address)'], 'attesterManager'))
    await impersonate(FORKS.eth, manager)
    await send(FORKS.eth, manager, mt, ['function enableAttester(address)'], 'enableAttester', [attester.address])
    await send(FORKS.eth, manager, mt, ['function setSignatureThreshold(uint256)'], 'setSignatureThreshold', [1n])
    for (const old of ['0x8867a67cDa4BC788C6E819BaeaEc60b867865287', '0x49fD63506E0D88E07511aD95bAe7B2A31aF98b28']) {
      await send(FORKS.eth, manager, mt, ['function disableAttester(address)'], 'disableAttester', [old])
    }
    const threshold = BigInt(await call(FORKS.eth, mt, ['function signatureThreshold() view returns (uint256)'], 'signatureThreshold'))
    assert.equal(threshold, 1n)
  })

  // ---------------------------------------------------------- a fake Iris that answers like Circle's
  const asked = { messages: 0, keys: 0 }
  const hits = new Map() // burn tx -> number of polls
  let withhold = false
  const iris = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (url.pathname === '/v2/publicKeys') { asked.keys++; return reply(200, { publicKeys: [{ publicKey: attesterPublicKey, cctpVersion: 2 }] }) }
    const m = url.pathname.match(/^\/v2\/messages\/(\d+)$/)
    if (!m) return reply(404, {})
    asked.messages++
    const tx = url.searchParams.get('transactionHash')
    const count = (hits.get(tx) ?? 0) + 1
    hits.set(tx, count)
    const receipt = await rpc(FORKS.base, 'eth_getTransactionReceipt', [tx])
    const log = receipt?.logs?.find((l) => l.address.toLowerCase() === base.messageTransmitter.toLowerCase() && l.topics[0] === toEventSelector('MessageSent(bytes)'))
    if (!log || count === 1 || withhold) return reply(404, { error: 'Message not found' })
    let message = decodeAbiParameters([{ type: 'bytes' }], log.data)[0]
    // what Circle adds after attesting: the message nonce and the finality that was executed
    const nonce = keccak256(tx)
    message = concat([slice(message, 0, 12), nonce, slice(message, 44, 144), numberToHex(2000, { size: 4 }), slice(message, 148)])
    if (count === 2) return reply(200, { messages: [{ message, eventNonce: nonce, attestation: 'PENDING', status: 'pending_confirmations', cctpVersion: 2 }] })
    const attestation = await attester.sign({ hash: keccak256(message) })
    reply(200, { messages: [{ message, eventNonce: nonce, attestation, status: 'complete', cctpVersion: 2 }] })
  })
  await new Promise((r) => iris.listen(IRIS_PORT, '127.0.0.1', r))

  // ---------------------------------------------------------- a wallet that forwards to whichever fork it is "on"
  const byChain = { [base.chainId]: FORKS.base, [eth.chainId]: FORKS.eth }
  const makeProvider = (startChainId) => {
    let current = startChainId
    const switched = []
    return {
      switched,
      request: async ({ method, params = [] }) => {
        if (method === 'eth_chainId') return numberToHex(current)
        if (method === 'wallet_switchEthereumChain') {
          const id = Number(params[0].chainId)
          if (!byChain[id]) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })
          current = id
          switched.push(id)
          return null
        }
        return rpc(byChain[current], method, params)
      },
    }
  }
  const deps = (provider, account = ACCOUNT) => ({ provider, account, iris: `http://127.0.0.1:${IRIS_PORT}`, pollMs: 100 })
  const recorder = () => { const events = []; const fn = (id, state, info) => { events.push(`${id}:${state}${info?.tx ? ':tx' : ''}`); if (process.env.DEBUG) console.log('   step', id, state, info?.note ?? '', info?.tx ?? '') }; fn.events = events; return fn }

  // ---------------------------------------------------------- the flow
  const AMOUNT = 12_500_000n
  let firstBurn
  await test('approve, burn (Standard), wait for the attestation, check it and mint, with the real contracts', async () => {
    const provider = makeProvider(base.chainId)
    const progress = recorder()
    const before = { base: await usdcBalance(FORKS.base, base, ACCOUNT), eth: await usdcBalance(FORKS.eth, eth, ACCOUNT) }
    const { burnTx } = await engine.burnStandard(deps(provider), base, eth, AMOUNT, progress)
    firstBurn = burnTx
    assert.deepEqual(progress.events, ['approve:active', 'approve:done:tx', 'burn:active', 'burn:done:tx'])
    assert.equal(await usdcBalance(FORKS.base, base, ACCOUNT), before.base - AMOUNT, 'USDC was burned on the source chain')

    const done = recorder()
    const res = await engine.completeTransfer(deps(provider), base, eth, burnTx, done)
    assert.equal(res.alreadyDone, false)
    assert.equal(res.minted, AMOUNT)
    assert.ok(res.mintTx)
    assert.deepEqual(done.events.filter((e, i, a) => a.indexOf(e) === i), ['attest:active', 'attest:done', 'check:active', 'check:done', 'mint:active', 'mint:done:tx'])
    assert.equal(await usdcBalance(FORKS.eth, eth, ACCOUNT), before.eth + AMOUNT, 'the same amount was minted on the destination chain')
    assert.deepEqual(provider.switched, [eth.chainId], 'the wallet was switched to the destination chain for the last step')
    assert.ok(hits.get(burnTx) >= 3, 'the service was polled until it answered (not found, pending, complete)')
    assert.ok(asked.keys >= 1)
  })

  await test('finishing the same transfer again is recognised as already done and sends nothing', async () => {
    const provider = makeProvider(eth.chainId)
    const done = recorder()
    const before = await usdcBalance(FORKS.eth, eth, ACCOUNT)
    const res = await engine.completeTransfer(deps(provider), base, eth, firstBurn, done)
    assert.equal(res.alreadyDone, true)
    assert.equal(await usdcBalance(FORKS.eth, eth, ACCOUNT), before)
  })

  await test('every approval is for the exact amount, so the next transfer approves again', async () => {
    const provider = makeProvider(base.chainId)
    const progress = recorder()
    await engine.burnStandard(deps(provider), base, eth, 1_000_000n, progress)
    assert.deepEqual(progress.events.slice(0, 2), ['approve:active', 'approve:done:tx'])
  })

  await test('a pre-approved amount skips the approval', async () => {
    await send(FORKS.base, ACCOUNT, base.usdc, ['function approve(address,uint256)'], 'approve', [base.tokenMessenger, 3_000_000n])
    const progress = recorder()
    await engine.burnStandard(deps(makeProvider(base.chainId)), base, eth, 3_000_000n, progress)
    assert.deepEqual(progress.events, ['approve:skipped', 'burn:active', 'burn:done:tx'])
  })

  await test('asking for more USDC than the wallet has stops before anything is signed', async () => {
    const provider = makeProvider(base.chainId)
    await assert.rejects(() => engine.burnStandard(deps(provider), base, eth, 10_000_000_000n, recorder()), (e) => e.name === 'BridgeError' && e.code === 'balance' && /You have .* USDC on Base Sepolia/.test(e.message))
  })

  await test('a transfer stuck on the last step (no gas on the destination) is finished later from the burn hash alone', async () => {
    const provider = makeProvider(base.chainId)
    const { burnTx } = await engine.burnStandard(deps(provider), base, eth, 2_000_000n, recorder())
    const wasGas = await rpc(FORKS.eth, 'eth_getBalance', [ACCOUNT, 'latest'])
    await rpc(FORKS.eth, 'anvil_setBalance', [ACCOUNT, '0x0'])
    await assert.rejects(() => engine.completeTransfer(deps(provider), base, eth, burnTx, recorder()), (e) => e.code === 'gas' && /no ETH on Ethereum Sepolia/.test(e.message))
    assert.equal(await engine.isReceived(deps(provider), eth, await attestedNonce(burnTx)), false)
    await rpc(FORKS.eth, 'anvil_setBalance', [ACCOUNT, wasGas])
    const before = await usdcBalance(FORKS.eth, eth, ACCOUNT)
    const res = await engine.completeTransfer(deps(makeProvider(eth.chainId)), base, eth, burnTx, recorder())
    assert.equal(res.minted, 2_000_000n)
    assert.equal(await usdcBalance(FORKS.eth, eth, ACCOUNT), before + 2_000_000n)
    assert.equal(await engine.isReceived(deps(provider), eth, await attestedNonce(burnTx)), true)
  })

  async function attestedNonce(burnTx) {
    const j = await (await fetch(`http://127.0.0.1:${IRIS_PORT}/v2/messages/6?transactionHash=${burnTx}`)).json()
    return j.messages?.[0]?.eventNonce
  }

  await test('a transfer that pays another wallet is refused, so nobody finishes it by mistake', async () => {
    const { burnTx } = await engine.burnStandard(deps(makeProvider(base.chainId)), base, eth, 1_000_000n, recorder())
    await assert.rejects(() => engine.completeTransfer(deps(makeProvider(eth.chainId), OTHER), base, eth, burnTx, recorder()), (e) => e.code === 'recipient')
  })

  await test('a burn addressed to another destination domain is refused', async () => {
    const { burnTx } = await engine.burnStandard(deps(makeProvider(base.chainId)), base, eth, 1_000_000n, recorder())
    const fake = { ...eth, domain: 9 }
    await assert.rejects(() => engine.completeTransfer(deps(makeProvider(eth.chainId)), base, fake, burnTx, recorder()), (e) => e.code === 'domain')
  })

  await test('a wallet that does not know the destination chain is asked to add it', async () => {
    const added = []
    const provider = makeProvider(base.chainId)
    const inner = provider.request
    let known = false
    provider.request = async (args) => {
      if (args.method === 'wallet_switchEthereumChain' && Number(args.params[0].chainId) === eth.chainId && !known) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })
      if (args.method === 'wallet_addEthereumChain') { added.push(args.params[0].chainName); known = true; return null }
      return inner(args)
    }
    const { burnTx } = await engine.burnStandard(deps(provider), base, eth, 1_000_000n, recorder())
    const res = await engine.completeTransfer(deps(provider), base, eth, burnTx, recorder())
    assert.equal(res.minted, 1_000_000n)
    assert.deepEqual(added, ['Ethereum Sepolia'])
  })

  iris.close()
  console.log(`\n${n} passed`)
} finally {
  stopForks()
}
