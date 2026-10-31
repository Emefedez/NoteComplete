#!/usr/bin/env python3
"""Recompress an AppImage with zstd behind AppImage's type2 runtime.

python3 tools/repack_appimage.py APPIMAGE [--arch aarch64|x86_64]

electron-builder's runtime only reads gzip or xz images, and reading Electron through
gzip cost about 0.8 s on every launch (1.35 s to first paint against 0.52 s unpacked, on
an M1 Max under Asahi). AppImage's own type2 runtime reads zstd, which decompresses
several times faster for a similar size. The runtime is a pinned release, checked against
its SHA-256 (the same digests GitHub publishes for the release assets), and cached in
~/.cache/notecomplete. Needs squashfs-tools 4.4 or newer (unsquashfs -o, zstd).
"""
import argparse, hashlib, os, platform, shutil, struct, subprocess, sys, tempfile, urllib.request
from pathlib import Path

RUNTIME_TAG = '20251108'
RUNTIME_SHA256 = {
    'aarch64': '00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444',
    'x86_64': '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d',
}
ARCH = {'aarch64': 'aarch64', 'arm64': 'aarch64', 'x86_64': 'x86_64', 'amd64': 'x86_64', 'x64': 'x86_64'}
CACHE = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'notecomplete'

def runtime(arch):
    path = CACHE / f'type2-runtime-{RUNTIME_TAG}-{arch}'
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        url = f'https://github.com/AppImage/type2-runtime/releases/download/{RUNTIME_TAG}/runtime-{arch}'
        print(f'Downloading {url}', flush=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
        partial = path.with_suffix('.partial')
        partial.write_bytes(data)
        partial.replace(path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != RUNTIME_SHA256[arch]:
        path.unlink()
        sys.exit(f'{path.name} does not match its pinned SHA-256; removed it. Run again to download it afresh.')
    return data

# The image starts where the runtime's ELF file ends: after its section header table.
def squashfs_offset(appimage):
    with open(appimage, 'rb') as f:
        head = f.read(64)
    if head[:4] != b'\x7fELF' or head[4] != 2 or head[5] != 1:
        sys.exit(f'{appimage} is not a 64-bit little-endian AppImage.')
    shoff, = struct.unpack_from('<Q', head, 0x28)
    shentsize, shnum = struct.unpack_from('<HH', head, 0x3A)
    return shoff + shentsize * shnum

def compression(image, offset):
    out = subprocess.run(['unsquashfs', '-s', '-o', str(offset), str(image)], capture_output=True, text=True, check=True).stdout
    return next((line.split()[-1] for line in out.splitlines() if line.startswith('Compression')), '?')

def repack(appimage, arch):
    head = runtime(arch)
    offset = squashfs_offset(appimage)
    if compression(appimage, offset) == 'zstd':
        print(f'{appimage.name} is already zstd.')
        return
    with tempfile.TemporaryDirectory(prefix='nc-repack-') as tmp:
        root, image = Path(tmp) / 'root', Path(tmp) / 'image.squashfs'
        subprocess.run(['unsquashfs', '-q', '-no-progress', '-d', str(root), '-o', str(offset), str(appimage)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['mksquashfs', str(root), str(image), '-comp', 'zstd', '-Xcompression-level', '15', '-b', '1M',
                        '-all-root', '-noappend', '-no-progress', '-quiet'], check=True)
        partial = appimage.with_name(appimage.name + '.partial')
        with open(partial, 'wb') as out:
            out.write(head)
            with open(image, 'rb') as src: shutil.copyfileobj(src, out, 1 << 20)
        os.chmod(partial, 0o755)
        if compression(partial, len(head)) != 'zstd':
            partial.unlink()
            sys.exit('The repacked image is not zstd; the original is unchanged.')
        before = appimage.stat().st_size
        os.replace(partial, appimage)
    print(f'Repacked {appimage.name} with zstd: {before / 1e6:.1f} MB -> {appimage.stat().st_size / 1e6:.1f} MB')

def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('appimage', type=Path, nargs='+')
    parser.add_argument('--arch', default=platform.machine(), help='runtime architecture (default: this machine)')
    args = parser.parse_args()
    arch = ARCH.get(args.arch.lower())
    if not arch: sys.exit(f'Unsupported architecture {args.arch}')
    for appimage in args.appimage: repack(appimage, arch)

if __name__ == '__main__':
    main()
