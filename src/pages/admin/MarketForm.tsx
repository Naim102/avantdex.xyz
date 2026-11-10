import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, TriangleAlert, X } from 'lucide-react'
import { formatUnits, parseUnits } from 'viem'
import { Field, Modal, Notice, Spinner } from '@/components/ui'
import { api, type Market } from '@/lib/api'

// ---------------------------------------------------------------- token pre-flight

export interface TokenCheck {
  address: string
  is_contract: boolean
  name: string | null
  symbol: string | null
  decimals: number | null
  total_supply: string | null
  ok: boolean
  checks: { label: string; ok: boolean; detail: string; blocking: boolean }[]
}

const ADDR = /^0x[0-9a-fA-F]{40}$/

/** Reads the token from the chain (through the API) and compares it with the form and the project record. */
export function useTokenCheck(address: string, decimals: number | null, marketId?: number) {
  const valid = ADDR.test(address)
  return useQuery({
    queryKey: ['token-check', address.toLowerCase(), decimals, marketId ?? null],
    enabled: valid,
    staleTime: 15000,
    queryFn: () => api.get<TokenCheck>(`/admin/token-check?address=${address}${decimals !== null ? `&decimals=${decimals}` : ''}${marketId !== undefined ? `&market_id=${marketId}` : ''}`),
  })
}

export function TokenCheckPanel({ result, loading, error }: { result?: TokenCheck; loading: boolean; error?: boolean }) {
  if (loading) return <Notice><Spinner label="Reading the token from the chain" /></Notice>
  if (error || !result) return <Notice tone="warn">The token could not be checked. Try again before you continue.</Notice>
  return (
    <div className="glass-inner space-y-2 rounded-2xl p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{result.name ? `${result.name} (${result.symbol ?? '?'})` : 'Token check'}</span>
        <span className={`text-xs font-bold ${result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{result.ok ? 'Passed' : 'Blocked'}</span>
      </div>
      <ul className="space-y-1">
        {result.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-[var(--success)]" aria-hidden="true" /> : c.blocking ? <X className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" aria-hidden="true" />}
            <span><b>{c.label}.</b> <span className="mono">{c.detail}</span></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- market draft form (create and edit)

const utc = (local: string) => {
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

/** Create a market draft for a project, or edit a draft that is not on-chain yet. */
export function MarketForm({ title, projectId, tokenAddress = '', tgeDate = null, market, onClose }: { title: string; projectId?: number; tokenAddress?: string; tgeDate?: string | null; market?: Market; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => {
    const now = new Date()
    if (market) {
      const dec = market.token_decimals
      const tickPerToken = (BigInt(market.tick_size) * 10n ** BigInt(dec)) / BigInt(market.lot_size)
      return {
        decimals: String(dec),
        lotTokens: formatUnits(BigInt(market.lot_size), dec),
        tick: formatUnits(tickPerToken, 6),
        minLots: market.min_lots,
        maxLots: market.max_lots,
        start: toLocal(new Date(market.trading_start)),
        end: toLocal(new Date(market.trading_end)),
        tge: market.tge_date ? toLocal(new Date(market.tge_date)) : '',
      }
    }
    return {
      decimals: '18', lotTokens: '1', tick: '0.01', minLots: '1', maxLots: '1000',
      start: toLocal(now), end: toLocal(new Date(now.getTime() + 30 * 86400000)), tge: tgeDate ? toLocal(new Date(tgeDate)) : '',
    }
  })
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: boolean }>({ busy: false })
  const decNum = f.decimals !== '' && Number.isInteger(Number(f.decimals)) ? Number(f.decimals) : null
  const token = market?.token_address && market.token_address !== '0x0000000000000000000000000000000000000000' ? market.token_address : tokenAddress
  const check = useTokenCheck(token, decNum, market?.id)
  const blocked = !!token && ADDR.test(token) && (check.isLoading || !check.data || !check.data.ok)
  const endBeforeTge = f.tge && f.end && new Date(f.end) < new Date(f.tge)

  const submit = async () => {
    setState({ busy: true })
    try {
      const dec = Number(f.decimals)
      const lotSize = parseUnits(f.lotTokens, dec)
      const tickPerToken = parseUnits(f.tick, 6)
      const tickLot = (tickPerToken * lotSize) / 10n ** BigInt(dec)
      if (tickLot === 0n || (tickPerToken * lotSize) % 10n ** BigInt(dec) !== 0n) throw new Error('Tick size does not convert to a whole number of USDC base units for this lot size')
      const body = {
        token_decimals: dec,
        lot_size: lotSize.toString(),
        tick_size: tickLot.toString(),
        min_lots: Number(f.minLots),
        max_lots: Number(f.maxLots),
        trading_start: new Date(f.start).toISOString(),
        trading_end: new Date(f.end).toISOString(),
        tge_date: f.tge ? new Date(f.tge).toISOString() : null,
      }
      if (market) await api.put(`/admin/markets/${market.id}`, body)
      else await api.post('/admin/markets', { ...body, project_id: projectId })
      void qc.invalidateQueries({ queryKey: ['admin-projects'] })
      void qc.invalidateQueries({ queryKey: ['admin-markets'] })
      void qc.invalidateQueries({ queryKey: ['admin-attention'] })
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
    <Modal open onClose={onClose} title={title}>
      {state.ok ? (
        <div className="space-y-3">
          <Notice tone="ok">{market ? 'Draft saved.' : 'Market draft created. Next: Market Management, create it on-chain, verify the configuration, approve and activate.'}</Notice>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <Notice>Parameters cannot be changed after the market is created on-chain. Until then you can edit or discard the draft.</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            {row('decimals', 'Token decimals', 'number', token ? 'Compared with the token below' : 'No token address yet: this cannot be verified now. It is checked again before settlement opens.')}
            {row('lotTokens', 'Lot size (tokens)', 'text', 'Smallest tradable quantity')}
            {row('tick', 'Tick size (USDC per token)', 'text', 'Price step')}
            <div />
            {row('minLots', 'Min order (lots)', 'number')}
            {row('maxLots', 'Max order (lots)', 'number')}
            {row('start', 'Trading start', 'datetime-local', f.start ? utc(f.start) : undefined)}
            {row('end', 'Trading end', 'datetime-local', f.end ? utc(f.end) : undefined)}
            {row('tge', 'TGE date (optional)', 'datetime-local', f.tge ? `${utc(f.tge)}. Shown to traders and used for alerts.` : 'Shown to traders and used for alerts')}
            <div className="flex items-end">
              <button type="button" className="btn btn-ghost !min-h-9" disabled={!f.tge} onClick={() => setF({ ...f, end: f.tge })}>Set trading end to the TGE date</button>
            </div>
          </div>
          {endBeforeTge && <Notice tone="warn">Trading ends before the TGE date. Users cannot trade in the last days before launch.</Notice>}
          {token && ADDR.test(token) && <TokenCheckPanel result={check.data} loading={check.isLoading} error={check.isError} />}
          {state.error && <Notice tone="error">{state.error}</Notice>}
          <button className="btn btn-primary" disabled={state.busy || blocked} onClick={() => void submit()}>
            {state.busy ? <Spinner /> : market ? 'Save draft' : 'Create market draft'}
          </button>
          {blocked && !check.isLoading && <p className="text-xs text-[var(--danger)]">The token check blocks this form. Fix the decimals or the address first.</p>}
        </div>
      )}
    </Modal>
  )
}
