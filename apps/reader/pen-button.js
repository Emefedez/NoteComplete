// Whether a pen event is its side button, however the browser reports it
// (docs/S-PEN-BUTTON.md). Pure: it takes plain event fields and returns "menu" or null,
// so the lines of Help → Test pen and stylus can be replayed in tests.
//
// What Chromium on Android (Chrome, Brave) gives a page for the S Pen button:
// - pen hovering, button pressed: pen pointermove whose `buttons` goes 0 → 1, 2 or 3,
//   with no pointerdown (signal A);
// - button held, then a tap: no pointer events, only a contextmenu whose pointerType is ""
//   (Chromium's stylus text selection), right after the pen hovered (signal B);
// - pen touching, button pressed: nothing (buttons stays 1), so it cannot be detected.
// Desktop pens (Wacom, Surface) report the barrel as button 2 or the eraser as 5 / 32.

export const PROFILE_KEY = 'notecomplete-pen-button';
const PEN_RECENT_MS = 1500;

// The setting saved by the "Pen button" dialog, if any and still for this browser.
export function loadPenProfile(storage = globalThis.localStorage, ua = globalThis.navigator?.userAgent || '') {
  try {
    const profile = JSON.parse(storage?.getItem(PROFILE_KEY) || 'null');
    if (!profile || profile.v !== 1) return null;
    // Calibrated in another major browser version: the defaults again.
    if (profile.ua && profile.ua !== browserTag(ua)) return { off: profile.off, longPress: profile.longPress };
    return profile;
  } catch { return null; }
}
export function browserTag(ua) {
  const m = ua.match(/(Chrome|Firefox|Version)\/(\d+)/);
  return `${m ? `${m[1]}/${m[2]}` : 'unknown'} ${/Android/.test(ua) ? 'Android' : /Mac|iPhone|iPad/.test(ua) ? 'Apple' : 'desktop'}`;
}

export function penButtonDetector(getProfile = () => null) {
  let contact = false, hoverButtons = 0, penSeenAt = -Infinity;
  return {
    // pointerdown / pointermove / pointerup / pointercancel, as
    // { type, pointerType, button, buttons, time }.
    pointer(e) {
      if (e.pointerType !== 'pen') return null;
      const profile = getProfile();
      penSeenAt = e.time;
      if (e.type === 'pointerdown') {
        contact = true;
        hoverButtons = e.buttons;
        // Desktop pens: barrel (2) or eraser (5) as the pen touches. Never on Android.
        return !profile?.off && (e.button > 0 || (e.buttons & ~1)) ? 'menu' : null;
      }
      if (e.type === 'pointerup' || e.type === 'pointercancel') { contact = false; hoverButtons = 0; return null; }
      // A pen hovering with no button: any contact whose lift was lost is over.
      if (contact && e.buttons === 0) contact = false;
      if (contact) return null; // Touching: the browser does not report the button.
      const mask = profile?.hoverMask || ~0;
      const was = hoverButtons & mask, now = e.buttons & mask;
      hoverButtons = e.buttons;
      return !profile?.off && now && !was ? 'menu' : null;
    },
    // { pointerType, time }
    contextmenu(e) {
      const profile = getProfile();
      if (profile?.off) return null;
      if (e.pointerType === 'pen') return 'menu';
      // Button held, then a tap: a long press with no pointer type, just after the pen hovered.
      if (!e.pointerType && e.time - penSeenAt < PEN_RECENT_MS && !contact) return 'menu';
      return null;
    },
    // A key the calibration saw the button send (none on stock Android).
    key(e) {
      const key = getProfile()?.key;
      return key && e.code === key.code && e.key === key.key ? 'menu' : null;
    },
    // The quick menu closed: the next press counts again.
    reset() { hoverButtons = 0; },
    get recent() { return penSeenAt; },
  };
}

// Calibration: from what was recorded while the user pressed the button, the profile to
// keep. `hover` are pen pointermoves with no contact; `taps` contextmenus; `keys` keydowns.
export function profileFrom({ hover = [], taps = [], keys = [] }, ua = '') {
  const baseline = hover.find((m) => m.phase === 'baseline')?.buttons ?? 0;
  const pressed = hover.filter((m) => m.phase === 'press' && m.buttons !== baseline);
  const hoverMask = pressed.reduce((mask, m) => mask | (m.buttons & ~baseline), 0);
  const tap = taps.find((t) => t.pointerType === '' || t.pointerType === 'pen');
  const key = keys.find((k) => k.key && !['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(k.key));
  return {
    v: 1,
    ua: browserTag(ua),
    hoverMask: hoverMask || 0,
    hoverSeen: hover.length > 0,
    tapContextmenu: tap ? tap.pointerType : null,
    key: key ? { key: key.key, code: key.code } : null,
    longPress: false,
    off: false,
  };
}

// What the calibration found, in words.
export function describeProfile(p) {
  const ways = [];
  if (p.hoverMask) ways.push(`while the pen hovers (reported as buttons ${p.hoverMask})`);
  if (p.tapContextmenu != null) ways.push('when you tap with it held');
  if (p.key) ways.push(`as the key ${p.key.key}`);
  if (ways.length) return `Your pen button works ${ways.join(' and ')}.`;
  if (!p.hoverSeen) return 'This browser does not report the pen hovering, and no button press arrived. Use Shift + pen, Shift + S, two fingers held still, or the pen long-press below.';
  return 'No button press arrived. Samsung’s Air command may be taking it: turn off “Open Air command with pen button” in Settings → Advanced features → S Pen → Air command, then try again.';
}
