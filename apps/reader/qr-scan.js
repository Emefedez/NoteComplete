// Reads one or a progressive sequence of QR codes with the camera (`BarcodeDetector`),
// updating live progress so both invite links and multi-frame `NCQR1` transfers work seamlessly.

let cameraPermissionId = 0;

function requestNativeCameraPermission() {
  if (!window.ReactNativeWebView) return Promise.resolve(true);
  const id = ++cameraPermissionId;
  return new Promise((resolve) => {
    const onMessage = (event) => {
      let message;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (message?.type !== 'notecomplete-camera-permission-result' || message.id !== id) return;
      cleanup();
      resolve(!!message.granted);
    };
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); resolve(true); }, 10000);
    window.addEventListener('message', onMessage);
    document.addEventListener('message', onMessage);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'notecomplete-camera-permission', id }));
  });
}

/**
 * Scans QR frames until `onCode(rawValue, helpers)` returns a truthy result `{ done: true, value }`
 * or the user cancels / times out.
 */
export async function scanQrFrames(onCode, statusEl, { initialText = 'Point the camera at the QR code…', timeoutMs = 120000 } = {}) {
  if (!('BarcodeDetector' in globalThis)) {
    throw Error('QR camera detection is not supported in this browser or Android WebView. Use file import or copy/paste the link instead.');
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const allowed = await requestNativeCameraPermission();
  if (!allowed) {
    throw Error('Camera permission was denied. Enable Camera access for NoteComplete in Android settings, or import a file instead.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    throw Error('The camera is not available (allow camera permission, or import a file instead).');
  }
  const wrap = document.createElement('div');
  wrap.className = 'qr-scan-live';
  const progress = document.createElement('progress');
  progress.className = 'qr-progress-bar';
  progress.hidden = true;
  const slotsBar = document.createElement('div');
  slotsBar.className = 'qr-slot-strip';
  slotsBar.hidden = true;
  const skipAlert = document.createElement('p');
  skipAlert.className = 'qr-skip-note';
  skipAlert.hidden = true;
  const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
  video.style.cssText = 'width:100%;max-height:260px;border-radius:8px;background:#000;margin:6px 0';
  let cancelled = false;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Stop camera';
  cancelBtn.onclick = () => { cancelled = true; };
  wrap.append(progress, slotsBar, skipAlert, video, cancelBtn);
  statusEl.textContent = initialText;
  statusEl.after(wrap);
  await video.play();
  const helpers = {
    setProgress(text, received, total, details = null) {
      statusEl.textContent = text;
      if (total && total > 1) {
        progress.hidden = false;
        progress.max = total;
        progress.value = received;
      } else {
        progress.hidden = true;
      }
      if (total && total > 1 && total <= 96 && Array.isArray(details?.receivedSlots)) {
        const filled = new Set(details.receivedSlots);
        const skipped = new Set(details.skipped || []);
        if (slotsBar.children.length !== total) {
          slotsBar.replaceChildren(...Array.from({ length: total }, () => document.createElement('span')));
        }
        slotsBar.hidden = false;
        for (let i = 0; i < total; i++) {
          const cell = slotsBar.children[i];
          const slotNum = i + 1;
          cell.className = filled.has(slotNum) ? 'is-filled' : skipped.has(slotNum) ? 'is-skipped' : '';
        }
      } else {
        slotsBar.hidden = true;
      }
      const skipped = details?.skipped || [];
      if (skipped.length) {
        skipAlert.hidden = false;
        const preview = skipped.slice(0, 6).map((n) => `#${n}`).join(', ') + (skipped.length > 6 ? ` (+${skipped.length - 6} more)` : '');
        skipAlert.textContent = `Skipped segment${skipped.length === 1 ? '' : 's'} ${preview} — keeping slot${skipped.length === 1 ? '' : 's'} empty until it cycles back.`;
      } else {
        skipAlert.hidden = true;
      }
    },
  };
  try {
    const deadline = Date.now() + timeoutMs;
    while (!cancelled && Date.now() < deadline) {
      const [code] = await detector.detect(video).catch(() => []);
      if (code?.rawValue) {
        const res = await onCode(code.rawValue, helpers);
        if (res?.done) return res.value;
      }
      await new Promise((r) => setTimeout(r, 140));
    }
    throw Error(cancelled ? 'Camera scan stopped.' : 'QR transfer did not finish in time. Move closer or pause on missing frames.');
  } finally {
    for (const track of stream.getTracks()) track.stop();
    wrap.remove();
  }
}

/** Legacy single-QR helper returning the first detected QR string. */
export async function scanQr(statusEl) {
  return scanQrFrames(
    (raw) => ({ done: true, value: raw }),
    statusEl,
    { initialText: 'Point the camera at the QR code on the other computer…', timeoutMs: 60000 },
  );
}
