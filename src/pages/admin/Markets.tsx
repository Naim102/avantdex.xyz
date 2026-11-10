import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContract } from 'wagmi'
import { toast } from 'sonner'
import { DataTable, EmptyState, Field, Notice, Spinner, StatusChip, TxPanel } from '@/components/ui'
import { api, type AppConfig, type Market } from '@/lib/api'
import { CHAIN_ID, useConfig } from '@/hooks/useApp'
import { useTx } from '@/hooks/useTx'
import { exchangeAbi } from '@/lib/exchangeAbi'
import { addrUrl, fmtDate, shortAddr } from '@/lib/format'

interface AdminMarket extends Market {
  created_by: string | null
  activation_approved_by: string | null
  metadata_ref: string
  project_status: string | null
  project_id: number | null
  two_person_required: boolean
  onchain_params: { token: string; lotSize: string; tickSize: string; minLots: string; maxLots: string; tradingStart: number; tradingEnd: number; metadataRef: string }
}

interface VerifyResult {
  checks: { field: string; draft: string; chain: string; ok: boolean }[]
  config_ok: boolean
  chain_status: string
  can_activate: boolean
  two_person_required: boolean
  activation_approved_by: string | null
}

const ZERO = '0x0000000000000000000000000000000000000000'

function useRoleCheck(cfg: AppConfig | undefined) {
  const { address } = useAccount()
  const role = useReadContract({ address: cfg?.exchange_address, abi: exchangeAbi, functionName: 'MARKET_MANAGER_ROLE', chainId: CHAIN_ID, query: { enabled: !!cfg } })
  const has = useReadContract({ address: cfg?.exchange_address, abi: exchangeAbi, functionName: 'hasRole', args: role.data && address ? [role.data, address] : undefined, chainId: CHAIN_ID, query: { enabled: !!role.data && !!address } })
  return has.data
}

function MarketActions({ m, cfg }: { m: AdminMarket; cfg: AppConfig }) {
  const qc = useQueryClient()
  const tx = useTx()
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [msg, setMsg] = useState('')
  const [token, setToken] = useState(m.token_address || '')
  const [hours, setHours] = useState('24')
  const [deadline, setDeadline] = useState('')
  const hasRole = useRoleCheck(cfg)
  const createdKey = `avantdex.created.${m.id}`
  const [createdAt, setCreatedAt] = useState(() => {
    const t = Number(localStorage.getItem(createdKey) ?? 0)
    return Date.now() - t < 15 * 60 * 1000 ? t : 0 // a record older than 15 minutes is ignored
  })
  const waiting = m.status === 'draft' && createdAt > 0
  const id = m.onchain_id

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-markets'] })
    void qc.invalidateQueries({ queryKey: ['admin-settlement'] })
  }
  const chain = async (label: string, fn: string, args: unknown[]) => {
    const r = await tx.run(label, { address: cfg.exchange_address, abi: exchangeAbi, functionName: fn, args })
    if (r) {
      await api.post(`/admin/markets/${m.id}/note-action`, { action: fn, tx_hash: r.transactionHash }).catch(() => undefined)
      toast.success(`${label} confirmed. The indexer will pick it up within seconds.`)
      refresh()
    }
    return r
  }
  const call = async (fn: () => Promise<unknown>) => {
    setMsg('')
    try {
      await fn()
      refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    }
  }
  const p = m.onchain_params
  const status = m.status

  return (
    <div className="space-y-3 rounded-2xl bg-[var(--tint)] p-3 text-sm">
      {hasRole === false && <Notice tone="warn">The connected wallet does not hold the on-chain MARKET_MANAGER_ROLE. Transactions below will fail. Switch to the contract admin wallet, or open <Link to="/admin/roles" className="underline">Admins</Link> with it and press Allow markets next to this wallet.</Notice>}
      {status === 'draft' && (
        <div className="space-y-2">
          <p className="text-[var(--subtle)]">Step 1: create the market on-chain with the exact draft parameters. {m.created_by && `Draft by ${shortAddr(m.created_by)}.`}</p>
          {waiting ? (
            <Notice tone="warn">
              A create transaction for this draft was already confirmed. Wait for the site to pick it up (usually seconds, this list refreshes by itself). Sending it again would create a second, unused market on the contract.
              {' '}
              <button className="underline" onClick={() => { localStorage.removeItem(createdKey); setCreatedAt(0) }}>It never appeared: allow creating again</button>
            </Notice>
          ) : (
            <button
              className="btn btn-primary !min-h-9"
              disabled={tx.busy}
              onClick={() => void chain('Create market on-chain', 'createMarket', [p.token, BigInt(p.lotSize), BigInt(p.tickSize), BigInt(p.minLots), BigInt(p.maxLots), BigInt(p.tradingStart), BigInt(p.tradingEnd), p.metadataRef]).then((r) => {
                if (r) { localStorage.setItem(createdKey, String(Date.now())); setCreatedAt(Date.now()) }
              })}
            >
              {tx.busy ? <Spinner /> : 'Create on-chain'}
            </button>
          )}
        </div>
      )}
      {status === 'Setup' && (
        <div className="space-y-2">
          <p className="text-[var(--subtle)]">Step 2: verify the on-chain configuration against the draft, step 3: approve, step 4: activate.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost !min-h-9" onClick={() => void call(async () => setVerify(await api.get<VerifyResult>(`/admin/markets/${m.id}/verify-config`)))}>Verify configuration</button>
            <button className="btn btn-ghost !min-h-9" onClick={() => void call(() => api.post(`/admin/markets/${m.id}/approve-activation`).then(() => api.get<VerifyResult>(`/admin/markets/${m.id}/verify-config`).then(setVerify)))}>
              Approve activation{m.activation_approved_by ? ` (by ${shortAddr(m.activation_approved_by)})` : ''}
            </button>
            <button className="btn btn-primary !min-h-9" disabled={tx.busy || !verify?.can_activate} onClick={() => void chain('Activate market', 'activateMarket', [BigInt(id!)])}>
              {tx.busy ? <Spinner /> : 'Activate'}
            </button>
          </div>
          {m.two_person_required && <p className="text-xs text-[var(--warn)]">Two-person approval is required: a second admin must approve before activation.</p>}
          {verify && (
            <div className="space-y-2">
              <Notice tone={verify.config_ok ? 'ok' : 'error'}>{verify.config_ok ? 'Every parameter matches the draft.' : 'Mismatch between the draft and the chain. Activation is blocked.'}</Notice>
              <DataTable head={['Field', 'Draft', 'Chain', '']} rows={verify.checks.map((c) => [c.field, <span key="d" className="mono text-xs break-all">{c.draft}</span>, <span key="c" className="mono text-xs break-all">{c.chain}</span>, c.ok ? '✓' : '✗'])} />
            </div>
          )}
        </div>
      )}
      {(status === 'Live' || status === 'Suspended') && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {status === 'Live' ? (
              <button className="btn btn-ghost !min-h-9" disabled={tx.busy} onClick={() => void chain('Suspend market', 'suspendMarket', [BigInt(id!)])}>Suspend trading</button>
            ) : (
              <button className="btn btn-primary !min-h-9" disabled={tx.busy} onClick={() => void chain('Resume market', 'resumeMarket', [BigInt(id!)])}>Resume trading</button>
            )}
            <button className="btn btn-danger !min-h-9" disabled={tx.busy} onClick={() => window.confirm('Cancel this market? Every open trade becomes refundable with no fee.') && void chain('Cancel market', 'cancelMarket', [BigInt(id!)])}>Cancel market (TGE cancelled)</button>
          </div>
          <div className="space-y-2 rounded-2xl border border-[var(--hair)] p-3">
            <div className="label">Open settlement after TGE</div>
            <Notice tone="warn">Verify the token address off-chain first (project-confirmed address, explorer, contract badge). Opening settlement stops trading and starts the delivery deadline. Use two-person review for this step.</Notice>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Token contract address" htmlFor={`tk${m.id}`}>
                <input id={`tk${m.id}`} className="field mono text-xs" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x…" />
              </Field>
              <Field label="Settlement window (hours, 1–336)" htmlFor={`h${m.id}`}>
                <input id={`h${m.id}`} className="field" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} />
              </Field>
            </div>
            <button className="btn btn-primary !min-h-9" disabled={tx.busy || !/^0x[0-9a-fA-F]{40}$/.test(token) || !(Number(hours) >= 1 && Number(hours) <= 336)} onClick={() => void chain('Open settlement', 'openSettlement', [BigInt(id!), token, BigInt(Number(hours) * 3600)])}>
              {tx.busy ? <Spinner /> : 'Open settlement'}
            </button>
          </div>
        </div>
      )}
      {status === 'SettlementOpen' && (
        <div className="space-y-3">
          <p className="text-[var(--subtle)]">Settlement deadline: <b>{fmtDate(m.settlement_deadline)}</b> · open trades: {m.open_trades}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Extend deadline to (max 30 days after opening)" htmlFor={`x${m.id}`}>
              <input id={`x${m.id}`} type="datetime-local" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <button className="btn btn-ghost !min-h-9" disabled={tx.busy || !deadline} onClick={() => void chain('Extend settlement', 'extendSettlement', [BigInt(id!), BigInt(Math.floor(new Date(deadline).getTime() / 1000))])}>Extend</button>
            <button className="btn btn-primary !min-h-9" disabled={tx.busy || m.open_trades > 0} onClick={() => void chain('Complete market', 'completeMarket', [BigInt(id!)])}>Complete market</button>
            <button className="btn btn-danger !min-h-9" disabled={tx.busy} onClick={() => window.confirm('Cancel this market? Remaining open trades become refundable with no fee.') && void chain('Cancel market', 'cancelMarket', [BigInt(id!)])}>Cancel market</button>
          </div>
          {m.open_trades > 0 && <p className="text-xs text-[var(--subtle)]">Completing requires every trade to be settled, defaulted or refunded first.</p>}
        </div>
      )}
      {(status === 'Completed' || status === 'Cancelled') && <p className="text-[var(--subtle)]">This market is closed.</p>}
      {msg && <Notice tone="error">{msg}</Notice>}
      <TxPanel tx={tx} />
    </div>
  )
}

function MarketCardAdmin({ m, cfg }: { m: AdminMarket; cfg: AppConfig }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const toggleListing = async () => {
    setErr('')
    try {
      await api.post(`/admin/markets/${m.id}/delist`, { delisted: !m.delisted })
      void qc.invalidateQueries({ queryKey: ['admin-markets'] })
      void qc.invalidateQueries({ queryKey: ['markets'] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <div className="glass space-y-3 rounded-3xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{m.project?.name ?? m.slug} <span className="mono text-xs text-[var(--subtle)]">{m.project?.token_symbol}</span></div>
          <div className="text-xs text-[var(--subtle)]">
            {m.onchain_id !== null ? `On-chain market #${m.onchain_id}` : 'Not on-chain yet'} · trading {fmtDate(m.trading_start)} → {fmtDate(m.trading_end)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {m.token_address && m.token_address !== ZERO && <a className="mono text-xs text-[var(--accent-text)] hover:underline" href={addrUrl(m.token_address)} target="_blank" rel="noopener noreferrer">{shortAddr(m.token_address)}</a>}
          <StatusChip status={m.status} />
          {m.onchain_id !== null && (
            <button className="btn btn-ghost !min-h-9" onClick={() => void toggleListing()} title="Off-chain visibility only. Orders, settlement and refunds are not affected.">
              {m.delisted ? 'Show on site' : 'Hide from site'}
            </button>
          )}
          <button className="btn btn-ghost !min-h-9" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Manage'}</button>
        </div>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {open && <MarketActions m={m} cfg={cfg} />}
    </div>
  )
}

function MarketList({ queryKey, path, empty, filter }: { queryKey: string; path: string; empty: string; filter?: (m: AdminMarket) => boolean }) {
  const { data: cfg } = useConfig()
  const { data, isLoading } = useQuery({ queryKey: [queryKey], queryFn: () => api.get<{ items: AdminMarket[] }>(path), refetchInterval: 8000 })
  if (isLoading || !cfg) return <Spinner label="Loading…" />
  const items = (data?.items ?? []).filter(filter ?? (() => true))
  if (!items.length) return <EmptyState title={empty} />
  return <div className="space-y-3">{items.map((m) => <MarketCardAdmin key={m.id} m={m} cfg={cfg} />)}</div>
}

export function LiveMarkets() {
  return (
    <>
      <h2 className="display text-2xl font-semibold">Live Markets</h2>
      <MarketList queryKey="admin-markets" path="/admin/markets" empty="No live markets" filter={(m) => ['Live', 'Suspended', 'SettlementOpen'].includes(m.status)} />
    </>
  )
}

export function MarketManagement() {
  return (
    <>
      <h2 className="display text-2xl font-semibold">Market Management</h2>
      <Notice>Activation is separate from approval: create on-chain, verify the configuration, get the approval, then activate. Parameters are immutable once created on-chain.</Notice>
      <MarketList queryKey="admin-markets" path="/admin/markets" empty="No market drafts yet. Configure one from Approved Projects." />
    </>
  )
}

export function SettlementManagement() {
  return (
    <>
      <h2 className="display text-2xl font-semibold">Settlement Management</h2>
      <Notice>Opening settlement is the biggest trust decision in the system: it fixes the token address that sellers must deliver. Admins can never move escrowed funds, and users keep every exit (cancel, settle, default claim, refund).</Notice>
      <MarketList queryKey="admin-settlement" path="/admin/settlement" empty="No markets are awaiting settlement" />
    </>
  )
}
