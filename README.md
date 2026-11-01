# AllocX

List. Buy. Transfer. A USDC marketplace on Arc for tokens, NFTs and onchain project rights. Buyers pay into escrow, and the seller is paid only after the transfer is verified onchain. If the transfer fails or the delivery window expires, the buyer is refunded.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Browse, search and filter listings, then buy with USDC.
- List ERC-20 tokens, ERC-721 NFTs, ERC-1155 tokens, single-step contract ownership, and AccessControl admin roles.
- See live escrow status, deadlines and transaction hashes for every order.
- Review your listings, purchases, assets and transaction history in the dashboard.
- Unsupported assets (for example contracts with a two-step owner handover) are shown as unsupported instead of being listed.

Onchain ownership and admin rights are not legal ownership of a company, brand or intellectual property.

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem and ConnectKit on the frontend. Solidity 0.8.28 with OpenZeppelin and Foundry for the contracts. Network: Arc Testnet.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://book.getfoundry.sh).

```bash
bun install
bun run dev
```

Other commands: `bun run check` (lint and typecheck), `bun run contracts:build`, `bun run contracts:test`.

## Environment variables

- `VITE_ALLOCX_MARKETPLACE`: address of the deployed AllocX marketplace contract on Arc Testnet.
- `VITE_ALLOCX_DEPLOY_BLOCK`: block the marketplace was deployed at. Transaction history is read from this block onward.

## Contracts

Three contracts in `contracts/`: the marketplace (listings and orders), the escrow (holds and releases USDC) and the transfer module (checks and performs asset transfers). The marketplace creates the other two when it is deployed, so only one address is configured.
