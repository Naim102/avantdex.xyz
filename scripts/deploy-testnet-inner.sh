#!/bin/sh
# Runs inside the Foundry container (see deploy-testnet.sh).
set -eu

RPC="${RPC_URL:-https://rpc.testnet.arc.io}"
USDC=0x3600000000000000000000000000000000000000
COLLECTOR="${FEE_COLLECTOR:-0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6}"
GAS="${GAS_PRICE_GWEI:-25}"
KEY="$DEPLOYER_PRIVATE_KEY"

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN_ID" != "5042002" ]; then
  echo "Refusing to deploy: chain id is $CHAIN_ID, expected 5042002 (Arc Testnet)." >&2
  exit 1
fi

DEPLOYER=$(cast wallet address --private-key "$KEY")
ADMIN="${ADMIN_ADDRESS:-$DEPLOYER}"
echo "Deployer:      $DEPLOYER"
echo "Admin/roles:   $ADMIN"
echo "Fee collector: $COLLECTOR"

# Arc's native gas token is USDC (18 decimals). Zero balance means the faucet has not been used yet.
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
if [ "$BAL" = "0" ]; then
  echo "The deployer has no testnet USDC for gas. Get some at https://faucet.circle.com (Arc Testnet) and retry." >&2
  exit 1
fi

# Sanity-check the settlement asset before wiring it in
DEC=$(cast call "$USDC" "decimals()(uint8)" --rpc-url "$RPC")
SYM=$(cast call "$USDC" "symbol()(string)" --rpc-url "$RPC")
if [ "$DEC" != "6" ]; then echo "USDC decimals are $DEC, expected 6. Aborting." >&2; exit 1; fi
echo "USDC:          $USDC ($SYM, $DEC decimals)"

forge build contracts/AvantdexExchange.sol contracts/test/mocks/MockTokens.sol >/dev/null 2>&1

START_BLOCK=$(cast block-number --rpc-url "$RPC")
OUT=$(forge create contracts/AvantdexExchange.sol:AvantdexExchange \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --gas-price "${GAS}gwei" --priority-gas-price 1gwei \
  --constructor-args "$USDC" "$COLLECTOR" "$ADMIN" 2>&1) || { echo "$OUT" >&2; exit 1; }
EXCHANGE=$(echo "$OUT" | grep 'Deployed to' | awk '{print $3}')
TX=$(echo "$OUT" | grep 'Transaction hash' | awk '{print $3}')
[ -n "$EXCHANGE" ] || { echo "$OUT" >&2; echo "Deployment failed." >&2; exit 1; }

DEMO=""
if [ "${DEMO_TOKEN:-}" = "--demo-token" ]; then
  DOUT=$(forge create contracts/test/mocks/MockTokens.sol:MockERC20 \
    --rpc-url "$RPC" --private-key "$KEY" --broadcast \
    --gas-price "${GAS}gwei" --priority-gas-price 1gwei 2>&1) || { echo "$DOUT" >&2; exit 1; }
  DEMO=$(echo "$DOUT" | grep 'Deployed to' | awk '{print $3}')
  cast send "$DEMO" "mint(address,uint256)" "$DEPLOYER" 1000000000000000000000000 \
    --rpc-url "$RPC" --private-key "$KEY" --gas-price "${GAS}gwei" --priority-gas-price 1gwei >/dev/null
fi

mkdir -p deployments
cat > deployments/arc-testnet.json <<JSON
{
  "network": "Arc Testnet",
  "chainId": 5042002,
  "exchange": "$EXCHANGE",
  "deployTx": "$TX",
  "deployBlock": $START_BLOCK,
  "usdc": "$USDC",
  "feeCollector": "$COLLECTOR",
  "admin": "$ADMIN",
  "demoToken": "$DEMO",
  "audited": false
}
JSON

echo
echo "AvantdexExchange deployed: $EXCHANGE"
echo "Explorer: https://explorer.testnet.arc.io/address/$EXCHANGE"
[ -n "$DEMO" ] && echo "Demo token (1,000,000 minted to you): $DEMO"
echo
echo "Put these in .env / Coolify environment variables:"
echo "  EXCHANGE_ADDRESS=$EXCHANGE"
echo "  EXCHANGE_DEPLOY_BLOCK=$START_BLOCK"
echo "  BOOTSTRAP_ADMIN_ADDRESSES=$ADMIN"
echo "Saved to deployments/arc-testnet.json"
