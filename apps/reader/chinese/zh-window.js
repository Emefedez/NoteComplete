// The windows of Chinese mode (the character panel, the convert and vocabulary dialogs, writing
// practice): the kit's movable window on a computer, a bottom sheet on a phone (CSS .zh-sheet),
// and inside an open modal dialog (a study card) when opened from one, so it shows over it.
import { movableWindow, isPhone } from '../prefabs/kit/window.js';
import { icon } from '../icons.js';
import { LANGS, zhLang, setZhLang } from './translate.js';

export { isPhone };
// The open modal <dialog> `near` is in (or the topmost one), where a window must go to be seen.
export function modalHost(near = null) {
  const own = near?.closest?.('dialog[open]');
  if (own) return own;
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal'));
  return open.at(-1) || null;
}
// `tall`: the height it may grow to at most (it scrolls inside), so a section opened later does
// not push it up under the app's bars.
export function zhWindow({ key, title, width = 380, tall = 0, near = null, onClose = null, className = '' }) {
  let win = null;
  const close = () => { win?.destroy(); onClose?.(); };
  const top = document.getElementById('viewport')?.getBoundingClientRect().top || 60;
  const height = tall ? Math.max(260, Math.min(tall, innerHeight - top - 24)) : null;
  win = movableWindow({ key, title, width, minWidth: 280, minHeight: 160, className: `zh-window ${isPhone() ? 'zh-sheet' : ''} ${className}`.trim(), onClose: close, phone: 'sheet' });
  if (height) win.el.style.setProperty('--zh-max', `${height}px`);
  const host = modalHost(near);
  if (host) host.append(win.el);
  return { ...win, close };
}

// The es | en toggle of the Chinese windows: meanings and translations in Spanish or English,
// one setting for every window (each toggle follows the others). `onChange(lang)` after a change.
export function langToggle({ onChange = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'zh-lang';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Language of meanings and translations');
  wrap.title = 'Meanings and translations in Spanish or English';
  wrap.append(icon('language'));
  const buttons = Object.entries(LANGS).map(([code, name]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = code.toUpperCase();
    b.title = name;
    b.dataset.lang = code;
    b.onclick = () => { if (code !== zhLang()) setZhLang(code); };
    return b;
  });
  wrap.append(...buttons);
  let shown = null;
  const sync = () => {
    const lang = zhLang();
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    if (shown && shown !== lang) onChange?.(lang);
    shown = lang;
  };
  const listener = () => { if (!wrap.isConnected && shown) return globalThis.removeEventListener('zh-settings', listener); sync(); };
  globalThis.addEventListener('zh-settings', listener);
  sync();
  return wrap;
}
