/** Thin client for the Avantdex API (`/api`, same origin in production, proxied by Vite in development). */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const TOKEN_KEY = 'avantdex.token'

export class ApiRequestError extends Error {
  status: number
  code: string
  fields?: { field: string; message: string }[]
  constructor(status: number, code: string, message: string, fields?: { field: string; message: string }[]) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiRequestError(0, 'network', 'Cannot reach the Avantdex API. Check your connection and try again.')
  }
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (res.status === 401) {
    // the session expired or is invalid: drop it so the UI asks the user to sign in again
    tokenStore.clear()
    window.dispatchEvent(new Event('avantdex:unauthorized'))
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: { field: string; message: string }[] } } | null)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.fields)
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ---------------------------------------------------------------- types

export interface AppConfig {
  chain_id: number
  explorer_url: string
  usdc_address: `0x${string}`
  usdc_decimals: number
  exchange_address: `0x${string}`
  fee_collector: `0x${string}`
  buyer_fee_bps: number
  seller_fee_bps: number
  categories: string[]
  notice: string
  network: string
  audited: boolean
  circle_wallet: { enabled: boolean; client_url: string; client_key: string; paymaster: boolean }
  /** Circle's Iris attestation service used by the bridge (the sandbox on testnet). */
  cctp?: { api_url: string }
}

export interface Badge {
  badge: 'verified_project' | 'contract_verified' | 'allocation_verified'
  granted_at: string | null
  expires_at: string | null
}

export interface ProjectPublic {
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
  documentation: string[]
  badges: Badge[]
}

export interface MarketStats {
  last_price: string | null
  best_bid: string | null
  best_ask: string | null
  volume_24h: string
  volume_total: string
  open_interest: string
  bid_depth: string
  ask_depth: string
  open_orders: number
  trades: number
}

export interface PlatformStats {
  markets_live: number
  markets_total: number
  projects_upcoming: number
  open_orders: number
  bid_depth: string
  ask_depth: string
  volume_24h: string
  volume_total: string
  open_interest: string
  trades_total: number
  trades_settled: number
  fees_paid: string
}

export interface Market {
  id: number
  onchain_id: number | null
  slug: string | null
  status: string
  delisted: boolean
  token_address: string
  token_decimals: number
  lot_size: string
  tick_size: string
  min_lots: string
  max_lots: string
  trading_start: string
  trading_end: string
  tge_date: string | null
  settlement_opened_at: string | null
  settlement_deadline: string | null
  open_trades: number
  activated_at: string | null
  project: ProjectPublic | null
  stats: Partial<MarketStats>
}

export interface Level {
  price: string
  lots: string
  orders: number
  cumulative_lots: string
}

export interface OrderBookData {
  market: number
  bids: Level[]
  asks: Level[]
  best_bid: string | null
  best_ask: string | null
  spread: string | null
  last_indexed_block: number | null
}

export interface ApiTrade {
  id: number
  market_onchain_id: number
  buy_order_id: number
  sell_order_id: number
  buyer: string
  seller: string
  lots: string
  price: string
  value: string
  buyer_fee: string
  seller_fee: string
  status: 'Open' | 'Settled' | 'Defaulted' | 'Refunded'
  tx_hash: string
  closed_tx_hash: string | null
  created_at: string
  closed_at: string | null
  role?: 'buyer' | 'seller'
  market?: {
    slug: string | null
    status: string
    name: string | null
    symbol: string | null
    settlement_deadline: string | null
    token_address: string
    lot_size: string
    token_decimals: number
  } | null
}

export interface ApiOrder {
  id: number
  market_onchain_id: number
  owner: string
  side: 'buy' | 'sell'
  price: string
  lots: string
  filled: string
  locked: string
  status: 'Open' | 'Partially Filled' | 'Filled' | 'Cancelled' | 'Expired'
  chain_status: string
  ioc: boolean
  expiry: string
  tx_hash: string
  closed_tx_hash: string | null
  created_at: string
}

export interface MatchPlan {
  maker_ids: number[]
  makers: { order_id: number; price: string; lots: string }[]
  expected_fill_lots: string
  expected_value: string
  expected_fee: string
  remaining_lots: string
}

/** Per market (token) position of a wallet, from GET /portfolio/{address}/positions. Amounts are lots; money is USDC base units. */
export interface Position {
  market_onchain_id: number
  to_receive_lots: number
  to_deliver_lots: number
  pay_locked: string
  collateral_locked: string
  sale_net: string
  received_lots: number
  delivered_lots: number
  open_trades: number
  open_buy_lots: number
  open_sell_lots: number
  open_orders: number
  locked_in_orders: string
  market: {
    slug: string | null
    status: string
    name: string | null
    symbol: string | null
    logo_url: string
    token_address: string
    lot_size: string
    token_decimals: number
    tge_date: string | null
    trading_end: string | null
    settlement_deadline: string | null
  }
}
