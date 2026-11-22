// Scrolling by fractions of a pixel. A scroll position set from script is kept in whole CSS
// pixels (Chromium rounds scrollLeft/scrollTop), so a drag or a glide moved in 1 px steps:
// 2 device pixels on a 2× screen, and at 120 or 144 Hz a slow pan advanced on some frames and
// not others (1, 1, 1, 2 px), where the browser's own scrolling moves by device pixels.
// Here the scroller takes the whole pixels and the content is shifted by what is left over,
// with a transform on its own layer while it moves; end() puts it back (at most half a pixel).
export function fractionalScroller(scroller, content) {
  let exact = null; // [left, top] the content shows while it moves
  function show(left, top) {
    scroller.scrollLeft = left;
    scroller.scrollTop = top;
    const sx = scroller.scrollLeft, sy = scroller.scrollTop;
    // At an edge the scroller stops short by more than the rounding: nothing to shift there.
    const fx = Math.abs(sx - left) < 1, fy = Math.abs(sy - top) < 1;
    const dx = fx ? sx - left : 0, dy = fy ? sy - top : 0;
    exact = [fx ? left : sx, fy ? top : sy];
    content.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
  }
  return {
    // Before a pan: the content gets its own layer now, so the first move does not wait for it.
    begin() {
      exact = null;
      content.style.willChange = "transform";
    },
    // Show the scroll position (left, top), fractions included.
    to(left, top) {
      if (!content.style.willChange) content.style.willChange = "transform";
      show(left, top);
    },
    // Move by (dx, dy) from where it shows; false once nothing moved (an edge).
    by(dx, dy) {
      const [left, top] = exact ?? [scroller.scrollLeft, scroller.scrollTop];
      this.to(left + dx, top + dy);
      return Math.abs(exact[0] - left) > 1e-6 || Math.abs(exact[1] - top) > 1e-6;
    },
    // Back to whole pixels and no layer of its own.
    end() {
      exact = null;
      content.style.transform = "";
      content.style.willChange = "";
    },
    get exact() { return exact; },
  };
}
