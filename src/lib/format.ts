import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID } from '@/hooks/useApp'

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const txUrl = (hash: string) => buildTxExplorerUrl(CHAIN_ID, hash)
export const addrUrl = (addr: string) => buildAddressExplorerUrl(CHAIN_ID, addr)

export function timeAgo(iso?: string | null): string {
  if (!iso) return '–'
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function fmtDay(iso?: string | null): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** A TGE date for display: the date, or "TBD" when the team has not fixed it yet (to be determined). */
export function tgeDay(iso?: string | null, tbd?: boolean): string {
  return !iso && tbd ? 'TBD' : fmtDay(iso)
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return 'Ended'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

export const BADGE_INFO: Record<string, { label: string; means: string; not: string }> = {
  verified_project: {
    label: 'Verified Project',
    means: 'A reviewer confirmed the applicant controls the official website/social accounts (or a project-signed statement) and the team wallet.',
    not: 'It does not mean the team is trustworthy, the project will succeed, or that a token will exist.',
  },
  contract_verified: {
    label: 'Contract Verified',
    means: 'The token contract address was confirmed by the project through an official channel and the source is verified on the explorer where available.',
    not: 'It does not mean the contract is audited, bug-free, or free of admin powers.',
  },
  allocation_verified: {
    label: 'Allocation Verified',
    means: 'Allocation and supply figures were compared with the official project documentation.',
    not: 'It does not mean the allocation is final, locked, or will be delivered.',
  },
}
