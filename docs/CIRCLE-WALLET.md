# Circle Wallet: passkey sign-in

Users can sign in to Avantdex with a **Circle Wallet**: a smart account on Arc that is controlled by a passkey (fingerprint, face or device PIN) instead of a seed phrase. Every **Connect Wallet** button opens a dialog that recommends it and shows **Sign in with passkey** and **Create a wallet**; "Choose another wallet" opens the normal wallet list.

Code: `src/components/ConnectButton.tsx` (dialog), `src/lib/circleWallet.ts` (wagmi connector and SDK loading), `src/lib/circleProvider.ts` (EIP-1193 provider around the smart account), `backend/app/smart_sig.py` and `backend/app/security.py` (sign-in verification), settings in `backend/app/config.py`. Tests: `scripts/test-circle-provider.mjs`, `backend/tests/test_smart_wallet.py`, `backend/tests/test_config.py`, and the dialog steps of `scripts/ui-feature-test.mjs`.

## Setting it up (the operator)

1. **Circle Console -> Keys -> Client Keys:** create a Client Key. It is meant for browsers, so it is not a secret, but keep it per project. A testnet key starts with `TEST_API_KEY:`; a `LIVE_API_KEY:` key cannot be used on Arc Testnet.
2. **Circle Console -> Modular Wallets -> Passkey Domain:** register the domain users see, for example `avantdex.xyz`. Passkeys are tied to one domain: a passkey made on `localhost` or another domain does not work on the production domain.
3. Optional, recommended: **Console -> Gas Station:** create a paymaster policy so Circle pays users' network fees.
4. Set in `.env` / Coolify on the **API** service and redeploy (no frontend rebuild is needed; the page reads the key from `/api/config`):

```
CIRCLE_CLIENT_KEY=TEST_API_KEY:...
CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl   # the default; leave unset
CIRCLE_PAYMASTER=true                                               # ask Gas Station first
```

Without a key the dialog still recommends Circle Wallet but says passkey sign-in is not set up yet, and the buttons are not shown. Check it with `GET /api/config`: `circle_wallet.enabled` must be `true`.

## What the user sees

* **Sign in with passkey:** the browser shows the passkeys saved for this site; the user picks one and confirms with fingerprint, face or PIN.
* **Create a wallet:** the user picks a username (3 to 32 letters, digits, dots, dashes, underscores); the device creates and saves a passkey; Circle registers it and returns the account address.
* The wallet address is a **smart account on Arc**. It is the address the app shows, the one that holds USDC and the one that owns orders. A new user sends it test USDC from `faucet.circle.com`.
* Then the usual wallet sign-in message (a signature that authorizes no transaction) opens the Avantdex session, and trading works as with any wallet. Each transaction (approve, order, cancel, settle) is one user operation and one passkey confirmation.

## How it works

| Step | What happens |
|---|---|
| Connect | `toWebAuthnCredential` (Register or Login) talks to Circle with the Client Key; `toCircleSmartAccount` returns the account for that passkey; only the passkey's public identifiers (credential id, public key, domain, username) are kept in `localStorage` (`avantdex:circle-wallet:v1`) so a reload restores the wallet. No secret is stored: the private key never leaves the user's authenticator. Disconnecting removes the record. |
| Sign-in message | `personal_sign` is signed by the account. The API verifies it: ordinary ECDSA first; otherwise **ERC-1271** (the account contract is asked `isValidSignature`) or, for an account that is not deployed yet, **ERC-6492** (a throw-away validator deploys the account inside an `eth_call` and asks it). Nothing is sent to the chain. |
| Transactions | `eth_sendTransaction` becomes a user operation through Circle's bundler. Gas Station is asked to pay first; if it cannot, the account pays with its own USDC (Arc's gas token). A cancelled passkey prompt is never retried. |
| Reads | go to the app's Arc RPC like any wallet. |

A new Circle account is **deployed lazily** with its first transaction, which is why sign-in must (and does) work before it exists.

## Limits

* **Arc only.** The provider refuses other chains. The Bridge page therefore cannot start a transfer from a Circle Wallet (it says so); to add USDC, send it to the wallet's Arc address from another wallet.
* Typed-data signing (`eth_signTypedData`), raw transactions and contract deployment are not supported by a smart account here; nothing in Avantdex needs them.
* Passkeys do not work across domains and need a browser with WebAuthn (the dialog says when it is missing). A user who loses every device that holds the passkey needs Circle's own passkey recovery (a BIP-39 mnemonic set up in advance); Avantdex does not implement recovery.
* The Circle SDK is a separate download (about 0.9 MB) loaded only when someone uses the wallet.
* A Circle Wallet address is not an admin address by default. To use one as an admin, add its **smart account address** under Admin -> Admins (sign-in works the same way).
* The passkey step itself (the browser's WebAuthn dialog and Circle's registration service) cannot be exercised without a real Client Key and the registered domain. What is tested: the provider logic with fake accounts (12 checks), the API's signature verification against real ERC-1271 and ERC-6492 accounts on a local chain (7 checks), the configuration, and the dialog states. The first run with a real key is the acceptance test; see the checklist below.

## Acceptance checklist with a real key

1. `GET /api/config` shows `circle_wallet.enabled: true`.
2. On the production domain, **Create a wallet** with a username: the device offers to save a passkey and the header shows an address.
3. Send the address test USDC; the header shows the balance.
4. Sign in (passkey prompt), place a small order, cancel it: each step is one passkey confirmation and appears in the portfolio.
5. Reload the page: the wallet is still connected. Disconnect, then **Sign in with passkey**: the same address returns.

If step 2 fails, the dialog names the cause: a rejected Client Key, a Passkey Domain that does not match the site, a passkey that already exists, or a cancelled prompt.

## Rules kept

* No secret is stored in the repository or the browser. The Client Key is public by design.
* Choosing another wallet is always one click; the existing wallet list, sign-in message and admin session are unchanged.
* The sign-in message authorizes no transaction or token approval.
