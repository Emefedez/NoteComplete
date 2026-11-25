#!/bin/sh
# Stops the instance run.sh started, by the exact PIDs it recorded (office-bridge.js does the
# same in Node; this is for stopping it by hand). usage: stop.sh <statedir>
# SIGTERM to the namespace's pid 1 (tini) lets supervisord stop the services; unshare and
# pasta exit once the namespace is empty (they are stopped after 30 s otherwise).
S=$1
C=$(cat "$S/child.pid" 2>/dev/null); U=$(cat "$S/unshare.pid" 2>/dev/null); P=$(cat "$S/pasta.pid" 2>/dev/null)
[ -n "$C" ] && grep -q 'inner.sh\|tini\|entrypoint' /proc/$C/cmdline 2>/dev/null && kill "$C" 2>/dev/null
i=0; while [ -n "$U" ] && kill -0 "$U" 2>/dev/null && [ $i -lt 60 ]; do sleep 0.5; i=$((i+1)); done
[ -n "$U" ] && grep -q unshare /proc/$U/cmdline 2>/dev/null && kill "$U"
[ -n "$P" ] && grep -q pasta /proc/$P/cmdline 2>/dev/null && kill "$P"
rm -f "$S/child.pid" "$S/unshare.pid" "$S/pasta.pid"
echo "stopped"
