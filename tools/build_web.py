#!/usr/bin/env python3
"""Build browser bindings from the same Rust core. No publishing."""
import hashlib
import json
import re
import sys
import os
from pathlib import Path
import shutil
import subprocess
try:
    import tomllib
except ModuleNotFoundError:
    raise SystemExit('Python 3.11 or newer is required to read Cargo.lock. Run this build with python3.11 or newer.')

ROOT=Path(__file__).resolve().parents[1]

def main():
    # prefabs/index.js from the module folders (tools/prefab_index.mjs).
    subprocess.run(['node',str(ROOT/'tools/prefab_index.mjs')],check=True)
    env=dict(os.environ)
    cargo=shutil.which('cargo')
    if shutil.which('rustup') and 'RUSTC' not in env:
        # Homebrew cargo/rustc and rustup may use different sysroots.
        env['RUSTC']=subprocess.check_output(['rustup','which','rustc'],text=True).strip()
        cargo=subprocess.check_output(['rustup','which','cargo'],text=True).strip()
    suffix='.exe' if os.name=='nt' else ''
    bindgen=ROOT/'work/wasm-tools/bin'/('wasm-bindgen'+suffix)
    if not bindgen.is_file():
        found=shutil.which('wasm-bindgen')
        if not found:raise SystemExit('Install wasm-bindgen-cli matching Cargo.lock, then retry.')
        bindgen=Path(found)
    lock=tomllib.loads((ROOT/'Cargo.lock').read_text())
    version=next(p['version'] for p in lock['package'] if p['name']=='wasm-bindgen')
    installed=subprocess.check_output([str(bindgen),'--version'],text=True).split()[-1]
    if installed!=version:raise SystemExit(f'wasm-bindgen-cli {version} required, found {installed}')
    subprocess.run([cargo,'build','--locked','--release','-p','noteful-wasm','-p','noteful-import-wasm','--target','wasm32-unknown-unknown'],cwd=ROOT,env=env,check=True)
    pkg=ROOT/'apps/reader/pkg'
    if pkg.exists(): shutil.rmtree(pkg)
    pkg.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(bindgen),'--target','web','--out-dir',str(pkg),str(ROOT/'target/wasm32-unknown-unknown/release/noteful_wasm.wasm')],check=True)
    # The Goodnotes/Notability importer: its own module, loaded only when a notebook is opened.
    subprocess.run([str(bindgen),'--target','web','--out-dir',str(pkg/'import'),str(ROOT/'target/wasm32-unknown-unknown/release/noteful_import_wasm.wasm')],check=True)
    npm='npm.cmd' if os.name=='nt' else 'npm'
    subprocess.run([npm,'ci','--ignore-scripts'],cwd=ROOT/'apps/reader',check=True)
    pdfjs=ROOT/'apps/reader/node_modules/pdfjs-dist'
    vendor=ROOT/'apps/reader/vendor/pdfjs'
    if vendor.exists(): shutil.rmtree(vendor)
    (vendor/'build').mkdir(parents=True,exist_ok=True)
    # The minified builds (1.7 MB instead of 3.1 MB), under the names the reader loads
    # (pdf-background.js imports pdf.mjs and names pdf.worker.mjs as its worker).
    for name in ['pdf.mjs','pdf.worker.mjs']: shutil.copy2(pdfjs/'build'/name.replace('.mjs','.min.mjs'),vendor/'build'/name)
    for folder in ['cmaps','standard_fonts','wasm']:
        shutil.copytree(pdfjs/folder,vendor/folder,dirs_exist_ok=True)
    shutil.copy2(pdfjs/'LICENSE',vendor/'LICENSE')
    # Comic Neue (SIL OFL 1.1): what Comic Sans and Handwriting text falls back to where those
    # fonts are not installed (Linux, Android), so it never ends as a generic cursive.
    comic=ROOT/'apps/reader/node_modules/@fontsource/comic-neue'
    fonts=ROOT/'apps/reader/vendor/fonts'
    if fonts.exists(): shutil.rmtree(fonts)
    fonts.mkdir(parents=True,exist_ok=True)
    for weight in ['400','700']:
        for style in ['normal','italic']:
            shutil.copy2(comic/'files'/f'comic-neue-latin-{weight}-{style}.woff2',fonts/f'comic-neue-{weight}-{style}.woff2')
    shutil.copy2(comic/'LICENSE',fonts/'LICENSE-comic-neue')
    chinese_fonts()
    subprocess.run(['node',str(ROOT/'tools/build_chinese_strokes.mjs')],check=True)  # stroke order: vendor/chinese/strokes/ (Arphic PL)
    subprocess.run(['node',str(ROOT/'tools/build_chinese_data.mjs')],check=True)  # dictionary packs: vendor/chinese/*.bin (CC BY-SA, Unicode, Apache, LGPL)
    # Bundle the local speech engine; model weights are fetched only on user request.
    speech=ROOT/'apps/reader/vendor/transformers'
    if speech.exists(): shutil.rmtree(speech)
    speech.mkdir(parents=True,exist_ok=True)
    transformers=ROOT/'apps/reader/node_modules/@huggingface/transformers'
    shutil.copy2(transformers/'dist/transformers.min.js',speech/'transformers.min.js')
    shutil.copy2(transformers/'LICENSE',speech/'LICENSE')
    runtime=ROOT/'apps/reader/node_modules/onnxruntime-web/dist'
    for name in ['ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.asyncify.wasm']:
        shutil.copy2(runtime/name,speech/name)
    # Text recognition engine, loaded only on request; language data is fetched on first use.
    ocr=ROOT/'apps/reader/vendor/tesseract'
    if ocr.exists(): shutil.rmtree(ocr)
    ocr.mkdir(parents=True,exist_ok=True)
    tesseract=ROOT/'apps/reader/node_modules/tesseract.js'
    for name in ['tesseract.esm.min.js','worker.min.js']: shutil.copy2(tesseract/'dist'/name,ocr/name)
    shutil.copy2(tesseract/'LICENSE.md' if (tesseract/'LICENSE.md').exists() else tesseract/'LICENSE',ocr/'LICENSE')
    core=ROOT/'apps/reader/node_modules/tesseract.js-core'
    for name in ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js']: shutil.copy2(core/name,ocr/name)
    shutil.copy2(core/'LICENSE',ocr/'LICENSE-core')
    # Markdown notes editor, loaded only when the Notes panel is opened.
    mde=ROOT/'apps/reader/vendor/tinymde'
    if mde.exists(): shutil.rmtree(mde)
    mde.mkdir(parents=True,exist_ok=True)
    tinymde=ROOT/'apps/reader/node_modules/tiny-markdown-editor'
    for name in ['tiny-mde.min.js','tiny-mde.min.css']: shutil.copy2(tinymde/'dist'/name,mde/name)
    shutil.copy2(tinymde/'LICENSE',mde/'LICENSE')
    # Math typesetting for AI answers and notes, loaded only when there is math.
    tex=ROOT/'apps/reader/vendor/katex'
    if tex.exists(): shutil.rmtree(tex)
    tex.mkdir(parents=True,exist_ok=True)
    katex=ROOT/'apps/reader/node_modules/katex'
    for name in ['katex.mjs','katex.min.css']: shutil.copy2(katex/'dist'/name,tex/name)
    shutil.copytree(katex/'dist/fonts',tex/'fonts',ignore=shutil.ignore_patterns('*.ttf','*.woff'))
    shutil.copy2(katex/'LICENSE',tex/'LICENSE')
    # Structured math editing in text boxes (math-field.js), loaded only when a formula is
    # edited; its fonts are KaTeX's, already above.
    ml=ROOT/'apps/reader/vendor/mathlive'
    if ml.exists(): shutil.rmtree(ml)
    ml.mkdir(parents=True,exist_ok=True)
    mathlive=ROOT/'apps/reader/node_modules/mathlive'
    shutil.copy2(mathlive/'mathlive.min.mjs',ml/'mathlive.min.mjs')
    shutil.copy2(mathlive/'LICENSE.txt',ml/'LICENSE')
    # Dark Reader, inlined into HTML documents in the dark theme, fetched on first use.
    dr=ROOT/'apps/reader/vendor/darkreader'
    if dr.exists(): shutil.rmtree(dr)
    dr.mkdir(parents=True,exist_ok=True)
    darkreader=ROOT/'apps/reader/node_modules/darkreader'
    for name in ['darkreader.js','LICENSE']: shutil.copy2(darkreader/name,dr/name)
    # Word and spreadsheet readers (office.js), fetched only when such a file is opened
    # (sw.js leaves them out of the offline install and keeps them once used).
    # The core SheetJS build reads XLSX, XLSM, XLSB, legacy XLS (BIFF8), ODS and FODS.
    for folder,package,name in (('mammoth','mammoth','mammoth.browser.min.js'),('sheetjs','xlsx','dist/xlsx.core.min.js')):
        out=ROOT/'apps/reader/vendor'/folder
        if out.exists(): shutil.rmtree(out)
        out.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/'apps/reader/node_modules'/package/name,out/Path(name).name)
        shutil.copy2(ROOT/'apps/reader/node_modules'/package/'LICENSE',out/'LICENSE')
    # HEIC photo decoder (heic.js): libheif with its WebAssembly inside, loaded only when a note
    # holds an iPhone photo, which Chromium and Electron cannot show (LGPL-3.0).
    heif=ROOT/'apps/reader/vendor/libheif'
    if heif.exists(): shutil.rmtree(heif)
    heif.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'apps/reader/node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs',heif/'libheif-bundle.mjs')
    shutil.copy2(ROOT/'apps/reader/node_modules/libheif-js/LICENSE',heif/'LICENSE')
    check_webllm()
    vendor_modules()
    write_manifest()
    print('Built apps/reader/. Serve with any static HTTP server. No Python/Rust server required at runtime.')

def chinese_fonts():
    """Noto Sans SC (SIL OFL 1.1) for Chinese text where the system has no such font, in the 101
    unicode-range slices Fontsource cuts it into: vendor/fonts/noto-sans-sc.css declares them
    (chinese/fonts.js loads it only for notes with Chinese), and a slice downloads only when a
    character in it is drawn. Exports embed the slices a page needs (docs/CHINESE-INPUT.md §6)."""
    package=ROOT/'apps/reader/node_modules/@fontsource-variable/noto-sans-sc'
    out=ROOT/'apps/reader/vendor/fonts/noto-sans-sc'
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    for f in (package/'files').glob('*.woff2'): shutil.copy2(f,out/f.name)
    shutil.copy2(package/'LICENSE',out/'LICENSE')
    css=(package/'index.css').read_text().replace("'Noto Sans SC Variable'","'Noto Sans SC'").replace('url(./files/','url(./noto-sans-sc/').replace("format('woff2-variations')","format('woff2')")
    (out.parent/'noto-sans-sc.css').write_text(css)

def check_webllm():
    """The model in this app (local-ai.js) downloads WebLLM from jsDelivr on first use instead of
    shipping it: the desktop stage copies every vendored file into the installers. It runs the file
    only if its hash is the one pinned in local-ai.js, so the pin must match the npm package here."""
    package=ROOT/'apps/reader/node_modules/@mlc-ai/web-llm'
    source=(ROOT/'apps/reader/local-ai.js').read_text()
    version=re.search(r"WEBLLM_VERSION = '([^']+)'",source).group(1)
    pinned=re.search(r"WEBLLM_SHA256 = '([0-9a-f]{64})'",source).group(1)
    installed=json.loads((package/'package.json').read_text())['version']
    actual=hashlib.sha256((package/'lib/index.js').read_bytes()).hexdigest()
    if installed!=version:raise SystemExit(f'local-ai.js pins WebLLM {version}, package.json installs {installed}: update WEBLLM_VERSION.')
    if actual!=pinned:raise SystemExit(f'WebLLM {version} lib/index.js has SHA-256 {actual}; set WEBLLM_SHA256 in apps/reader/local-ai.js to it.')

# Fetched only when a feature needs them: the service worker (sw.js) caches them the first time
# instead of at install, so a first visit (a tablet joining a session) downloads the app and
# not 40 MB of engines. Speech, text recognition, Word and spreadsheet readers, math, Dark
# Reader, and the fonts, character maps and image decoders only some PDFs use.
LAZY=('vendor/libheif/','vendor/transformers/','vendor/tesseract/','vendor/mammoth/','vendor/sheetjs/','vendor/katex/','vendor/mathlive/','vendor/darkreader/','vendor/pdfjs/cmaps/','vendor/pdfjs/standard_fonts/','vendor/pdfjs/wasm/','vendor/chinese/','vendor/fonts/noto-sans-sc')
def write_manifest():
    """precache.json: every file the app ships, with a hash of its contents (the service worker
    downloads a file again only when its hash changes; the desktop and Android apps ship
    exactly these files), and the shell the service worker caches at install."""
    reader=ROOT/'apps/reader'
    names=sorted(p.name for p in reader.iterdir() if p.is_file() and p.suffix in ('.html','.js','.css','.svg','.png','.webmanifest'))
    names+=sorted(p.relative_to(reader).as_posix() for folder in ('pkg','vendor') for p in (reader/folder).rglob('*') if p.is_file() and p.suffix not in ('.map','.ts'))
    # The prefab modules (docs/PREFAB-MODULES.md): manifests, code, help and AI notes; not their tests.
    # Chinese mode's modules (docs/CHINESE-INPUT.md) and Math mode's modules; not their tests.
    names+=sorted(p.relative_to(reader).as_posix() for p in (reader/'chinese').glob('*.js'))
    names+=sorted(p.relative_to(reader).as_posix() for p in (reader/'math').glob('*.js'))
    names+=sorted(p.relative_to(reader).as_posix() for p in (reader/'prefabs').rglob('*') if p.is_file() and '/test/' not in p.as_posix() and not p.name.endswith('.test.mjs'))
    files={name:hashlib.sha256((reader/name).read_bytes()).hexdigest()[:16] for name in names}
    shell=[name for name in names if not name.startswith(LAZY) and 'LICENSE' not in name and name!='sw.js']
    (reader/'precache.json').write_text(json.dumps({'files':files,'shell':shell})+'\n')

IMPORT=re.compile(r"""(^[ \t]*(?:(?:import|export)\b[^;'"]*?\bfrom\s*|import\s*))(['"])([^'"]+)\2""",re.M)
def vendor_modules():
    """Sharing (collab.js) loads Yjs, y-protocols and a QR encoder on first use. They are npm
    ES modules with bare imports ('yjs', 'lib0/x'); the files they need are copied with each
    import rewritten to a relative path, so the browser loads them without a bundler."""
    modules=ROOT/'apps/reader/node_modules'
    out=ROOT/'apps/reader/vendor'
    def source(spec,base):
        if spec=='yjs':return modules/'yjs/dist/yjs.mjs'
        if spec.startswith('lib0/'):return modules/'lib0'/(spec[5:]+'.js')
        if spec.startswith('.'):
            path=(base.parent/spec).resolve()
            return path if path.suffix in ('.js','.mjs') else path.with_name(path.name+'.js')
        raise SystemExit(f'Unexpected import {spec} in {base}')
    def target(path):
        rel=path.relative_to(modules)
        if rel.parts[0]=='yjs':return out/'yjs/yjs.mjs'
        if rel.parts[0]=='qrcode-generator':return out/'qrcode/qrcode.mjs'
        return out/rel.parts[0]/rel.name
    for name in ('yjs','y-protocols','lib0','qrcode'):
        if (out/name).exists():shutil.rmtree(out/name)
    todo=[modules/'yjs/dist/yjs.mjs',modules/'y-protocols/sync.js',modules/'y-protocols/awareness.js',modules/'lib0/encoding.js',modules/'lib0/decoding.js',modules/'qrcode-generator/dist/qrcode.mjs']
    done=set()
    while todo:
        path=todo.pop()
        if path in done:continue
        done.add(path)
        text=path.read_text()
        def rewrite(m):
            dep=source(m.group(3),path)
            todo.append(dep)
            rel=os.path.relpath(target(dep),target(path).parent).replace(os.sep,'/')
            return m.group(1)+m.group(2)+(rel if rel.startswith('.') else './'+rel)+m.group(2)
        text=IMPORT.sub(rewrite,text)
        dest=target(path)
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(text)
    for package,name in (('yjs','yjs'),('y-protocols','y-protocols'),('lib0','lib0'),('qrcode-generator','qrcode')):
        licence=modules/package/'LICENSE'
        if licence.exists():shutil.copy2(licence,out/name/'LICENSE')
    jsqr_out=out/'jsqr'
    if jsqr_out.exists():shutil.rmtree(jsqr_out)
    jsqr_out.mkdir(parents=True,exist_ok=True)
    jsqr_umd=(modules/'jsqr/dist/jsQR.js').read_text()
    (jsqr_out/'jsqr.mjs').write_text(
        '// ESM wrapper generated from jsqr/dist/jsQR.js for offline QR scanning without globals or eval.\n'
        'const _target = {};\n'
        'const _mod = { exports: _target };\n'
        '((module, exports, define, self) => {\n'
        + jsqr_umd
        + '\n})(_mod, _mod.exports, undefined, _target);\n'
        'export default typeof _mod.exports === \'function\' ? _mod.exports : (_mod.exports?.default || _target.jsQR);\n'
    )
    jsqr_licence=modules/'jsqr/LICENSE'
    if jsqr_licence.exists():shutil.copy2(jsqr_licence,jsqr_out/'LICENSE')

# --manifest: only rewrite precache.json for the files already built.
if __name__=='__main__':write_manifest() if sys.argv[1:]==['--manifest'] else main()
