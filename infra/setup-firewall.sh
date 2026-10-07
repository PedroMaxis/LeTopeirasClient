#!/usr/bin/env bash
# Opens the LeTopeiras ports in the instance's iptables and persists them.
# Oracle's Ubuntu image ends the INPUT chain with a REJECT rule, so the rules are
# inserted right before it. Idempotent: rules that already exist are skipped.
# Usage: sudo ./setup-firewall.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if ! command -v netfilter-persistent >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi

# proto port(s) comment
RULES=(
  "tcp 80 http (ACME)"
  "tcp 443 https + TURN/TLS"
  "tcp 7881 LiveKit ICE/TCP"
  "udp 3478 LiveKit TURN/UDP"
  "udp 50000:60000 LiveKit media"
)

for rule in "${RULES[@]}"; do
  read -r proto port comment <<<"$rule"
  args=(-p "$proto" -m state --state NEW -m "$proto" --dport "$port" -j ACCEPT)
  if iptables -C INPUT "${args[@]}" 2>/dev/null; then
    echo "ok      $proto/$port ($comment)"
    continue
  fi
  # Position of the first REJECT rule; append if there is none.
  pos=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
  if [[ -n $pos ]]; then
    iptables -I INPUT "$pos" "${args[@]}"
  else
    iptables -A INPUT "${args[@]}"
  fi
  echo "added   $proto/$port ($comment)"
done

netfilter-persistent save >/dev/null
echo "Saved. Current INPUT chain:"
iptables -L INPUT -n --line-numbers
