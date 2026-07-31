#!/bin/sh
set -eu

if [ "${CURAFLOW_DEMO_SEED:-0}" = "1" ]; then
  echo "[entrypoint] Running rolling demo seed"
  node dist/scripts/seed-demo-data.js
fi

exec "$@"
