import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { erc20Abi, parseEventLogs, type Address, type Log } from 'viem'
import { marketplaceAbi, escrowAbi } from '@/lib/abi'
import { CHAIN_ID, DEPLOY_BLOCK, MARKETPLACE, MAX_PAGE, USDC_ADDRESS, type Listing, type Order } from '@/lib/allocx'

const POLL = 8000

const market = { address: MARKETPLACE, abi: marketplaceAbi, chainId: CHAIN_ID } as const

export function useCounts() {
  const listings = useReadContract({ ...market, functionName: 'listingCount', query: { refetchInterval: POLL } })
  const orders = useReadContract({ ...market, functionName: 'orderCount', query: { refetchInterval: POLL } })
  return {
    listingCount: listings.data ?? 0n,
    orderCount: orders.data ?? 0n,
    isLoading: listings.isLoading || orders.isLoading,
  }
}

function pageWindow(count: bigint) {
  const size = count > MAX_PAGE ? MAX_PAGE : count
  return { from: count - size + 1n, size }
}

/** Newest first. Reads up to the latest 200 listings straight from the marketplace contract. */
export function useListings() {
  const { listingCount, isLoading: countLoading } = useCounts()
  const { from, size } = pageWindow(listingCount)
  const query = useReadContract({
    ...market,
    functionName: 'getListings',
    args: [from, size],
    query: { enabled: listingCount > 0n, refetchInterval: POLL },
  })
  const listings = ((query.data ?? []) as readonly Listing[]).slice().reverse()
  return {
    listings,
    isLoading: countLoading || (listingCount > 0n && query.isLoading),
    isError: query.isError,
    refetch: query.refetch,
  }
}

export function useOrders() {
  const { orderCount, isLoading: countLoading } = useCounts()
  const { from, size } = pageWindow(orderCount)
  const query = useReadContract({
    ...market,
    functionName: 'getOrders',
    args: [from, size],
    query: { enabled: orderCount > 0n, refetchInterval: POLL },
  })
  const orders = ((query.data ?? []) as readonly Order[]).slice().reverse()
  return { orders, isLoading: countLoading || (orderCount > 0n && query.isLoading), isError: query.isError }
}

export function usePaused() {
  const q = useReadContract({ ...market, functionName: 'paused', query: { refetchInterval: POLL } })
  return !!q.data
}

export function useMarketConfig() {
  const owner = useReadContract({ ...market, functionName: 'owner' })
  const escrow = useReadContract({ ...market, functionName: 'escrow' })
  const module = useReadContract({ ...market, functionName: 'transferModule' })
  const window = useReadContract({ ...market, functionName: 'deliveryWindow' })
  return {
    owner: owner.data,
    escrow: escrow.data,
    transferModule: module.data,
    deliveryWindow: window.data !== undefined ? Number(window.data) : undefined,
  }
}

export function useUsdcBalance() {
  const { address } = useAccount()
  const q = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: POLL },
  })
  return { balance: q.data, isLoading: q.isLoading }
}

export function useUsdcAllowance(spender?: Address) {
  const { address } = useAccount()
  const q = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!spender, refetchInterval: POLL },
  })
  return q.data ?? 0n
}

export function useListingSupport(listingId?: bigint) {
  const q = useReadContract({
    ...market,
    functionName: 'checkListing',
    args: listingId !== undefined ? [listingId] : undefined,
    query: { enabled: listingId !== undefined, refetchInterval: POLL },
  })
  return q.data === undefined ? undefined : Number(q.data)
}

export interface MarketEvent {
  name: string
  txHash: `0x${string}`
  blockNumber: bigint
  logIndex: number
  orderId?: bigint
  listingId?: bigint
  buyer?: Address
  seller?: Address
  to?: Address
  amount?: bigint
  reason?: number
}

async function fetchRange(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  addresses: Address[],
  from: bigint,
  to: bigint,
): Promise<Log[]> {
  try {
    return await client.getLogs({ address: addresses, fromBlock: from, toBlock: to })
  } catch {
    // Some RPCs cap the block range: split and retry in bounded chunks.
    const out: Log[] = []
    const step = 20_000n
    for (let start = from; start <= to; start += step) {
      const end = start + step - 1n > to ? to : start + step - 1n
      out.push(...(await client.getLogs({ address: addresses, fromBlock: start, toBlock: end })))
    }
    return out
  }
}

/** Marketplace and escrow events from the deployment block. These carry the transaction hashes. */
export function useMarketEvents(escrow?: Address) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  return useQuery({
    queryKey: ['allocx-events', escrow],
    enabled: !!client && !!escrow,
    refetchInterval: 15000,
    queryFn: async (): Promise<MarketEvent[]> => {
      if (!client || !escrow) return []
      const head = await client.getBlockNumber()
      const logs = await fetchRange(client, [MARKETPLACE, escrow], DEPLOY_BLOCK, head)
      const abi = [...marketplaceAbi, ...escrowAbi]
      const parsed = parseEventLogs({ abi, logs, strict: false })
      const events: MarketEvent[] = []
      for (const l of parsed) {
        const a = (l as unknown as { args: Record<string, unknown> }).args ?? {}
        events.push({
          name: l.eventName,
          txHash: l.transactionHash,
          blockNumber: l.blockNumber,
          logIndex: Number(l.logIndex),
          orderId: (a.orderId ?? undefined) as bigint | undefined,
          listingId: (a.listingId ?? a.id ?? undefined) as bigint | undefined,
          buyer: a.buyer as Address | undefined,
          seller: a.seller as Address | undefined,
          to: a.to as Address | undefined,
          amount: (a.amount ?? a.price) as bigint | undefined,
          reason: a.reason !== undefined ? Number(a.reason) : undefined,
        })
      }
      return events.sort((x, y) => Number(y.blockNumber - x.blockNumber) || y.logIndex - x.logIndex)
    },
  })
}

export function useBlockTimes(blockNumbers: bigint[]) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const key = blockNumbers.map(String).join(',')
  return useQuery({
    queryKey: ['allocx-block-times', key],
    enabled: !!client && blockNumbers.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const out: Record<string, number> = {}
      await Promise.all(
        blockNumbers.map(async (n) => {
          const b = await client!.getBlock({ blockNumber: n })
          out[String(n)] = Number(b.timestamp)
        }),
      )
      return out
    },
  })
}

export function useClaim(orderId?: bigint, escrow?: Address) {
  const q = useReadContract({
    address: escrow,
    abi: escrowAbi,
    functionName: 'claims',
    args: orderId !== undefined ? [orderId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!escrow && orderId !== undefined, refetchInterval: POLL },
  })
  const data = q.data
  return data && data[1] > 0n ? { recipient: data[0], amount: data[1] } : undefined
}
