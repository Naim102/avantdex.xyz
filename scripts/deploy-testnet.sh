#!/usr/bin/env bash
# Deploys AvantdexExchange to ARC TESTNET from YOUR wallet (no keys are ever sent anywhere but your own RPC call).
#
#   export DEPLOYER_PRIVATE_KEY=0x...        # a testnet-only wallet funded at https://faucet.circle.com
#   ./scripts/deploy-testnet.sh              # deploy the exchange
#   ./scripts/deploy-testnet.sh --demo-token # also deploy a demo ERC-20 to practise a market/settlement
#
# Optional environment:
#   ADMIN_ADDRESS   receives DEFAULT_ADMIN / MARKET_MANAGER / PAUSER roles (default: the deployer)
#   FEE_COLLECTOR   platform fee address (default: 0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6)
#   RPC_URL         default https://rpc.testnet.arc.io
#   GAS_PRICE_GWEI  max fee per gas, default 25 (Arc guidance: at least 20 gwei)
#
# The script refuses to run against any chain other than Arc Testnet (chain id 5042002).
# Requires Docker (it runs Foundry in a container). On Windows use Git Bash or WSL.
set -euo pipefail

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  echo "Set DEPLOYER_PRIVATE_KEY first (a testnet-only wallet). Never use a wallet that holds real value." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK_ARGS=()
if [ -n "${DOCKER_NETWORK:-}" ]; then NETWORK_ARGS=(--network "$DOCKER_NETWORK"); fi

MSYS_NO_PATHCONV=1 docker run --rm --user 0:0 "${NETWORK_ARGS[@]}" \
  -e DEPLOYER_PRIVATE_KEY \
  -e ADMIN_ADDRESS -e FEE_COLLECTOR -e RPC_URL -e GAS_PRICE_GWEI -e DEMO_TOKEN="${1:-}" \
  -v "$ROOT:/app" -w /app \
  --entrypoint /bin/sh ghcr.io/foundry-rs/foundry:v1.7.1 /app/scripts/deploy-testnet-inner.sh
