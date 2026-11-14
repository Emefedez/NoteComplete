// Back and forward navigation history for a reader tab (mouse buttons 3 and 4,
// BrowserBack / BrowserForward keys, and Alt+Left / Alt+Right).
// Tracks in-note page jumps, Home <-> Document transitions, and document switches.

export function sameStop(a, b) {
  if (!a || !b || a.view !== b.view) return false;
  if (a.view === 'home') return (a.folderId || null) === (b.folderId || null);
  return (a.key || '') === (b.key || '') && (a.page ?? 0) === (b.page ?? 0);
}

export class NavHistory {
  constructor(limit = 64) {
    this.limit = limit;
    this.backStack = [];
    this.forwardStack = [];
    this. navigating = false;
  }

  // Record the current stop before moving to `next`.
  record(current, next) {
    if (this.navigating || !current) return;
    if (next && sameStop(current, next)) return;
    const prev = this.backStack.at(-1);
    if (!prev || !sameStop(prev, current)) {
      this.backStack.push({ ...current });
      if (this.backStack.length > this.limit) this.backStack.shift();
    } else {
      this.backStack[this.backStack.length - 1] = { ...current };
    }
    this.forwardStack.length = 0;
  }

  get canBack() {
    return this.backStack.length > 0;
  }

  get canForward() {
    return this.forwardStack.length > 0;
  }

  back(current) {
    while (this.backStack.length) {
      const target = this.backStack.pop();
      if (current && sameStop(target, current)) continue;
      if (current) {
        const top = this.forwardStack.at(-1);
        if (!top || !sameStop(top, current)) this.forwardStack.push({ ...current });
      }
      return target;
    }
    return null;
  }

  forward(current) {
    while (this.forwardStack.length) {
      const target = this.forwardStack.pop();
      if (current && sameStop(target, current)) continue;
      if (current) {
        const top = this.backStack.at(-1);
        if (!top || !sameStop(top, current)) this.backStack.push({ ...current });
      }
      return target;
    }
    return null;
  }

  clear() {
    this.backStack.length = 0;
    this.forwardStack.length = 0;
  }
}

// Mouse button 3 is Browser Back; button 4 is Browser Forward.
export function mouseNavDirection(event) {
  if (!event) return 0;
  if (event.button === 3) return -1;
  if (event.button === 4) return 1;
  return 0;
}

// Keyboard Back / Forward: dedicated BrowserBack / BrowserForward keys, or Alt+ArrowLeft / Alt+ArrowRight.
export function keyNavDirection(event) {
  if (!event) return 0;
  if (event.key === 'BrowserBack') return -1;
  if (event.key === 'BrowserForward') return 1;
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === 'ArrowLeft') return -1;
    if (event.key === 'ArrowRight') return 1;
  }
  return 0;
}
