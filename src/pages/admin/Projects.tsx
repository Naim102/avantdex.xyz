import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseUnits } from 'viem'
import { BadgeRow, DataTable, EmptyState, Field, Modal, Notice, Spinner, StatusChip } from '@/components/ui'
import { api } from '@/lib/api'
import { useConfig } from '@/hooks/useApp'
import { useAuth } from '@/hooks/useApp'
import { fmtDate, shortAddr } from '@/lib/format'
import { BADGE_INFO } from '@/lib/format'

export interface AdminProject {
  id: number
  slug: string
  name: string
  token_symbol: string
  token_name: string
  status: string
  applicant: string
  team_wallet: string
  website: string
  socials: string[]
  documentation: string[]
  description: string
  evidence: string
  supply_info: string
  allocation_info: string
  tge_info: string
  tge_date: string | null
  token_address: string
  blockchain: string
  category: string
  review_note: string
  updated_at: string
  badges: { badge: string; granted_at: string | null; expires_at: string | null }[]
  history: { from: string | null; to: string; actor: string; reason: string; at: string }[]
}

const NEXT: Record<string, string[]> = {
  Submitted: ['Approved', 'Under Review', 'Changes Requested', 'Rejected'],
  'Under Review': ['Approved', 'Verification', 'Changes Requested', 'Rejected'],
  Verification: ['Approved', 'Changes Requested', 'Rejected'],
  'Changes Requested': ['Approved', 'Under Review', 'Rejected'],
  Rejected: ['Approved', 'Under Review'],
  Approved: ['Market Setup', 'Under Review', 'Rejected'],
  'Market Setup': ['Approved'],
  Live: ['Delisted'],
  Suspended: ['Delisted'],
}
const NEEDS_REASON = ['Rejected', 'Changes Requested', 'Delisted']

function useProjects(status = '') {
  return useQuery({ queryKey: ['admin-projects', status], queryFn: () => api.get<{ items: AdminProject[] }>(`/admin/projects${status ? `?status=${encodeURIComponent(status)}` : ''}`) })
}

interface FormState {
  name: string; token_symbol: string; token_name: string; logo_url: string; description: string; website: string; socials: string
  category: string; blockchain: string; token_address: string; supply_info: string; allocation_info: string; tge_info: string
  tge_date: string; documentation: string; evidence: string; team_wallet: string; status: string
}

const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

/** Add a project directly, or edit any field of an existing one. Admins can do both at any stage. */
function ProjectFormModal({ project, onClose }: { project?: AdminProject; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: cfg } = useConfig()
  const [f, setF] = useState<FormState>(() => ({
    name: project?.name ?? '', token_symbol: project?.token_symbol ?? '', token_name: project?.token_name ?? '', logo_url: '',
    description: project?.description ?? '', website: project?.website ?? '', socials: (project?.socials ?? []).join('\n'),
    category: project?.category ?? 'Other', blockchain: project?.blockchain ?? 'Arc Testnet', token_address: project?.token_address ?? '',
    supply_info: project?.supply_info ?? '', allocation_info: project?.allocation_info ?? '', tge_info: project?.tge_info ?? '',
    tge_date: project?.tge_date ? project.tge_date.slice(0, 16) : '', documentation: (project?.documentation ?? []).join('\n'),
    evidence: project?.evidence ?? '', team_wallet: project?.team_wallet ?? '', status: 'Approved',
  }))
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const set = (k: keyof FormState, v: string) => setF((x) => ({ ...x, [k]: v }))
  const submit = async () => {
    setState({ busy: true })
    try {
      const body = {
        name: f.name, token_symbol: f.token_symbol, token_name: f.token_name, logo_url: f.logo_url, description: f.description, website: f.website,
        socials: lines(f.socials), category: f.category, blockchain: f.blockchain, token_address: f.token_address, supply_info: f.supply_info,
        allocation_info: f.allocation_info, tge_info: f.tge_info, tge_date: f.tge_date ? new Date(f.tge_date).toISOString() : null,
        documentation: lines(f.documentation), evidence: f.evidence, team_wallet: f.team_wallet,
      }
      if (project) await api.put(`/admin/projects/${project.id}`, body)
      else await api.post('/admin/projects', { ...body, status: f.status })
      void qc.invalidateQueries({ queryKey: ['admin-projects'] })
      void qc.invalidateQueries({ queryKey: ['admin-overview'] })
      void qc.invalidateQueries({ queryKey: ['upcoming-projects'] })
      onClose()
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Failed' })
    }
  }
  const input = (k: keyof FormState, label: string, opts?: { type?: string; hint?: string; area?: boolean; span?: boolean }) => (
    <div className={opts?.span ? 'sm:col-span-2' : ''}>
      <Field label={label} htmlFor={`pf-${k}`} hint={opts?.hint}>
        {opts?.area ? (
          <textarea id={`pf-${k}`} className="field min-h-20" value={f[k]} onChange={(e) => set(k, e.target.value)} />
        ) : (
          <input id={`pf-${k}`} type={opts?.type ?? 'text'} className="field" value={f[k]} onChange={(e) => set(k, e.target.value)} />
        )}
      </Field>
    </div>
  )
  return (
    <Modal open onClose={onClose} title={project ? `Edit ${project.name}` : 'Add a project'}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          {input('name', 'Project name')}
          {input('token_symbol', 'Token symbol', { hint: '1 to 12 characters, A to Z and 0 to 9' })}
          {input('token_name', 'Token name')}
          {input('website', 'Website (https)')}
          <div>
            <Field label="Category" htmlFor="pf-category">
              <select id="pf-category" className="field" value={f.category} onChange={(e) => set('category', e.target.value)}>
                {(cfg?.categories ?? ['Other']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          {input('blockchain', 'Blockchain')}
          {input('logo_url', 'Logo URL (https, optional)', { hint: project ? 'Leave empty to clear the logo' : undefined })}
          {input('token_address', 'Token contract (optional)')}
          {input('socials', 'Social links, one per line', { area: true, span: true, hint: 'https links' })}
          {input('documentation', 'Documentation links, one per line', { area: true, span: true })}
          {input('description', 'Description', { area: true, span: true })}
          {input('supply_info', 'Supply', { area: true })}
          {input('allocation_info', 'Allocation', { area: true })}
          {input('tge_info', 'TGE information', { area: true })}
          {input('tge_date', 'TGE date (optional)', { type: 'datetime-local' })}
          {input('evidence', 'Authorisation evidence', { area: true, span: true })}
          {input('team_wallet', 'Team wallet (empty: your wallet)')}
          {!project && (
            <div>
              <Field label="Start at" htmlFor="pf-status" hint="Approved lists it as Coming soon">
                <select id="pf-status" className="field" value={f.status} onChange={(e) => set('status', e.target.value)}>
                  {['Approved', 'Submitted', 'Under Review', 'Verification'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={state.busy} onClick={() => void submit()}>{state.busy ? <Spinner /> : project ? 'Save changes' : 'Add project'}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

function ProjectDetail({ p, onClose, showBadges }: { p: AdminProject; onClose: () => void; showBadges: boolean }) {
  const qc = useQueryClient()
  const auth = useAuth()
  const [reason, setReason] = useState('')
  const [badge, setBadge] = useState('verified_project')
  const [evidence, setEvidence] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const [editing, setEditing] = useState(false)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-projects'] })
    void qc.invalidateQueries({ queryKey: ['admin-overview'] })
  }
  const act = async (fn: () => Promise<unknown>) => {
    setState({ busy: true })
    try {
      await fn()
      refresh()
      setState({ busy: false })
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Failed' })
    }
  }
  const canBadge = auth.roles.length > 0
  return (
    <Modal open onClose={onClose} title={`${p.name} (${p.token_symbol})`}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={p.status} /> <BadgeRow badges={p.badges as never} />
          <span className="ml-auto flex gap-2">
            <button className="btn btn-ghost !min-h-9" onClick={() => setEditing(true)}>Edit</button>
            <button
              className="btn btn-danger !min-h-9"
              disabled={state.busy}
              onClick={() => window.confirm(`Delete ${p.name}? This removes the project and cannot be undone. A project with a market on-chain cannot be deleted.`) && void act(() => api.del(`/admin/projects/${p.id}`).then(onClose))}
            >
              Delete
            </button>
          </span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="label">Applicant</dt><dd className="mono break-all text-xs">{p.applicant}</dd></div>
          <div><dt className="label">Team wallet</dt><dd className="mono break-all text-xs">{p.team_wallet}</dd></div>
          <div><dt className="label">Website</dt><dd className="break-all">{p.website || '–'}</dd></div>
          <div><dt className="label">Token contract</dt><dd className="mono break-all text-xs">{p.token_address || 'not provided'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Socials</dt><dd className="break-all">{p.socials.join(', ') || '–'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Documentation</dt><dd className="break-all">{p.documentation.join(', ') || '–'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Description</dt><dd className="whitespace-pre-wrap">{p.description}</dd></div>
          <div className="sm:col-span-2"><dt className="label">Ownership / authorisation evidence</dt><dd className="whitespace-pre-wrap">{p.evidence}</dd></div>
          <div><dt className="label">Supply</dt><dd className="whitespace-pre-wrap">{p.supply_info || '–'}</dd></div>
          <div><dt className="label">Allocation</dt><dd className="whitespace-pre-wrap">{p.allocation_info || '–'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">TGE</dt><dd className="whitespace-pre-wrap">{p.tge_info || '–'} {p.tge_date ? `(${fmtDate(p.tge_date)})` : ''}</dd></div>
        </dl>
        <div>
          <div className="label">History</div>
          <ol className="space-y-1 text-xs text-[var(--subtle)]">
            {p.history.map((h, i) => (
              <li key={i}>{fmtDate(h.at)} · {h.from ?? '–'} → <b className="text-[var(--ink-2)]">{h.to}</b> · {shortAddr(h.actor)} {h.reason && `· “${h.reason}”`}</li>
            ))}
          </ol>
        </div>
        {(NEXT[p.status] ?? []).length > 0 && (
          <div className="space-y-2 rounded-2xl bg-[var(--tint)] p-3">
            <div className="label">Move to</div>
            <input className="field" placeholder="Reason (required for reject / changes requested / delist)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {NEXT[p.status].map((to) => (
                <button key={to} className={`btn ${to === 'Rejected' || to === 'Delisted' ? 'btn-danger' : to === 'Approved' ? 'btn-primary' : 'btn-ghost'} !min-h-9`} disabled={state.busy || (NEEDS_REASON.includes(to) && !reason.trim())} onClick={() => void act(() => api.post(`/admin/projects/${p.id}/transition`, { to, reason }).then(() => setReason('')))}>
                  {to}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--subtle)]">Approving lists the project as Coming soon on the site. Trading starts only after a market is created on-chain and activated.</p>
          </div>
        )}
        {showBadges && (
          <div className="space-y-2 rounded-2xl bg-[var(--tint)] p-3">
            <div className="label">Verification badges</div>
            {p.badges.map((b) => (
              <div key={b.badge} className="flex items-center justify-between gap-2">
                <span>{BADGE_INFO[b.badge]?.label}</span>
                {canBadge && (
                  <button className="btn btn-danger !min-h-8 !px-3 !py-1 text-xs" disabled={state.busy} onClick={() => void act(() => api.del(`/admin/projects/${p.id}/badges/${b.badge}`))}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
            {canBadge ? (
              <>
                <select className="field" value={badge} onChange={(e) => setBadge(e.target.value)} aria-label="Badge">
                  {Object.entries(BADGE_INFO).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <textarea className="field min-h-16" placeholder="Evidence: what was checked and where (required)" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
                <button className="btn btn-primary !min-h-9" disabled={state.busy || evidence.trim().length < 3} onClick={() => void act(() => api.post(`/admin/projects/${p.id}/badges`, { badge, evidence }).then(() => setEvidence('')))}>
                  Grant badge
                </button>
                <p className="text-xs text-[var(--subtle)]">{BADGE_INFO[badge]?.means} {BADGE_INFO[badge]?.not}</p>
              </>
            ) : (
              <p className="text-xs text-[var(--subtle)]">Only admins can grant or revoke badges.</p>
            )}
          </div>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
      </div>
      {editing && <ProjectFormModal project={p} onClose={() => setEditing(false)} />}
    </Modal>
  )
}

function ProjectTable({ status, filter, showBadges }: { status?: string; filter?: (p: AdminProject) => boolean; showBadges: boolean }) {
  const { data, isLoading } = useProjects(status)
  const [open, setOpen] = useState<AdminProject | null>(null)
  const items = (data?.items ?? []).filter(filter ?? (() => true))
  if (isLoading) return <Spinner label="Loading…" />
  const current = open ? (data?.items.find((x) => x.id === open.id) ?? open) : null
  return (
    <div className="glass rounded-3xl p-4">
      <DataTable
        empty="No projects here."
        head={['Project', 'Status', 'Badges', 'Updated', '']}
        rows={items.map((p) => [
          <div key="n"><div className="font-semibold">{p.name}</div><div className="mono text-xs text-[var(--subtle)]">{p.token_symbol}</div></div>,
          <StatusChip key="s" status={p.status} />,
          <BadgeRow key="b" badges={p.badges as never} compact />,
          <span key="u" className="text-xs text-[var(--subtle)]">{fmtDate(p.updated_at)}</span>,
          <button key="o" className="btn btn-ghost !min-h-9" onClick={() => setOpen(p)}>Open</button>,
        ])}
      />
      {current && <ProjectDetail p={current} onClose={() => setOpen(null)} showBadges={showBadges} />}
    </div>
  )
}

export function Applications() {
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-2xl font-semibold">Applications</h2>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a project</button>
      </div>
      {adding && <ProjectFormModal onClose={() => setAdding(false)} />}
      <select className="field max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
        <option value="">All submitted</option>
        {['Submitted', 'Under Review', 'Verification', 'Changes Requested', 'Approved', 'Rejected', 'Market Setup', 'Live', 'Suspended', 'Delisted', 'Completed'].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <ProjectTable status={status} showBadges={false} />
    </>
  )
}

export function Verification() {
  return (
    <>
      <h2 className="display text-2xl font-semibold">Verification</h2>
      <Notice>Badges describe specific checks only. They never imply investment safety, profitability or guaranteed token delivery. Granting and revoking is audit-logged.</Notice>
      <ProjectTable filter={(p) => ['Verification', 'Approved', 'Market Setup', 'Live', 'Suspended'].includes(p.status)} showBadges />
    </>
  )
}

// ---------------------------------------------------------------- Approved projects + market draft

function DraftForm({ p, onClose }: { p: AdminProject; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => {
    const now = new Date()
    const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    return {
      decimals: '18',
      lotTokens: '1',
      tick: '0.01',
      minLots: '1',
      maxLots: '1000',
      start: toLocal(now),
      end: toLocal(new Date(now.getTime() + 30 * 86400000)),
    }
  })
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: boolean }>({ busy: false })
  const submit = async () => {
    setState({ busy: true })
    try {
      const dec = Number(f.decimals)
      const lotSize = parseUnits(f.lotTokens, dec)
      const tickPerToken = parseUnits(f.tick, 6)
      const tickLot = (tickPerToken * lotSize) / 10n ** BigInt(dec)
      if (tickLot === 0n || (tickPerToken * lotSize) % 10n ** BigInt(dec) !== 0n) throw new Error('Tick size does not convert to a whole number of USDC base units for this lot size')
      await api.post('/admin/markets', {
        project_id: p.id,
        token_decimals: dec,
        lot_size: lotSize.toString(),
        tick_size: tickLot.toString(),
        min_lots: Number(f.minLots),
        max_lots: Number(f.maxLots),
        trading_start: new Date(f.start).toISOString(),
        trading_end: new Date(f.end).toISOString(),
      })
      void qc.invalidateQueries({ queryKey: ['admin-projects'] })
      void qc.invalidateQueries({ queryKey: ['admin-markets'] })
      setState({ busy: false, ok: true })
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Failed' })
    }
  }
  const row = (k: keyof typeof f, label: string, type = 'text', hint?: string) => (
    <Field label={label} htmlFor={`d-${k}`} hint={hint}>
      <input id={`d-${k}`} type={type} className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  )
  return (
    <Modal open onClose={onClose} title={`Configure market: ${p.name}`}>
      {state.ok ? (
        <div className="space-y-3">
          <Notice tone="ok">Market draft created. Next: Market Management → create it on-chain, verify configuration, approve and activate.</Notice>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <Notice>Parameters cannot be changed after the market is created on-chain. To change them, cancel and create a new market.</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            {row('decimals', 'Token decimals', 'number')}
            {row('lotTokens', 'Lot size (tokens)', 'text', 'Smallest tradable quantity')}
            {row('tick', 'Tick size (USDC per token)', 'text', 'Price step')}
            <div />
            {row('minLots', 'Min order (lots)', 'number')}
            {row('maxLots', 'Max order (lots)', 'number')}
            {row('start', 'Trading start', 'datetime-local')}
            {row('end', 'Trading end', 'datetime-local')}
          </div>
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <button className="btn btn-primary" disabled={state.busy} onClick={() => void submit()}>
            {state.busy ? <Spinner /> : 'Create market draft'}
          </button>
        </div>
      )}
    </Modal>
  )
}

export function ApprovedProjects() {
  const { data } = useProjects('Approved')
  const { data: setup } = useProjects('Market Setup')
  const [draft, setDraft] = useState<AdminProject | null>(null)
  const items = data?.items ?? []
  return (
    <>
      <h2 className="display text-2xl font-semibold">Approved Projects</h2>
      <Notice>Approval does not activate a market. A market manager configures it here, creates it on-chain and activates it as a separate step.</Notice>
      {items.length === 0 ? <EmptyState title="No approved projects waiting for a market" /> : (
        <div className="glass rounded-3xl p-4">
          <DataTable
            head={['Project', 'Badges', 'TGE', '']}
            rows={items.map((p) => [
              <div key="n"><div className="font-semibold">{p.name}</div><div className="mono text-xs text-[var(--subtle)]">{p.token_symbol}</div></div>,
              <BadgeRow key="b" badges={p.badges as never} compact />,
              fmtDate(p.tge_date),
              <button key="c" className="btn btn-primary !min-h-9" onClick={() => setDraft(p)}>Configure market</button>,
            ])}
          />
        </div>
      )}
      {(setup?.items.length ?? 0) > 0 && <p className="text-sm text-[var(--subtle)]">{setup?.items.length} project(s) already in Market Setup. Continue in Market Management.</p>}
      {draft && <DraftForm p={draft} onClose={() => setDraft(null)} />}
    </>
  )
}
