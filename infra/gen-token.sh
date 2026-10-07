#!/usr/bin/env bash
# Prints a LiveKit test token (24 h, join/publish/subscribe) using the `lk` CLI, for
# checking the deployment with https://meet.livekit.io ("Custom" tab).
# Uses the key pair from infra/.env. Runs `lk` from Docker when it isn't installed.
# Usage: ./gen-token.sh [identity] [room]
set -euo pipefail
cd "$(dirname "$0")"

identity=${1:-teste-$RANDOM}
room=${2:-teste}

set -a
# shellcheck disable=SC1091
source .env
set +a
: "${LIVEKIT_API_KEY:?missing in .env}" "${LIVEKIT_API_SECRET:?missing in .env}" "${LIVEKIT_DOMAIN:?missing in .env}"

args=(token create --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET"
  --join --room "$room" --identity "$identity" --valid-for 24h)

if command -v lk >/dev/null; then
  lk "${args[@]}"
else
  docker run --rm livekit/livekit-cli "${args[@]}"
fi

echo
echo "LiveKit URL: wss://$LIVEKIT_DOMAIN"
