import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useReadContract } from 'wagmi'
import { DataTable, EmptyState, Field, Notice, Spinner, StatusChip, TxPanel } from '@/components/ui'
import { api } from '@/lib/api'
import { CHAIN_ID, useConfig } from '@/hooks/useApp'
import { useTx } from '@/hooks/useTx'
import { exchangeAbi } from '@/lib/exchangeAbi'
import { fmtDate, shortAddr } from '@/lib/format'
import { fmtUsdc } from '@/lib/exchange'

interface OverviewData {
  applications_by_status: Record<string, number>
  markets_by_status: Record<string, number>
  open_trades: number
  settled_trades: number
  fees_collected: string
  fee_collector: string
  open_listing_requests: number
  open_disputes: number
  indexer_lag_blocks: number | null
}

interface AttentionItem { severity: 'high' | 'warn' | 'info'; key: string; title: string; detail: string; link: string }

/** What a person should look at now: passed TGE dates, closing deadlines, markets ready to complete, a stalled indexer. */
function Attention() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-attention'], queryFn: () => api.get<{ items: AttentionItem[] }>('/admin/attention'), refetchInterval: 30000 })
  const items = data?.items ?? []
  const tone = { high: 'text-[var(--danger)]', warn: 'text-[var(--warn)]', info: 'text-[var(--muted)]' } as const
  const label = { high: 'Act now', warn: 'Soon', info: 'Info' } as const
  return (
    <section className="glass p-4 sm:p-5" aria-labelledby="att-h">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="att-h" className="display text-lg">Needs attention</h3>
        <span className="text-xs text-[var(--muted)]">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      {isLoading ? (
        <Spinner label="Checking" />
      ) : items.length === 0 ? (
        <p className="py-3 text-sm font-medium text-[var(--muted)]">Nothing needs attention. TGE dates, settlement deadlines and the indexer are all fine.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--hair)]">
          {items.map((i) => (
            <li key={i.key}>
              <Link to={i.link} className="grid grid-cols-[auto_1fr] gap-x-3 py-3 hover:bg-[var(--tint)]">
                <span className={`pt-0.5 text-xs font-bold ${tone[i.severity]}`}>{label[i.severity]}</span>
                <span>
                  <span className="block text-sm font-semibold">{i.title}</span>
                  <span className="block text-xs text-[var(--muted)]">{i.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<OverviewData>('/admin/overview'), refetchInterval: 10000 })
  if (isLoading || !data) return <Spinner label="Loading…" />
  const apps = data.applications_by_status
  const markets = data.markets_by_status
  const stat = (label: string, value: string | number, sub?: string) => (
    <div className="glass rounded-3xl p-4 sm:p-5">
      <div className="label">{label}</div>
      <div className="display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--subtle)]">{sub}</div>}
    </div>
  )
  return (
    <>
      <h2 className="display text-2xl font-semibold">Overview</h2>
      <Attention />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {stat('Open trades', String(data.open_trades))}
        {stat('Settled trades', String(data.settled_trades))}
        {stat('Fees collected', `${fmtUsdc(String(data.fees_collected), 4)} USDC`, `To ${shortAddr(String(data.fee_collector))}`)}
        {stat('Listing requests open', String(data.open_listing_requests))}
        {stat('Disputes open', String(data.open_disputes))}
        {stat('Indexer lag', data.indexer_lag_blocks === null ? 'not started' : `${data.indexer_lag_blocks} blocks`)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-3xl p-4 sm:p-5">
          <div className="label">Applications by status</div>
          {Object.keys(apps).length === 0 ? <p className="text-sm text-[var(--subtle)]">No applications yet.</p> : Object.entries(apps).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><StatusChip status={k} /> <span className="tabular-nums">{v}</span></div>
          ))}
        </div>
        <div className="glass rounded-3xl p-4 sm:p-5">
          <div className="label">Markets by status</div>
          {Object.keys(markets).length === 0 ? <p className="text-sm text-[var(--subtle)]">No markets yet.</p> : Object.entries(markets).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><StatusChip status={k} /> <span className="tabular-nums">{v}</span></div>
          ))}
        </div>
      </div>
    </>
  )
}

interface DisputeRow { id: number; trade_id: number; opener: string; reason: string; evidence: string[]; status: string; notes: { by: string; at: string; note: string }[]; created_at: string }

export function Disputes() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api.get<{ items: DisputeRow[] }>('/admin/disputes') })
  const [note, setNote] = useState<Record<number, string>>({})
  const [err, setErr] = useState('')
  const update = async (id: number, status?: string) => {
    setErr('')
    try {
      await api.post(`/admin/disputes/${id}`, { status, note: note[id] ?? '' })
      setNote((n) => ({ ...n, [id]: '' }))
      void qc.invalidateQueries({ queryKey: ['admin-disputes'] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <h2 className="display text-2xl font-semibold">Disputes</h2>
      <Notice>Tickets are an off-chain support process. Nothing here can move funds; settlement, default and refund outcomes are decided by the contract.</Notice>
      {err && <Notice tone="error">{err}</Notice>}
      {!data?.items.length ? <EmptyState title="No dispute tickets" /> : data.items.map((d) => (
        <div key={d.id} className="glass space-y-2 rounded-3xl p-4 text-sm">
          <div className="flex items-center justify-between"><span className="font-semibold">Ticket #{d.id} · trade #{d.trade_id}</span><StatusChip status={d.status} /></div>
          <p className="text-xs text-[var(--subtle)]">{shortAddr(d.opener)} · {fmtDate(d.created_at)}</p>
          <p className="whitespace-pre-wrap">{d.reason}</p>
          {d.evidence.length > 0 && <p className="break-all text-xs text-[var(--accent-text)]">{d.evidence.join(' · ')}</p>}
          {d.notes.map((n, i) => <p key={i} className="rounded-xl bg-[var(--tint)] p-2 text-xs"><b>{shortAddr(n.by)}</b>: {n.note}</p>)}
          <input className="field" placeholder="Add a note" value={note[d.id] ?? ''} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            {['In Review', 'Resolved', 'Rejected'].map((s) => <button key={s} className="btn btn-ghost !min-h-9" onClick={() => void update(d.id, s)}>{s}</button>)}
            <button className="btn btn-ghost !min-h-9" disabled={!note[d.id]?.trim()} onClick={() => void update(d.id)}>Add note only</button>
          </div>
        </div>
      ))}
    </>
  )
}

export function Users() {
  const { data } = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<{ items: { address: string; first_seen: string; last_seen: string; orders: number; trades: number }[] }>('/admin/users') })
  return (
    <>
      <h2 className="display text-2xl font-semibold">Users</h2>
      <p className="text-sm text-[var(--subtle)]">Wallet addresses only. No personal data is stored.</p>
      <div className="glass rounded-3xl p-4">
        <DataTable empty="No users yet." head={['Wallet', 'First seen', 'Last seen', 'Orders', 'Trades']} rows={(data?.items ?? []).map((u) => [<span key="a" className="mono text-xs">{u.address}</span>, fmtDate(u.first_seen), fmtDate(u.last_seen), u.orders, u.trades])} />
      </div>
    </>
  )
}

interface RoleRow { id: number; address: string; role: string; granted_by: string | null; created_at: string; onchain: Record<string, boolean> | null }

/** Reads whether the connected wallet is the contract admin (the only wallet that can allow others to create markets). */
function useContractAdmin() {
  const { data: cfg } = useConfig()
  const { address } = useAccount()
  const base = { address: cfg?.exchange_address, abi: exchangeAbi, chainId: CHAIN_ID } as const
  const adminRole = useReadContract({ ...base, functionName: 'DEFAULT_ADMIN_ROLE', query: { enabled: !!cfg } })
  const mgrRole = useReadContract({ ...base, functionName: 'MARKET_MANAGER_ROLE', query: { enabled: !!cfg } })
  const isAdmin = useReadContract({ ...base, functionName: 'hasRole', args: adminRole.data && address ? [adminRole.data, address] : undefined, query: { enabled: !!adminRole.data && !!address } })
  return { cfg, isContractAdmin: isAdmin.data === true, mgrRole: mgrRole.data, address }
}

export function Roles() {
  const qc = useQueryClient()
  const tx = useTx()
  const { cfg, isContractAdmin, mgrRole, address: me } = useContractAdmin()
  const { data } = useQuery({ queryKey: ['admin-roles'], queryFn: () => api.get<{ items: RoleRow[] }>('/admin/roles') })
  const [addr, setAddr] = useState('')
  const [allowMarkets, setAllowMarkets] = useState(true)
  const [err, setErr] = useState('')
  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr)
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-roles'] })
  const allow = async (wallet: string) => {
    if (!cfg || !mgrRole) return
    await tx.run('Allow market creation', { address: cfg.exchange_address, abi: exchangeAbi, functionName: 'grantRole', args: [mgrRole, wallet] })
    refresh()
  }
  const add = async () => {
    setErr('')
    try {
      await api.post('/admin/roles', { address: addr })
      if (allowMarkets && isContractAdmin) await allow(addr)
      setAddr('')
      refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  const items = data?.items ?? []
  const mine = items.find((r) => r.address.toLowerCase() === me?.toLowerCase())
  const canMarkets = (r: RoleRow) => !!r.onchain?.MARKET_MANAGER_ROLE
  return (
    <>
      <h2 className="display text-2xl font-semibold">Admins</h2>
      <Notice>
        Every admin can do everything in this dashboard. Starting trading on a market is also an on-chain transaction, and the contract only accepts it from a wallet it has allowed to create markets. That permission is given once per wallet, by the contract admin wallet.
      </Notice>
      {me && mine && !canMarkets(mine) && (
        <Notice tone="warn">
          The wallet you are connected with ({shortAddr(me)}) is an admin here but is not yet allowed to create markets on-chain.
          {isContractAdmin ? ' Use the button next to it below.' : ' Connect the contract admin wallet, open this page and press "Allow markets" next to this wallet.'}
        </Notice>
      )}
      <div className="glass space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Add an admin (wallet address)" htmlFor="ra">
            <input id="ra" className="field mono text-xs" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <button className="btn btn-primary" disabled={!valid || tx.busy} onClick={() => void add()}>{tx.busy ? <Spinner /> : 'Add admin'}</button>
        </div>
        {isContractAdmin ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allowMarkets} onChange={(e) => setAllowMarkets(e.target.checked)} /> Also allow this wallet to create and start markets (one extra transaction from your wallet)
          </label>
        ) : (
          <p className="text-xs text-[var(--muted)]">To also allow a new admin to start markets, use this page while connected as the contract admin wallet.</p>
        )}
        {err && <Notice tone="error">{err}</Notice>}
        <DataTable
          head={['Wallet', 'Can start markets', 'Added by', '']}
          rows={items.map((r) => [
            <span key="a" className="mono break-all text-xs">{r.address}</span>,
            r.onchain ? (
              canMarkets(r) ? <span key="o" className="text-xs font-semibold text-[var(--success)]">Yes</span> : isContractAdmin ? (
                <button key="o" className="btn btn-primary !min-h-8 !px-3 !py-1 text-xs" disabled={tx.busy} onClick={() => void allow(r.address)}>Allow markets</button>
              ) : <span key="o" className="text-xs text-[var(--muted)]">Not yet</span>
            ) : '–',
            shortAddr(r.granted_by),
            <button key="d" className="btn btn-danger !min-h-8 !px-3 !py-1 text-xs" onClick={() => void api.del(`/admin/roles/${r.id}`).then(refresh).catch((e: Error) => setErr(e.message))}>Remove</button>,
          ])}
        />
        <TxPanel tx={tx} />
      </div>
    </>
  )
}

export function AuditLogs() {
  const [action, setAction] = useState('')
  const { data } = useQuery({ queryKey: ['admin-audit', action], queryFn: () => api.get<{ items: { id: number; actor: string; role: string; action: string; entity_type: string; entity_id: string; before: unknown; after: unknown; created_at: string }[] }>(`/admin/audit-logs${action ? `?action=${encodeURIComponent(action)}` : ''}`) })
  return (
    <>
      <h2 className="display text-2xl font-semibold">Audit Logs</h2>
      <p className="text-sm text-[var(--subtle)]">Append-only: the database rejects updates and deletes.</p>
      <input className="field max-w-xs" placeholder="Filter by action prefix, e.g. project." value={action} onChange={(e) => setAction(e.target.value)} />
      <div className="glass rounded-3xl p-4">
        <DataTable empty="No audit entries yet." head={['Time', 'Actor', 'Action', 'Entity', 'Change']} rows={(data?.items ?? []).map((a) => [
          <span key="t" className="text-xs">{fmtDate(a.created_at)}</span>, <span key="a" className="mono text-xs" title={a.role}>{shortAddr(a.actor)}</span>, a.action, `${a.entity_type} ${a.entity_id}`,
          <code key="c" className="block max-w-xs truncate text-[11px] text-[var(--subtle)]" title={JSON.stringify({ before: a.before, after: a.after })}>{JSON.stringify(a.after ?? a.before ?? {})}</code>,
        ])} />
      </div>
    </>
  )
}

interface SettingsData {
  chain_id: number
  exchange_address: string
  usdc_address: string
  fee_collector: string
  buyer_fee_bps: number
  seller_fee_bps: number
  two_person_required: boolean
  notice: string
  note: string
}

function FeeCollectorForm({ current }: { current: string }) {
  const { data: cfg } = useConfig()
  const tx = useTx()
  const [addr, setAddr] = useState('')
  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== '0x0000000000000000000000000000000000000000'
  const change = async () => {
    if (!cfg || !valid) return
    if (!window.confirm(`Send ALL future platform fees to ${addr}? Double-check the address: a wrong address loses fees.`)) return
    await tx.run('Change fee collector', { address: cfg.exchange_address, abi: exchangeAbi, functionName: 'setFeeCollector', args: [addr] })
  }
  return (
    <div className="glass space-y-3 rounded-3xl p-4">
      <h3 className="display text-lg font-semibold">Platform fee collector</h3>
      <p className="text-sm text-[var(--subtle)]">
        All platform fees (0.5% buyer + 0.5% seller on settled trades) are paid in USDC to <span className="mono break-all text-[var(--ink-2)]">{current}</span>. This is read live from the contract.
      </p>
      <Notice tone="warn">Changing it is an on-chain transaction that only the contract's DEFAULT_ADMIN wallet can send. It affects fees paid from now on and cannot touch escrowed funds. For a first deployment you can instead set FEE_COLLECTOR before running the deploy script.</Notice>
      <Field label="New fee collector address" htmlFor="fc">
        <input id="fc" className="field mono text-xs" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
      </Field>
      <button className="btn btn-danger" disabled={!valid || tx.busy} onClick={() => void change()}>
        {tx.busy ? <Spinner /> : 'Change fee collector on-chain'}
      </button>
      <TxPanel tx={tx} />
    </div>
  )
}

interface KeeperStatus {
  status: null | { enabled: boolean; dry_run: boolean; complete_markets: boolean; address: string; balance: number; min_balance: number; updated_at: string; error?: string; totals?: Record<string, number>; last_results?: Record<string, unknown> }
  recent: { action: string; entity: string; tx: string | null; ok: boolean | null; at: string }[]
}

/** The keeper worker does trust-free chores (expire orders, refund cancelled markets). This panel only reports; it has no controls. */
function KeeperPanel() {
  const { data } = useQuery({ queryKey: ['admin-keeper'], queryFn: () => api.get<KeeperStatus>('/admin/keeper'), refetchInterval: 30000 })
  const st = data?.status
  return (
    <div className="glass space-y-3 p-4">
      <h3 className="display text-lg">Keeper</h3>
      {!st ? (
        <p className="text-sm text-[var(--muted)]">Not running. It clears expired orders and refunds cancelled markets for everyone, using a small wallet that only holds gas. Turn it on with KEEPER_ENABLED=true and KEEPER_PRIVATE_KEY in the environment (see the runbook). It can never cancel a market, open or extend settlement, or move anyone's funds.</p>
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="ledger-row"><dt className="text-[var(--muted)]">Wallet</dt><dd className="mono text-xs">{shortAddr(st.address)}</dd></div>
            <div className="ledger-row"><dt className="text-[var(--muted)]">Gas balance</dt><dd className="tabular-nums">{st.balance.toFixed(4)} USDC</dd></div>
            <div className="ledger-row"><dt className="text-[var(--muted)]">Last pass</dt><dd>{fmtDate(st.updated_at)}</dd></div>
            <div className="ledger-row"><dt className="text-[var(--muted)]">Mode</dt><dd>{st.dry_run ? 'dry run (sends nothing)' : 'live'}{st.complete_markets ? ', completes markets' : ''}</dd></div>
          </dl>
          {st.error && <Notice tone="warn">{st.error}</Notice>}
          {st.totals && Object.keys(st.totals).length > 0 && <p className="text-xs text-[var(--muted)]">Since start: {Object.entries(st.totals).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(', ')}</p>}
          {(data?.recent.length ?? 0) > 0 && (
            <DataTable head={['When', 'Action', 'Target', 'Result']} rows={(data?.recent ?? []).map((r) => [fmtDate(r.at), r.action.replace('keeper.', '').replace('_', ' '), r.entity, r.ok ? 'ok' : 'failed'])} />
          )}
        </>
      )}
    </div>
  )
}

/** Pause stops NEW orders only. Cancel, settle, default claims and refunds keep working. Needs the PAUSER role on the contract. */
function PauseControl() {
  const { data: cfg } = useConfig()
  const { address } = useAccount()
  const tx = useTx()
  const base = { address: cfg?.exchange_address, abi: exchangeAbi, chainId: CHAIN_ID } as const
  const paused = useReadContract({ ...base, functionName: 'paused', query: { enabled: !!cfg, refetchInterval: 10000 } })
  const role = useReadContract({ ...base, functionName: 'PAUSER_ROLE', query: { enabled: !!cfg } })
  const can = useReadContract({ ...base, functionName: 'hasRole', args: role.data && address ? [role.data, address] : undefined, query: { enabled: !!role.data && !!address } })
  const isPaused = paused.data === true
  const toggle = async () => {
    if (!cfg) return
    if (!window.confirm(isPaused ? 'Allow new orders again?' : 'Pause new orders on every market? Cancelling, settling, claiming and refunds keep working.')) return
    await tx.run(isPaused ? 'Unpause' : 'Pause', { address: cfg.exchange_address, abi: exchangeAbi, functionName: isPaused ? 'unpause' : 'pause' })
    void paused.refetch()
  }
  return (
    <div className="glass space-y-3 p-4">
      <h3 className="display text-lg">New orders</h3>
      <p className="text-sm text-[var(--muted)]">
        Status: <b className={isPaused ? 'text-[var(--danger)]' : 'text-[var(--success)]'}>{paused.data === undefined ? 'unknown' : isPaused ? 'paused' : 'open'}</b>. Pausing stops new orders on every market. Users can still cancel, settle, claim a default and get refunds.
      </p>
      {can.data === false && <Notice tone="warn">The connected wallet does not hold the PAUSER role on the contract.</Notice>}
      <button className={`btn ${isPaused ? 'btn-primary' : 'btn-danger'}`} disabled={tx.busy || can.data !== true} onClick={() => void toggle()}>
        {tx.busy ? <Spinner /> : isPaused ? 'Unpause new orders' : 'Pause new orders'}
      </button>
      <TxPanel tx={tx} />
    </div>
  )
}

export function SettingsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<SettingsData>('/admin/settings') })
  const [notice, setNotice] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  if (!data) return <Spinner />
  const row = (k: string, v: unknown) => <div key={k} className="flex flex-wrap justify-between gap-2 border-b border-[var(--hair)] py-2 text-sm"><span className="text-[var(--subtle)]">{k}</span><span className="mono break-all text-xs">{String(v)}</span></div>
  const save = async () => {
    try {
      await api.put('/admin/settings', { notice: notice ?? '' })
      setMsg('Saved')
      void qc.invalidateQueries({ queryKey: ['config'] })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <h2 className="display text-2xl font-semibold">Settings</h2>
      <div className="glass rounded-3xl p-4">
        {row('Chain ID', data.chain_id)}
        {row('Exchange contract', data.exchange_address)}
        {row('USDC', data.usdc_address)}
        {row('Fee collector', data.fee_collector)}
        {row('Buyer fee', `${data.buyer_fee_bps / 100}% (contract constant)`)}
        {row('Seller fee', `${data.seller_fee_bps / 100}% (contract constant)`)}
        {row('Two-person approval for activation', data.two_person_required ? 'required' : 'not enforced (testnet)')}
        <p className="pt-3 text-xs text-[var(--subtle)]">{data.note}</p>
      </div>
      <FeeCollectorForm current={data.fee_collector} />
      <PauseControl />
      <KeeperPanel />
      <div className="glass space-y-3 rounded-3xl p-4">
        <Field label="Platform notice (shown as a banner)" htmlFor="nt" hint="Plain text, up to 500 characters.">
          <input id="nt" className="field" maxLength={500} value={notice ?? data.notice} onChange={(e) => setNotice(e.target.value)} />
        </Field>
        <button className="btn btn-primary" onClick={() => void save()}>Save notice</button>
        {msg && <p className="text-sm text-[var(--subtle)]">{msg}</p>}
      </div>
    </>
  )
}
