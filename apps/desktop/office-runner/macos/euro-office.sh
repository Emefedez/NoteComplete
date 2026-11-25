#!/bin/sh
# Euro-Office for NoteComplete on macOS (office-bridge.js; docs/TABLES-AND-OFFICE.md phase 6).
# The Document Server exists only for Linux, so on macOS it runs in whichever Linux container
# runtime is installed: Apple `container` (macOS 26+), Podman, Docker Desktop, OrbStack, or
# Colima. Publishes only 127.0.0.1:<port> -> :80 inside the container.
#
# usage:
#   euro-office.sh check
#   euro-office.sh pull <imageRef> [runtime]
#   euro-office.sh inspect <imageRef> <destDir> [runtime]
#   euro-office.sh start <imageRef> <port> <dataDir> <configFile> <name> [runtime]
#   euro-office.sh stop <name> [runtime]
#   euro-office.sh remove <imageRef> <name> [runtime]
#
# UNTESTED on a real macOS machine (written on Linux; see docs/TABLES-AND-OFFICE.md).
set -eu

ACTION=${1:-check}

detect_runtime() {
  if command -v container >/dev/null 2>&1; then
    echo "container"
    return
  fi
  if command -v podman >/dev/null 2>&1; then
    echo "podman"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    echo "docker"
    return
  fi
  echo "none"
}

host_alias_for() {
  case "$1" in
    podman) echo "host.containers.internal" ;;
    docker) echo "host.docker.internal" ;;
    container) echo "host.docker.internal" ;;
    *) echo "host.docker.internal" ;;
  esac
}

runtime_ready() {
  case "$1" in
    container) container system status >/dev/null 2>&1 || container ls >/dev/null 2>&1 ;;
    podman) podman info >/dev/null 2>&1 ;;
    docker) docker info >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

case "$ACTION" in
  check)
    RT=$(detect_runtime)
    if [ "$RT" = "none" ]; then
      printf '{"ok":true,"runtime":"none","ready":false,"hostAlias":"","detail":"No container runtime found. Install Podman (brew install podman && podman machine init && podman machine start), Docker Desktop, OrbStack, Colima, or Apple container (macOS 26+)."}\n'
      exit 0
    fi
    ALIAS=$(host_alias_for "$RT")
    if runtime_ready "$RT"; then
      printf '{"ok":true,"runtime":"%s","ready":true,"hostAlias":"%s","detail":"Using %s"}\n' "$RT" "$ALIAS" "$RT"
    else
      printf '{"ok":true,"runtime":"%s","ready":false,"hostAlias":"%s","detail":"%s is installed but not running. Start it and try again."}\n' "$RT" "$ALIAS" "$RT"
    fi
    ;;

  pull)
    IMAGE=$2
    RT=${3:-$(detect_runtime)}
    [ "$RT" != "none" ] || { echo "No container runtime found" >&2; exit 1; }
    if [ "$RT" = "container" ]; then
      container image pull "$IMAGE"
    else
      "$RT" pull "$IMAGE"
    fi
    ;;

  inspect)
    IMAGE=$2
    DEST=$3
    RT=${4:-$(detect_runtime)}
    mkdir -p "$DEST"
    [ "$RT" != "none" ] || { echo "No container runtime found" >&2; exit 1; }
    if [ "$RT" = "container" ]; then
      container run --rm --entrypoint cat "$IMAGE" /var/www/euro-office/documentserver/document-formats/onlyoffice-docs-formats.json > "$DEST/formats.json" 2>/dev/null || rm -f "$DEST/formats.json"
      container run --rm --entrypoint cat "$IMAGE" /var/www/euro-office/documentserver/NOTICE > "$DEST/NOTICE" 2>/dev/null || rm -f "$DEST/NOTICE"
    else
      "$RT" run --rm --entrypoint cat "$IMAGE" /var/www/euro-office/documentserver/document-formats/onlyoffice-docs-formats.json > "$DEST/formats.json" 2>/dev/null || rm -f "$DEST/formats.json"
      "$RT" run --rm --entrypoint cat "$IMAGE" /var/www/euro-office/documentserver/NOTICE > "$DEST/NOTICE" 2>/dev/null || rm -f "$DEST/NOTICE"
    fi
    ;;

  start)
    IMAGE=$2; PORT=$3; DATADIR=$4; CONFFILE=$5; NAME=$6; RT=${7:-$(detect_runtime)}
    [ -n "${JWT_SECRET:-}" ] || { echo "JWT_SECRET is not set" >&2; exit 2; }
    [ "$RT" != "none" ] || { echo "No container runtime found" >&2; exit 1; }
    mkdir -p "$DATADIR"
    if [ "$RT" = "container" ]; then
      container stop "$NAME" >/dev/null 2>&1 || true
      container rm "$NAME" >/dev/null 2>&1 || true
      container run -d --name "$NAME" \
        -p "127.0.0.1:$PORT:80" \
        -e JWT_ENABLED=true -e "JWT_SECRET=$JWT_SECRET" \
        -e ALLOW_PRIVATE_IP_ADDRESS=true \
        -e "GENERATE_FONTS=${GENERATE_FONTS:-true}" \
        -e PLUGINS_ENABLED=false \
        -v "$CONFFILE:/etc/euro-office/documentserver/local-production-linux.json:ro" \
        -v "$DATADIR:/var/www/euro-office/Data" \
        "$IMAGE"
    else
      "$RT" rm -f "$NAME" >/dev/null 2>&1 || true
      "$RT" run -d --rm --name "$NAME" \
        -p "127.0.0.1:$PORT:80" \
        --add-host=host.docker.internal:host-gateway \
        -e JWT_ENABLED=true -e "JWT_SECRET=$JWT_SECRET" \
        -e ALLOW_PRIVATE_IP_ADDRESS=true \
        -e "GENERATE_FONTS=${GENERATE_FONTS:-true}" \
        -e PLUGINS_ENABLED=false \
        -v "$CONFFILE:/etc/euro-office/documentserver/local-production-linux.json:ro" \
        -v "$DATADIR:/var/www/euro-office/Data" \
        "$IMAGE"
    fi
    ;;

  stop)
    NAME=$2; RT=${3:-$(detect_runtime)}
    [ "$RT" != "none" ] || exit 0
    if [ "$RT" = "container" ]; then
      container stop "$NAME" >/dev/null 2>&1 || true
      container rm "$NAME" >/dev/null 2>&1 || true
    else
      "$RT" stop -t 15 "$NAME" >/dev/null 2>&1 || true
      "$RT" rm -f "$NAME" >/dev/null 2>&1 || true
    fi
    ;;

  remove)
    IMAGE=$2; NAME=$3; RT=${4:-$(detect_runtime)}
    [ "$RT" != "none" ] || exit 0
    if [ "$RT" = "container" ]; then
      container stop "$NAME" >/dev/null 2>&1 || true
      container rm "$NAME" >/dev/null 2>&1 || true
      container image rm "$IMAGE" >/dev/null 2>&1 || true
    else
      "$RT" rm -f "$NAME" >/dev/null 2>&1 || true
      "$RT" rmi "$IMAGE" >/dev/null 2>&1 || true
    fi
    ;;

  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
esac
