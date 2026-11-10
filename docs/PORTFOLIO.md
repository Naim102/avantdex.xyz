# Portfolio overview: token allocation

Page: **Portfolio -> Overview** (`src/pages/Portfolio.tsx`, `src/components/PortfolioOverview.tsx`). API: `GET /api/portfolio/{address}/positions` (`backend/app/routers/public.py`). Tests: `test_portfolio_positions_per_token` (backend), the UI feature test step "portfolio overview shows the token allocation per market".

The overview answers two questions: **how much USDC is locked**, and **how many of each token will I receive or have to deliver**. It is public chain data by wallet, like the other portfolio endpoints, so it needs no sign-in beyond connecting the wallet.

## Layout (top to bottom)

1. **Summary band**: USDC in the wallet, locked in open orders, locked in trades, claimable. One row, four figures, each with a one-line explanation. If something is claimable, the withdraw box appears below the page content.
2. **Needs you** (only when something is due): deliver tokens before a settlement deadline, tokens on the way or a default you can claim, a cancelled market whose trades are refundable. Each row links to Settlement Status.
3. **Your token allocation**: one row per market (token). On phones each row becomes a card.
4. The escrow notice.

## Token allocation columns

| Column | Meaning | Guaranteed? |
|---|---|---|
| Token | project logo, name, symbol; links to the market | |
| **You receive** | tokens from your **open trades as buyer** (`+N SYM`), plus the tokens already received from settled trades | Yes, by escrow: the trade settles, defaults (you are paid the payment plus collateral) or is refunded |
| **You deliver** | tokens you owe from your **open trades as seller** (`-N SYM`), the USDC you earn on delivery (payment minus the seller fee), plus tokens already delivered | Yes, you owe them, or lose the collateral at the deadline |
| USDC locked in trades | what is escrowed for those trades: as buyer payment plus the fee reserve, as seller the collateral | |
| **Resting orders** | "Buy up to N" or "Sell up to N" tokens still unfilled in your open orders, and the USDC locked behind them | **No.** A resting order may never match. It is labelled "not guaranteed to fill". |
| Next | market status and the next date: trading end, TGE date, or the settlement countdown ("Settlement open, 2d 3h left", "deadline passed", "Cancelled: trades are refundable") | |

Amounts are converted from lots with the market's lot size and decimals, so they are exact token quantities. Markets are listed only if the wallet has an open or settled trade or a resting order there. Defaulted and refunded trades are not open positions.

## API

`GET /api/portfolio/{address}/positions` returns `{ "items": [ ... ] }`, one object per market:

| Field | Meaning |
|---|---|
| `to_receive_lots`, `to_deliver_lots` | lots of open trades as buyer, as seller |
| `received_lots`, `delivered_lots` | lots of settled trades as buyer, as seller |
| `pay_locked` | buyer side: payment plus fee reserve of open trades (USDC base units, string) |
| `collateral_locked` | seller side: collateral of open trades |
| `sale_net` | seller side: payment minus the seller fee, earned when delivering |
| `open_trades` | number of open trades |
| `open_buy_lots`, `open_sell_lots`, `open_orders` | unfilled lots of live resting orders (expired orders are not counted as open) |
| `locked_in_orders` | USDC locked by open orders, including expired ones that have not been cleaned up (they still hold funds) |
| `market` | slug, status, name, symbol, logo, token address, lot size, decimals, TGE date, trading end, settlement deadline |

Invalid addresses return 422. Money is returned as strings so large values never lose precision.

## Rules kept

* Nothing here is invented: every number is read from indexed on-chain orders and trades.
* An off-chain or resting order is never presented as guaranteed; only escrowed trades are.
* The totals do not add tokens across different markets (they are different assets); USDC totals are in the summary band.
