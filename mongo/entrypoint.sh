#!/usr/bin/env bash
# Wraps the official mongo image's own entrypoint (which already handles running mongod as the right user correctly -
# reimplementing that is fragile, so this script never does). It only adds three things the local (non-Docker) setup
# already has: a persisted keyfile (needed because --replSet + auth requires one, even for a single node), a
# single-node replica set, and the two least-privilege users - all created ONCE, only on a genuinely empty data
# directory. Real work happens in bootstrap.js, run via mongosh from inside this same container (true localhost, so
# the pre-auth exception applies) - a script from a DIFFERENT container could not do this, since Mongo's localhost
# exception only recognises same-process-namespace connections.
set -euo pipefail

DATA_DIR="/data/db"
KEYFILE="$DATA_DIR/.mongo-keyfile"

mkdir -p "$DATA_DIR"
if [ ! -f "$KEYFILE" ]; then
  openssl rand -base64 756 > "$KEYFILE"
fi
chmod 600 "$KEYFILE"
chown mongodb:mongodb "$KEYFILE"

FIRST_RUN=0
if [ -z "$(find "$DATA_DIR" -mindepth 1 -not -name '.mongo-keyfile' -print -quit 2>/dev/null)" ]; then
  FIRST_RUN=1
fi

docker-entrypoint.sh mongod --replSet rs0 --keyFile "$KEYFILE" --bind_ip_all &
MONGOD_PID=$!

echo "santulan-entrypoint: waiting for mongod..."
until mongosh --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
  sleep 1
done

if [ "$FIRST_RUN" = "1" ]; then
  echo "santulan-entrypoint: first run - initiating the replica set and creating least-privilege users..."
  mongosh --quiet mongodb://127.0.0.1:27017/admin --file /docker-init/bootstrap.js
fi

wait "$MONGOD_PID"
