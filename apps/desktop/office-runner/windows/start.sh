#!/bin/sh
# Starts the Document Server inside the NoteComplete-EuroOffice WSL distribution, as root:
# NoteComplete runs `wsl -d NoteComplete-EuroOffice -u root -- sh <this> <port> <config.json>`
# with JWT_SECRET and GENERATE_FONTS passed through WSLENV. nginx listens on PORT (all WSL2
# distributions share one network, so not on 80); WSL forwards it to the Windows localhost.
# UNTESTED on Windows (see the plan).
set -eu
PORT=$1; CONF=${2:-}
[ -n "${JWT_SECRET:-}" ] || { echo "JWT_SECRET is not set" >&2; exit 2; }
N=/etc/euro-office/documentserver/nginx
cp -f "$N/ds.conf.tmpl" "$N/ds.conf"
sed -i "s/listen 0.0.0.0:80;/listen 0.0.0.0:$PORT;/; s/listen \[::\]:80 /listen [::]:$PORT /" "$N/ds.conf"
[ -n "$CONF" ] && [ -f "$CONF" ] && cp -f "$CONF" /etc/euro-office/documentserver/local-production-linux.json
exec /usr/bin/env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 \
  EO_ROOT=/var/www/euro-office/documentserver EO_LOG=/var/log/euro-office/documentserver \
  EO_CONF=/etc/euro-office/documentserver COMPANY_NAME_LOW=euro-office PRODUCT_NAME_LOW=documentserver \
  JWT_ENABLED=true JWT_SECRET="$JWT_SECRET" ALLOW_PRIVATE_IP_ADDRESS=true \
  GENERATE_FONTS="${GENERATE_FONTS:-true}" PLUGINS_ENABLED=false \
  /entrypoint.sh
