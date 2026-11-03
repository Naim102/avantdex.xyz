/** Units, formatting and error mapping for the Avantdex exchange. All money is integer base units. */
import { formatUnits, parseUnits } from 'viem'
import type { Market } from '@/lib/api'

export const USDC_DECIMALS = 6
export const BPS = 10_000n
export const FEE_BPS = 50n // 0.5% on each side, charged only when a trade settles

export const MARKET_STATUS_LABEL: Record<string, string> = {
  Setup: 'Setup',
  Live: 'Live',
  Suspended: 'Suspended',
  SettlementOpen: 'Settlement open',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  draft: 'Draft',
}

export const fee = (value: bigint): bigint => (value * FEE_BPS) / BPS

export function fmtUsdc(raw: bigint | string | null | undefined, digits = 2): string {
  if (raw === null || raw === undefined) return '—'
  const s = formatUnits(BigInt(raw), USDC_DECIMALS)
  const n = Number(s)
  return n.toLocaleString('en-US', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: Math.max(digits, 2) })
}

/** Trimmed decimal string without float rounding. */
export function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}

/** Tokens per lot as an exact decimal string (for example "1" or "0.5"). */
export function lotTokens(m: Pick<Market, 'lot_size' | 'token_decimals'>): string {
  return trimDecimal(formatUnits(BigInt(m.lot_size), m.token_decimals))
}

/** USDC per token for a per-lot price, as an exact decimal string. */
export function pricePerToken(priceLot: bigint, m: Pick<Market, 'lot_size' | 'token_decimals'>): string {
  // priceLot (USDC base units per lot) * 10^dec / lotSize = USDC base units per token
  const perToken = (priceLot * 10n ** BigInt(m.token_decimals)) / BigInt(m.lot_size)
  return trimDecimal(formatUnits(perToken, USDC_DECIMALS))
}

export function fmtPricePerToken(priceLot: string | null | undefined, m: Pick<Market, 'lot_size' | 'token_decimals'>): string {
  if (priceLot === null || priceLot === undefined) return '—'
  const p = pricePerToken(BigInt(priceLot), m)
  const n = Number(p)
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 })
}

export function fmtLotsAsTokens(lots: string | bigint, m: Pick<Market, 'lot_size' | 'token_decimals'>): string {
  const base = BigInt(lots) * BigInt(m.lot_size)
  const n = Number(formatUnits(base, m.token_decimals))
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export interface ParsedOrderInput {
  priceLot?: bigint
  lots?: bigint
  error?: string
}

/** Converts "USDC per token" and "token quantity" into on-chain price-per-lot and lots, with clear errors. */
export function parseOrderInput(priceStr: string, qtyStr: string, m: Market): ParsedOrderInput {
  const out: ParsedOrderInput = {}
  const lotSize = BigInt(m.lot_size)
  const tick = BigInt(m.tick_size)
  try {
    if (qtyStr) {
      const base = parseUnits(qtyStr, m.token_decimals)
      if (base === 0n) out.error = 'Quantity must be above zero'
      else if (base % lotSize !== 0n) out.error = `Quantity must be a multiple of ${lotTokens(m)} token(s)`
      else out.lots = base / lotSize
    }
    if (priceStr) {
      const perToken = parseUnits(priceStr, USDC_DECIMALS)
      const perLotNum = perToken * lotSize
      const unit = 10n ** BigInt(m.token_decimals)
      if (perLotNum % unit !== 0n) out.error = out.error ?? 'Price has too many decimals for this lot size'
      else {
        const priceLot = perLotNum / unit
        if (priceLot === 0n) out.error = out.error ?? 'Price must be above zero'
        else if (priceLot % tick !== 0n) out.error = out.error ?? `Price must be a multiple of ${pricePerToken(tick, m)} USDC per token`
        else out.priceLot = priceLot
      }
    }
  } catch {
    out.error = 'Enter valid numbers'
  }
  if (out.lots !== undefined) {
    if (out.lots < BigInt(m.min_lots)) out.error = out.error ?? `Minimum order is ${m.min_lots} lot(s)`
    if (out.lots > BigInt(m.max_lots)) out.error = out.error ?? `Maximum order is ${m.max_lots} lot(s)`
  }
  if (out.priceLot !== undefined && out.lots !== undefined && out.priceLot * out.lots < 1_000_000n) {
    out.error = out.error ?? 'Order value must be at least 1 USDC'
  }
  return out
}

/** Absolute market time window helper. */
export function marketTradable(m: Market, now = Date.now()): { ok: boolean; reason?: string } {
  if (m.status !== 'Live') return { ok: false, reason: `Trading is closed: market is ${MARKET_STATUS_LABEL[m.status] ?? m.status}` }
  if (new Date(m.trading_start).getTime() > now) return { ok: false, reason: 'Trading has not started yet' }
  if (new Date(m.trading_end).getTime() <= now) return { ok: false, reason: 'Trading period has ended' }
  return { ok: true }
}

// ---------------------------------------------------------------- contract errors

export const CONTRACT_ERRORS: Record<string, string> = {
  InvalidPrice: 'Price must be a positive multiple of the market tick size.',
  InvalidSize: 'Order size or value is outside the market limits (minimum value 1 USDC).',
  InvalidExpiry: 'Expiry must be in the future and not after the trading end.',
  MarketNotTradable: 'This market is not open for trading right now.',
  MarketNotFound: 'This market does not exist on-chain.',
  NothingFilled: 'Not enough liquidity at your price: the minimum fill could not be met. No funds moved.',
  NotOrderOwner: 'Only the order owner can do this.',
  OrderNotOpen: 'This order is no longer open.',
  TradeNotOpen: 'This trade is already closed.',
  NotSeller: 'Only the seller can settle this trade.',
  NotBuyer: 'Only the buyer can do this.',
  SettlementNotOpen: 'Settlement has not been opened for this market.',
  DeadlineNotReached: 'The settlement deadline has not passed yet.',
  DeliveryNotVerified: 'The token transfer did not deliver the exact amount, so nothing was settled.',
  NotRefundable: 'This trade is not refundable.',
  NothingToClaim: 'Nothing to claim.',
  TooManyItems: 'Too many items in one transaction (maximum 50).',
  InvalidMarketStatus: 'The market is not in the right state for this action.',
  InvalidSettlementWindow: 'Settlement window must be between 1 hour and 14 days.',
  InvalidExtension: 'New deadline must be later than the current one and within 30 days of settlement opening.',
  TokenMismatch: 'This market already has a different token address.',
  NotAContract: 'That address is not a contract.',
  TradesStillOpen: 'There are still open trades.',
  InvalidMarketParams: 'Market parameters are invalid.',
  EnforcedPause: 'New orders are paused by the platform. You can still cancel, settle and claim refunds.',
  AccessControlUnauthorizedAccount: 'This wallet does not have the required on-chain role.',
}
