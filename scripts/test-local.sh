#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Every run gets a new ledger and wallet. No deployed program keypair is needed.
if [[ "${SKIP_BUILD:-0}" != 1 ]]; then
  anchor build --ignore-keys --arch v3
fi
mkdir -p .anchor
umask 077
run_dir=$(mktemp -d "$PWD/.anchor/test.XXXXXX")
validator_pid=
cleanup() {
  if [[ -n "$validator_pid" ]]; then
    kill "$validator_pid" 2>/dev/null || true
    wait "$validator_pid" 2>/dev/null || true
  fi
  if [[ -f "$run_dir/ledger/validator.log" ]]; then
    cp "$run_dir/ledger/validator.log" .anchor/runtime.log
  fi
  rm -rf "$run_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
solana-keygen new --no-bip39-passphrase --silent --outfile "$run_dir/wallet.json" >/dev/null
wallet_pubkey=$(solana-keygen pubkey "$run_dir/wallet.json")
rpc_port=${TEST_RPC_PORT:-18899}
export ANCHOR_PROVIDER_URL="http://127.0.0.1:$rpc_port"
export ANCHOR_WALLET="$run_dir/wallet.json"
# Refuse to reuse another local validator accidentally.
node - "$rpc_port" <<'JS'
const net = require("node:net");
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65533) {
  throw new Error("TEST_RPC_PORT must be between 1024 and 65533");
}
Promise.all([port, port + 1, port + 2].map(p => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", () => reject(new Error(`Local test port ${p} is already in use`)));
  server.listen(p, "127.0.0.1", () => server.close(resolve));
}))).catch(error => { console.error(error.message); process.exitCode = 1; });
JS
solana-test-validator --reset --quiet --bind-address 127.0.0.1 \
  --rpc-port "$rpc_port" --faucet-port "$((rpc_port + 2))" \
  --ledger "$run_dir/ledger" --mint "$wallet_pubkey" \
  --upgradeable-program SsubM7pGA83VRnCodXVrxU2GZNBQzBYgzPUYBssCwU1 target/deploy/step_subscriptions.so "$wallet_pubkey" \
  >.anchor/validator.log 2>&1 &
validator_pid=$!
ready=0
for ((i=0; i<120; i++)); do
  if ! kill -0 "$validator_pid" 2>/dev/null; then
    cat .anchor/validator.log
    exit 1
  fi
  if curl --silent --fail --max-time 1 -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$ANCHOR_PROVIDER_URL" | grep -q '"ok"'; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then
  tail -n 50 .anchor/validator.log
  exit 1
fi
suite=${TEST_SUITE:-test:client}
case "$suite" in test:client|test:security:client) ;; *) exit 2 ;; esac
npm run "$suite" -- "$@"
