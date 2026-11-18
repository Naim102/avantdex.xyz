# Interface and design system

Calm, professional trading product on the brand palette: green `#28DF99`, black `#262627`. Code: `src/index.css` (tokens and component classes), `src/hooks/useTheme.tsx`, `tailwind.config.js`.

## Themes

Two themes, chosen from the Theme menu in the footer and remembered in the browser (`localStorage` key `avantdex.theme`, set on `<html data-theme>` before first paint so there is no flash). **Sky** (light, the default) and **Ink** (dark). Saved choices of retired themes fall back to Sky (Ink for dark or terminal).

| Token | Sky | Ink |
|---|---|---|
| Page / surface | `#EAF0FB` / `#FFFFFF` | `#121213` / `#1F1F21` |
| Text | `#262627` | `#F4F1E8` |
| Hairline / strong line | `#CFD9EE` / `#AEBBD8` | `#2F2F32` / `#4A4A4F` |
| Accent (actions, active states) | `#28DF99` with black text | `#28DF99` with black text |
| Buy / success, sell / danger | `#08774C`, `#B42318` | `#28DF99`, `#FF8077` |

Every text and background pair used by the UI was checked against WCAG AA (4.5:1). Components use CSS variables (`--ink`, `--surface`, `--accent`, `--accent-ink`, `--line`, `--r-*`), never hard-coded colors, so a theme change never touches component code.

## Look

* Archivo for text and headings (weight 700, regular width), IBM Plex Mono for every figure and address so digits line up.
* 1 px soft borders, layered soft shadows only on the focal block and floating menus, 16 px card radius, 10 px control radius.
* No em dash characters in interface text.

## Motion

Short and purposeful, all of it off for `prefers-reduced-motion`:

* sliding active pill in the main navigation and in tabs; modal entrance; menu open and close;
* staged hero entrance, figures that count up once, content that eases in once while scrolling, a scroll progress bar, card hover lift, route transition;
* the hero pyramid (three.js, loaded as its own chunk, rendered on demand) turns and pulls apart while the page scrolls, and floats gently;
* a dot and trailing ring follow the mouse and grow over clickable elements; primary buttons lean toward the pointer. Mouse only (off for touch).

## Home page sections

Hero with three live figures, market board (last price, bid, ask, 24h volume, open interest, buy versus sell liquidity), category shortcuts, "Where the liquidity sits" (summary band plus a depth table where bar length is a market's total depth and the colors split buy and sell), platform ledger, a scroll-driven "life of a trade", fees in plain numbers (read from the API config), Coming soon, owner steps, FAQ. All numbers come from the API (`/api/stats`, per-market `stats`); nothing is invented.

## Portfolio

The overview opens with one summary band of four wallet figures, then "Needs you" (only when a deadline or claim needs the owner) and the token allocation table (what you receive, deliver and have resting, per token). Details and the rule that resting orders are never shown as guaranteed: [PORTFOLIO.md](PORTFOLIO.md).

## Roadmap, testnet notice, connect dialog and bridge

* **Roadmap** ([ROADMAP.md](ROADMAP.md)): seven connected boxes (4 + 3), date under each box, expandable details; one column with down arrows on narrow screens.
* **Testnet notice**: banner under the header, a Testnet tag by the logo, a hero chip and a footer line, all driven by the API's chain id.
* **Connect dialog** ([CIRCLE-WALLET.md](CIRCLE-WALLET.md)): a Circle Wallet card with Sign in with passkey and Create a wallet (or, without a Client Key, a plain statement that it is not set up yet), then "Choose another wallet" for the normal list. Errors from Circle appear inside the card in plain words. `Modal` renders through a portal to `<body>` and is capped at 92% of the screen height with its own scroll.
* **Bridge page** ([CCTP.md](CCTP.md)): a two-column layout (transfer form, progress and recent transfers) that stacks on phones. It is a lazy chunk.
* The header now has five links (Home, Explore, Portfolio, Bridge, Create Listing); on phones they stay inside the menu.

## Responsive

No sideways scrolling from 320 px up. **Phones have a bottom navigation bar** (`src/components/BottomNav.tsx`): Home, Explore, Portfolio, Bridge and List, fixed to the bottom of the screen within thumb reach, the current page marked, safe-area aware, hidden from the `lg` breakpoint where the header carries the links. The page reserves room for it, so the footer is never covered. The **header is small on phones** (about 48 px: logo, notifications, wallet; no menu button) and larger from `sm`. The testnet strip is one short line on phones. Tables become cards on phones. Tap targets in the page are at least 44 px; the compact header buttons are 36 px.

## Screenshots and deck

`docs/screenshots/` and `docs/Avantdex-product-tour.pptx` (rebuild with `python scripts/build_deck.py`) show the product from the local stack with demo data. They predate the latest visual changes and are refreshed on request.
