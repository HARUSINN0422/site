#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
while true; do
  node server.js
  status=$?
  if [ "$status" -ne 75 ]; then
    echo "server.js exited with status $status; not restarting automatically."
    exit "$status"
  fi
  echo "GitHub update applied; restarting server.js in 1 second..."
  sleep 1
done
