# Unpacks OCI layers (in manifest order) into a rootfs, applying whiteouts (office-bridge.js).
# Run as fake root inside `unshare --map-auto --map-root-user` so file owners are kept.
# usage: python3 -I unpack.py <imagedir> <rootfs>   (imagedir: manifest.json + blobs/<hex>)
import json, os, shutil, sys, tarfile
img, root = sys.argv[1], os.path.abspath(sys.argv[2])
os.makedirs(root, exist_ok=True)
def rm(p):
    if os.path.islink(p) or os.path.isfile(p): os.unlink(p)
    elif os.path.isdir(p): shutil.rmtree(p)
for layer in json.load(open(os.path.join(img, 'manifest.json')))['layers']:
    path = os.path.join(img, 'blobs', layer['digest'].split(':')[1])
    print('layer', layer['digest'][:19], flush=True)
    with tarfile.open(path, 'r:*') as t:
        members = []
        for m in t:
            name = os.path.normpath(m.name).lstrip('/')
            if name.startswith('..'): continue
            d, b = os.path.split(name)
            if b == '.wh..wh..opq':
                full = os.path.join(root, d)
                if os.path.isdir(full):
                    for c in os.listdir(full): rm(os.path.join(full, c))
                continue
            if b.startswith('.wh.'):
                rm(os.path.join(root, d, b[4:])); continue
            if m.ischr() or m.isblk(): continue   # no device nodes in a userns
            target = os.path.join(root, name)
            if os.path.lexists(target) and not (m.isdir() and os.path.isdir(target)) :
                rm(target)
            members.append(m)
        try: t.extractall(root, members=members, numeric_owner=True, filter='fully_trusted')
        except TypeError: t.extractall(root, members=members, numeric_owner=True)  # Python < 3.12
print('ok')
