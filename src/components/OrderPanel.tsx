import { useAccount, useReadContracts } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { zeroHash } from 'viem'
import { marketplaceAbi } from '@/lib/abi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CHAIN_ID,
  MARKETPLACE,
  REFUND_REASON,
  SUPPORT_TEXT,
  accessControlAbi,
  countdown,
  isDirectType,
  ownableAbi,
  sameAddr,
  shortAddr,
  type Listing,
  type Order,
} from '@/lib/allocx'
import { useNow } from '@/hooks/useNow'
import { usePaused, type MarketEvent } from '@/hooks/useMarket'
import { useTx } from '@/hooks/useTx'
import { Notice, Spinner, StatusBadge, TxPanel } from '@/components/ui'

function HashLink({ hash }: { hash?: `0x${string}` }) {
  if (!hash) return null
  return (
    <a href={buildTxExplorerUrl(CHAIN_ID, hash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
      {shortAddr(hash)} <ExternalLink className="size-3" />
    </a>
  )
}

function Step({ done, active, title, detail, hash }: { done: boolean; active: boolean; title: string; detail?: string; hash?: `0x${string}` }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-1 size-3 shrink-0 rounded-full border-2 ${done ? 'border-[var(--success)] bg-[var(--success)]' : active ? 'border-[var(--warn)] bg-transparent' : 'border-white/20 bg-transparent'}`}
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${done || active ? '' : 'text-[var(--subtle)]'}`}>{title}</div>
        {detail && <div className="text-xs text-pretty text-[var(--subtle)]">{detail}</div>}
        <HashLink hash={hash} />
      </div>
    </li>
  )
}

/** Live delivery check for ownership and admin-role sales, straight from the project contract. */
function useDirectDelivery(listing: Listing, order: Order) {
  const direct = isDirectType(listing.assetType)
  const { data } = useReadContracts({
    allowFailure: true,
    contracts:
      listing.assetType === 3
        ? [{ address: listing.assetContract, abi: ownableAbi, functionName: 'owner', chainId: CHAIN_ID }]
        : [
            { address: listing.assetContract, abi: accessControlAbi, functionName: 'hasRole', args: [zeroHash, order.buyer], chainId: CHAIN_ID },
            { address: listing.assetContract, abi: accessControlAbi, functionName: 'hasRole', args: [zeroHash, order.seller], chainId: CHAIN_ID },
          ],
    query: { enabled: direct && order.status === 1, refetchInterval: 6000 },
  })
  if (!direct || !data) return { buyerHas: false, sellerHas: true, delivered: false }
  if (listing.assetType === 3) {
    const owner = data[0]?.status === 'success' ? (data[0].result as string) : ''
    const buyerHas = sameAddr(owner, order.buyer)
    return { buyerHas, sellerHas: sameAddr(owner, order.seller), delivered: buyerHas }
  }
  const buyerHas = data[0]?.status === 'success' && data[0].result === true
  const sellerHas = data[1]?.status === 'success' && data[1].result === true
  return { buyerHas, sellerHas, delivered: buyerHas && !sellerHas }
}

export function OrderPanel({
  listing,
  order,
  events,
  support,
}: {
  listing: Listing
  order: Order
  events: MarketEvent[]
  support?: number
}) {
  const { address } = useAccount()
  const now = useNow()
  const paused = usePaused()
  const tx = useTx()
  const direct = isDirectType(listing.assetType)
  const delivery = useDirectDelivery(listing, order)

  const isSeller = sameAddr(address, order.seller)
  const isBuyer = sameAddr(address, order.buyer)
  const funded = order.status === 1
  const expired = now > Number(order.deadline)
  const remaining = Number(order.deadline) - now

  const ev = (name: string) => events.find((e) => e.orderId === order.id && e.name === name)
  const fundedEv = ev('OrderFunded')
  const completedEv = ev('OrderCompleted')
  const refundedEv = ev('OrderRefunded')
  const releasedEv = ev('Released')
  const deferredEv = ev('ReleaseDeferred')
  const refundDeferredEv = ev('RefundDeferred')

  const call = (label: string, functionName: 'completeOrder' | 'refundOrder') =>
    tx.run(label, { address: MARKETPLACE, abi: marketplaceAbi, functionName, args: [order.id] })

  const handOver = async () => {
    if (listing.assetType === 3) {
      await tx.run('Transfer ownership to buyer', { address: listing.assetContract, abi: ownableAbi, functionName: 'transferOwnership', args: [order.buyer] })
      return
    }
    if (!delivery.buyerHas) {
      const ok = await tx.run('Grant admin role to buyer', { address: listing.assetContract, abi: accessControlAbi, functionName: 'grantRole', args: [zeroHash, order.buyer] })
      if (!ok) return
    }
    await tx.run('Renounce your admin role', { address: listing.assetContract, abi: accessControlAbi, functionName: 'renounceRole', args: [zeroHash, order.seller] })
  }

  const canRefund = funded && (isSeller || expired || paused) && !(direct && delivery.delivered)
  const refundLabel = isSeller ? 'Decline and refund buyer' : 'Refund buyer'

  return (
    <div className="glass space-y-5 rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="display text-xl font-semibold">Order #{order.id.toString()}</h2>
        <StatusBadge kind="order" status={order.status} />
      </div>

      <ol className="space-y-4">
        <Step
          done
          active={false}
          title={`${formatUsdc(order.price)} USDC paid into escrow`}
          detail={`Buyer ${shortAddr(order.buyer)} · held by the escrow contract`}
          hash={fundedEv?.txHash}
        />
        <Step
          done={order.status === 2}
          active={funded}
          title={direct ? 'Seller hands over rights, then delivery is verified' : 'Seller authorizes the transfer, then delivery is verified'}
          detail={funded ? (expired ? 'The delivery window has ended.' : `Delivery window: ${countdown(remaining)} left`) : order.status === 3 ? 'Not delivered.' : 'Verified onchain.'}
          hash={completedEv?.txHash}
        />
        <Step
          done={order.status === 2 || order.status === 3}
          active={false}
          title={order.status === 3 ? 'Buyer refunded' : 'Payment released to seller'}
          detail={
            order.status === 3
              ? [
                  refundedEv?.reason !== undefined ? `Reason: ${REFUND_REASON[refundedEv.reason] ?? 'Refunded'}.` : '',
                  refundDeferredEv ? 'The refund could not be sent to the buyer and is held for them to claim.' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              : deferredEv
                ? 'Payment could not be pushed to the seller and is held for them to claim.'
                : undefined
          }
          hash={order.status === 3 ? refundedEv?.txHash : (releasedEv ?? deferredEv)?.txHash}
        />
      </ol>

      {funded && support !== undefined && support !== 0 && !direct && isSeller && (
        <Notice tone="warn">
          This transfer would currently fail: {SUPPORT_TEXT[support]?.text} If it fails, the buyer is refunded automatically.
        </Notice>
      )}

      {funded && isSeller && !direct && (
        <div className="space-y-2">
          <Notice>
            By authorizing, AllocX moves this asset from your wallet to the buyer and releases the escrowed USDC to you only if the transfer is verified.
          </Notice>
          <button className="btn btn-primary w-full" disabled={tx.busy || expired || paused} onClick={() => void call('Authorize transfer', 'completeOrder')}>
            {tx.busy ? <Spinner label="Working…" /> : 'Authorize transfer and get paid'}
          </button>
        </div>
      )}

      {funded && direct && (isSeller || delivery.delivered) && (
        <div className="space-y-2">
          {isSeller && !delivery.delivered && (
            <>
              <Notice tone={expired ? 'error' : 'warn'}>
                {expired
                  ? 'The delivery window has ended. Do not hand over rights now: the buyer can still claim a refund.'
                  : 'Hand over the rights from your wallet before the window ends. Handing them over after a refund means the buyer gets them for free.'}
              </Notice>
              <button className="btn btn-primary w-full" disabled={tx.busy || expired || paused} onClick={() => void handOver()}>
                {tx.busy ? <Spinner label="Working…" /> : listing.assetType === 3 ? 'Transfer ownership to buyer' : 'Hand over admin role to buyer'}
              </button>
            </>
          )}
          {delivery.delivered && (
            <>
              <Notice tone="ok">Delivery detected onchain. Verify it to release the payment to the seller.</Notice>
              <button className="btn btn-primary w-full" disabled={tx.busy} onClick={() => void call('Verify delivery and release payment', 'completeOrder')}>
                {tx.busy ? <Spinner label="Working…" /> : 'Verify and release payment'}
              </button>
            </>
          )}
        </div>
      )}

      {funded && isBuyer && !direct && !expired && !paused && (
        <Notice>Waiting for the seller to authorize the transfer. If it does not happen in time, you can refund yourself.</Notice>
      )}
      {funded && isBuyer && direct && !delivery.delivered && !expired && !paused && (
        <Notice>Waiting for the seller to hand over the rights. If it does not happen in time, you can refund yourself.</Notice>
      )}

      {canRefund && (
        <button className={`btn w-full ${isSeller ? 'btn-ghost' : 'btn-danger'}`} disabled={tx.busy} onClick={() => void call('Refund buyer', 'refundOrder')}>
          {tx.busy ? <Spinner label="Working…" /> : refundLabel}
        </button>
      )}
      {funded && !canRefund && isBuyer && !delivery.delivered && (
        <button className="btn btn-ghost w-full" disabled>
          Refund available in {countdown(remaining)}
        </button>
      )}

      <TxPanel tx={tx} />
    </div>
  )
}
