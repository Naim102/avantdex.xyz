import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID, REFUND_REASON, sameAddr, shortAddr, timeAgo, type Listing, type Order } from '@/lib/allocx'
import { useBlockTimes, useListings, useMarketConfig, useMarketEvents, useOrders, type MarketEvent } from '@/hooks/useMarket'
import { AssetAmount, EmptyState, ListingCard, ListingGrid, Notice, SkeletonGrid, StatusBadge } from '@/components/ui'
import { AdminPanel, ClaimRow, HoldingCheck } from '@/components/DashboardParts'

const TABS = ['My Listings', 'My Purchases', 'My Assets', 'Transaction History'] as const

function OrderRow({ order, listing }: { order: Order; listing?: Listing }) {
  return (
    <Link to={`/listing/${order.listingId}`} className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 transition-colors hover:border-[var(--border-strong)]">
      <div className="min-w-0">
        <div className="display truncate text-base font-semibold">{listing?.name ?? `Listing #${order.listingId}`}</div>
        <div className="mt-0.5 text-xs text-[var(--subtle)]">
          Order #{order.id.toString()} · {timeAgo(Number(order.createdAt))}
          {listing && (
            <>
              {' '}· <AssetAmount listing={listing} />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="display font-bold tabular-nums">{formatUsdc(order.price)} USDC</span>
        <StatusBadge kind="order" status={order.status} />
      </div>
    </Link>
  )
}

function eventLabel(e: MarketEvent, me: string): string | null {
  switch (e.name) {
    case 'ListingCreated':
      return 'Listing created'
    case 'ListingCancelled':
      return 'Listing cancelled'
    case 'OrderFunded':
      return sameAddr(e.buyer, me) ? 'Purchased: USDC paid into escrow' : 'Sale: buyer paid into escrow'
    case 'OrderCompleted':
      return 'Transfer verified and payment released'
    case 'OrderRefunded':
      return `Buyer refunded${e.reason !== undefined ? ` (${REFUND_REASON[e.reason] ?? 'refunded'})` : ''}`
    case 'ReleaseDeferred':
      return 'Payment held for claim'
    case 'RefundDeferred':
      return 'Refund held for claim'
    case 'Claimed':
      return 'Payment claimed'
    default:
      return null
  }
}

export default function Dashboard() {
  const { address, isConnected } = useAccount()
  const [tab, setTab] = useState<(typeof TABS)[number]>('My Listings')
  const { listings, isLoading: listingsLoading } = useListings()
  const { orders, isLoading: ordersLoading } = useOrders()
  const { escrow } = useMarketConfig()
  const events = useMarketEvents(escrow)

  const byId = useMemo(() => new Map(listings.map((l) => [l.id.toString(), l])), [listings])
  const myListings = listings.filter((l) => sameAddr(l.seller, address))
  const myPurchases = orders.filter((o) => sameAddr(o.buyer, address))
  const myAssets = myPurchases.filter((o) => o.status === 2)
  const mySales = orders.filter((o) => sameAddr(o.seller, address))

  const history = (() => {
    const listingIds = new Set(myListings.map((l) => l.id.toString()))
    const orderIds = new Set([...myPurchases, ...mySales].map((o) => o.id.toString()))
    return (events.data ?? [])
      .filter((e) => {
        if (!eventLabel(e, address ?? '')) return false
        return (
          sameAddr(e.buyer, address) ||
          sameAddr(e.seller, address) ||
          sameAddr(e.to, address) ||
          (e.listingId !== undefined && listingIds.has(e.listingId.toString())) ||
          (e.orderId !== undefined && orderIds.has(e.orderId.toString()))
        )
      })
      .slice(0, 40)
  })()
  const times = useBlockTimes(history.map((h) => h.blockNumber))

  const deferredOrders = (events.data ?? []).filter((e) => (e.name === 'ReleaseDeferred' || e.name === 'RefundDeferred') && sameAddr(e.to, address))

  if (!isConnected) {
    return (
      <EmptyState
        title="Connect your wallet"
        body="Your listings, purchases, assets and transaction history are read from the AllocX contract for your wallet."
        action={
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button className="btn btn-primary" onClick={show}>
                Connect Wallet
              </button>
            )}
          </ConnectKitButton.Custom>
        }
      />
    )
  }

  const loading = listingsLoading || ordersLoading
  const needsAction = mySales.filter((o) => o.status === 1).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-4xl font-bold">Dashboard</h1>
          <p className="mono mt-1 text-sm text-[var(--subtle)]">{shortAddr(address)}</p>
        </div>
        <Link to="/create" className="btn btn-primary">
          List Asset
        </Link>
      </div>

      {needsAction > 0 && (
        <Notice tone="warn">
          You have {needsAction} sale{needsAction > 1 ? 's' : ''} waiting for you to deliver. Open the listing to authorize the transfer.
        </Notice>
      )}
      {deferredOrders.map((e) => (
        <ClaimRow key={e.orderId?.toString()} orderId={e.orderId as bigint} />
      ))}

      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl bg-white/5 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold transition-colors ${tab === t ? 'bg-white/12 text-[var(--ink)]' : 'text-[var(--subtle)] hover:text-[var(--ink)]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonGrid count={3} />
      ) : (
        <>
          {tab === 'My Listings' &&
            (myListings.length === 0 ? (
              <EmptyState title="No listings yet" body="List a supported token, NFT, or set of project rights to start selling." action={<Link to="/create" className="btn btn-primary">List Asset</Link>} />
            ) : (
              <ListingGrid>
                {myListings.map((l) => (
                  <ListingCard key={l.id.toString()} listing={l} />
                ))}
              </ListingGrid>
            ))}

          {tab === 'My Purchases' &&
            (myPurchases.length === 0 ? (
              <EmptyState title="No purchases yet" body="Assets you buy appear here with their escrow status." action={<Link to="/explore" className="btn btn-primary">Explore listings</Link>} />
            ) : (
              <div className="space-y-3">
                {myPurchases.map((o) => (
                  <OrderRow key={o.id.toString()} order={o} listing={byId.get(o.listingId.toString())} />
                ))}
              </div>
            ))}

          {tab === 'My Assets' &&
            (myAssets.length === 0 ? (
              <EmptyState title="No assets yet" body="Once a purchase is verified and completed, the asset shows up here with a live onchain ownership check." />
            ) : (
              <div className="space-y-3">
                {myAssets.map((o) => {
                  const l = byId.get(o.listingId.toString())
                  if (!l) return null
                  return (
                    <Link key={o.id.toString()} to={`/listing/${l.id}`} className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 hover:border-[var(--border-strong)]">
                      <div className="min-w-0">
                        <div className="display truncate text-base font-semibold">{l.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--subtle)]">
                          <AssetAmount listing={l} /> · {shortAddr(l.assetContract)}
                        </div>
                      </div>
                      <HoldingCheck listing={l} />
                    </Link>
                  )
                })}
              </div>
            ))}

          {tab === 'Transaction History' &&
            (events.isLoading ? (
              <SkeletonGrid count={2} />
            ) : events.isError ? (
              <Notice tone="error">Could not load transaction history from Arc Testnet.</Notice>
            ) : history.length === 0 ? (
              <EmptyState title="No transactions yet" body="Listings, purchases, transfers and refunds from your wallet are recorded here with their transaction hashes." />
            ) : (
              <div className="glass divide-y divide-white/8 rounded-3xl">
                {history.map((e) => {
                  const l = e.listingId !== undefined ? byId.get(e.listingId.toString()) : undefined
                  const ts = times.data?.[String(e.blockNumber)]
                  return (
                    <div key={`${e.txHash}-${e.logIndex}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{eventLabel(e, address ?? '')}</div>
                        <div className="truncate text-xs text-[var(--subtle)]">
                          {l?.name ?? (e.listingId !== undefined ? `Listing #${e.listingId}` : e.orderId !== undefined ? `Order #${e.orderId}` : '')}
                          {ts ? ` · ${timeAgo(ts)}` : ''}
                        </div>
                      </div>
                      <a href={buildTxExplorerUrl(CHAIN_ID, e.txHash)} target="_blank" rel="noopener noreferrer" className="mono inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                        {shortAddr(e.txHash)} <ExternalLink className="size-3" />
                      </a>
                    </div>
                  )
                })}
              </div>
            ))}
        </>
      )}

      <AdminPanel />
    </div>
  )
}
