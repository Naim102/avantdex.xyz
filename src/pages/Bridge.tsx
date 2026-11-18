import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, formatUnits, type EIP1193Provider } from 'viem'
import { ArrowDownUp, Check, ExternalLink, Loader2, X } from 'lucide-react'
import { BridgeKit, type BridgeResult, type EstimateResult } from '@circle-fin/bridge-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { ConnectButton } from '@/components/ConnectButton'
import { Chip, Field, Notice, PageTitle, Spinner } from '@/components/ui'
import { useConfig } from '@/hooks/useApp'
import { CIRCLE_CONNECTOR_ID } from '@/lib/circleWallet'
import { isUserRejection } from '@/lib/errors'
import { shortAddr } from '@/lib/format'
import { ARC_KEY, buildRoutes, type KitChain, type Route } from '@/lib/bridgeRoutes'
import { MIN_BRIDGE_USDC, fetchMessage, isAttested, loadRecords, parseMessage, parseUsdc, saveRecord, type BridgeRecord } from '@/lib/cctp'
import { BridgeError, burnStandard, completeTransfer, isReceived, publicClientFor, switchTo, type Progress, type StepId, type StepState } from '@/lib/directBridge'

const kit = new BridgeKit()
// Arc is read through the same RPC as the rest of the site (VITE_RPC_URL when set, for example a local chain while testing)
const ARC_RPC = (import.meta.env.VITE_RPC_URL as string | undefined) || undefined
const ROUTES = buildRoutes(kit.getSupportedChains({ isTestnet: true, chainType: 'evm' }) as unknown as KitChain[]).map((r) => (r.key === ARC_KEY && ARC_RPC ? { ...r, rpc: [ARC_RPC, ...r.rpc] } : r))
const ARC = ROUTES.find((r) => r.key === ARC_KEY)!
const OTHERS = ROUTES.filter((r) => r.key !== ARC_KEY)
const routeByKey = (key: string): Route => ROUTES.find((r) => r.key === key) ?? ARC
const IRIS_DEFAULT = 'https://iris-api-sandbox.circle.com'

type Dir = 'in' | 'out'
type Mode = 'self' | 'circle'
type Speed = 'FAST' | 'SLOW'
interface StepView {
  id: StepId
  state: StepState | 'pending'
  tx?: string
  note?: string
}

const SELF_STEPS: StepId[] = ['approve', 'burn', 'attest', 'check', 'mint']
const CIRCLE_STEPS: StepId[] = ['approve', 'burn', 'attest', 'mint']
const FINISH_STEPS: StepId[] = ['attest', 'check', 'mint']
const initial = (ids: StepId[]): StepView[] => ids.map((id, i) => ({ id, state: i === 0 ? 'active' : 'pending' }))
const EVENT_STEP: Record<string, StepId> = { approve: 'approve', burn: 'burn', fetchAttestation: 'attest', mint: 'mint' }
const NEXT: Record<string, StepId | undefined> = { approve: 'burn', burn: 'attest', attest: 'mint' }

const sum = (xs: { amount: string | null }[]) => xs.reduce((a, x) => a + Number(x.amount ?? 0), 0)
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

function describeError(e: unknown): string {
  if (e instanceof BridgeError) return e.message
  if (isUserRejection(e)) return 'You cancelled the request in your wallet. Nothing was sent.'
  if ((e as { name?: string })?.name === 'AbortError') return 'Stopped.'
  const x = e as { shortMessage?: string; message?: string }
  const msg = x?.shortMessage ?? x?.message ?? ''
  return msg ? msg.slice(0, 240) : 'The transfer could not be completed.'
}

function ChainSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const main = OTHERS.filter((r) => r.primary)
  const more = OTHERS.filter((r) => !r.primary)
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <optgroup label="Main networks">
        {main.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </optgroup>
      <optgroup label="More networks">
        {more.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </optgroup>
    </select>
  )
}

/** A step list that moves to the next step when one is done or skipped. */
function stepper(order: StepId[], setSteps: React.Dispatch<React.SetStateAction<StepView[]>>): Progress {
  return (id, state, info) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id === id) return { ...s, state, tx: info?.tx ?? s.tx, note: info?.note ?? (state === 'done' ? undefined : s.note) }
        const prevId = order[order.indexOf(s.id) - 1]
        if ((state === 'done' || state === 'skipped') && prevId === id && s.state === 'pending') return { ...s, state: 'active' }
        return s
      }),
    )
  }
}

export default function Bridge() {
  const { address, connector, isConnected } = useAccount()
  const isCircleWallet = connector?.id === CIRCLE_CONNECTOR_ID
  const queryClient = useQueryClient()
  const { data: cfg } = useConfig()
  const iris = cfg?.cctp?.api_url ?? IRIS_DEFAULT

  const [dir, setDir] = useState<Dir>('in')
  const [otherKey, setOtherKey] = useState<string>(OTHERS.find((r) => r.primary)?.key ?? OTHERS[0].key)
  const [amount, setAmount] = useState('')
  const [wanted, setWanted] = useState<Mode>('self')
  const [speed, setSpeed] = useState<Speed>('SLOW')

  const from = dir === 'in' ? routeByKey(otherKey) : ARC
  const to = dir === 'in' ? ARC : routeByKey(otherKey)
  const circleOk = to.forwarderDestination
  const mode: Mode = wanted === 'circle' && circleOk ? 'circle' : 'self'
  const raw = parseUsdc(amount)

  const balance = useQuery({
    queryKey: ['bridge-balance', from.key, address],
    queryFn: () => publicClientFor(from).readContract({ address: from.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address!] }),
    enabled: !!address,
    refetchInterval: 10_000,
    retry: 1,
  })
  const bal = balance.data
  const gasOnTo = useQuery({
    queryKey: ['bridge-gas', to.key, address],
    queryFn: () => publicClientFor(to).getBalance({ address: address! }),
    enabled: !!address && mode === 'self',
    refetchInterval: 15_000,
    retry: 1,
  })
  const noGasOnTo = mode === 'self' && gasOnTo.data === 0n

  let amountError: string | undefined
  if (amount && raw === null) amountError = 'Enter a number with at most 6 decimals.'
  else if (raw !== null && raw < BigInt(MIN_BRIDGE_USDC) * 1_000_000n) amountError = `The minimum is ${MIN_BRIDGE_USDC} USDC.`
  else if (raw !== null && bal !== undefined && raw > bal) amountError = `You only have ${formatUnits(bal, 6)} USDC on ${from.label}.`
  const validAmount = raw !== null && !amountError

  // ------------------------------------------------------------------ Circle mode: fee estimate (no transaction)
  const askKey = connector && address && validAmount && mode === 'circle' && !isCircleWallet ? `${address}|${amount}|${from.key}|${to.key}|${speed}` : null
  const [answer, setAnswer] = useState<{ key: string; est?: EstimateResult; error?: string } | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const fresh = answer && answer.key === askKey ? answer : null
  const est = fresh?.est ?? null
  const estError = fresh?.error
  const estLoading = askKey !== null && !fresh && loadingKey === askKey
  useEffect(() => {
    if (!connector || !address || !askKey) return
    let alive = true
    const ask = async () => {
      setLoadingKey(askKey)
      try {
        const provider = (await connector.getProvider()) as EIP1193Provider
        const adapter = await createViemAdapterFromProvider({ provider })
        const r = await kit.estimate({
          from: { adapter, chain: from.key as never },
          to: { adapter, chain: to.key as never, useForwarder: true },
          amount,
          config: { transferSpeed: speed },
        })
        if (alive) setAnswer({ key: askKey, est: r })
      } catch (e) {
        if (alive) setAnswer({ key: askKey, error: describeError(e) })
      }
    }
    const timer = setTimeout(() => void ask(), 700)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [connector, address, askKey, amount, from.key, to.key, speed])

  const circleFee = est ? sum(est.fees.filter((f) => f.token === 'USDC' && f.amount)) : 0
  const gasTotal = est ? est.gasFees.filter((g) => g.fees?.fee).reduce((a, g) => a + Number(g.fees?.fee ?? 0), 0) : 0
  const gasToken = est?.gasFees[0]?.token ?? from.native.symbol

  // ------------------------------------------------------------------ the transfer
  const [steps, setSteps] = useState<StepView[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<{ dir: Dir; amount: string } | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- savedAt only signals that the list changed
  const records = useMemo(() => loadRecords(address), [address, savedAt])
  const lastResult = useRef<{ result: BridgeResult; adapter: Awaited<ReturnType<typeof createViemAdapterFromProvider>> } | null>(null)
  const burnTx = useRef<string>()
  const abort = useRef<AbortController>()
  useEffect(() => () => abort.current?.abort(), [])

  // Circle mode: Bridge Kit announces each step when it completes
  useEffect(() => {
    const handlers = (['approve', 'burn', 'fetchAttestation', 'mint'] as const).map((name) => {
      const handler = (p: unknown) => {
        const values = (p as { values?: { txHash?: string; state?: string } } | undefined)?.values
        const id = EVENT_STEP[name]
        setSteps((prev) =>
          prev.map((s) => {
            if (s.id === id) return { ...s, state: values?.state === 'error' ? 'error' : 'done', tx: values?.txHash ?? s.tx }
            if (s.id === NEXT[id] && s.state === 'pending') return { ...s, state: 'active' }
            return s
          }),
        )
        if (name === 'burn' && values?.txHash) burnTx.current = values.txHash
      }
      ;(kit.on as (a: string, h: (p: unknown) => void) => void)(name, handler)
      return [name, handler] as const
    })
    return () => handlers.forEach(([name, h]) => (kit.off as (a: string, h: (p: unknown) => void) => void)(name, h))
  }, [])

  const remember = (m: Mode) => {
    if (!burnTx.current || !address) return
    saveRecord({ burnTx: burnTx.current, from: from.key, to: to.key, amount, address, mode: m, at: Date.now() })
    setSavedAt(Date.now())
  }
  const finishOk = (d: Dir, amt: string, provider?: EIP1193Provider) => {
    setDone({ dir: d, amount: amt })
    void queryClient.invalidateQueries()
    // the rest of the site runs on Arc: put the wallet back there
    if (provider) void switchTo(provider, ARC).catch(() => undefined)
  }

  /** Mode "I finish it myself": approve, burn, wait for Circle, mint with the wallet. */
  const startSelf = async () => {
    if (!connector || !address || raw === null) return
    abort.current = new AbortController()
    const provider = (await connector.getProvider()) as EIP1193Provider
    const deps = { provider, account: address, iris, signal: abort.current.signal }
    setSteps(initial(SELF_STEPS))
    const progress = stepper(SELF_STEPS, setSteps)
    const { burnTx: tx } = await burnStandard(deps, from, to, raw, progress)
    burnTx.current = tx
    remember('self')
    await completeTransfer(deps, from, to, tx, progress)
    finishOk(dir, amount, provider)
  }

  /** Mode "Circle finishes it": the Forwarding Service submits the last step. */
  const startCircle = async () => {
    if (!connector || !address) return
    setSteps(initial(CIRCLE_STEPS))
    const provider = (await connector.getProvider()) as EIP1193Provider
    await switchTo(provider, from)
    const adapter = await createViemAdapterFromProvider({ provider })
    const result = await kit.bridge({
      from: { adapter, chain: from.key as never },
      to: { adapter, chain: to.key as never, useForwarder: true },
      amount,
      config: { transferSpeed: speed },
    })
    lastResult.current = { result, adapter }
    setCanRetry(result.state === 'error')
    remember('circle')
    const byName: Record<string, StepId> = { approve: 'approve', burn: 'burn', fetchattestation: 'attest', mint: 'mint' }
    setSteps((prev) =>
      prev.map((s) => {
        const r = result.steps.find((x) => byName[x.name.toLowerCase()] === s.id)
        return r ? { ...s, state: r.state === 'error' ? 'error' : r.state === 'pending' ? s.state : 'done', tx: r.txHash ?? s.tx } : s
      }),
    )
    const bad = result.steps.find((s) => s.state === 'error')
    if (result.state === 'error' || bad) {
      setError(`The "${bad?.name ?? 'transfer'}" step failed.${bad?.errorMessage ? ' ' + String(bad.errorMessage).slice(0, 200) : ''} If USDC was already burned, press Retry: it continues from the failed step and never burns twice.`)
    } else {
      finishOk(dir, amount)
    }
  }

  const start = async () => {
    setRunning(true)
    setError(undefined)
    setDone(null)
    setCanRetry(false)
    burnTx.current = undefined
    try {
      if (mode === 'self') await startSelf()
      else await startCircle()
    } catch (e) {
      remember(mode)
      setError(describeError(e) + (burnTx.current && mode === 'self' ? ' Your USDC is safe: it was burned and Circle will still attest it. Finish the transfer from Recent transfers.' : ''))
      setSteps((prev) => prev.map((s) => (s.state === 'active' ? { ...s, state: 'error' } : s)))
    } finally {
      setRunning(false)
    }
  }

  /** Finish a remembered "self" transfer: wait for the attestation if needed, then mint. */
  const finish = async (rec: BridgeRecord) => {
    if (!connector || !address || running) return
    const f = routeByKey(rec.from)
    const t = routeByKey(rec.to)
    setRunning(true)
    setError(undefined)
    setDone(null)
    abort.current = new AbortController()
    setSteps(initial(FINISH_STEPS))
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider
      await completeTransfer({ provider, account: address, iris, signal: abort.current.signal }, f, t, rec.burnTx, stepper(FINISH_STEPS, setSteps))
      setSavedAt(Date.now())
      finishOk(rec.to === ARC_KEY ? 'in' : 'out', rec.amount, provider)
      void queryClient.invalidateQueries({ queryKey: ['bridge-record'] })
    } catch (e) {
      setError(describeError(e))
      setSteps((prev) => prev.map((s) => (s.state === 'active' ? { ...s, state: 'error' } : s)))
    } finally {
      setRunning(false)
    }
  }

  const retry = async () => {
    const last = lastResult.current
    if (!last) return
    setRunning(true)
    setError(undefined)
    try {
      const r = await kit.retry(last.result, { from: last.adapter, to: last.adapter })
      lastResult.current = { result: r, adapter: last.adapter }
      setCanRetry(r.state === 'error')
      if (r.state === 'error') setError('The transfer still has a failed step. Try again in a moment.')
      else finishOk(dir, amount)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setRunning(false)
    }
  }

  const verb = dir === 'in' ? 'Add' : 'Withdraw'
  const canStart = isConnected && !isCircleWallet && validAmount && !running && (mode === 'self' || (!!est && !estLoading))
  const received = raw !== null ? Number(formatUnits(raw, 6)) - (mode === 'circle' ? circleFee : 0) : 0
  const circleSteps = steps.length === CIRCLE_STEPS.length
  const stepLabel = (id: StepId): string =>
    ({
      approve: `Approve USDC on ${from.label}`,
      burn: `Burn USDC on ${from.label}`,
      attest: 'Circle attests the burn',
      check: 'Check Circle’s signature',
      mint: circleSteps ? `Circle mints USDC on ${to.label}` : `Mint USDC on ${to.label}`,
    })[id]

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageTitle
        title="Bridge USDC"
        subtitle="Move USDC between Arc Testnet and other test networks with Circle's Cross-Chain Transfer Protocol (CCTP V2). USDC is burned on one chain and minted on the other: no wrapped token, and Avantdex never holds your funds."
      />

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="glass space-y-5 rounded-3xl p-4 sm:p-6" aria-label="Transfer">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <Field label="From" htmlFor="bridge-from">
              {dir === 'in' ? <ChainSelect id="bridge-from" value={otherKey} onChange={setOtherKey} disabled={running} /> : <div id="bridge-from" className="field flex items-center font-semibold">{ARC.label}</div>}
            </Field>
            <button type="button" className="btn btn-ghost !min-h-11 !px-3" onClick={() => !running && setDir((d) => (d === 'in' ? 'out' : 'in'))} disabled={running} aria-label="Swap direction" title="Swap direction">
              <ArrowDownUp className="size-4 sm:rotate-90" />
            </button>
            <Field label="To" htmlFor="bridge-to">
              {dir === 'out' ? <ChainSelect id="bridge-to" value={otherKey} onChange={setOtherKey} disabled={running} /> : <div id="bridge-to" className="field flex items-center font-semibold">{ARC.label}</div>}
            </Field>
          </div>

          <Field label="Amount (USDC)" htmlFor="bridge-amount" error={amountError} hint={isConnected ? `Balance on ${from.label}: ${bal === undefined ? (balance.isError ? 'unavailable' : '…') : formatUnits(bal, 6)} USDC` : 'Connect a wallet to see your balance.'}>
            <div className="flex gap-2">
              <input id="bridge-amount" className="field tabular-nums" inputMode="decimal" placeholder="10.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={running} autoComplete="off" />
              <button type="button" className="btn btn-ghost" disabled={running || bal === undefined || bal === 0n} onClick={() => bal !== undefined && setAmount(formatUnits(bal, 6))}>
                Max
              </button>
            </div>
          </Field>

          <fieldset className="space-y-2" disabled={running}>
            <legend className="label">Who finishes the transfer?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`cursor-pointer rounded-2xl border p-3 text-sm ${mode === 'self' ? 'border-[var(--accent)] bg-[var(--tint)]' : 'border-[var(--line)]'}`}>
                <input type="radio" name="mode" className="sr-only" checked={mode === 'self'} onChange={() => setWanted('self')} />
                <span className="block font-bold">I finish it myself</span>
                <span className="mt-0.5 block text-xs font-medium text-[var(--muted)]">
                  Standard transfer, no Circle fee. After Circle signs, you confirm one last transaction on {to.label} and need a little {to.native.symbol} there for gas.
                </span>
              </label>
              <label className={`rounded-2xl border p-3 text-sm ${circleOk ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${mode === 'circle' ? 'border-[var(--accent)] bg-[var(--tint)]' : 'border-[var(--line)]'}`}>
                <input type="radio" name="mode" className="sr-only" checked={mode === 'circle'} disabled={!circleOk} onChange={() => setWanted('circle')} />
                <span className="block font-bold">Circle finishes it</span>
                <span className="mt-0.5 block text-xs font-medium text-[var(--muted)]">
                  {circleOk ? `Forwarding Service: Circle submits the last step, so you need no gas on ${to.label}. A small fee applies.` : `Circle cannot finish transfers that end on ${to.label}. Use "I finish it myself".`}
                </span>
              </label>
            </div>
          </fieldset>

          {mode === 'circle' && (
            <fieldset className="space-y-2" disabled={running}>
              <legend className="label">Speed</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ['FAST', 'Fast', 'Seconds. A small protocol fee applies on some routes.'],
                    ['SLOW', 'Standard', `No protocol fee. Waits for finality: ${from.wait} from ${from.label}.`],
                  ] as const
                ).map(([v, label, body]) => (
                  <label key={v} className={`cursor-pointer rounded-2xl border p-3 text-sm ${speed === v ? 'border-[var(--accent)] bg-[var(--tint)]' : 'border-[var(--line)]'}`}>
                    <input type="radio" name="speed" className="sr-only" checked={speed === v} onChange={() => setSpeed(v)} />
                    <span className="block font-bold">{label}</span>
                    <span className="mt-0.5 block text-xs font-medium text-[var(--muted)]">{body}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <dl className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--tint)] p-4 text-sm" aria-label="Summary">
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-[var(--muted)]">Recipient</dt>
              <dd className="mono">{address ? shortAddr(address) : 'your connected wallet'}</dd>
            </div>
            {mode === 'self' ? (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-[var(--muted)]">Circle fee</dt>
                  <dd className="tabular-nums">none (Standard)</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-[var(--muted)]">Wait for Circle</dt>
                  <dd className="text-right">{from.wait}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-[var(--muted)]">Gas you pay</dt>
                  <dd className="text-right">{from.native.symbol} on {from.label}, {to.native.symbol} on {to.label}</dd>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-[var(--muted)]">Circle fees</dt>
                  <dd className="tabular-nums">{estLoading ? <Spinner /> : est ? `about ${usd(circleFee)} USDC` : 'shown after you enter an amount'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-[var(--muted)]">Network gas on {from.label}</dt>
                  <dd className="tabular-nums">{est ? `about ${gasTotal.toPrecision(2)} ${gasToken}` : `in ${from.native.symbol}`}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3 border-t border-[var(--hair)] pt-2 font-bold">
              <dt>You receive on {to.label}</dt>
              <dd className="tabular-nums">{raw !== null && (mode === 'self' || est) ? `${mode === 'circle' ? 'about ' : ''}${usd(received)} USDC` : '–'}</dd>
            </div>
          </dl>

          {noGasOnTo && (
            <Notice tone="warn">
              You have no {to.native.symbol} on {to.label} to pay for the last step. {circleOk ? 'Get a little first, or choose "Circle finishes it".' : 'Get a little first.'}
              {to.key === ARC_KEY && (
                <>
                  {' '}
                  <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">faucet.circle.com</a>
                </>
              )}
            </Notice>
          )}
          {estError && <Notice tone="warn">The fee estimate failed: {estError}</Notice>}
          {mode === 'circle' && est && raw !== null && circleFee > Number(formatUnits(raw, 6)) * 0.05 && (
            <Notice tone="warn">
              Circle's fees are {Math.round((circleFee / Number(formatUnits(raw, 6))) * 100)}% of this amount on this route. A larger amount costs less in proportion, and so can a different chain.
            </Notice>
          )}
          {isCircleWallet && (
            <Notice tone="warn">
              Your Circle Wallet works on Arc only, so it cannot start a transfer from another network. To add USDC, send it to your Circle Wallet address on Arc from another wallet. To use this page, connect another wallet.
            </Notice>
          )}

          {!isConnected ? (
            <ConnectButton className="btn btn-primary w-full" />
          ) : (
            <button className="btn btn-primary w-full" disabled={!canStart} onClick={() => void start()}>
              {running ? <Spinner label="Transfer in progress. Confirm in your wallet…" /> : `${verb} ${amount || '0'} USDC ${dir === 'in' ? 'to Arc' : 'from Arc'}`}
            </button>
          )}
          <p className="text-center text-xs font-medium text-[var(--subtle)]">Testnet only. Test USDC has no value. The CCTP contracts are Circle's, not Avantdex's. Get test USDC at faucet.circle.com and gas from each network's faucet.</p>
        </section>

        <section className="space-y-4" aria-label="Progress">
          <div className="glass space-y-4 rounded-3xl p-4 sm:p-6">
            <h2 className="display text-xl">Progress</h2>
            {steps.length === 0 ? (
              <p className="text-sm font-medium text-[var(--muted)]">Each step appears here as it completes: approval, burn on the source chain, Circle's attestation and the mint on the destination.</p>
            ) : (
              <ol className="space-y-3" aria-live="polite">
                {steps.map((s) => (
                  <StepRow key={s.id} step={s} label={stepLabel(s.id)} txUrl={(h) => (s.id === 'mint' ? to.txUrl(h) : from.txUrl(h))} />
                ))}
              </ol>
            )}
            {error && (
              <div className="space-y-3">
                <Notice tone="error">{error}</Notice>
                {canRetry && (
                  <button className="btn btn-ghost" disabled={running} onClick={() => void retry()}>
                    Retry from the failed step
                  </button>
                )}
              </div>
            )}
            {done && (
              <Notice tone="ok">
                Done. {done.amount} USDC was {done.dir === 'in' ? 'added to' : 'withdrawn from'} Arc.{' '}
                {done.dir === 'in' && (
                  <>
                    It is in your wallet; placing an order locks what you need in the Avantdex escrow. <Link to="/explore" className="underline">Open the market board</Link>.
                  </>
                )}
              </Notice>
            )}
          </div>

          {dir === 'in' && (
            <div className="glass rounded-3xl p-4 text-sm font-medium text-[var(--muted)] sm:p-6">
              <h2 className="display mb-1.5 text-lg text-[var(--ink)]">How it reaches the escrow</h2>
              <ol className="list-decimal space-y-1 pl-5">
                <li>The bridge puts USDC in your wallet on Arc.</li>
                <li>When you place an order, the Avantdex contract locks the USDC for that order (the escrow).</li>
                <li>You can cancel an open order and get it back, or settle after the token launch.</li>
              </ol>
            </div>
          )}

          {records.length > 0 && (
            <div className="glass space-y-3 rounded-3xl p-4 sm:p-6">
              <h2 className="display text-xl">Recent transfers</h2>
              <p className="text-xs font-medium text-[var(--muted)]">Kept in this browser only. A burned transfer is safe: it can always be finished from here.</p>
              <ul className="space-y-3">
                {records.map((r) => (
                  <RecordRow key={r.burnTx} record={r} iris={iris} busy={running} canAct={isConnected && !isCircleWallet} onFinish={() => void finish(r)} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StepRow({ step, label, txUrl }: { step: StepView; label: string; txUrl: (h: string) => string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs ${step.state === 'done' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : step.state === 'error' ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-[var(--line-strong)]'}`}
        aria-hidden="true"
      >
        {step.state === 'done' || step.state === 'skipped' ? <Check className="size-3.5" /> : step.state === 'active' ? <Loader2 className="size-3.5 animate-spin" /> : step.state === 'error' ? <X className="size-3.5" /> : null}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${step.state === 'pending' ? 'text-[var(--muted)]' : ''}`}>{label}</p>
        {step.note && <p className="text-xs font-medium text-[var(--muted)]">{step.note}</p>}
        {step.tx && (
          <a href={txUrl(step.tx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent-text)] hover:underline">
            {shortAddr(step.tx)} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </li>
  )
}

interface RecordState {
  attested: boolean
  delivered: boolean
  mintTx?: string
}

function RecordRow({ record, iris, busy, canAct, onFinish }: { record: BridgeRecord; iris: string; busy: boolean; canAct: boolean; onFinish: () => void }) {
  const from = routeByKey(record.from)
  const to = routeByKey(record.to)
  const { data, isError } = useQuery<RecordState>({
    queryKey: ['bridge-record', record.burnTx, iris],
    queryFn: async () => {
      const m = await fetchMessage(iris, from.domain, record.burnTx)
      if (!isAttested(m)) return { attested: false, delivered: false }
      if (record.mode === 'circle') return { attested: true, delivered: !!m.destinationMintTxHash, mintTx: m.destinationMintTxHash }
      return { attested: true, delivered: (await isReceived({}, to, parseMessage(m.message).nonce)) === true }
    },
    refetchInterval: (q) => (q.state.data?.delivered ? false : 10_000),
  })
  const delivered = !!data?.delivered
  const ready = record.mode === 'self' && !!data?.attested && !delivered
  return (
    <li className="space-y-1.5 rounded-2xl border border-[var(--line)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {record.amount} USDC · {from.label} to {to.label}
        </span>
        <Chip tone={delivered ? 'ok' : ready ? 'accent' : 'warn'}>
          {delivered ? 'Delivered' : isError ? 'Status unavailable' : ready ? 'Ready to finish' : data?.attested ? 'Circle is minting' : 'Waiting for Circle'}
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <a href={from.txUrl(record.burnTx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline">
          Burn {shortAddr(record.burnTx)} <ExternalLink className="size-3" />
        </a>
        {data?.mintTx && (
          <a href={to.txUrl(data.mintTx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline">
            Mint {shortAddr(data.mintTx)} <ExternalLink className="size-3" />
          </a>
        )}
        {record.mode === 'self' && !delivered && (
          <button type="button" className="btn btn-ghost !min-h-8 !px-3 text-xs" disabled={busy || !canAct} onClick={onFinish}>
            {data?.attested ? `Finish on ${to.label}` : 'Wait and finish'}
          </button>
        )}
      </div>
    </li>
  )
}
