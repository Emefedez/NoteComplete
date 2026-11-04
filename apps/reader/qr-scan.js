// Reads a QR code with the camera (the browser's BarcodeDetector, where it exists), for the
// address a NoteComplete shows to receive study material. Resolves with the code's text.
export async function scanQr(status) {
  if (!('BarcodeDetector' in globalThis)) throw Error('This browser cannot read QR codes. Scan the code with the camera app instead, or type the address and PIN.');
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { throw Error('The camera is not available (allow it, or type the address and PIN).'); }
  const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
  video.style.cssText = 'width:100%;max-height:260px;border-radius:8px;background:#000;margin:6px 0';
  status.after(video);
  await video.play();
  try {
    const stop = Date.now() + 60000;
    while (Date.now() < stop) {
      const [code] = await detector.detect(video).catch(() => []);
      if (code?.rawValue) return code.rawValue;
      status.textContent = 'Point the camera at the QR code on the other computer…';
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error('No QR code found. Try again, or type the address and PIN.');
  } finally { for (const track of stream.getTracks()) track.stop(); video.remove(); }
}
