import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { marketplaceAbi } from '@/lib/abi'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID, MARKETPLACE, SUPPORT_TEXT, assetLabel, isDirectType, sameAddr, shortAddr, timeAgo, type Listing, type Order } from '@/lib/allocx'
import { erc20Abi } from 'viem'
import { USDC_ADDRESS } from '@/lib/allocx'
import { useListingSupport, useMarketConfig, useMarketEvents, useOrders, usePaused, useUsdcAllowance, useUsdcBalance } from '@/hooks/useMarket'
import { useTx } from '@/hooks/useTx'
import { AssetAmount, AssetThumb, AssetTypeChip, LegalNote, Notice, Price, Spinner, StatusBadge, TxPanel } from '@/components/ui'
import { OrderPanel } from '@/components/OrderPanel'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-[var(--subtle)]">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{children}</span>
    </div>
  )
}

function BuyPanel({ listing, support }: { listing: Listing; support?: number }) {
  const { address, isConnected } = useAccount()
  const { escrow } = useMarketConfig()
  const { balance } = useUsdcBalance()
  const allowance = useUsdcAllowance(escrow)
  const paused = usePaused()
  const tx = useTx()
  const [ack, setAck] = useState(false)

  const isSeller = sameAddr(address, listing.seller)
  const direct = isDirectType(listing.assetType)
  const active = listing.status === 1
  const deliverable = support === 0
  const insufficient = balance !== undefined && balance < listing.price
  const needsAllowance = allowance < listing.price

  const buy = async () => {
    if (!escrow) return
    if (needsAllowance) {
      const ok = await tx.run('Allow escrow to hold your USDC', { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [escrow, listing.price] })
      if (!ok) return
    }
    await tx.run('Buy now', { address: MARKETPLACE, abi: marketplaceAbi, functionName: 'buy', args: [listing.id] })
  }

  const cancel = () => tx.run('Cancel listing', { address: MARKETPLACE, abi: marketplaceAbi, functionName: 'cancelListing', args: [listing.id] })

  return (
    <div className="glass space-y-4 rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Price</span>
        <StatusBadge kind="listing" status={listing.status} />
      </div>
      <Price value={listing.price} size="lg" />

      {active && !isSeller && (
        <>
          <div className="glass-inner divide-y divide-white/8 rounded-2xl px-4 text-sm">
            <div className="flex justify-between py-2.5">
              <span className="text-[var(--subtle)]">You pay</span>
              <span className="tabular-nums font-semibold">{formatUsdc(listing.price)} USDC</span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-[var(--subtle)]">Held in escrow until</span>
              <span className="text-right font-medium">transfer is verified</span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-[var(--subtle)]">If not delivered</span>
              <span className="font-medium">full refund</span>
            </div>
          </div>
          {support !== undefined && !deliverable && <Notice tone="error">Not available to buy right now: {SUPPORT_TEXT[support]?.text}</Notice>}
          {direct && (
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--ink-2)]">
              <input type="checkbox" className="mt-1 size-4 accent-[#acc6e9]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand this transfers onchain admin or ownership rights only, not legal ownership of a company.</span>
            </label>
          )}
          {paused && <Notice tone="warn">The marketplace is paused. Purchases are disabled.</Notice>}
          {insufficient && (
            <Notice tone="error">
              Your USDC balance is below the price. Get test USDC from{' '}
              <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="underline">
                faucet.circle.com
              </a>
              .
            </Notice>
          )}
          {isConnected ? (
            <button className="btn btn-primary w-full" disabled={!deliverable || paused || insufficient || tx.busy || !escrow || (direct && !ack)} onClick={() => void buy()}>
              {tx.busy ? <Spinner label={tx.phase === 'wallet' ? 'Confirm in wallet…' : 'Confirming…'} /> : needsAllowance ? 'Allow USDC and Buy Now' : 'Buy Now'}
            </button>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button className="btn btn-primary w-full" onClick={show}>
                  Connect Wallet to buy
                </button>
              )}
            </ConnectKitButton.Custom>
          )}
        </>
      )}

      {active && isSeller && (
        <>
          <Notice>This is your listing. Buyers can purchase it while it stays active and you keep holding the asset.</Notice>
          <button className="btn btn-danger w-full" disabled={tx.busy} onClick={() => void cancel()}>
            {tx.busy ? <Spinner label="Working…" /> : 'Cancel listing'}
          </button>
        </>
      )}
      {listing.status === 2 && <Notice tone="warn">A buyer has paid into escrow. The order is in progress below.</Notice>}
      {listing.status === 3 && <Notice tone="ok">This asset has been sold and transferred.</Notice>}
      {listing.status === 4 && <Notice>This listing was cancelled by the seller.</Notice>}
      <TxPanel tx={tx} />
    </div>
  )
}

export default function ListingDetail() {
  const { id } = useParams()
  const listingId = /^\d+$/.test(id ?? '') ? BigInt(id as string) : undefined
  const { escrow } = useMarketConfig()
  const { data: events } = useMarketEvents(escrow)
  const { orders } = useOrders()

  const q = useReadContract({
    address: MARKETPLACE,
    abi: marketplaceAbi,
    functionName: 'getListing',
    args: listingId !== undefined ? [listingId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: listingId !== undefined, refetchInterval: 8000, retry: false },
  })
  const support = useListingSupport(listingId)
  const listing = q.data

  if (listingId === undefined || q.isError) {
    return (
      <div className="glass rounded-3xl p-10 text-center">
        <h1 className="display text-2xl font-semibold">Listing not found</h1>
        <p className="mt-2 text-[var(--subtle)]">This listing does not exist on AllocX.</p>
        <Link to="/explore" className="btn btn-primary mt-6">
          Back to Explore
        </Link>
      </div>
    )
  }
  if (!listing) return <div className="glass h-96 animate-pulse rounded-3xl" />

  const related = orders.filter((o) => o.listingId === listing.id)
  const order: Order | undefined = related.find((o) => o.status === 1) ?? related.find((o) => o.status === 2) ?? related[0]

  return (
    <div className="space-y-6">
      <Link to="/explore" className="inline-flex items-center gap-1.5 text-sm text-[var(--subtle)] hover:text-[var(--ink)]">
        <ArrowLeft className="size-4" /> Explore
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <div className="glass overflow-hidden rounded-3xl">
            <AssetThumb listing={listing} className="aspect-[16/8] w-full" />
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <AssetTypeChip type={listing.assetType} />
                <span className="chip">Listing #{listing.id.toString()}</span>
              </div>
              <h1 className="display text-3xl font-bold text-balance sm:text-4xl">{listing.name}</h1>
              <p className="whitespace-pre-line text-pretty text-[var(--muted)]">{listing.description || 'The seller did not add a description.'}</p>
            </div>
          </div>

          <div className="glass divide-y divide-white/8 rounded-3xl px-5 py-2 sm:px-6">
            <Row label="Asset type">{assetLabel(listing.assetType)}</Row>
            <Row label="Includes">
              <AssetAmount listing={listing} />
            </Row>
            <Row label="Project contract">
              <a href={buildAddressExplorerUrl(CHAIN_ID, listing.assetContract)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                {shortAddr(listing.assetContract)} <ExternalLink className="size-3" />
              </a>
            </Row>
            <Row label="Seller">
              <a href={buildAddressExplorerUrl(CHAIN_ID, listing.seller)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                {shortAddr(listing.seller)} <ExternalLink className="size-3" />
              </a>
            </Row>
            <Row label="Listed">{timeAgo(Number(listing.createdAt))}</Row>
            <Row label="Transfer check">
              {listing.status === 1 || listing.status === 2
                ? support === undefined
                  ? 'Checking…'
                  : support === 0
                    ? 'Verified deliverable'
                    : 'Not deliverable now'
                : 'Closed'}
            </Row>
          </div>
          <LegalNote />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <BuyPanel key={listing.id.toString()} listing={listing} support={support} />
        </aside>
      </div>

      {order && <OrderPanel key={`${listing.id}-${order.id}`} listing={listing} order={order} events={events ?? []} support={support} />}
    </div>
  )
}
