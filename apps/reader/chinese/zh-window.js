// The windows of Chinese mode (the character panel, the convert and vocabulary dialogs, writing
// practice): the kit's movable window on a computer, a bottom sheet on a phone (CSS .zh-sheet),
// and inside an open modal dialog (a study card) when opened from one, so it shows over it.
import { movableWindow } from '../prefabs/kit/window.js';

export const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 600px), (max-height: 500px) and (orientation: landscape)').matches;
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
  win = movableWindow({ key, title, width, minWidth: 280, minHeight: 160, className: `zh-window ${isPhone() ? 'zh-sheet' : ''} ${className}`.trim(), onClose: close });
  if (height) win.el.style.setProperty('--zh-max', `${height}px`);
  const host = modalHost(near);
  if (host) host.append(win.el);
  return { ...win, close };
}
