import { useAccount, useReadContract } from 'wagmi'
import { zeroHash, type Address } from 'viem'
import { escrowAbi, marketplaceAbi } from '@/lib/abi'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID, MARKETPLACE, accessControlAbi, erc1155ReadAbi, erc721ReadAbi, ownableAbi, sameAddr, type Listing } from '@/lib/allocx'
import { erc20Abi } from 'viem'
import { useClaim, useMarketConfig, usePaused } from '@/hooks/useMarket'
import { useTx } from '@/hooks/useTx'
import { Notice, Spinner, TxPanel } from '@/components/ui'

/** Live onchain check that the connected wallet still holds a purchased asset. */
export function HoldingCheck({ listing }: { listing: Listing }) {
  const { address } = useAccount()
  const base = { address: listing.assetContract, chainId: CHAIN_ID } as const
  const me = address as Address
  const enabled = !!address
  const erc20 = useReadContract({ ...base, abi: erc20Abi, functionName: 'balanceOf', args: [me], query: { enabled: enabled && listing.assetType === 0 } })
  const nft = useReadContract({ ...base, abi: erc721ReadAbi, functionName: 'ownerOf', args: [listing.tokenId], query: { enabled: enabled && listing.assetType === 1 } })
  const multi = useReadContract({ ...base, abi: erc1155ReadAbi, functionName: 'balanceOf', args: [me, listing.tokenId], query: { enabled: enabled && listing.assetType === 2 } })
  const owner = useReadContract({ ...base, abi: ownableAbi, functionName: 'owner', query: { enabled: enabled && listing.assetType === 3 } })
  const role = useReadContract({ ...base, abi: accessControlAbi, functionName: 'hasRole', args: [zeroHash, me], query: { enabled: enabled && listing.assetType === 4 } })

  let held: boolean | undefined
  if (listing.assetType === 0 && erc20.data !== undefined) held = erc20.data >= listing.amount
  if (listing.assetType === 1 && nft.data !== undefined) held = sameAddr(nft.data, address)
  if (listing.assetType === 2 && multi.data !== undefined) held = multi.data >= listing.amount
  if (listing.assetType === 3 && owner.data !== undefined) held = sameAddr(owner.data, address)
  if (listing.assetType === 4 && role.data !== undefined) held = role.data === true

  if (held === undefined) return <span className="chip">Checking onchain…</span>
  return (
    <span className="chip" style={{ color: held ? 'var(--success)' : 'var(--subtle)', background: held ? 'rgba(141,216,159,0.12)' : undefined }}>
      {held ? 'Held by this wallet' : 'No longer held by this wallet'}
    </span>
  )
}

/** A payment or refund that could not be pushed to its recipient is held by escrow until they claim it. */
export function ClaimRow({ orderId }: { orderId: bigint }) {
  const { address } = useAccount()
  const { escrow } = useMarketConfig()
  const claim = useClaim(orderId, escrow)
  const tx = useTx()
  if (!claim || !sameAddr(claim.recipient, address) || !escrow) return null
  return (
    <div className="glass-inner space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Order #{orderId.toString()} funds ready to claim</div>
          <div className="text-xs text-[var(--subtle)]">Escrow could not send this to your wallet automatically.</div>
        </div>
        <span className="display text-lg font-bold tabular-nums">{formatUsdc(claim.amount)} USDC</span>
      </div>
      <button className="btn btn-primary w-full" disabled={tx.busy} onClick={() => void tx.run('Claim USDC', { address: escrow, abi: escrowAbi, functionName: 'claim', args: [orderId] })}>
        {tx.busy ? <Spinner label="Working…" /> : 'Claim USDC'}
      </button>
      <TxPanel tx={tx} />
    </div>
  )
}

/** Emergency pause control. Only rendered for the marketplace owner wallet. */
export function AdminPanel() {
  const { address } = useAccount()
  const { owner } = useMarketConfig()
  const paused = usePaused()
  const tx = useTx()
  if (!address || !owner || !sameAddr(owner, address)) return null
  return (
    <div className="glass space-y-3 rounded-3xl p-5">
      <h3 className="display text-lg font-semibold">Marketplace admin</h3>
      <Notice tone={paused ? 'warn' : 'info'}>
        {paused
          ? 'The marketplace is paused. Listings, purchases and token transfers are disabled. Refunds stay open to everyone.'
          : 'Pausing disables new listings, purchases and token transfers. Cancellations and refunds always stay open.'}
      </Notice>
      <button
        className={`btn w-full ${paused ? 'btn-primary' : 'btn-danger'}`}
        disabled={tx.busy}
        onClick={() => void tx.run(paused ? 'Unpause marketplace' : 'Pause marketplace', { address: MARKETPLACE, abi: marketplaceAbi, functionName: paused ? 'unpause' : 'pause' })}
      >
        {tx.busy ? <Spinner label="Working…" /> : paused ? 'Resume marketplace' : 'Emergency pause'}
      </button>
      <TxPanel tx={tx} />
    </div>
  )
}
