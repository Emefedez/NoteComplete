#!/usr/bin/env python3
"""Rebuild NoteComplete for Linux and replace the installed AppImage.

python3 tools/update_appimage.py [--target PATH] [--no-install] [--force]

Builds the web reader and WASM core, the noteful CLI bundled for AI tools and
MCP, stages the reader into the Electron app and packages an AppImage for
this machine's architecture. The previous AppImage is kept beside the new one
as NoteComplete.AppImage.previous. It refuses to replace a running app unless
--force is given.
"""
import argparse, hashlib, os, platform, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / 'apps/desktop'
DEFAULT = Path.home() / '.local/share/notecomplete/NoteComplete.AppImage'
ARCH = {'aarch64': 'arm64', 'arm64': 'arm64', 'x86_64': 'x64', 'amd64': 'x64'}

def run(*cmd, cwd=ROOT):
    print('+', ' '.join(map(str, cmd)), flush=True)
    subprocess.run(list(map(str, cmd)), cwd=cwd, check=True)

def running():
    # Electron's process name is truncated by the kernel to 15 characters.
    return subprocess.run(['pgrep', '-x', 'notecomplete-de'], capture_output=True).returncode == 0

def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--target', type=Path, default=DEFAULT, help=f'installed AppImage (default {DEFAULT})')
    parser.add_argument('--no-install', action='store_true', help='build only')
    parser.add_argument('--force', action='store_true', help='replace even while NoteComplete is running')
    args = parser.parse_args()
    arch = ARCH.get(platform.machine().lower())
    if not arch: sys.exit(f'Unsupported architecture {platform.machine()}')
    if not args.no_install and running() and not args.force:
        sys.exit('NoteComplete is running. Close it, or pass --force (the running copy keeps working until restarted).')
    run(sys.executable, 'tools/build_web.py')
    run('cargo', 'build', '--release', '--locked', '-p', 'noteful-cli')
    if not (DESKTOP / 'node_modules/.bin/electron-builder').exists():
        run('npm', 'ci', cwd=DESKTOP)
    run('node', 'stage.mjs', cwd=DESKTOP)
    run('npx', 'electron-builder', '--linux', 'AppImage', f'--{arch}', '--publish', 'never', cwd=DESKTOP)
    built = max((DESKTOP / 'dist').glob(f'NoteComplete-*-linux-{arch}.AppImage'), key=lambda p: p.stat().st_mtime)
    digest = hashlib.sha256(built.read_bytes()).hexdigest()
    print(f'Built {built} ({built.stat().st_size / 1e6:.1f} MB, sha256 {digest[:16]}…)')
    if args.no_install: return
    args.target.parent.mkdir(parents=True, exist_ok=True)
    if args.target.exists():
        shutil.copy2(args.target, args.target.with_name(args.target.name + '.previous'))
    partial = args.target.with_name(args.target.name + '.partial')
    shutil.copy2(built, partial)
    os.chmod(partial, 0o755)
    os.replace(partial, args.target)
    print(f'Installed {args.target}; previous copy kept as {args.target.name}.previous')

if __name__ == '__main__':
    main()
