# CCTP bridge (add USDC to Arc, withdraw from Arc)

Page: **Bridge** (`/bridge`, `src/pages/Bridge.tsx`), chain table and helpers in `src/lib/bridge.ts`. Verification script: `scripts/verify-cctp.mjs`. Tests: the "bridge" step of `scripts/ui-feature-test.mjs`. Status: **Arc Testnet and other test networks only**, not audited.

## What it does

A user moves USDC between Arc Testnet and six other test networks with Circle's Cross-Chain Transfer Protocol (CCTP V2): USDC is **burned** on the source chain and **minted** on the destination chain, so there is no wrapped token and no liquidity pool. Avantdex never holds the funds, has no contract of its own in this path, and the backend and the indexer are not involved: the browser talks to the user's wallet, Circle's CCTP contracts and Circle's public attestation service.

| Direction | Source | Destination | Typical use |
|---|---|---|---|
| Add to Arc | Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji, Polygon Amoy | Arc Testnet | fund a new trading wallet |
| Withdraw from Arc | Arc Testnet | the same six chains | take winnings or leftovers out |

The recipient is always the connected wallet (the same address on the destination chain). Smart-contract wallets may not own that address on the other chain, so the page is meant for ordinary wallets.

## How a transfer runs

1. The user picks the other chain, the direction, an amount (at least 1 USDC, at most the balance on the source chain) and a speed. The page asks Circle's fee service for an estimate (`kit.estimate`) and shows: Circle fees, network gas on the source chain, and what arrives. A warning appears when fees are more than 5% of the amount.
2. **Approve** USDC for the CCTP token messenger on the source chain (wallet request 1).
3. **Burn** with `depositForBurnWithHook` and the Forwarding Service hook (wallet request 2).
4. Circle **attests** the burn, and **Circle's Forwarding Service submits the mint** on the destination chain. The user needs no gas and no signature on the destination chain. This matters most for new users: to add USDC to Arc they would otherwise need Arc gas (which is USDC) before they own any.
5. The page shows each step as it completes, with explorer links. The burn transaction is saved in the browser (`localStorage`, key `avantdex:bridge:v1`, wallet-scoped) and listed under **Recent transfers**, which polls Circle until the mint is observed. Circle finishes a transfer even if the tab is closed.

If a step fails after USDC was burned, **Retry** calls `kit.retry`, which continues from the failed step and never burns twice.

## Decisions and why

| Decision | Reason |
|---|---|
| **Bridge Kit** (`@circle-fin/bridge-kit` 1.16 with `@circle-fin/adapter-viem-v2`), not App Kit | Bridge only. The standalone kit is about 0.6 MB of source against 3 MB for App Kit, and the page is a lazy chunk so the main bundle is unchanged. The API is the same; moving to App Kit later (swap, unified balance) is a small change. |
| **Forwarding Service always on** | No destination gas, no second page visit, no half-finished transfers. The fee is shown before the user signs (about 0.02 USDC into Arc; more out of Arc, for example about 1.3 USDC to Ethereum Sepolia on 2026-11-18). |
| **Speed choice** Fast or Standard | Fast (about seconds) may add a small protocol fee; Standard has none and waits for finality. |
| **No custom developer fee** | Avantdex charges nothing for bridging: platform fees are only on settled trades. |
| **Recipient fixed to the connected wallet** | Avoids sending to a wrong address by typo. |
| **Lazy-loaded page** | The Circle packages are large; they download only when `/bridge` is opened. |

## Chains and contracts (testnet)

CCTP uses **domain** numbers, not chain ids. The token messenger, message transmitter, token minter and message contracts have the same address on every testnet below.

| Chain | Chain id | CCTP domain |
|---|---|---|
| Arc Testnet | 5042002 | 26 |
| Ethereum Sepolia | 11155111 | 0 |
| Avalanche Fuji | 43113 | 1 |
| OP Sepolia | 11155420 | 2 |
| Arbitrum Sepolia | 421614 | 3 |
| Base Sepolia | 84532 | 6 |
| Polygon Amoy | 80002 | 7 |

| Contract | Address |
|---|---|
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| TokenMessengerWithFees | `0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A` |

Test USDC per chain comes from Circle's list (the kit carries it): Arc `0x3600…0000`, Ethereum Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, Arbitrum Sepolia `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, OP Sepolia `0x5fd84259d66Cd46123540766Be93DFE6D43130D7`, Avalanche Fuji `0x5425890298aed601595a70AB815c96711a31Bc65`, Polygon Amoy `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`. The attestation service is `https://iris-api-sandbox.circle.com` (public, open CORS, no key). Mainnet uses `iris-api.circle.com` and different token messenger and transmitter addresses (Arc mainnet: TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, domain 26).

## Verified, and a documentation trap

`node scripts/verify-cctp.mjs` reads the deployed contracts on Arc Testnet, Ethereum Sepolia and Base Sepolia and confirms, on 2026-11-18: the transmitter's `localDomain()` is 26, 0 and 6; the token messenger implementation contains the **seven-argument** `depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)` and `depositForBurnWithHook`; and it does **not** contain the four-argument V1 form. Arc's page "Bridge USDC and EURC with CCTP" still shows the four-argument call and an `/v2/attestations/{hash}` URL; code written from it would revert. Use Circle's developer pages (`/cctp/references/contract-interfaces`, `GET /v2/messages/{domain}?transactionHash=`), as the page does through the kit.

## Limits

* **Testnet only.** The wagmi chain list, `src/lib/bridge.ts` and the Iris host are testnet values. Mainnet needs its own table (domains and addresses above), the production Iris host, the wagmi chains, and an explicit confirmation step for real funds. Do not add it before the audit (see [ROADMAP.md](ROADMAP.md)).
* **This moves USDC, not project tokens.** CCTP carries USDC, EURC and cirBTC. Settlement of a pre-TGE token still needs that token to exist on Arc (finding H-2 of [AUDIT-2026-11-ARC-CIRCLE.md](AUDIT-2026-11-ARC-CIRCLE.md)).
* **Recent transfers live in the browser only.** Clearing site data removes the list, not the transfer: the burn and the mint stay on chain and can be found from the explorer or Circle's service.
* **Fees can be a large share of a small amount** (a warning shows above 5%). Fast transfers also depend on Circle's Fast Transfer allowance.
* **Circle Wallet cannot bridge.** A Circle Wallet works on Arc only; the page says so and disables the button (see [CIRCLE-WALLET.md](CIRCLE-WALLET.md)).
* **Only the connected wallet receives.** There is no "send to another address" field on purpose.
* Real end-to-end transfers need funds on a public testnet (gas on the source chain and test USDC from `faucet.circle.com`). The automated test covers the page, validation, the Circle fee quote and the layout; the burn and mint transactions are run by Circle's own kit and contracts and were not executed in the automated test.

## Tests

`scripts/ui-feature-test.mjs`, step "bridge": connects a wallet, flips to withdraw, checks the minimum and number-format messages, waits for a **live** fee quote from Circle for Arc to Ethereum Sepolia, checks the summary and the enabled button, and checks that the wrong-network banner stays hidden (the bridge asks the wallet to switch networks on purpose). The mobile overflow step also covers `/bridge` and `/roadmap`.
