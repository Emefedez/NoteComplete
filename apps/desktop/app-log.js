// A small diagnostic log, off until Help → Keep a diagnostic log turns it on, for finding out what happened after the fact:
// ~/.config/notecomplete-desktop/logs/notecomplete.log (and .1, the one before).
// It keeps the reader's warnings and errors and its "[NC]" progress lines (expand,
// AI runs), never note contents. Rotated at MAX bytes.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX = 2 * 1024 * 1024;

// Which console messages are kept: warnings, errors, and the app's own [NC] lines.
export function keep(level, message) {
  const l = typeof level === 'number' ? ['debug', 'info', 'warning', 'error'][level] || 'info' : String(level || 'info');
  return l === 'warning' || l === 'error' || /^\[NC\]/.test(String(message || ''));
}

export function appLog(dir, { max = MAX, now = () => new Date() } = {}) {
  const file = path.join(dir, 'notecomplete.log'), setting = path.join(dir, 'logging.json');
  let ready = false, on = false;
  try { on = JSON.parse(readFileSync(setting, 'utf8')).on === true; } catch { /* Off by default. */ }
  function write(line) {
    if (!on) return;
    try {
      if (!ready) { mkdirSync(dir, { recursive: true }); ready = true; }
      try { if (statSync(file).size > max) renameSync(file, file + '.1'); } catch { /* No log yet. */ }
      appendFileSync(file, `${now().toISOString()} ${String(line).replace(/\s+$/, '').slice(0, 4000)}\n`);
    } catch { /* Logging never breaks the app. */ }
  }
  return {
    file,
    dir,
    write,
    get on() { return on; },
    // Remembered across launches; turning it off stops writing (the file stays until deleted).
    setOn(next) {
      on = next === true;
      try { mkdirSync(dir, { recursive: true }); ready = true; writeFileSync(setting, JSON.stringify({ on })); } catch { /* Kept for this run only. */ }
      if (on) write(`[NC] logging on`);
      return on;
    },
    // Electron 44 passes one event object; older versions (event, level, message, line, source).
    attach(contents, tab = '') {
      contents.on('console-message', (event, level, message, line, source) => {
        const lv = event?.level ?? level, msg = event?.message ?? message;
        const src = event?.sourceId ?? source, ln = event?.lineNumber ?? line;
        if (!keep(lv, msg)) return;
        write(`[tab ${tab}] ${typeof lv === 'number' ? ['debug', 'info', 'warning', 'error'][lv] : lv} ${msg}${src && !/^\[NC\]/.test(msg) ? ` (${path.basename(String(src))}:${ln})` : ''}`);
      });
      contents.on('render-process-gone', (_e, details) => write(`[tab ${tab}] renderer gone: ${details?.reason} (${details?.exitCode})`));
    },
  };
}
