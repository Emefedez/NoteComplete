// Bridges native stylus hover events (injected by the Android host when RNCWebView/WebView
// drops hardware ACTION_HOVER_* events) into standard DOM PointerEvents so pen detection,
// finger-pan while hovering, tooltips, hover ring, and the pen test dialog work uniformly.

/**
 * Installs `window.__notecompleteNativeHover(phase, x, y, pointerType, distance)` and
 * returns a teardown function. Dedupes against trusted browser pen hover events.
 */
export function installNativeHoverBridge({
  globalObj = globalThis,
  win = globalThis.window,
  doc = globalThis.document,
  now = () => (globalThis.performance?.now ? performance.now() : Date.now()),
  dedupeMs = 120,
} = {}) {
  if (!win || !doc || typeof globalObj.PointerEvent !== 'function') {
    return () => {};
  }

  let lastTrustedHoverAt = -Infinity;
  let hoverTarget = null;

  const onTrustedPenHover = (e) => {
    if (e?.isTrusted && e.pointerType === 'pen' && !e.buttons) {
      lastTrustedHoverAt = now();
    }
  };
  win.addEventListener('pointermove', onTrustedPenHover, { capture: true, passive: true });
  win.addEventListener('pointerover', onTrustedPenHover, { capture: true, passive: true });

  const fire = (target, type, init) => {
    if (!target || typeof target.dispatchEvent !== 'function') return;
    target.dispatchEvent(new globalObj.PointerEvent(type, {
      bubbles: true,
      cancelable: type !== 'pointerover' && type !== 'pointerout',
      composed: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: init.pointerType || 'pen',
      clientX: init.x,
      clientY: init.y,
      button: -1,
      buttons: 0,
      pressure: 0,
      width: 1,
      height: 1,
      relatedTarget: init.relatedTarget ?? null,
    }));
  };

  const bridge = (phase, x, y, pointerType = 'pen', _distance = 0) => {
    const cx = Number(x);
    const cy = Number(y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
    if (phase === 'move' && now() - lastTrustedHoverAt < dedupeMs) return false;

    const target = phase === 'exit'
      ? hoverTarget
      : (doc.elementFromPoint?.(cx, cy) || doc.body || doc.documentElement);

    if (phase === 'exit') {
      if (hoverTarget) {
        fire(hoverTarget, 'pointerout', { x: cx, y: cy, pointerType, relatedTarget: null });
        hoverTarget = null;
      }
      return true;
    }

    if (target && target !== hoverTarget) {
      if (hoverTarget) fire(hoverTarget, 'pointerout', { x: cx, y: cy, pointerType, relatedTarget: target });
      const prev = hoverTarget;
      hoverTarget = target;
      fire(target, 'pointerover', { x: cx, y: cy, pointerType, relatedTarget: prev });
    }
    if (target) {
      fire(target, 'pointermove', { x: cx, y: cy, pointerType });
    }
    return true;
  };

  globalObj.__notecompleteNativeHover = bridge;
  return () => {
    win.removeEventListener('pointermove', onTrustedPenHover, { capture: true });
    win.removeEventListener('pointerover', onTrustedPenHover, { capture: true });
    if (globalObj.__notecompleteNativeHover === bridge) delete globalObj.__notecompleteNativeHover;
    hoverTarget = null;
  };
}
