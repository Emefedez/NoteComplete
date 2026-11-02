// Encodes PDF page rasters to PNG away from the page's main thread (pdf-background.js): the
// page sends an ImageBitmap of what pdf.js drew and gets a Blob back. Encoding a full page
// takes 60–100 ms, which would otherwise hold up pen strokes and scrolling.
onmessage = async ({ data: { id, bitmap } }) => {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (error) {
    bitmap?.close?.();
    postMessage({ id, error: String(error) });
  }
};
