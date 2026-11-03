#!/bin/sh
# Deploys the Avantdex exchange and test assets to a LOCAL anvil chain (never use on a real network).
# Writes /shared/addresses.env for the API and indexer containers.
set -eu
RPC="${RPC:-http://anvil:8545}"
FEE_COLLECTOR="${FEE_COLLECTOR:-0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6}"
USDC=0x3600000000000000000000000000000000000000
# anvil's well-known unlocked dev account 0 (public test account, holds no real value)
ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

cd /app
forge build contracts/AvantdexExchange.sol contracts/test/mocks/MockTokens.sol >/dev/null

# usage: dep <path:Contract> [--constructor-args ...]   (constructor args must come last)
dep() { target="$1"; shift; forge create "$target" --rpc-url "$RPC" --unlocked --from "$ADMIN" --broadcast "$@" 2>&1 | grep 'Deployed to' | awk '{print $3}'; }

# 1) USDC stand-in at Arc's real USDC address (a mock with a blocklist, so failure paths can be tested)
TMP=$(dep contracts/test/mocks/MockTokens.sol:BlocklistUSDC)
cast rpc anvil_setCode "$USDC" "$(cast code "$TMP" --rpc-url "$RPC")" --rpc-url "$RPC" >/dev/null

# 2) Multicall3 (wagmi batches reads through it); copied from Arc Testnet when reachable
MC=0xcA11bde05977b3631167028862bE2a173976CA11
CODE=$(cast code "$MC" --rpc-url https://rpc.testnet.arc.io 2>/dev/null || true)
if [ -n "$CODE" ] && [ "$CODE" != "0x" ]; then cast rpc anvil_setCode "$MC" "$CODE" --rpc-url "$RPC" >/dev/null; else echo "warning: could not copy Multicall3"; fi

# 3) exchange + a demo project token for settlement tests
BLOCK=$(cast block-number --rpc-url "$RPC")
EXCHANGE=$(dep contracts/AvantdexExchange.sol:AvantdexExchange --constructor-args "$USDC" "$FEE_COLLECTOR" "$ADMIN")
[ -n "$EXCHANGE" ] || { echo "exchange deployment failed"; exit 1; }
TOKEN=$(dep contracts/test/mocks/MockTokens.sol:MockERC20)

# 4) fund anvil dev accounts 1-5 with test USDC and demo tokens
for A in 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC 0x90F79bf6EB2c4f870365E785982E1f101E93b906 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc; do
  cast send "$USDC" "mint(address,uint256)" "$A" 1000000000000 --rpc-url "$RPC" --unlocked --from "$ADMIN" >/dev/null
  cast send "$TOKEN" "mint(address,uint256)" "$A" 1000000000000000000000000 --rpc-url "$RPC" --unlocked --from "$ADMIN" >/dev/null
done

mkdir -p /shared
cat > /shared/addresses.env <<ENV
export EXCHANGE_ADDRESS=$EXCHANGE
export EXCHANGE_DEPLOY_BLOCK=$BLOCK
export USDC_ADDRESS=$USDC
export DEMO_TOKEN=$TOKEN
ENV
echo "exchange=$EXCHANGE block=$BLOCK demo_token=$TOKEN"
