# 05. Arc integration

Audit date: 2026-11-21, commit `f6e4da8`. Question asked by Circle's grant criteria: *"Arc is core to your flow of value, liquidity, or settlement."* This document separates what the repository **proves** about Arc from what it only **claims**.

## 1. Summary

| Question | Answer | Evidence |
|---|---|---|
| Is the product deployed on Arc? | **Yes, on Arc Testnet (5042002).** Not on Arc mainnet (5042), and mainnet is deliberately not configured | `deployments/arc-testnet.json`; live `eth_chainId` `0x4cef52`; live code at `0xb489...0283` is 16,175 bytes; `AGENTS.md` "Mainnet is NOT deployed" |
| Is Arc the settlement layer for USDC in the product? | **Yes by design.** Every trade escrows and settles USDC on Arc; the project token must also exist on Arc (listing policy) | `AvantdexExchange.sol` (USDC only); `backend/app/utils.py` `arc_chain` (API error `arc_only`) |
| Is Arc technically essential, in the sense that the product could not work elsewhere? | **No.** The contract is generic EVM Solidity 0.8.28 (`cancun`). The only Arc-specific constant in the contract is the USDC address passed to the constructor. Porting needs a new deployment, a different USDC address and (if USDC differs) a decimals check | `AvantdexExchange.sol` constructor; `foundry.toml` |
| Is Arc a meaningful product fit? | **Yes, for four reasons the code reflects:** USDC is the gas token (a Circle Wallet user needs only USDC, optionally sponsored by Circle Gas Station); finality is deterministic and fast (the indexer has no reorg logic, so a trade is visible in seconds); Arc has CCTP V2 as domain 26 (the Bridge page treats Arc as the primary route); Arc's compliance model (blocklist reverts) is designed for in the contract | `src/lib/circleProvider.ts`; `worker.py`; `src/lib/bridgeRoutes.ts` `ARC_KEY`; `_pay` |
| What would stop working if Arc were removed? | Everything that is configured against chain id 5042002: `/api/config`, the wagmi chain in `src/config.ts` and `src/hooks/useTx.ts`, the Circle Wallet provider (Arc-only), the Arc-only listing rule, the testnet banner logic, deploy scripts that refuse any other chain, and the bridge's Arc route. The contract logic and the order-book design would survive a port | see section 3 |

## 2. Arc-specific implementation evidence

| Area | What the repository does | File and line | Status |
|---|---|---|---|
| Network config | `chain_id = 5042002`, `rpc_url = https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io` | `backend/app/config.py` lines 17 to 20; served by `/api/config` | VERIFIED (live response) |
| USDC address and decimals | ERC-20 USDC `0x3600000000000000000000000000000000000000`, 6 decimals; the native 18-decimal view is never used for money | `config.py` line 20; `exchange.ts` `USDC_DECIMALS`; contract `usdc` immutable | VERIFIED (`usdc()` read on chain) |
| 20 gwei fee floor | Browser: `MIN_MAX_FEE = parseGwei('20')`; keeper: `max(KEEPER_MAX_GAS_GWEI, 20)`; bridge: floor 20 gwei on Arc; scripts use 25 gwei | `src/hooks/useTx.ts` 31; `backend/app/keeper.py` 74; `src/lib/directBridge.ts` 101 to 104; `scripts/testnet_e2e.py` 40 | IMPLEMENTED (recorded in the repository's audit as sound) |
| USDC blocklist behaviour | Every payout is push-with-fallback to `claimable`; five blocklist tests with a mock USDC | `_pay` line 685; `Avantdex.t.sol` lines 857 to 920 | VERIFIED against the mock only; **not** tested against Arc's real blocklist (R-12) |
| Non-strict timestamps | Only comparisons against stored times; indexer orders by `(blockNumber, logIndex)` | `placeOrder`, `claimDefault`; `worker.py` line 192 | IMPLEMENTED |
| Deterministic finality | The indexer has no reorg handling by design | `worker.py` | IMPLEMENTED (relies on Arc documentation; not independently verified here) |
| RPC behaviour | Retries a smaller log range when the provider rejects a large range; a node behind the head raises an error and the loop retries after 10 s | `worker.py` lines 155 to 160, 182 to 184 | IMPLEMENTED |
| Explorer links | `https://explorer.testnet.arc.io` used across the app and in the bridge's Arc route | `bridgeRoutes.ts` lines 110 to 111 | IMPLEMENTED |
| Faucet | The testnet banner, the connect dialog and the trade panel link to Circle's faucet (`faucet.circle.com`); the error mapper tells users to get test USDC for gas | `Header.tsx` 186, `ConnectButton.tsx` 97, `TradePanel.tsx` 231, `errors.ts` 23 | IMPLEMENTED |
| Deploy guard | The deploy script refuses any chain id other than 5042002 | `scripts/deploy-testnet-inner.sh` lines 12 to 14 | IMPLEMENTED |
| CCTP on Arc (domain 26) | Arc is the first route; Arc TokenMessengerV2 and MessageTransmitterV2 addresses are read from Circle's chain data; `verify-cctp.mjs` checks the deployed Arc contracts have the 7-argument V2 `depositForBurn` | `src/lib/bridgeRoutes.ts`; `docs/CCTP.md` | VERIFIED by a read-only script (recorded); a full public-testnet transfer is not yet done |
| Chain label in the UI | "Arc Testnet" banner, header tag, hero chip, footer, all driven by the API's chain id (they disappear on any other chain id) | `Header.tsx` 137 and 180; `Footer.tsx` 72; `Home.tsx` 201 | VERIFIED (recorded UI test) |
| Arc-only listing | `arc_chain()` rejects any other blockchain with `arc_only`; the listing form shows Arc as a fixed value | `backend/app/utils.py` line 42 | VERIFIED (recorded test) |
| Contract on Arc | v2 deployed, roles correct, 4 markets, 15 orders, 4 trades; one trade settled, one refunded | on-chain reads today | VERIFIED |
| Indexer on Arc | `/api/health`: `last_block` equals `chain_head` (73,366,759), lag 0 | live response today | VERIFIED |

## 3. Where Arc is hard-wired (and what that means for mainnet)

| Place | Hard-wiring | Impact |
|---|---|---|
| `src/config.ts`, `src/hooks/useTx.ts`, `src/hooks/useApp.tsx` (`CHAIN_ID = arcTestnet.id`) | The wagmi chain list is `[arcTestnet, mainnet]`; every transaction forces Arc **Testnet** | Moving to Arc mainnet (5042) is a code change in several places, not only environment variables (repository audit M-6) |
| `src/lib/circleWallet.ts` line 84 | Chooses `arc` or `arcTestnet` from the API's chain id | Mainnet-ready at that point only |
| `backend/app/config.py` | Defaults point at the testnet | Environment override is enough for the API |
| `scripts/*.py`, `deploy-testnet*.sh` | Assert chain id 5042002 | Intentional safety rail |
| `AGENTS.md` line 20 says Arc mainnet "is deliberately not configured here" | Policy | Arc mainnet exists (the repository's audit lists its CCTP addresses); the mainnet decision is the project's, tied to the audit |

## 4. Arc features the product does not use (and could)

| Arc / Circle feature on Arc | Used today | Relevance |
|---|---|---|
| USDC as native gas token | Indirectly (users pay gas in USDC; Circle Gas Station path coded) | Core to onboarding |
| CCTP V2 (domain 26) | Yes (Bridge page) | Funding and withdrawal |
| Gateway wallet and minter on Arc | **No.** Addresses appear only in the generated registry `src/onchain-facts.ts`; no code path | Possible unified-balance deposit |
| StableFX, USYC, EURC | No | EURC-priced markets would need a second quote token (the contract is USDC only) |
| Memo and Multicall3From | No | Batch `approve` plus `placeOrder` while keeping `msg.sender` (today a first trade is two wallet transactions) |
| Permit2 or EIP-2612 / EIP-3009 for USDC | No | Remove the separate approval transaction (repository audit L-8) |
| Arc Foundry (`arc-forge`, `arc-anvil --network arc`) | No (standard Foundry) | Would close the testing gap R-12 |

## 5. Honest positioning for Circle's reviewers

* **What is true:** the exchange is deployed and exercised on Arc Testnet; USDC is the only money in the system; Arc-only listing makes Arc the settlement layer for the project tokens too; the code contains Arc-specific hardening; the bridge treats Arc as its primary network.
* **What is not true, and must not be claimed:** that the product is live on Arc mainnet; that Arc-specific tests exist beyond mocks; that the product could not run elsewhere; that any volume reflects real users.
* **A fair one-line framing:** "Arc is the chosen settlement layer and the design uses its USDC-as-gas, fast-finality and CCTP properties, but the order-book contract itself is chain-agnostic EVM code."
