import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { FileText, Megaphone } from 'lucide-react'
import { EmptyState, Field, Notice, PageTitle, Spinner, StatusChip, WalletGate } from '@/components/ui'
import { api, ApiRequestError } from '@/lib/api'
import { useAuth, useConfig } from '@/hooks/useApp'
import { fmtDate } from '@/lib/format'

// ---------------------------------------------------------------- Create Listing hub (not "Create Order")

export function ListingHub() {
  return (
    <div className="space-y-6">
      <PageTitle title="Create Listing" subtitle="Get a project onto Avantdex. Listing a project is free and never creates an order or a market by itself." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/list/submit" className="glass flex flex-col gap-3 rounded-3xl p-6 transition-colors hover:border-[var(--border-strong)]">
          <FileText className="size-7 text-[var(--accent-text)]" />
          <div className="display text-xl font-semibold">Submit Your Project</div>
          <p className="text-sm text-[var(--subtle)]">For project owners and authorised team representatives. Provide project, token and ownership details. Applications go through review, verification and a separate market activation.</p>
        </Link>
        <Link to="/list/request" className="glass flex flex-col gap-3 rounded-3xl p-6 transition-colors hover:border-[var(--border-strong)]">
          <Megaphone className="size-7 text-[var(--accent-text)]" />
          <div className="display text-xl font-semibold">Request a Listing</div>
          <p className="text-sm text-[var(--subtle)]">Suggest a project you want to trade. A request never creates a live market: the Avantdex team reviews it first.</p>
        </Link>
      </div>
      <Notice tone="warn">Arc only: Avantdex lists tokens that are, or will be, deployed on Arc, because trades are settled on Arc in USDC. A token that launches on another chain cannot be listed. See the <Link to="/legal/listing-policy" className="underline">listing policy</Link>.</Notice>
      <Notice>Looking to buy or sell? Open a market and use its Buy / Sell panel. Listing a project is a different thing from placing an order.</Notice>
    </div>
  )
}

// ---------------------------------------------------------------- Submit Your Project

interface ProjectForm {
  name: string
  token_name: string
  token_symbol: string
  logo_url: string
  description: string
  website: string
  socials: string
  category: string
  blockchain: string
  token_address: string
  supply_info: string
  allocation_info: string
  tge_info: string
  tge_date: string
  tge_tbd: boolean
  documentation: string
  evidence: string
  team_wallet: string
}

const EMPTY: ProjectForm = {
  name: '', token_name: '', token_symbol: '', logo_url: '', description: '', website: '', socials: '', category: 'Other', blockchain: 'Arc',
  token_address: '', supply_info: '', allocation_info: '', tge_info: '', tge_date: '', tge_tbd: false, documentation: '', evidence: '', team_wallet: '',
}

interface MyProject {
  id: number
  slug: string
  name: string
  token_name: string
  token_symbol: string
  logo_url: string
  description: string
  website: string
  socials: string[]
  category: string
  blockchain: string
  token_address: string
  supply_info: string
  allocation_info: string
  tge_info: string
  tge_date: string | null
  tge_tbd: boolean
  documentation: string[]
  evidence: string
  team_wallet: string
  status: string
  review_note: string
  updated_at: string
  history: { to: string; reason: string; at: string }[]
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

function payload(f: ProjectForm, wallet?: string) {
  return {
    ...f,
    team_wallet: f.team_wallet || wallet || '',
    socials: lines(f.socials),
    documentation: lines(f.documentation),
    tge_date: !f.tge_tbd && f.tge_date ? new Date(f.tge_date).toISOString() : null,
    tge_tbd: f.tge_tbd,
  }
}

function MyApplications({ onEdit }: { onEdit: (p: MyProject) => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['my-projects'], queryFn: () => api.get<{ items: MyProject[] }>('/projects/mine') })
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')
  if (!data?.items.length) return null
  const submit = async (id: number) => {
    setBusy(id)
    setErr('')
    try {
      await api.post(`/projects/${id}/submit`)
      await qc.invalidateQueries({ queryKey: ['my-projects'] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="space-y-3">
      <h2 className="display text-xl font-semibold">Your applications</h2>
      {err && <Notice tone="error">{err}</Notice>}
      {data.items.map((p) => (
        <div key={p.id} className="glass space-y-2 rounded-3xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold">{p.name}</span> <span className="mono text-xs text-[var(--subtle)]">{p.token_symbol}</span>
              <div className="text-xs text-[var(--subtle)]">Updated {fmtDate(p.updated_at)}</div>
            </div>
            <StatusChip status={p.status} />
          </div>
          {p.status === 'Changes Requested' && p.review_note && <Notice tone="warn">Changes requested: {p.review_note}</Notice>}
          {p.status === 'Rejected' && p.review_note && <Notice tone="error">Rejected: {p.review_note}</Notice>}
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--subtle)]">
            {p.history.map((h, i) => (
              <li key={i}>
                {h.to} · {fmtDate(h.at)}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {(p.status === 'Draft' || p.status === 'Changes Requested') && (
              <>
                <button className="btn btn-ghost" onClick={() => onEdit(p)}>
                  Edit
                </button>
                <button className="btn btn-primary" disabled={busy === p.id} onClick={() => void submit(p.id)}>
                  {busy === p.id ? <Spinner /> : p.status === 'Draft' ? 'Submit for review' : 'Resubmit'}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

export function SubmitProject() {
  const { address } = useAccount()
  const { data: cfg } = useConfig()
  const qc = useQueryClient()
  const auth = useAuth()
  const [f, setF] = useState<ProjectForm>(EMPTY)
  const [editing, setEditing] = useState<number | null>(null)
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false })
  const set = <K extends keyof ProjectForm>(k: K, v: ProjectForm[K]) => setF((s) => ({ ...s, [k]: v }))

  const load = (p: MyProject) => {
    setEditing(p.id)
    setF({
      ...EMPTY,
      name: p.name,
      token_name: p.token_name,
      token_symbol: p.token_symbol,
      logo_url: p.logo_url,
      description: p.description,
      website: p.website,
      socials: p.socials.join('\n'),
      category: p.category,
      blockchain: 'Arc', // the only chain Avantdex lists; older applications that named another chain are corrected on save
      token_address: p.token_address,
      supply_info: p.supply_info,
      allocation_info: p.allocation_info,
      tge_info: p.tge_info,
      tge_date: p.tge_date ? p.tge_date.slice(0, 10) : '',
      tge_tbd: !!p.tge_tbd,
      documentation: p.documentation.join('\n'),
      evidence: p.evidence,
      team_wallet: p.team_wallet,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const run = async (submit: boolean) => {
    setState({ busy: true })
    try {
      const saved = editing ? await api.put<MyProject>(`/projects/${editing}`, payload(f, address)) : await api.post<MyProject>('/projects', payload(f, address))
      setEditing(saved.id)
      if (submit) await api.post(`/projects/${saved.id}/submit`)
      await qc.invalidateQueries({ queryKey: ['my-projects'] })
      setState({ busy: false, ok: submit ? 'Submitted for review. You can track the status below.' : 'Draft saved.' })
      if (submit) {
        setF(EMPTY)
        setEditing(null)
      }
    } catch (e) {
      const msg = e instanceof ApiRequestError && e.fields?.length ? e.fields.map((x) => `${x.field}: ${x.message}`).join('; ') : e instanceof Error ? e.message : 'Failed'
      setState({ busy: false, error: msg })
    }
  }

  const inp = (k: Exclude<keyof ProjectForm, 'tge_tbd'>, label: string, opts?: { hint?: string; type?: string; max?: number }) => (
    <Field label={label} htmlFor={k} hint={opts?.hint}>
      <input id={k} type={opts?.type ?? 'text'} className="field" maxLength={opts?.max} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  )
  const area = (k: Exclude<keyof ProjectForm, 'tge_tbd'>, label: string, hint?: string, max = 2000) => (
    <Field label={label} htmlFor={k} hint={hint}>
      <textarea id={k} className="field min-h-24" maxLength={max} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  )

  return (
    <div className="space-y-6">
      <PageTitle title="Submit Your Project" subtitle="For project owners and authorised team representatives. Submitting is free. Approval, verification and market activation are separate steps." />
      <WalletGate needSignIn what="submit a project">
        {auth.signedIn && (
          <div className="space-y-6">
            <MyApplications onEdit={load} />
            <section className="glass space-y-5 rounded-3xl p-4 sm:p-5 sm:p-6">
              <h2 className="display text-xl font-semibold">{editing ? `Editing application #${editing}` : 'New application'}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {inp('name', 'Project name', { max: 120 })}
                {inp('token_name', 'Token name', { max: 120 })}
                {inp('token_symbol', 'Token symbol', { hint: 'A–Z and 0–9, up to 12 characters', max: 12 })}
                {inp('logo_url', 'Project logo URL', { hint: 'https:// image link' })}
              </div>
              {area('description', 'Project description')}
              <div className="grid gap-4 sm:grid-cols-2">
                {inp('website', 'Official website', { hint: 'https:// only' })}
                <Field label="Category" htmlFor="category">
                  <select id="category" className="field" value={f.category} onChange={(e) => set('category', e.target.value)}>
                    {(cfg?.categories ?? ['Other']).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {area('socials', 'Official social links', 'One https:// link per line (at least one required)', 1000)}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Blockchain" htmlFor="blockchain" hint="Avantdex lists only tokens deployed on Arc, because trades are settled on Arc.">
                  <div id="blockchain" className="field flex items-center font-semibold">Arc</div>
                </Field>
                {inp('token_address', 'Token contract address on Arc (optional before TGE)', { hint: '0x… the token’s address on Arc' })}
              </div>
              {area('supply_info', 'Token supply information')}
              {area('allocation_info', 'Allocation information')}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Expected TGE date" htmlFor="tge_date" hint={f.tge_tbd ? 'Marked as TBD (to be determined). Untick it when the date is fixed.' : undefined}>
                  <div className="space-y-2">
                    <input id="tge_date" type="date" className="field" value={f.tge_date} disabled={f.tge_tbd} onChange={(e) => set('tge_date', e.target.value)} />
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={f.tge_tbd}
                        onChange={(e) => setF((s) => ({ ...s, tge_tbd: e.target.checked, tge_date: e.target.checked ? '' : s.tge_date }))}
                      />
                      TBD (to be determined)
                    </label>
                  </div>
                </Field>
                {area('tge_info', 'TGE information')}
              </div>
              {area('documentation', 'Project documentation links', 'One https:// link per line', 1000)}
              {area('evidence', 'Ownership or authorisation evidence', 'For example a signed statement published on the official website or a post from the official account. Links or short text only.')}
              <Field label="Team wallet" htmlFor="team_wallet" hint="You must be signed in with this wallet to submit. This proves control of the wallet only.">
                <input id="team_wallet" className="field mono text-xs" value={f.team_wallet || address || ''} onChange={(e) => set('team_wallet', e.target.value.trim())} />
              </Field>
              {state.error && <Notice tone="error">{state.error}</Notice>}
              {state.ok && <Notice tone="ok">{state.ok}</Notice>}
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-ghost" disabled={state.busy} onClick={() => void run(false)}>
                  {state.busy ? <Spinner /> : 'Save draft'}
                </button>
                <button className="btn btn-primary" disabled={state.busy} onClick={() => void run(true)}>
                  {state.busy ? <Spinner /> : 'Submit for review'}
                </button>
              </div>
              <p className="text-xs text-[var(--subtle)]">Submitting an application does not create a market. A reviewer approves the application, a verification admin grants badges, and a market manager separately activates the market.</p>
            </section>
          </div>
        )}
      </WalletGate>
    </div>
  )
}

// ---------------------------------------------------------------- Request a Listing

export function RequestListing() {
  const navigate = useNavigate()
  const [f, setF] = useState({ project_name: '', token_symbol: '', link: '', reason: '' })
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: number }>({ busy: false })
  const submit = async () => {
    setState({ busy: true })
    try {
      const r = await api.post<{ requests_for_symbol: number }>('/listing-requests', f)
      setState({ busy: false, done: r.requests_for_symbol })
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : 'Failed' })
    }
  }
  const { data: top } = useQuery({ queryKey: ['request-summary'], queryFn: () => api.get<{ items: { token_symbol: string; requests: number }[] }>('/listing-requests/summary') })
  return (
    <div className="space-y-6">
      <PageTitle title="Request a Listing" subtitle="Suggest a project you would like to trade. A request never creates a live market; the Avantdex team reviews it first. Only tokens deployed on Arc can be listed." />
      <WalletGate needSignIn what="request a listing">
        {state.done ? (
          <div className="space-y-4">
            <Notice tone="ok">Request received. {state.done > 1 ? `${state.done} requests exist for this symbol.` : 'You are the first to request this symbol.'}</Notice>
            <button className="btn btn-ghost" onClick={() => void navigate('/explore')}>
              Back to Explore
            </button>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <section className="glass space-y-4 rounded-3xl p-4 sm:p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project name" htmlFor="pn">
                  <input id="pn" className="field" maxLength={120} value={f.project_name} onChange={(e) => setF({ ...f, project_name: e.target.value })} />
                </Field>
                <Field label="Token symbol" htmlFor="ts" hint="A–Z and 0–9">
                  <input id="ts" className="field" maxLength={12} value={f.token_symbol} onChange={(e) => setF({ ...f, token_symbol: e.target.value })} />
                </Field>
              </div>
              <Field label="Official website or social link" htmlFor="lk" hint="https:// only">
                <input id="lk" className="field" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
              </Field>
              <Field label="Why should it be listed?" htmlFor="rs" hint={`${f.reason.length}/1000`}>
                <textarea id="rs" className="field min-h-28" maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </Field>
              {state.error && <Notice tone="error">{state.error}</Notice>}
              <button className="btn btn-primary" disabled={state.busy} onClick={() => void submit()}>
                {state.busy ? <Spinner /> : 'Send request'}
              </button>
              <p className="text-xs text-[var(--subtle)]">Free. Up to 5 requests per day per wallet. Requests are reviewed by admins; they do not create a market.</p>
            </section>
            <aside className="space-y-2">
              <h2 className="label">Most requested</h2>
              {top?.items.length ? top.items.slice(0, 8).map((i) => (
                <div key={i.token_symbol} className="glass-inner flex justify-between rounded-2xl px-3 py-2 text-sm">
                  <span className="mono">{i.token_symbol}</span>
                  <span className="text-[var(--subtle)]">{i.requests}</span>
                </div>
              )) : <EmptyState title="No requests yet" />}
            </aside>
          </div>
        )}
      </WalletGate>
    </div>
  )
}
