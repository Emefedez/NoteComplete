#!/bin/sh
# Runs as fake root inside the namespaces made by run.sh: mounts what the image needs and
# hands off to the image's own /entrypoint.sh. usage: inner.sh <rootfs> <hostgw>
set -eu
R=$1; HOSTGW=$2
hostname eo
# Wait until pasta has configured the network namespace (an address on the tap device).
i=0; until ip -4 addr show 2>/dev/null | grep -q 'scope global'; do i=$((i+1)); [ $i -gt 200 ] && { echo "no network" >&2; exit 1; }; sleep 0.1; done
mount -t proc proc "$R/proc"
mount --rbind /dev "$R/dev"
mount -t tmpfs -o mode=1777 tmpfs "$R/dev/shm"
mount --rbind -o ro /sys "$R/sys" 2>/dev/null || mount --rbind /sys "$R/sys"
mount -t tmpfs -o mode=755 tmpfs "$R/run"
mount -t tmpfs -o mode=1777 tmpfs "$R/tmp"
printf '127.0.0.1 localhost eo\n::1 localhost\n%s host.nc.internal\n' "$HOSTGW" > "$R/etc/hosts"
: > "$R/etc/resolv.conf"
exec chroot "$R" /usr/bin/env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 \
  EO_ROOT=/var/www/euro-office/documentserver EO_LOG=/var/log/euro-office/documentserver \
  EO_CONF=/etc/euro-office/documentserver COMPANY_NAME_LOW=euro-office PRODUCT_NAME_LOW=documentserver \
  JWT_ENABLED=true JWT_SECRET="$JWT_SECRET" ALLOW_PRIVATE_IP_ADDRESS=true \
  GENERATE_FONTS="${GENERATE_FONTS:-true}" PLUGINS_ENABLED=false \
  /entrypoint.sh
