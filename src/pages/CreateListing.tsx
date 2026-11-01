import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, erc721Abi, isAddress, parseEventLogs, parseUnits } from 'viem'
import { marketplaceAbi } from '@/lib/abi'
import { parseUsdc } from '@/onchain-money'
import { ASSET_TYPES, CHAIN_ID, MARKETPLACE, SUPPORT_TEXT, ZERO, isDirectType, type Listing } from '@/lib/allocx'
import { useMarketConfig, usePaused } from '@/hooks/useMarket'
import { useTx } from '@/hooks/useTx'
import { LegalNote, ListingCard, Notice, Spinner, TxPanel } from '@/components/ui'

const DIGITS = /^\d*$/

export default function CreateListing() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const { transferModule } = useMarketConfig()
  const paused = usePaused()
  const tx = useTx()

  const [type, setType] = useState(0)
  const [asset, setAsset] = useState('')
  const [tokenId, setTokenId] = useState('')
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [image, setImage] = useState('')

  const direct = isDirectType(type)
  const needsTokenId = type === 1 || type === 2
  const needsAmount = type === 0 || type === 2
  const assetOk = isAddress(asset)
  const assetAddr = (assetOk ? asset : ZERO)

  const decimalsQ = useReadContract({
    address: assetAddr,
    abi: erc20Abi,
    functionName: 'decimals',
    chainId: CHAIN_ID,
    query: { enabled: assetOk && type === 0 },
  })
  const symbolQ = useReadContract({
    address: assetAddr,
    abi: erc20Abi,
    functionName: 'symbol',
    chainId: CHAIN_ID,
    query: { enabled: assetOk && type === 0 },
  })

  const parsed = useMemo(() => {
    let tokenIdBig = 0n
    let amountBig = 1n
    let priceBig: bigint | null = null
    let amountErr = ''
    try {
      if (needsTokenId) tokenIdBig = tokenId === '' ? -1n : BigInt(tokenId)
      if (type === 0) {
        if (decimalsQ.data === undefined) amountBig = 0n
        else amountBig = amount === '' ? 0n : parseUnits(amount, Number(decimalsQ.data))
      } else if (type === 2) {
        amountBig = amount === '' ? 0n : BigInt(amount)
      }
    } catch {
      amountBig = 0n
      amountErr = 'Enter a valid amount.'
    }
    try {
      priceBig = price === '' ? null : parseUsdc(price)
    } catch {
      priceBig = null
    }
    return { tokenIdBig, amountBig, priceBig, amountErr }
  }, [type, needsTokenId, tokenId, amount, price, decimalsQ.data])

  const inputsReady = assetOk && parsed.tokenIdBig >= 0n && parsed.amountBig > 0n && !!address
  const preview = useReadContract({
    address: MARKETPLACE,
    abi: marketplaceAbi,
    functionName: 'previewListing',
    args: [type, assetAddr, parsed.tokenIdBig < 0n ? 0n : parsed.tokenIdBig, parsed.amountBig, address ?? ZERO],
    chainId: CHAIN_ID,
    query: { enabled: inputsReady, refetchInterval: 6000 },
  })
  const committed = useReadContract({
    address: MARKETPLACE,
    abi: marketplaceAbi,
    functionName: 'committedAmount',
    args: [address ?? ZERO, type, assetAddr, parsed.tokenIdBig < 0n ? 0n : parsed.tokenIdBig],
    chainId: CHAIN_ID,
    query: { enabled: inputsReady },
  })

  const support = preview.data === undefined ? undefined : Number(preview.data)
  const needsApproval = support === 3 && !direct
  const supportInfo = support !== undefined ? SUPPORT_TEXT[support] : undefined
  const canList = support === 0 || needsApproval
  const formOk = name.trim().length > 0 && name.length <= 80 && description.length <= 500 && image.length <= 256 && parsed.priceBig !== null && parsed.priceBig > 0n

  const previewListing: Listing = {
    id: 0n,
    seller: address ?? ZERO,
    assetType: type,
    assetContract: assetAddr,
    tokenId: parsed.tokenIdBig < 0n ? 0n : parsed.tokenIdBig,
    amount: parsed.amountBig,
    price: parsed.priceBig ?? 0n,
    status: 1,
    createdAt: 0n,
    activeOrderId: 0n,
    name: name || 'Listing name',
    description,
    imageUri: image,
  }

  const submit = async () => {
    if (!canList || !formOk || !transferModule || parsed.priceBig === null) return
    if (needsApproval) {
      const base = { address: assetAddr } as const
      let approved = null
      if (type === 0) {
        approved = await tx.run('Authorize AllocX to move your tokens', {
          ...base,
          abi: erc20Abi,
          functionName: 'approve',
          args: [transferModule, (committed.data ?? 0n) + parsed.amountBig],
        })
      } else if (type === 1) {
        approved = await tx.run('Authorize AllocX for this NFT', {
          ...base,
          abi: erc721Abi,
          functionName: 'approve',
          args: [transferModule, parsed.tokenIdBig],
        })
      } else {
        approved = await tx.run('Authorize AllocX for this token', {
          ...base,
          abi: erc721Abi,
          functionName: 'setApprovalForAll',
          args: [transferModule, true],
        })
      }
      if (!approved) return
    }
    const receipt = await tx.run('Create listing', {
      address: MARKETPLACE,
      abi: marketplaceAbi,
      functionName: 'createListing',
      args: [type, assetAddr, parsed.tokenIdBig, parsed.amountBig, parsed.priceBig, name.trim(), description.trim(), image.trim()],
    })
    if (!receipt) return
    const created = parseEventLogs({ abi: marketplaceAbi, logs: receipt.logs, eventName: 'ListingCreated' })[0]
    if (created) void navigate(`/listing/${created.args.id.toString()}`)
  }

  const cta = !isConnected ? null : tx.busy ? (
    <Spinner label={tx.phase === 'wallet' ? 'Confirm in wallet…' : 'Confirming…'} />
  ) : needsApproval ? (
    'Authorize and list'
  ) : (
    'List Asset'
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-4xl font-bold">Create listing</h1>
        <p className="mt-1 text-[var(--subtle)]">Only assets with a safe, verifiable transfer can be listed. Everything else is shown as unsupported.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="glass space-y-5 rounded-3xl p-5 sm:p-6">
          <div>
            <label className="label">Asset type</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ASSET_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setType(t.id)
                    setTokenId('')
                    setAmount('')
                  }}
                  className={`rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${type === t.id ? 'border-[var(--accent)] bg-[rgba(172,198,233,0.12)] text-[var(--accent)]' : 'border-[var(--border)] bg-white/4 hover:border-[var(--border-strong)]'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--subtle)]">{ASSET_TYPES[type].hint}</p>
          </div>

          <div>
            <label className="label" htmlFor="asset">Project or contract address</label>
            <input id="asset" className="field mono" placeholder="0x…" value={asset} onChange={(e) => setAsset(e.target.value.trim())} spellCheck={false} />
            {asset && !assetOk && <p className="mt-1.5 text-xs text-[var(--danger)]">Enter a valid contract address.</p>}
          </div>

          {(needsTokenId || needsAmount) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {needsTokenId && (
                <div>
                  <label className="label" htmlFor="tokenId">Token ID</label>
                  <input id="tokenId" className="field mono" inputMode="numeric" placeholder="0" value={tokenId} onChange={(e) => DIGITS.test(e.target.value) && setTokenId(e.target.value)} />
                </div>
              )}
              {needsAmount && (
                <div>
                  <label className="label" htmlFor="amount">Amount{type === 0 && symbolQ.data ? ` (${symbolQ.data})` : ''}</label>
                  <input
                    id="amount"
                    className="field tabular-nums"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => (type === 0 ? /^\d*\.?\d*$/ : DIGITS).test(e.target.value) && setAmount(e.target.value)}
                  />
                  {parsed.amountErr && <p className="mt-1.5 text-xs text-[var(--danger)]">{parsed.amountErr}</p>}
                </div>
              )}
            </div>
          )}

          {supportInfo && inputsReady && (
            <Notice tone={supportInfo.ok ? 'ok' : needsApproval ? 'info' : 'error'}>
              {needsApproval ? 'You still need to authorize AllocX to transfer this asset. It will be requested in your wallet when you list.' : supportInfo.text}
            </Notice>
          )}
          {direct && (
            <Notice>
              No approval is needed for rights. After a buyer pays into escrow, you hand over the rights from your wallet and payment is released once the
              handover is verified. Contracts with two-step handovers (pending owner or pending admin) are unsupported.
            </Notice>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div>
              <label className="label" htmlFor="name">Project name</label>
              <input id="name" className="field" maxLength={80} placeholder="e.g. Orbit Protocol admin rights" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="price">Price (USDC)</label>
              <input id="price" className="field tabular-nums" inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => /^\d*\.?\d{0,6}$/.test(e.target.value) && setPrice(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="desc">Short description</label>
            <textarea id="desc" className="field min-h-24 resize-y" maxLength={500} placeholder="What is being sold, and what does the buyer receive?" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="mt-1 text-right text-xs tabular-nums text-[var(--subtle)]">{description.length}/500</div>
          </div>
          <div>
            <label className="label" htmlFor="image">Image URL (optional)</label>
            <input id="image" className="field" maxLength={256} placeholder="https://… or ipfs://…" value={image} onChange={(e) => setImage(e.target.value.trim())} />
          </div>

          <LegalNote />
          {paused && <Notice tone="warn">The marketplace is paused. New listings are disabled until it resumes.</Notice>}
          <TxPanel tx={tx} />

          {isConnected ? (
            <button className="btn btn-primary w-full" disabled={!canList || !formOk || tx.busy || paused || !transferModule} onClick={() => void submit()}>
              {cta}
            </button>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button className="btn btn-primary w-full" onClick={show}>
                  Connect Wallet to list
                </button>
              )}
            </ConnectKitButton.Custom>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <div className="label">Preview</div>
          <div className="pointer-events-none" aria-hidden="true">
            <ListingCard listing={previewListing} />
          </div>
          <p className="text-xs text-pretty text-[var(--subtle)]">
            Listing details are stored onchain. Your wallet confirms every transaction.
          </p>
        </aside>
      </div>
    </div>
  )
}

