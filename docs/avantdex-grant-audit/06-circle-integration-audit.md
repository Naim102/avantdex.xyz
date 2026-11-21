# 06. Circle ecosystem audit

Audit date: 2026-11-21, commit `f6e4da8`. Method: grep and read of `package.json`, `src/`, `backend/`, `scripts/`, `contracts/`, docs; read-only reads of the live API and Arc Testnet. Circle's official program page (`https://www.circle.com/grant`, read 2026-11-21) lists "USDC, Wallets, CCTP, Nanopayments, Gateway, and related services" as examples of meaningful building blocks. This audit classifies each by what the code actually does.

Status classes used in this document: **Production** (running with real users or funds), **Testnet** (running or runnable on testnets), **SDK-package only** (a dependency in `package.json` that application code does not import), **Configuration only** (settings, addresses or reference data with no executing code path), **Planned**, **Not present**.

No Circle product is in **Production**: the whole product is testnet-only.

## 1. Audit table

| Product | Evidence (file and line) | Actual usage | Status |
|---|---|---|---|
| **USDC** (Arc ERC-20, 6 decimals) | `contracts/AvantdexExchange.sol` `IERC20 public immutable usdc` (line 129), `_pullUsdc`, `_pay`; `backend/app/config.py` line 20; on-chain `usdc()` read today returns `0x3600...0000` | The only currency of the system: escrow, collateral, fees, payouts, gas (Arc's gas token is USDC) | **Testnet** (test USDC from `faucet.circle.com`). Note: USDC usage alone is not a Circle platform integration and is not presented as one here |
| **CCTP V2: Standard transfer, own implementation** | `src/lib/directBridge.ts` (`burnStandard` 120, `completeTransfer` 164), `src/lib/cctp.ts` (`STANDARD_FINALITY = 2000`, `parseMessage`, `verifyAttestation`), `src/lib/bridgeRoutes.ts` (24 testnet routes) | Browser approves, calls `TokenMessengerV2.depositForBurn` (7 arguments), polls Iris, checks the attestation against published attester keys, then calls `MessageTransmitterV2.receiveMessage` on the destination | **Testnet** (PARTIAL verification: real CCTP contracts on Base Sepolia and Ethereum Sepolia **forks** with the test's own attester, 11 checks; read-only on-chain data check; **no complete public-testnet transfer with Circle's live signatures is recorded**: `docs/CCTP.md` "Limits") |
| **CCTP V2: Forwarding Service via Bridge Kit** | `src/pages/Bridge.tsx` lines 7 to 8 import `@circle-fin/bridge-kit` and `@circle-fin/adapter-viem-v2`; mode "Circle finishes it" | Circle's kit runs approve and burn; Circle's Forwarding Service submits the destination mint; page shows the fee before signing | **Testnet** (a live fee quote for Arc to Ethereum Sepolia appears in the recorded UI test; the transfer itself was not run) |
| **Circle Iris attestation API** | `backend/app/config.py` `cctp_api_url` (default `https://iris-api-sandbox.circle.com`); live `/api/config` returns `"cctp":{"api_url":"https://iris-api-sandbox.circle.com"}` | Public, no key; the browser polls `GET /v2/messages/{domain}?transactionHash=` and `GET /v2/publicKeys` | **Testnet** (sandbox host) |
| **CCTP Fast Transfer** | The direct flow hard-codes `minFinalityThreshold = 2000` (Standard) and `maxFee = 0`; fast mode exists only inside Bridge Kit's options | Not used by our own code | **SDK-package only** (reachable through Bridge Kit; not demonstrated) |
| **CCTP hooks** (`depositForBurnWithHook`) | `docs/AUDIT-2026-11-ARC-CIRCLE.md` section 5; `docs/CCTP.md` "Deposits into the escrow" | Discussed and left out on purpose: the exchange has no deposit function (it pulls with `transferFrom`) | **Planned** (needs a contract change) |
| **Circle Modular Wallets: passkey smart accounts** | `src/lib/circleWallet.ts` line 87 dynamic import of `@circle-fin/modular-wallets-core`; `src/lib/circleProvider.ts` (EIP-1193 provider, `createCircleProvider` line 70); `src/components/ConnectButton.tsx`; `backend/app/smart_sig.py`; `docs/CIRCLE-WALLET.md` | Passkey register and login; smart account address is the trader's address; API verifies ERC-1271 and ERC-6492 sign-in signatures with `eth_call` | **Configuration only on the live site.** The feature is implemented but **disabled**: live `/api/config` returns `"circle_wallet":{"enabled":false,"client_key":""...}`. Tested with fake accounts and a local chain; **never run with a real Circle Client Key** (`TEST-REPORT.md` "Not covered") |
| **Circle Gas Station / paymaster** | `backend/app/config.py` line 48 `circle_paymaster = True`; `circleProvider.ts` `sendUserOperation(... paymaster)` with fallback to the wallet's own USDC (test "when Gas Station cannot sponsor, the wallet pays with its own USDC", `scripts/test-circle-provider.mjs` line 75) | Requests sponsorship per transaction; needs a policy created in Circle Console | **Configuration only** (no policy evidenced; never exercised against Circle) |
| **Circle bundler / Modular Wallets RPC** | `CIRCLE_CLIENT_URL` default `https://modular-sdk.circle.com/v1/rpc/w3s/buidl` | Reached only after a Client Key is set | **Configuration only** |
| **Circle Developer Console account, Client Key, Passkey Domain** | `.env.example` variable names `CIRCLE_CLIENT_KEY`, `CIRCLE_CLIENT_URL`, `CIRCLE_PAYMASTER` (values not reproduced here); live `client_key` empty | The operator has not set a key on the live deployment | **Not present** on production (UNKNOWN whether an account exists) |
| **Circle Bridge Kit** (`@circle-fin/bridge-kit` 1.16.0) | `Bridge.tsx` 7; `scripts/verify-cctp.mjs` 12; `scripts/test-bridge-fork.mjs` 24 | Chain data (domains, USDC and contract addresses, RPC endpoints) for the route list; Forwarding mode | **Testnet** |
| **Circle App Kit** (`@circle-fin/app-kit`) | `package.json` only; no import in `src/`, `scripts/` or `backend/` | None | **SDK-package only** |
| **Developer-controlled wallets** (`@circle-fin/developer-controlled-wallets`) | `package.json`; imported only by `scripts/compass-deploy.ts` line 8 and `scripts/self-deploy.ts` line 8 (legacy deploy tooling from the earlier AllocX version) | Not part of the Avantdex product; the v2 deployment used `scripts/deploy-testnet.sh` (Foundry in Docker) | **SDK-package only** (legacy scripts) |
| **Smart Contract Platform** (`@circle-fin/smart-contract-platform`) | `package.json`; imported only by the same two legacy scripts (line 13) | As above | **SDK-package only** (legacy scripts) |
| **User-controlled wallets** (`@circle-fin/user-controlled-wallets`, `@circle-fin/w3s-pw-web-sdk`) | `package.json` only | None | **SDK-package only** |
| **Gateway (unified USDC balance)** | `GatewayWallet` and `GatewayMinter` addresses (testnet and mainnet) appear in `src/onchain-facts.ts` around lines 535 to 555, a file **generated by the Arc Studio scaffold** ("GENERATED, do not edit") | Reference data only; no code reads or calls it | **Configuration only** (reference data). Not an integration |
| **Nanopayments / x402** | grep for `nanopayment` and `x402` finds no match in `src/`, `backend/app/`, `scripts/` | None | **Not present** |
| **StableFX** | grep finds no match | None | **Not present** |
| **EURC** | Mentioned in documentation only (CCTP moves USDC, EURC, cirBTC) | The exchange is USDC-only | **Not present** |
| **USYC** | Mentioned in documentation (CCTP on BNB Smart Chain supports USYC only) | None | **Not present** |
| **Circle Mint, Circle Payments Network, fiat on and off ramps, compliance screening tools** | No code or configuration | None | **Not present** |
| **Circle Faucet** | Links in `Header.tsx` 186, `ConnectButton.tsx` 97, `TradePanel.tsx` 231 | Sends testnet users to `faucet.circle.com` | **Testnet** (outbound link only) |

## 2. What this means for the grant

* **What can honestly be called a Circle integration today:** USDC as the settlement currency on Arc Testnet; a CCTP V2 bridge (own Standard flow plus Circle's Forwarding Service) on testnets; and Circle Modular Wallets passkey sign-in **as built code that is switched off in production**.
* **What cannot be claimed:** any Circle product in production; Gateway, Nanopayments, StableFX or Circle Mint integration; developer-controlled or user-controlled wallets in the product; that the passkey login has been accepted by Circle's service; that a complete real CCTP transfer has been run.
* **Dependency hygiene:** five of the eight `@circle-fin/*` packages in `package.json` are not used by the product (App Kit, user-controlled wallets and w3s-pw-web-sdk are unused everywhere; developer-controlled wallets and Smart Contract Platform are used only by legacy scripts). Only `bridge-kit`, `adapter-viem-v2` and `modular-wallets-core` are imported by product code. A reviewer who reads `package.json` first may infer integrations that do not exist. Remove them or integrate them before submitting (a code change, outside this read-only audit).
* **Circle's minimum bar** (from the program page): a working product, a technical roadmap showing the role of Circle products and Arc, and at least one Circle integration demonstrable on video. The first two are met on testnet. The third can be met today with the Bridge page, and can be made stronger in about a day by setting a Client Key (see section 3, step 0).

## 3. Recommended Circle Integration Roadmap

Ordered by value to the grant and to the product. Effort is an estimate for the existing code base, not a quote.

| Step | Integration | Why it matters | What exists | Work needed | Effort | Demonstrable on video |
|---|---|---|---|---|---|---|
| **0a** | Turn on **Circle Wallet passkey sign-in** on the live testnet site | Converts the strongest Circle integration from "configuration only" to "testnet, running"; the acceptance checklist already exists | Complete code and `docs/CIRCLE-WALLET.md` checklist | Create a testnet Client Key (`TEST_API_KEY:...`) in Circle Console, register Passkey Domain `avantdex.xyz`, set `CIRCLE_CLIENT_KEY` on the API, run the 5-step checklist | 0.5 to 1 day | Yes: create a wallet, sign in, place and cancel an order |
| **0b** | **One complete public-testnet CCTP transfer**, both directions, recorded | Replaces "verified on forks" with "verified on public testnets"; the missing evidence in `docs/CCTP.md` | Complete flow, resume button | Testnet USDC and gas on source and destination; a fast source (Avalanche Fuji or Polygon Amoy attest in about 8 seconds; Arc itself under a second) keeps the video short; Ethereum-secured chains take 15 to 19 minutes | 0.5 day | Yes |
| **0c** | **Gas Station policy** for the Avantdex flows | Makes "no USDC needed to start" real; Circle's page ties Wallets to meaningful use | Provider asks for sponsorship, falls back to own USDC | Create a paymaster policy in Console limited to the exchange and USDC addresses | 0.5 day | Yes: a new wallet places a trade with zero USDC for gas |
| **1a** | **Batch `approve` plus `placeOrder` as one user operation** for Circle Wallet users | Halves the confirmations of a first trade (today two); a real UX gain from smart accounts | `sendUserOperation({ calls })` already takes an array in `circleProvider.ts` | Detect the approval need in `TradePanel` and submit both calls together for smart-account users; tests | 2 to 4 days | Yes |
| **1b** | **"Fund and trade" flow:** Bridge, then auto-continue to the order form | Connects CCTP to the product's core action; a user without Arc USDC is the main drop-off | Bridge and trade panel exist separately | Keep the destination wallet connected, show the Arc balance after mint, deep-link back to the market; Circle Wallet limitation (Arc only) needs a UX answer | 3 to 5 days | Yes |
| **1c** | **Keeper and fee-collector custody with Circle developer-controlled wallets** | Replaces a raw private key in an environment variable (`KEEPER_PRIVATE_KEY`) with managed keys and policies; reduces the hot-key risk named in `docs/KEEPER.md` | Package already in `package.json` (currently unused) | Backend adapter for the keeper's signing; policy limits; Console setup | 1 to 2 weeks | Partly |
| **2a** | **Gateway unified balance** as a deposit source | One USDC balance across chains; larger UX step than the bridge | Address registry only | Requires deciding how a Gateway mint reaches the exchange (the exchange has no deposit function); likely a new contract version with a deposit balance, tests and a new audit | 3 to 6 weeks | Later |
| **2b** | **CCTP hook or Forwarding recipient into escrow** | One-step cross-chain deposit | Analysis in the repository's audit | Same contract change as 2a | with 2a | Later |
| **2c** | **Arc native: Multicall3From or Permit-style approvals** | One-transaction first trade for EOA wallets too | None | Contract-free where USDC supports a signature path; verify on Arc first | 1 to 2 weeks | Later |
| **3a** | **EURC or StableFX-priced markets** | Euro-denominated pre-market; fits Circle's "stablecoin FX" focus area | None | Second quote token in the contract (new version) | 4 to 8 weeks | Not now |
| **3b** | **Paid market-data API for agents (x402, Nanopayments)** | Fits Circle's "agentic economic activity" focus; new revenue line | The public read API exists | Product decision first; no evidence of demand in the repository | 3 to 5 weeks | Not now |
| **3c** | **Compliance and screening tooling** | Pre-TGE trading of tokens may carry regulatory exposure; a Circle-compatible screening layer could help | None | Needs legal advice first; out of engineering scope today | UNKNOWN | Not now |

Priority for the proposal: do **0a, 0b, 0c** before submitting (about 2 days in total, no contract change), then commit to **1a, 1b, 1c** as grant milestones, and present **2a to 3c** only as ecosystem-expansion options (see `11-roadmap-milestones-budget.md`).

## 4. Checklist: can each existing integration be shown on a 3 to 5 minute video today?

| Integration | Can it be filmed today? | What is needed first |
|---|---|---|
| USDC escrow, place, match, settle, refund on Arc Testnet | **Yes** (the deployment exists; settled and refunded trades exist on chain) | Testnet USDC for two wallets |
| CCTP bridge, Arc to Ethereum Sepolia with a live fee quote | **Yes** (the quote is live) | Nothing |
| CCTP complete transfer with Circle's live attestation | **Not yet recorded** | Step 0b |
| Circle Wallet passkey sign-in | **No** (disabled on the live site) | Step 0a |
| Gas-sponsored first trade | **No** | Steps 0a and 0c |
