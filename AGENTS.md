# AllocX

> Built with Arc Studio

Project memory for AllocX, a USDC marketplace on Arc Testnet for listing, buying and transferring tokens, NFTs and onchain project rights.

## What This App Does

Sellers list ERC-20 / ERC-721 / ERC-1155 tokens, single-step `Ownable` ownership and `AccessControl` DEFAULT_ADMIN_ROLE. Buyers pay USDC into escrow. Payment is released only after onchain delivery verification; failed or expired deliveries refund the buyer. No platform fee.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind, react-router-dom, wagmi v2, viem, ConnectKit (injected wallets)
- Contracts: Solidity 0.8.28 + Foundry, OpenZeppelin 5.6.1
- Chain: Arc Testnet (5042002). USDC ERC-20 (6 decimals) at 0x3600000000000000000000000000000000000000

## Deployed (Arc Testnet)

- AllocXMarketplace: 0x1af972dc5f777088ff10a9b3fc2ee076b23e80b1 (deploy block 69835919, tx 0x55c3a6014bcbe73582b452c71799589b660b526768df9beab4681bbcda2b5770)
- AllocXEscrow: 0xE4AE6C74565D22474E3Cab67Bad144f34EAABCb8 (created by the marketplace constructor)
- AllocXTransfer: 0xB66494919b0207819d796057e6D91DfbBBf3FC6c (created by the marketplace constructor)
- Owner: the platform deployer wallet 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42 (shared, the user cannot sign with it). For an owner-controlled pause, redeploy with the user's own address as `initialOwner`.

## Key Decisions

- Token types (ERC20/721/1155): seller approves the transfer module at listing time, then calls `completeOrder`. The module pulls the asset and verifies balances/owner; on failure the buyer is refunded in the same transaction.
- Direct types (Ownable, AccessControl admin): seller hands over rights on the project contract itself. Anyone may call `completeOrder` once delivery is verified. Two-step handovers (`pendingOwner`, `pendingDefaultAdmin`) are reported as unsupported because they cannot be settled safely without custody.
- Known limitation: direct handovers are not atomic. A seller must hand over rights only while the order is Funded and before its deadline.
- Pause blocks listing, buying and token transfers. Cancel, refunds, and settlement of already-delivered direct rights stay open.
- If a seller cannot receive USDC (for example blocklisted), the escrow holds the payment as a claim. The same applies to refunds for a blocklisted buyer (`RefundDeferred`) in the current source, but the Arc Testnet deployment listed above predates that change and still reverts such refunds until the buyer is unblocked. A redeploy is needed for the fix to take effect onchain.

## Key Files

- `contracts/AllocXMarketplace.sol`, `AllocXEscrow.sol`, `AllocXTransfer.sol`
- `src/lib/abi.ts` (generated from `contracts/out`), `src/lib/allocx.ts` (constants, enums, helpers)
- `src/hooks/useMarket.ts` (contract reads, event history), `src/hooks/useTx.ts` (wallet transactions)
- `src/pages/` Home, Explore, ListingDetail, CreateListing, Dashboard; `src/components/OrderPanel.tsx` (escrow order flow)

## To Run

```bash
bun install
bun run dev
```
