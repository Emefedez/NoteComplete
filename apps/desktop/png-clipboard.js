// Copied items as a picture on the system clipboard, byte for byte: the reader's PNG carries the
// items in a chunk (reader/png-clip.js), and Chromium re-encodes a PNG written as an image (the
// chunk is lost). Written here as the platform's raw PNG format, with the reader's marker text
// beside it, so other apps get the picture and NoteComplete gets its items back.
//   Linux:   "image/png" (Wayland and X11 offer it as that MIME type). On Wayland Chromium only
//            sets the clipboard while a window of the app has the keyboard; it is checked with
//            wl-paste, and when the picture is not there, wl-copy puts it (picture only).
//   Windows: the registered "PNG" format (Office, GIMP, Paint.NET, browsers read it).
//   macOS:   "public.png".
const RAW = { linux: 'image/png', win32: 'PNG', darwin: 'public.png' };
export const MAX_PNG = 64 * 1024 * 1024;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const rawFormat = (platform) => `electron application/osclipboard;format="${RAW[platform] || 'image/png'}"`;

// `run(cmd, args, input?)` → { code, stdout: Buffer } (or throws when the command is missing).
export function pngClipboard({ clipboard, ClipboardItem, platform = process.platform, env = process.env, run, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function waylandHas(bytes) {
    for (let i = 0; i < 3; i++) {
      const got = await run('wl-paste', ['--no-newline', '--type', 'image/png']).catch(() => null);
      if (!got) return null; // No wl-paste: cannot tell.
      if (got.code === 0 && Buffer.compare(got.stdout, bytes) === 0) return true;
      await wait(80);
    }
    return false;
  }
  return {
    // Writes `bytes` (a PNG) and `text`; says how: 'electron', 'wl-copy'.
    async write(bytes, text) {
      if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PNG || !SIGNATURE.every((b, i) => bytes[i] === b)) throw Error('Not a PNG.');
      const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const entries = { [rawFormat(platform)]: new Blob([png], { type: 'image/png' }) };
      if (typeof text === 'string' && text) entries['text/plain'] = text.slice(0, 1000);
      await clipboard.write([new ClipboardItem(entries)]);
      if (platform !== 'linux' || !env.WAYLAND_DISPLAY) return 'electron';
      if ((await waylandHas(png)) !== false) return 'electron';
      const put = await run('wl-copy', ['--type', 'image/png'], png).catch(() => null);
      if (put?.code !== 0) throw Error('Could not put the picture on the clipboard.');
      return 'wl-copy';
    },
  };
}

// run() for pngClipboard with child_process: stdout collected, or `input` written to stdin
// (then stdout is not kept: wl-copy stays in the background serving the clipboard, and a
// pipe it inherited would never close).
export function processRunner(spawn) {
  return (cmd, args, input) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', input ? 'ignore' : 'pipe', 'ignore'] });
    const out = [];
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.stdout?.on('data', (d) => out.push(d));
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out) }); });
    if (input) child.stdin.end(input);
  });
}
