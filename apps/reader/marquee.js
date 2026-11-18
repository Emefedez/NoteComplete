// Names cut short with an ellipsis (documents beside the note, tabs, archive entries) slide
// while hovered to show their end, and slide back when the pointer leaves. Only names that
// overflow move; with reduced motion asked for, nothing moves (the full name stays in the
// title). Markup: the name has class "marquee"; hovering its row (class "marquee-host", or
// the name itself) starts it. The text is wrapped in a .marquee-text span the first time.
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
    return host ? (host.classList.contains('marquee') ? host : host.querySelector('.marquee')) : null;
  };
  const inner = (el) => {
    let span = el.firstElementChild;
    if (!span || !span.classList.contains('marquee-text') || el.childNodes.length !== 1) {
      span = doc.createElement('span');
      span.className = 'marquee-text';
      span.textContent = el.textContent;
      el.replaceChildren(span);
    }
    return span;
  };
  let active = null;
  const stop = (el) => {
    const span = el.querySelector(':scope > .marquee-text');
    if (span) span.style.transform = '';
    // Back to plain text, so the ellipsis shows again.
    const done = () => { el.classList.remove('sliding'); const s = el.querySelector(':scope > .marquee-text'); if (s && el.childNodes.length === 1) el.textContent = s.textContent; };
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
