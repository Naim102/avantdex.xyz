import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConnectButton } from '@/components/ConnectButton'
import { erc20Abi, formatUnits, type EIP1193Provider } from 'viem'
import { ArrowDownUp, Check, ExternalLink, Loader2, X } from 'lucide-react'
import { BridgeKit, type BridgeResult, type EstimateResult } from '@circle-fin/bridge-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { Chip, Field, Notice, PageTitle, Spinner } from '@/components/ui'
import { isUserRejection } from '@/lib/errors'
import { CIRCLE_CONNECTOR_ID } from '@/lib/circleWallet'
import { shortAddr } from '@/lib/format'
import {
  ARC_ROUTE,
  MIN_BRIDGE_USDC,
  OTHER_ROUTES,
  fetchTransferStatus,
  loadRecords,
  parseUsdc,
  routeByKey,
  saveRecord,
  type BridgeRecord,
} from '@/lib/bridge'

const kit = new BridgeKit()
const usdcOf = (key: string) => kit.getSupportedChains().find((c) => String(c.chain) === key)?.usdcAddress as `0x${string}` | undefined

type Dir = 'in' | 'out'
type Speed = 'FAST' | 'SLOW'
type StepId = 'approve' | 'burn' | 'attest' | 'mint'
type StepState = 'pending' | 'active' | 'done' | 'error'
interface StepView {
  id: StepId
  state: StepState
  tx?: string
}

const EVENT_STEP: Record<string, StepId> = { approve: 'approve', burn: 'burn', fetchAttestation: 'attest', mint: 'mint' }
const NEXT: Record<StepId, StepId | null> = { approve: 'burn', burn: 'attest', attest: 'mint', mint: null }
const initialSteps = (): StepView[] => [
  { id: 'approve', state: 'active' },
  { id: 'burn', state: 'pending' },
  { id: 'attest', state: 'pending' },
  { id: 'mint', state: 'pending' },
]

const sum = (xs: { amount: string | null }[]) => xs.reduce((a, x) => a + Number(x.amount ?? 0), 0)
const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

function describeError(e: unknown): string {
  if (isUserRejection(e)) return 'You cancelled the request in your wallet. Nothing was sent.'
  const msg = (e as { message?: string })?.message ?? ''
  return msg ? msg.slice(0, 220) : 'The transfer could not be completed.'
}

export default function Bridge() {
  const { address, connector, chainId, isConnected } = useAccount()
  const isCircle = connector?.id === CIRCLE_CONNECTOR_ID
  const { switchChainAsync } = useSwitchChain()
  const queryClient = useQueryClient()

  const [dir, setDir] = useState<Dir>('in')
  const [otherKey, setOtherKey] = useState<string>(OTHER_ROUTES[0].key)
  const [amount, setAmount] = useState('')
  const [speed, setSpeed] = useState<Speed>('FAST')

  const from = dir === 'in' ? routeByKey(otherKey) : ARC_ROUTE
  const to = dir === 'in' ? ARC_ROUTE : routeByKey(otherKey)
  const raw = parseUsdc(amount)

  const balance = useReadContract({
    address: usdcOf(from.key),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: from.chain.id,
    query: { enabled: !!address, refetchInterval: 8000 },
  })
  const bal = balance.data

  let amountError: string | undefined
  if (amount && raw === null) amountError = 'Enter a number with at most 6 decimals.'
  else if (raw !== null && raw < BigInt(MIN_BRIDGE_USDC) * 1_000_000n) amountError = `The minimum is ${MIN_BRIDGE_USDC} USDC.`
  else if (raw !== null && bal !== undefined && raw > bal) amountError = `You only have ${formatUnits(bal, 6)} USDC on ${from.label}.`
  const validAmount = raw !== null && !amountError

  // ------------------------------------------------------------------ fee estimate (Circle fee service, no transaction)
  // The answer is kept together with the inputs it was asked for, so a stale answer is simply not shown.
  const askKey = connector && address && validAmount && !isCircle ? `${address}|${amount}|${from.key}|${to.key}|${speed}` : null
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
          from: { adapter, chain: from.key },
          to: { adapter, chain: to.key, useForwarder: true },
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
  const gasToken = est?.gasFees[0]?.token ?? from.gas

  // ------------------------------------------------------------------ the transfer
  const [steps, setSteps] = useState<StepView[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)
  const lastResult = useRef<{ result: BridgeResult; adapter: Awaited<ReturnType<typeof createViemAdapterFromProvider>> } | null>(null)
  const burnTx = useRef<string>()
  const [canRetry, setCanRetry] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- savedAt only signals that the list changed
  const records = useMemo(() => loadRecords(address), [address, savedAt])

  // live progress: Bridge Kit announces each step when it completes
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
      // the event names are typed per provider; the payload shape is the same for all four
      ;(kit.on as (a: string, h: (p: unknown) => void) => void)(name, handler)
      return [name, handler] as const
    })
    return () => handlers.forEach(([name, h]) => (kit.off as (a: string, h: (p: unknown) => void) => void)(name, h))
  }, [])

  const remember = () => {
    if (!burnTx.current || !address) return
    saveRecord({ burnTx: burnTx.current, from: from.key, to: to.key, amount, address, at: Date.now() })
    setSavedAt(Date.now())
  }

  const finish = (result: BridgeResult) => {
    const byName: Record<string, StepId> = { approve: 'approve', burn: 'burn', fetchattestation: 'attest', mint: 'mint' }
    setSteps((prev) =>
      prev.map((s) => {
        const r = result.steps.find((x) => byName[x.name.toLowerCase()] === s.id)
        if (!r) return s
        return { ...s, state: r.state === 'error' ? 'error' : r.state === 'pending' ? s.state : 'done', tx: r.txHash ?? s.tx }
      }),
    )
    const bad = result.steps.find((s) => s.state === 'error')
    if (result.state === 'error' || bad) {
      setError(`The "${bad?.name ?? 'transfer'}" step failed.${bad?.errorMessage ? ' ' + String(bad.errorMessage).slice(0, 200) : ''} If USDC was already burned, press Retry: it continues from the failed step and never burns twice.`)
    } else {
      setDone(true)
      void queryClient.invalidateQueries()
    }
  }

  const start = async () => {
    if (!connector || !address || !validAmount || !est) return
    setRunning(true)
    setError(undefined)
    setDone(false)
    setCanRetry(false)
    setSteps(initialSteps())
    burnTx.current = undefined
    try {
      if (chainId !== from.chain.id) await switchChainAsync({ chainId: from.chain.id })
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider })
      const result = await kit.bridge({
        from: { adapter, chain: from.key },
        to: { adapter, chain: to.key, useForwarder: true },
        amount,
        config: { transferSpeed: speed },
      })
      lastResult.current = { result, adapter }
      setCanRetry(result.state === 'error')
      remember()
      finish(result)
    } catch (e) {
      remember()
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
      finish(r)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setRunning(false)
    }
  }

  const flip = () => {
    if (running) return
    setDir((d) => (d === 'in' ? 'out' : 'in'))
  }

  const verb = dir === 'in' ? 'Add' : 'Withdraw'
  const canStart = isConnected && !isCircle && validAmount && !!est && !running && !estLoading

  return (
    <div className="space-y-8">
      <PageTitle
        title="Bridge USDC"
        subtitle="Move USDC between Arc Testnet and other test networks with Circle's Cross-Chain Transfer Protocol (CCTP). USDC is burned on one chain and minted on the other: no wrapped token, and Avantdex never holds your funds."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="glass space-y-5 rounded-3xl p-5 sm:p-6" aria-label="Transfer">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <Field label="From" htmlFor="bridge-from">
              {dir === 'in' ? (
                <select id="bridge-from" className="field" value={otherKey} onChange={(e) => setOtherKey(e.target.value)} disabled={running}>
                  {OTHER_ROUTES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              ) : (
                <div id="bridge-from" className="field flex items-center font-semibold">{ARC_ROUTE.label}</div>
              )}
            </Field>
            <button type="button" className="btn btn-ghost !min-h-11 !px-3 sm:mb-0" onClick={flip} disabled={running} aria-label="Swap direction" title="Swap direction">
              <ArrowDownUp className="size-4 sm:rotate-90" />
            </button>
            <Field label="To" htmlFor="bridge-to">
              {dir === 'out' ? (
                <select id="bridge-to" className="field" value={otherKey} onChange={(e) => setOtherKey(e.target.value)} disabled={running}>
                  {OTHER_ROUTES.map((r) => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              ) : (
                <div id="bridge-to" className="field flex items-center font-semibold">{ARC_ROUTE.label}</div>
              )}
            </Field>
          </div>

          <Field label="Amount (USDC)" htmlFor="bridge-amount" error={amountError} hint={isConnected ? `Balance on ${from.label}: ${bal === undefined ? '…' : formatUnits(bal, 6)} USDC` : 'Connect a wallet to see your balance.'}>
            <div className="flex gap-2">
              <input id="bridge-amount" className="field tabular-nums" inputMode="decimal" placeholder="10.00" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={running} autoComplete="off" />
              <button type="button" className="btn btn-ghost" disabled={running || bal === undefined || bal === 0n} onClick={() => bal !== undefined && setAmount(formatUnits(bal, 6))}>
                Max
              </button>
            </div>
          </Field>

          <fieldset className="space-y-2" disabled={running}>
            <legend className="label">Speed</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['FAST', 'Fast', 'Seconds. A small Circle fee applies on some routes.'],
                  ['SLOW', 'Standard', 'No Circle protocol fee. Takes longer on chains with slow finality, up to about 20 minutes.'],
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

          <dl className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--tint)] p-4 text-sm" aria-label="Summary">
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-[var(--muted)]">Recipient</dt>
              <dd className="mono">{address ? shortAddr(address) : 'your connected wallet'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-[var(--muted)]">Circle fees</dt>
              <dd className="tabular-nums">{estLoading ? <Spinner /> : est ? `about ${usd(circleFee)} USDC` : 'shown after you enter an amount'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-[var(--muted)]">Network gas on {from.label}</dt>
              <dd className="tabular-nums">{est ? `about ${gasTotal.toPrecision(2)} ${gasToken}` : `in ${from.gas}`}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-[var(--hair)] pt-2 font-bold">
              <dt>You receive on {to.label}</dt>
              <dd className="tabular-nums">{est && raw !== null ? `about ${usd(Number(formatUnits(raw, 6)) - circleFee)} USDC` : '–'}</dd>
            </div>
          </dl>
          {estError && <Notice tone="warn">The fee estimate failed: {estError}</Notice>}
          {est && raw !== null && circleFee > Number(formatUnits(raw, 6)) * 0.05 && (
            <Notice tone="warn">
              Circle's fees are {Math.round((circleFee / Number(formatUnits(raw, 6))) * 100)}% of this amount on this route. A larger amount costs less in proportion, and so can a different chain.
            </Notice>
          )}

          {isCircle && (
            <Notice tone="warn">
              Your Circle Wallet works on Arc only, so it cannot start a transfer from another network. To add USDC, send it to your Circle Wallet address on Arc from another wallet. To use this page, connect another wallet.
            </Notice>
          )}
          <Notice>
            Circle completes the transfer on {to.label} for you (the Forwarding Service), so you do not need gas there. You sign two wallet requests on {from.label}: an approval and the burn. You need a little {from.gas} on {from.label} for gas
            {dir === 'in' ? (
              <>
                {' '}and test USDC from{' '}
                <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">faucet.circle.com</a>
              </>
            ) : null}
            .
          </Notice>

          {!isConnected ? (
            <ConnectButton className="btn btn-primary w-full" />
          ) : (
            <button className="btn btn-primary w-full" disabled={!canStart} onClick={() => void start()}>
              {running ? <Spinner label="Transfer in progress. Confirm in your wallet…" /> : `${verb} ${amount || '0'} USDC ${dir === 'in' ? 'to Arc' : 'from Arc'}`}
            </button>
          )}
          <p className="text-center text-xs font-medium text-[var(--subtle)]">Testnet only. Test USDC has no value. CCTP contracts are Circle's, not Avantdex's.</p>
        </section>

        <section className="space-y-4" aria-label="Progress">
          <div className="glass space-y-4 rounded-3xl p-5 sm:p-6">
            <h2 className="display text-xl">Progress</h2>
            {steps.length === 0 ? (
              <p className="text-sm font-medium text-[var(--muted)]">Each step appears here as it completes: approval, burn on the source chain, Circle's attestation, and the mint on the destination.</p>
            ) : (
              <ol className="space-y-3" aria-live="polite">
                {steps.map((s) => (
                  <StepRow key={s.id} step={s} from={from.label} to={to.label} txUrl={s.id === 'mint' ? to.txUrl : from.txUrl} />
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
                Done. {amount} USDC was {dir === 'in' ? 'added to' : 'withdrawn from'} Arc.{' '}
                {dir === 'in' && (
                  <>
                    <Link to="/explore" className="underline">Open the market board</Link>.
                  </>
                )}
              </Notice>
            )}
          </div>

          {records.length > 0 && (
            <div className="glass space-y-3 rounded-3xl p-5 sm:p-6">
              <h2 className="display text-xl">Recent transfers</h2>
              <p className="text-xs font-medium text-[var(--muted)]">Kept in this browser only. Circle finishes a transfer even if you close the page.</p>
              <ul className="space-y-3">
                {records.map((r) => (
                  <RecordRow key={r.burnTx} record={r} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StepRow({ step, from, to, txUrl }: { step: StepView; from: string; to: string; txUrl: (h: string) => string }) {
  const label: Record<StepId, string> = {
    approve: `Approve USDC on ${from}`,
    burn: `Burn USDC on ${from}`,
    attest: 'Circle attests the burn',
    mint: `Circle mints USDC on ${to}`,
  }
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs ${step.state === 'done' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : step.state === 'error' ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-[var(--line-strong)]'}`}
        aria-hidden="true"
      >
        {step.state === 'done' ? <Check className="size-3.5" /> : step.state === 'active' ? <Loader2 className="size-3.5 animate-spin" /> : step.state === 'error' ? <X className="size-3.5" /> : null}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${step.state === 'pending' ? 'text-[var(--muted)]' : ''}`}>{label[step.id]}</p>
        {step.tx && (
          <a href={txUrl(step.tx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent-text)] hover:underline">
            {shortAddr(step.tx)} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </li>
  )
}

function RecordRow({ record }: { record: BridgeRecord }) {
  const from = routeByKey(record.from)
  const to = routeByKey(record.to)
  const { data, isError } = useQuery({
    queryKey: ['bridge-status', record.burnTx],
    queryFn: () => fetchTransferStatus(from.domain, record.burnTx),
    refetchInterval: (q) => (q.state.data?.mintTx ? false : 10_000),
  })
  const delivered = !!data?.mintTx
  return (
    <li className="space-y-1 rounded-2xl border border-[var(--line)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {record.amount} USDC · {from.label} to {to.label}
        </span>
        <Chip tone={delivered ? 'ok' : 'warn'}>{delivered ? 'Delivered' : isError ? 'Status unavailable' : data?.attested ? 'Circle is minting' : 'Waiting for Circle'}</Chip>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <a href={from.txUrl(record.burnTx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline">
          Burn {shortAddr(record.burnTx)} <ExternalLink className="size-3" />
        </a>
        {data?.mintTx && (
          <a href={to.txUrl(data.mintTx)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline">
            Mint {shortAddr(data.mintTx)} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </li>
  )
}
