// Decodes HEIC photos (an iPhone's camera) for heic.js, off the main thread: libheif
// (vendor/libheif, LGPL-3.0) decodes the photo, and an OffscreenCanvas encodes it as a JPEG
// the browser can show. Message in: { id, bytes }; out: { id, blob, width, height } or
// { id, error }.
let lib = null;
async function library() {
  if (!lib) {
    const { default: factory } = await import('./vendor/libheif/libheif-bundle.mjs');
    lib = factory();
    if (lib.ready) await lib.ready;
  }
  return lib;
}
self.onmessage = async ({ data: { id, bytes } }) => {
  try {
    const heif = await library();
    const decoder = new heif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(bytes));
    if (!images?.length) throw Error('No picture in this HEIC file');
    // The primary picture (a HEIC may hold a burst or a depth map after it).
    const image = images[0];
    const width = image.get_width(), height = image.get_height();
    const pixels = await new Promise((resolve, reject) => image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => (out ? resolve(out) : reject(Error('Could not decode this HEIC photo')))));
    for (const img of images) img.free?.();
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').putImageData(new ImageData(pixels.data, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    self.postMessage({ id, blob, width, height });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
