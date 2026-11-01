import { erc20Abi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'

export const CHAIN_ID = arcTestnet.id
export const MARKETPLACE = import.meta.env.VITE_ALLOCX_MARKETPLACE as Address
export const DEPLOY_BLOCK = BigInt((import.meta.env.VITE_ALLOCX_DEPLOY_BLOCK as string | undefined) ?? '0')
export const USDC_ADDRESS = (getUsdc(CHAIN_ID)?.address ?? '0x3600000000000000000000000000000000000000') as Address
export const ZERO = '0x0000000000000000000000000000000000000000' as Address
export const MAX_PAGE = 200n

export const ASSET_TYPES = [
  { id: 0, label: 'ERC-20 token', short: 'ERC-20', direct: false, hint: 'Fungible tokens held in your wallet.' },
  { id: 1, label: 'ERC-721 NFT', short: 'ERC-721', direct: false, hint: 'A single NFT, identified by token ID.' },
  { id: 2, label: 'ERC-1155 token', short: 'ERC-1155', direct: false, hint: 'An amount of one ERC-1155 token ID.' },
  { id: 3, label: 'Contract ownership', short: 'Ownership', direct: true, hint: 'Single-step owner() of a contract you own.' },
  { id: 4, label: 'AccessControl admin', short: 'Admin role', direct: true, hint: 'DEFAULT_ADMIN_ROLE on an AccessControl contract.' },
] as const

export const LISTING_STATUS = ['None', 'Active', 'Pending', 'Sold', 'Cancelled'] as const
export const ORDER_STATUS = ['None', 'Funded', 'Completed', 'Refunded'] as const
export const REFUND_REASON = ['Declined by seller', 'Transfer failed', 'Expired', 'Marketplace paused'] as const

export const SUPPORT_TEXT: Record<number, { ok: boolean; text: string }> = {
  0: { ok: true, text: 'Supported and ready to transfer.' },
  1: { ok: false, text: 'Unsupported: this contract does not expose a safe, verifiable transfer for this asset type.' },
  2: { ok: false, text: 'The connected wallet does not hold or control this asset.' },
  3: { ok: false, text: 'AllocX is not yet authorized to transfer this asset.' },
  4: { ok: false, text: 'Insufficient balance after your other active listings.' },
  5: { ok: false, text: 'Invalid amount or token ID for this asset type.' },
}

export interface Listing {
  id: bigint
  seller: Address
  assetType: number
  assetContract: Address
  tokenId: bigint
  amount: bigint
  price: bigint
  status: number
  createdAt: bigint
  activeOrderId: bigint
  name: string
  description: string
  imageUri: string
}

export interface Order {
  id: bigint
  listingId: bigint
  buyer: Address
  seller: Address
  price: bigint
  status: number
  createdAt: bigint
  deadline: bigint
  settledAt: bigint
}

export const isDirectType = (t: number) => t === 3 || t === 4
export const assetLabel = (t: number) => ASSET_TYPES[t]?.label ?? 'Unknown'
export const assetShort = (t: number) => ASSET_TYPES[t]?.short ?? 'Unknown'

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function imageSrc(uri: string): string | null {
  const v = uri.trim()
  if (v.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${v.slice(7)}`
  if (v.startsWith('https://')) return v
  return null
}

export function timeAgo(seconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return 'Expired'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

export const ownableAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'transferOwnership', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
] as const

export const accessControlAbi = [
  { type: 'function', name: 'hasRole', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'grantRole', stateMutability: 'nonpayable', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renounceRole', stateMutability: 'nonpayable', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'callerConfirmation', type: 'address' }], outputs: [] },
] as const

export const erc721ReadAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

export const erc1155ReadAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

export { erc20Abi }
