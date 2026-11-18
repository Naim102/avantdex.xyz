# CCTP bridge (add USDC to Arc, withdraw from Arc)

Page: **Bridge** (`/bridge`, `src/pages/Bridge.tsx`). Code: `src/lib/cctp.ts` (ABIs, message parsing, Iris client, attestation check), `src/lib/bridgeRoutes.ts` (the network list), `src/lib/directBridge.ts` (the transfer, step by step). Tests and checks: `node scripts/test-cctp.mjs`, `node scripts/test-bridge-fork.mjs`, `node scripts/verify-cctp.mjs`, and the bridge step of `scripts/ui-feature-test.mjs`. Status: **Arc Testnet and other test networks only**, not audited.

## What it does

A user moves USDC between Arc Testnet and other test networks with Circle's Cross-Chain Transfer Protocol (CCTP V2): USDC is **burned** on the source chain and **minted** on the destination chain, so there is no wrapped token and no liquidity pool. Avantdex never holds the funds and has no contract in this path. The browser talks to the user's wallet, Circle's CCTP contracts and Circle's public Iris attestation service. The recipient is always the connected wallet (the same address on the other chain).

## Two ways to finish a transfer

| | **I finish it myself** (default) | **Circle finishes it** |
|---|---|---|
| Transfer type | CCTP V2 **Standard** (`minFinalityThreshold` 2000), no CCTP fee | Standard or Fast, with Circle's Forwarding Service |
| Steps you sign | approve, burn on the source chain, then **`receiveMessage`** on the destination chain | approve and burn on the source chain only |
| Gas you need | on the source chain **and** a little on the destination chain (on Arc the gas token is USDC) | on the source chain only |
| Fee | none from Circle (only network gas) | the Forwarding Service fee, about 0.02 USDC into Arc and more out of it (about 1.3 USDC to Ethereum Sepolia on 2026-11-18); shown before you sign |
| Available | every network in the list | only when Circle's Forwarding Service supports the destination (the page greys it out and says so) |
| Run by | our own code with viem (`directBridge.ts`) | Circle's Bridge Kit |

### The direct (Standard) flow

1. **Approve** USDC for TokenMessengerV2 on the source chain (exact amount; skipped when the allowance already covers it).
2. **Burn:** `depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller = 0, maxFee = 0, minFinalityThreshold = 2000)`.
3. **Attest:** the page polls `GET {CCTP_API_URL}/v2/messages/{sourceDomain}?transactionHash={burn tx}` every 4 seconds until the status is `complete` and the attestation is a real signature (not `PENDING`). Standard transfers wait for the source chain's finality: under a second from Arc, about 8 seconds from Avalanche and Polygon, **about 15 to 19 minutes from Ethereum, Base, Arbitrum and OP** (Linea: hours). The page shows the expected wait before you start.
4. **Check:** the message is read (destination domain, recipient, amount), the destination's `usedNonces` is read (so a transfer that was already completed is recognised), and the attestation is checked against Circle's published attester keys, `GET {CCTP_API_URL}/v2/publicKeys`: a run of 65-byte signatures over `keccak256(message)`, each from a published V2 attester, in increasing signer order, exactly `signatureThreshold` of them. This check is informational (the contract repeats it); a failure is shown, never silently hidden.
5. **Mint:** the wallet is switched to the destination chain (the chain is added to the wallet first if it does not know it), and `receiveMessage(message, attestation)` is called on MessageTransmitterV2. The wallet is switched back to Arc afterwards.

A transfer that stops after the burn is **safe**: the burn hash is remembered in this browser (`avantdex:bridge:v2`) and listed under **Recent transfers**, which shows *Waiting for Circle*, *Ready to finish* or *Delivered* and has a **Finish on {chain}** button that runs steps 3 to 5 from the burn hash alone. The page refuses to finish a transfer that pays another wallet and one addressed to another domain, and it warns before the last step when the wallet has no gas on the destination chain.

## Networks

The list is built from Circle's own chain data (the Bridge Kit ships each chain's CCTP domain, USDC address, TokenMessengerV2 and MessageTransmitterV2 addresses and public RPC endpoints). `scripts/verify-cctp.mjs` checks every USDC address and every contract address and domain against Circle's documentation tables on each run. **Main networks** are listed first: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Avalanche Fuji and Polygon Amoy. **More networks** follow alphabetically. Every row below is on Circle's tables.

| Network | Chain id | CCTP domain | USDC | Circle finishes transfers into it |
|---|---|---|---|---|
| Ethereum Sepolia | 11155111 | 0 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | yes |
| Avalanche Fuji | 43113 | 1 | `0x5425890298aed601595a70AB815c96711a31Bc65` | yes |
| Optimism Sepolia | 11155420 | 2 | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` | yes |
| Arbitrum Sepolia | 421614 | 3 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | yes |
| Base Sepolia | 84532 | 6 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | yes |
| Polygon Amoy | 80002 | 7 | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | yes |
| Unichain Sepolia | 1301 | 10 | `0x31d0220469e10c4E71834a79b1f276d740d3768F` | yes |
| Linea Sepolia | 59141 | 11 | `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7` | yes |
| Codex Testnet | 812242 | 12 | `0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f` | yes |
| Sonic Testnet | 14601 | 13 | `0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51` | yes |
| World Chain Sepolia | 4801 | 14 | `0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88` | yes |
| Monad Testnet | 10143 | 15 | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | yes |
| Sei Testnet | 1328 | 16 | `0x4fCF1784B31630811181f670Aea7A7bEF803eaED` | yes |
| Apothem Network | 51 | 18 | `0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4` | yes |
| Ink Sepolia | 763373 | 21 | `0xFabab97dCE620294D2B0b0e46C68964e326300Ac` | yes |
| Plume Testnet | 98867 | 22 | `0xcB5f30e335672893c7eb944B374c196392C19D18` | yes |
| Arc Testnet | 5042002 | 26 | `0x3600000000000000000000000000000000000000` | yes |
| Edge Testnet | 33431 | 28 | `0x2d9F7CAD728051AA35Ecdc472a14cf8cDF5CFD6B` | yes |
| Injective Testnet | 1439 | 29 | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` | no |
| Morph Hoodi | 2910 | 30 | `0x7433b41C6c5e1d58D4Da99483609520255ab661B` | no |
| Pharos Atlantic | 688689 | 31 | `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` | no |
| Cronos Testnet | 338 | 32 | `0xEb33dc5fac03833e132593659e1dE7256aB59794` | no |
| Plasma Testnet | 9746 | 33 | `0xE67Fb267022cBA8064Dd388CC2FED724F3120D9D` | no |
| X Layer Testnet | 1952 | 37 | `0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3` | no |

All testnet chains use the same contracts: TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`, MessageTransmitterV2 `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, TokenMinterV2 `0xb43db544E2c27092c107639Ad201b3dEfAbcF192`, TokenMessengerWithFees `0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A`.

**Not offered, and why**

* **BNB Smart Chain:** CCTP is live there for **USYC only**. Circle's page says USDC is "supported on all CCTP domains except BNB Smart Chain", so USDC cannot be bridged to or from it with CCTP.
* **Robinhood Chain:** not in Circle's CCTP chain or USDC tables, so there is nothing to configure.
* **HyperEVM Testnet:** the Bridge Kit lists it, but Circle's testnet tables do not, so its USDC address and contracts cannot be confirmed from Circle's pages and the page leaves it out (`NOT_IN_CIRCLE_DOCS` in `bridgeRoutes.ts`).
* Solana, Aptos, Sui, Stellar and Starknet are not EVM chains and use other programs; out of scope.

## Configuration

| Setting | Where | Meaning |
|---|---|---|
| `CCTP_API_URL` | API environment (`.env`, Coolify), default `https://iris-api-sandbox.circle.com` | Circle's Iris attestation API (public, **no key**). The API hands it to the page through `/api/config` (`cctp.api_url`), so changing it needs no rebuild. It must be an `https://` URL. Mainnet is `https://iris-api.circle.com` and also needs the mainnet contract and USDC tables (see below). |
| Arc RPC | `RPC_URL` (API) and `VITE_RPC_URL` (build, optional) | as for the rest of the site: `https://rpc.testnet.arc.io` |
| Other chains' RPC | the public endpoints in Circle's chain data, with fallback between them | reads only (balances, nonces, receipts); transactions go through the wallet |
| Arc USDC | `0x3600000000000000000000000000000000000000` | the same on every Arc network, six decimals in the ERC-20 view |

`GET /v2/publicKeys` of the sandbox returned four keys on 2026-11-18, two for CCTP V1 and two for V2. The addresses derived from the V2 keys, `0x8867a67cDa4BC788C6E819BaeaEc60b867865287` and `0x49fD63506E0D88E07511aD95bAe7B2A31aF98b28`, are the enabled attesters of MessageTransmitterV2 on Arc Testnet, Ethereum Sepolia and Base Sepolia (threshold 2 of 2), which `verify-cctp.mjs` re-checks.

## Deposits into the escrow, and withdrawals

* **Deposit:** the bridge delivers USDC to the user's wallet on Arc. Placing an order then locks the USDC for that order in the Avantdex exchange contract (the escrow); cancelling an open order returns it. The exchange has **no deposit function** (it pulls USDC with `transferFrom` when an order is placed), so a CCTP hook that pays "into the escrow" in one step would need a new contract (a deposit balance or a hook receiver) and a redeployment. That was left out on purpose; the page explains the two steps next to the form.
* **Withdrawal:** from the same page, Arc to any listed network, with the same two ways of finishing.

## Verified

* **`node scripts/test-bridge-fork.mjs`** runs the whole direct flow against the **real CCTP V2 contracts** on throw-away forks of Base Sepolia and Ethereum Sepolia (Docker, public RPCs): approve and burn with `depositForBurn`, polling a fake Iris that answers like Circle's (not found, pending, complete), the attestation check, `receiveMessage` minting the same amount on the other fork, "already completed" detection, resuming a transfer that stalled for lack of gas, and the refusals (wrong recipient, wrong domain, balance). Only the signer of the attestation is ours (the test makes its own key the attester on the fork). This confirms the call arguments, the message layout and the nonce handling against the real contracts; it cannot confirm Circle's live signatures.
* **`node scripts/test-cctp.mjs`** (9 checks): message and burn-body parsing, the attester addresses of Circle's published keys, accepted and refused attestations, the Iris polling loop (404, 500, pending, abort, timeout), amounts, and the network list.
* **`node scripts/verify-cctp.mjs`** (read-only): the deployed contracts have the seven-argument V2 `depositForBurn` and not the four-argument V1 form that Arc's exchange guide still shows (code written from it would revert), the chain data matches Circle's USDC and contract tables, and the attester keys are enabled on chain.
* **A second trap in Arc's guide:** it finds the burn message by the log topic `0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0`. The real `MessageSent(bytes)` event of the deployed MessageTransmitterV2 has topic `0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036` (read from a real burn receipt on a fork). The bridge never parses logs: it asks Iris by burn transaction hash.
* The UI test connects a wallet, flips to withdraw, checks the amount messages and the mode choice, and gets a **live** fee quote from Circle for the Circle-finishes mode.

## Limits

* **Testnet only.** Mainnet needs the production Iris URL, the mainnet USDC and contract tables (CCTP contracts are `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` / `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` on Arc mainnet and most chains, with exceptions such as EDGE), real-funds confirmations and the audit first (see [ROADMAP.md](ROADMAP.md)).
* **This moves USDC, not project tokens.** Settlement of a pre-TGE token needs that token to exist on Arc; the listing policy therefore accepts only tokens deployed on Arc (see [AUDIT-2026-11-ARC-CIRCLE.md](AUDIT-2026-11-ARC-CIRCLE.md)).
* **Standard transfers are slow from Ethereum and the Ethereum-secured chains** (about 15 to 19 minutes). The wait is Circle's, not ours; the page keeps polling and the transfer survives a closed tab.
* **Circle Wallet cannot bridge.** A Circle Wallet works on Arc only; the page says so and disables the button ([CIRCLE-WALLET.md](CIRCLE-WALLET.md)).
* **Recent transfers live in the browser only.** Clearing site data removes the list, not the transfer: the burn stays on chain and anyone holding the burn hash can finish it from this page.
* The first real run on a public testnet (burn, Circle's live attestation, mint) needs funds and is the acceptance test; the automated tests cover everything except Circle's live signing.
