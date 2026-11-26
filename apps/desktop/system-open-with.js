// The system's "Open with" chooser for a file NoteComplete does not open itself.
// Linux: xdg-desktop-portal OpenFile with ask=true (the desktop's app chooser), through
// PyGObject, which can hand the portal a file descriptor; the helper stays until the
// chooser answers, because the portal drops requests whose caller has gone.
// Windows: shell32's Open With dialog. Elsewhere, or when that fails: the default app.
import { spawn } from 'node:child_process';

export const PORTAL_SCRIPT = `
import os, sys
from gi.repository import Gio, GLib
path = sys.argv[1]
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
loop = GLib.MainLoop()
reply, _ = bus.call_with_unix_fd_list_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
    'org.freedesktop.portal.OpenURI', 'OpenFile',
    GLib.Variant('(sha{sv})', ('', 0, {'ask': GLib.Variant('b', True)})), GLib.VariantType('(o)'),
    Gio.DBusCallFlags.NONE, -1, Gio.UnixFDList.new_from_array([fd]), None)
print('asked', flush=True)
bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response', reply.unpack()[0], None,
    Gio.DBusSignalFlags.NO_MATCH_RULE, lambda *a: loop.quit())
GLib.timeout_add_seconds(600, loop.quit)
loop.run()
`;

// Resolves once the chooser is up (true) or could not be shown (false).
export function systemOpenWith(file, { platform = process.platform, run = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = platform === 'linux'
        ? run('python3', ['-I', '-c', PORTAL_SCRIPT, file], { stdio: ['ignore', 'pipe', 'ignore'] })
        : platform === 'win32'
          ? run('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', file], { stdio: 'ignore', detached: true })
          : null;
    } catch { child = null; }
    if (!child) return resolve(false);
    if (platform === 'win32') { child.on('error', () => resolve(false)); child.unref?.(); return setTimeout(() => resolve(true), 300); }
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    child.stdout?.on('data', (d) => { if (String(d).includes('asked')) finish(true); });
    child.on('error', () => finish(false));
    child.on('exit', () => finish(false));
  });
}
