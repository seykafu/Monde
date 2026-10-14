#!/usr/bin/env bash
# Boot the built server with no services configured and check /v1/health (catches bundling/runtime-start bugs).
set -euo pipefail
PORT=${PORT:-8097}
PORT=$PORT node server/dist/index.js > /tmp/monde-smoke.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then
    echo "smoke: server healthy"; exit 0
  fi
  if ! kill -0 $PID 2>/dev/null; then echo "smoke: server exited"; cat /tmp/monde-smoke.log; exit 1; fi
  sleep 0.25
done
echo "smoke: timed out"; cat /tmp/monde-smoke.log; exit 1
