import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DataTable, EmptyState, Field, Notice, Spinner, StatusChip, TxPanel } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth, useConfig } from '@/hooks/useApp'
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

export function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get<OverviewData>('/admin/overview'), refetchInterval: 10000 })
  if (isLoading || !data) return <Spinner label="Loading…" />
  const apps = data.applications_by_status
  const markets = data.markets_by_status
  const stat = (label: string, value: string | number, sub?: string) => (
    <div className="glass rounded-3xl p-5">
      <div className="label">{label}</div>
      <div className="display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--subtle)]">{sub}</div>}
    </div>
  )
  return (
    <>
      <h2 className="display text-2xl font-semibold">Overview</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stat('Open trades', String(data.open_trades))}
        {stat('Settled trades', String(data.settled_trades))}
        {stat('Fees collected', `${fmtUsdc(String(data.fees_collected), 4)} USDC`, `To ${shortAddr(String(data.fee_collector))}`)}
        {stat('Listing requests open', String(data.open_listing_requests))}
        {stat('Disputes open', String(data.open_disputes))}
        {stat('Indexer lag', data.indexer_lag_blocks === null ? 'not started' : `${data.indexer_lag_blocks} blocks`)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-3xl p-5">
          <div className="label">Applications by status</div>
          {Object.keys(apps).length === 0 ? <p className="text-sm text-[var(--subtle)]">No applications yet.</p> : Object.entries(apps).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><StatusChip status={k} /> <span className="tabular-nums">{v}</span></div>
          ))}
        </div>
        <div className="glass rounded-3xl p-5">
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

export function Roles() {
  const qc = useQueryClient()
  const auth = useAuth()
  const { data } = useQuery({ queryKey: ['admin-roles'], queryFn: () => api.get<{ items: RoleRow[]; available_roles: string[] }>('/admin/roles'), enabled: auth.roles.includes('super_admin') })
  const [addr, setAddr] = useState('')
  const [role, setRole] = useState('project_reviewer')
  const [err, setErr] = useState('')
  if (!auth.roles.includes('super_admin')) return <Notice tone="warn">Only a Super Admin can manage roles.</Notice>
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-roles'] })
  const grant = async () => {
    setErr('')
    try {
      await api.post('/admin/roles', { address: addr, role })
      setAddr('')
      refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }
  return (
    <>
      <h2 className="display text-2xl font-semibold">Admin Roles</h2>
      <Notice>These are the off-chain dashboard roles. On-chain powers (market manager, pauser, admin) are separate contract roles; the columns below show what the contract says for each address.</Notice>
      <div className="glass space-y-3 rounded-3xl p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field label="Wallet address" htmlFor="ra"><input id="ra" className="field mono text-xs" value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" /></Field>
          <Field label="Role" htmlFor="rr"><select id="rr" className="field" value={role} onChange={(e) => setRole(e.target.value)}>{(data?.available_roles ?? []).map((r) => <option key={r}>{r}</option>)}</select></Field>
          <button className="btn btn-primary" onClick={() => void grant()}>Grant</button>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <DataTable head={['Wallet', 'Role', 'On-chain', 'Granted by', '']} rows={(data?.items ?? []).map((r) => [
          <span key="a" className="mono text-xs">{r.address}</span>, r.role,
          r.onchain ? <span key="o" className="text-xs">{Object.entries(r.onchain).filter(([, v]) => v).map(([k]) => k.replace('_ROLE', '')).join(', ') || 'none'}</span> : '—',
          shortAddr(r.granted_by), <button key="d" className="btn btn-danger !min-h-8 !px-3 !py-1 text-xs" onClick={() => void api.del(`/admin/roles/${r.id}`).then(refresh).catch((e: Error) => setErr(e.message))}>Revoke</button>,
        ])} />
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

export function SettingsPage() {
  const qc = useQueryClient()
  const auth = useAuth()
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
      <div className="glass space-y-3 rounded-3xl p-4">
        <Field label="Platform notice (shown as a banner)" htmlFor="nt" hint="Plain text, up to 500 characters. Super Admin only.">
          <input id="nt" className="field" maxLength={500} value={notice ?? data.notice} onChange={(e) => setNotice(e.target.value)} disabled={!auth.roles.includes('super_admin')} />
        </Field>
        <button className="btn btn-primary" disabled={!auth.roles.includes('super_admin')} onClick={() => void save()}>Save notice</button>
        {msg && <p className="text-sm text-[var(--subtle)]">{msg}</p>}
      </div>
    </>
  )
}
