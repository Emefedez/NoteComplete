#!/bin/sh
# Applies one OCI image layer (a .tar.gz) to / inside the NoteComplete-EuroOffice WSL
# distribution, as root (euro-office.ps1 -Action Import). Whiteouts first, as unpack.py does
# on Linux: ".wh..wh..opq" empties its folder, ".wh.<name>" deletes <name>; then the layer is
# extracted keeping owners and modes, without the whiteout markers.
# usage: apply-layer.sh <layer.tar.gz>     UNTESTED on Windows (see the plan).
set -eu
L=$1
tar -tzf "$L" | while IFS= read -r entry; do
  e=${entry#./}; d=$(dirname "/$e"); b=$(basename "$e")
  case "$b" in
    .wh..wh..opq) [ -d "$d" ] && find "$d" -mindepth 1 -maxdepth 1 -exec rm -rf {} + ;;
    .wh.*) rm -rf "$d/${b#.wh.}" ;;
  esac
done
tar -xzpf "$L" -C / --numeric-owner --exclude='*/.wh.*' --exclude='.wh.*' --exclude='dev/*' 2>/dev/null || tar -xzpf "$L" -C / --numeric-owner --exclude='*/.wh.*' --exclude='.wh.*'
