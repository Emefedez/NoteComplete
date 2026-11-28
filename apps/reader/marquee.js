// Names cut short with an ellipsis (documents beside the note, tabs, archive entries) slide
// while hovered to show their end, and slide back when the pointer leaves. Only names that
// overflow move; with reduced motion asked for, nothing moves (the full name stays in the
// title). Markup: the name has class "marquee"; hovering its row (class "marquee-host", or
// the name itself) starts it. The text is wrapped in a .marquee-text span the first time.
// Any other text cut short the same way (one line, overflow hidden, an ellipsis: scratchpad
// titles, dialog headings, list rows…) slides too, found under the pointer (`truncated`).
export const slideDistance = (scrollWidth, clientWidth) => Math.max(0, Math.ceil(scrollWidth - clientWidth));
// Seconds for `distance` pixels: about 70 px a second, never shorter than 0.6 s.
export const slideSeconds = (distance) => Math.max(0.6, distance / 70);

export function installMarquee(doc = globalThis.document) {
  const win = doc?.defaultView;
  if (!win || doc.documentElement.dataset.marquee) return;
  doc.documentElement.dataset.marquee = '1';
  const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const nameOf = (target) => {
    const host = target?.closest?.('.marquee-host, .marquee');
    if (host) return host.classList.contains('marquee') ? host : host.querySelector('.marquee');
    // Already sliding (its ellipsis is off then, so it no longer looks cut short).
    return target?.closest?.('.marquee-auto') || truncated(target, win);
  };
  // Named ones keep only their text; others keep their own children (icons, links) inside.
  const inner = (el) => {
    let span = el.firstElementChild;
    if (!span || !span.classList.contains('marquee-text') || el.childNodes.length !== 1) {
      span = doc.createElement('span');
      span.className = 'marquee-text';
      if (el.classList.contains('marquee')) span.textContent = el.textContent;
      else span.append(...el.childNodes);
      el.replaceChildren(span);
    }
    return span;
  };
  const unwrap = (el) => {
    const s = el.querySelector(':scope > .marquee-text');
    if (!s || el.childNodes.length !== 1) return;
    if (el.classList.contains('marquee')) el.textContent = s.textContent;
    else el.replaceChildren(...s.childNodes);
  };
  let active = null;
  const stop = (el) => {
    const span = el.querySelector(':scope > .marquee-text');
    if (span) span.style.transform = '';
    // Back to plain text, so the ellipsis shows again.
    const done = () => { el.classList.remove('sliding', 'marquee-auto'); unwrap(el); };
    if (!span || reduced()) done(); else setTimeout(() => { if (active !== el) done(); }, slideSeconds(slideDistance(el.scrollWidth, el.clientWidth)) * 1000);
  };
  doc.addEventListener('pointerover', (e) => {
    const el = nameOf(e.target);
    if (el === active) return;
    if (active) stop(active);
    active = el;
    if (!el || reduced() || e.pointerType === 'touch') return;
    // After the row has laid out its hover state (buttons that appear on hover).
    win.requestAnimationFrame(() => {
      if (active !== el) return;
      const distance = slideDistance(el.scrollWidth, el.clientWidth);
      if (!distance) return;
      if (!el.classList.contains('marquee')) el.classList.add('marquee-auto');
      const span = inner(el);
      el.classList.add('sliding');
      el.style.setProperty('--slide', `${slideSeconds(distance)}s`);
      span.style.transform = `translateX(${-distance}px)`;
    });
  });
  doc.addEventListener('pointerout', (e) => {
    if (!active || (e.relatedTarget && nameOf(e.relatedTarget) === active)) return;
    stop(active);
    active = null;
  });
}

// The text under `target` (it or one of a few parents) that is cut short on one line with an
// ellipsis, or null. Editable text, form fields and text cut over several lines (line clamps)
// are left alone.
export function truncated(target, win = globalThis) {
  let el = target?.nodeType === 1 ? target : target?.parentElement;
  for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
    if (el.matches?.('input, textarea, select, [contenteditable], [contenteditable] *, svg, svg *, canvas, .TinyMDE, .TinyMDE *')) return null;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const css = win.getComputedStyle?.(el);
      if (css && css.textOverflow === 'ellipsis' && css.whiteSpace.startsWith('nowrap') && css.overflowX !== 'visible' && !/flex|grid/.test(css.display)) return el;
    }
  }
  return null;
}
