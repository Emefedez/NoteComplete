#!/bin/sh
# Starts the Euro-Office rootfs as a rootless "container" without docker (office-bridge.js,
# proven in the Euro-Office spike): unshare with the user's subuid range for the namespaces,
# pasta for the network. Only 127.0.0.1:PORT on this computer is published (-> nginx :80
# inside); inside, HOSTGW reaches this computer's loopback (the document and save callbacks).
# usage: run.sh <rootfs> <statedir> <port> [hostgw]   env: JWT_SECRET (required), GENERATE_FONTS
# Writes <statedir>/{unshare,child,pasta}.pid and container.log, then returns.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOTFS=$1; STATE=$2; PORT=$3; HOSTGW=${4:-169.254.1.2}
[ -n "${JWT_SECRET:-}" ] || { echo "JWT_SECRET is not set" >&2; exit 2; }
mkdir -p "$STATE"
rm -f "$STATE/unshare.pid" "$STATE/child.pid" "$STATE/pasta.pid"
export JWT_SECRET GENERATE_FONTS="${GENERATE_FONTS:-true}"
unshare --map-auto --map-root-user --mount --pid --fork --net --uts --ipc --kill-child \
  -- sh "$HERE/inner.sh" "$ROOTFS" "$HOSTGW" > "$STATE/container.log" 2>&1 < /dev/null &
UPID=$!
echo "$UPID" > "$STATE/unshare.pid"
# The forked child (pid 1 of the new pid namespace) holds the namespaces. Wait until it has
# exec'd sh inner.sh and entered its own user+net namespaces so pasta can attach reliably.
MY_USER_NS=$(readlink "/proc/$$/ns/user" 2>/dev/null || true)
i=0; CHILD=""
while [ -z "$CHILD" ]; do
  for c in $(cat "/proc/$UPID/task/$UPID/children" 2>/dev/null); do
    CMD=$(tr '\0' ' ' < "/proc/$c/cmdline" 2>/dev/null || true)
    case "$CMD" in
      sh\ *inner.sh*|/bin/sh\ *inner.sh*)
        CNS=$(readlink "/proc/$c/ns/user" 2>/dev/null || true)
        if [ -n "$CNS" ] && [ "$CNS" != "$MY_USER_NS" ] && [ -r "/proc/$c/ns/net" ]; then
          CHILD=$c
          break
        fi
        ;;
    esac
  done
  [ -n "$CHILD" ] && break
  kill -0 "$UPID" 2>/dev/null || { echo "unshare exited:" >&2; cat "$STATE/container.log" >&2; exit 1; }
  i=$((i+1)); [ $i -gt 200 ] && { echo "namespace child not found" >&2; kill -9 "$UPID" 2>/dev/null || true; exit 1; }
  sleep 0.05
done
echo "$CHILD" > "$STATE/child.pid"
PASTA_OK=0
for attempt in 1 2 3; do
  if pasta --config-net -a 10.88.0.2 -n 24 -g 10.88.0.1 --map-host-loopback "$HOSTGW" \
    -t "127.0.0.1/$PORT:80" -u none -T none -U none --no-dhcp --no-ndp --no-dhcpv6 --no-ra -4 \
    -P "$STATE/pasta.pid" "$CHILD" > "$STATE/pasta.log" 2>&1 < /dev/null; then
    PASTA_OK=1
    break
  fi
  sleep 0.2
done
if [ "$PASTA_OK" -ne 1 ]; then
  echo "pasta failed:" >&2
  cat "$STATE/pasta.log" >&2
  kill -9 "$UPID" 2>/dev/null || true
  exit 1
fi
echo "unshare $UPID child $CHILD pasta $(cat "$STATE/pasta.pid") port $PORT"
