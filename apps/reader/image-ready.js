// An image loaded from `src`, ready to draw on a canvas. Safari's img.decode() can reject for
// SVG pictures that load and draw fine (a WebKit bug), which made inserting a prefab fail on
// iPad: the load event decides, and decode() is only a hint.
export function imageReady(img, src) {
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error('The picture could not be drawn.'));
  });
  img.src = src;
  return loaded.then(() => (typeof img.decode === 'function' ? img.decode().catch(() => {}) : null)).then(() => img);
}
