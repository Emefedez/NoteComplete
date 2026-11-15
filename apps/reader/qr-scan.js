// Reads one or a progressive sequence of QR codes with the camera, using native
// `BarcodeDetector` when available and falling back to offline `jsQR` frame decoding so
// desktop Electron and browsers without `BarcodeDetector` scan QR streams reliably.
import { icon } from './icons.js';

const MAX_SCAN_DIM = 960;
let cameraPermissionId = 0;
let jsQrLoading = null;

/** Whether the current environment exposes a camera capture API. */
export function canScanQr(nav = globalThis.navigator) {
  return Boolean(nav?.mediaDevices?.getUserMedia);
}

function defaultLoadJsQr() {
  return (jsQrLoading ||= import('./vendor/jsqr/jsqr.mjs').then((mod) => mod.default || mod));
}

function requestNativeCameraPermission() {
  const nativeBridge = globalThis.window?.ReactNativeWebView;
  if (!nativeBridge) return Promise.resolve(true);
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
      globalThis.window?.removeEventListener('message', onMessage);
      globalThis.document?.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); resolve(true); }, 10000);
    globalThis.window?.addEventListener('message', onMessage);
    globalThis.document?.addEventListener('message', onMessage);
    nativeBridge.postMessage(JSON.stringify({ type: 'notecomplete-camera-permission', id }));
  });
}

function formatCameraOpenError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return Error('Camera permission was denied (allow camera access, or import a file instead).');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return Error('No camera was found on this device (connect a camera, or import a file instead).');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return Error('The camera is busy in another app (close it there, or import a file instead).');
  }
  return Error('The camera is not available (allow camera permission, or import a file instead).');
}

/** Opens a video stream with rear-camera preference and falls back to any available webcam. */
export async function openCameraStream(mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.getUserMedia) {
    throw Error('The camera is not available on this device (import a file or paste the code instead).');
  }
  const preferred = {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  try {
    return await mediaDevices.getUserMedia(preferred);
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      throw formatCameraOpenError(err);
    }
    try {
      return await mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (fallbackErr) {
      throw formatCameraOpenError(fallbackErr);
    }
  }
}

/** Builds a detector using native `BarcodeDetector` when supported, else canvas + `jsQR`. */
export async function createQrDetector({ doc = globalThis.document, Detector = globalThis.BarcodeDetector, loadJsQr = defaultLoadJsQr } = {}) {
  if (typeof Detector === 'function') {
    try {
      const supported = typeof Detector.getSupportedFormats === 'function' ? await Detector.getSupportedFormats() : null;
      if (!Array.isArray(supported) || supported.includes('qr_code')) {
        return new Detector({ formats: ['qr_code'] });
      }
    } catch { /* Fall back to jsQR when native BarcodeDetector cannot initialize qr_code. */ }
  }
  const jsQR = await loadJsQr();
  let canvas = null;
  let ctx = null;
  return {
    async detect(video) {
      const srcWidth = Number(video?.videoWidth || 0);
      const srcHeight = Number(video?.videoHeight || 0);
      if (!srcWidth || !srcHeight) return [];
      const scale = Math.min(1, MAX_SCAN_DIM / Math.max(srcWidth, srcHeight));
      const width = Math.max(1, Math.round(srcWidth * scale));
      const height = Math.max(1, Math.round(srcHeight * scale));
      if (!canvas) {
        canvas = doc.createElement('canvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) return [];
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const frame = ctx.getImageData(0, 0, width, height);
      const decoded = jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
      return decoded?.data ? [{ rawValue: decoded.data }] : [];
    },
  };
}

/**
 * Scans QR frames until `onCode(rawValue, helpers)` returns a truthy result `{ done: true, value }`
 * or the user cancels / times out.
 */
export async function scanQrFrames(onCode, statusEl, { initialText = 'Point the camera at the QR code…', timeoutMs = 120000 } = {}) {
  const allowed = await requestNativeCameraPermission();
  if (!allowed) {
    const scope = globalThis.window?.ReactNativeWebView ? ' for NoteComplete in Android settings' : '';
    throw Error(`Camera permission was denied. Enable Camera access${scope}, or import a file instead.`);
  }
  const detector = await createQrDetector();
  const stream = await openCameraStream();
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
  const stopCamera = () => {
    cancelled = true;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* Already stopped. */ }
    }
  };
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.append(icon('stop'), 'Stop camera');
  cancelBtn.onclick = stopCamera;
  wrap.append(progress, slotsBar, skipAlert, video, cancelBtn);
  statusEl.textContent = initialText;
  statusEl.after(wrap);
  const parentDialog = wrap.closest('dialog');
  parentDialog?.addEventListener('close', stopCamera, { once: true });
  let etaStartedAt = 0;
  let etaStartCount = 0;
  try {
    await video.play();
    const helpers = {
      setProgress(text, received, total, details = null) {
        let displayText = text;
        if (total && total > 1 && received >= 1 && received < total) {
          if (!etaStartedAt) {
            etaStartedAt = Date.now();
            etaStartCount = received;
          } else if (received > etaStartCount) {
            const elapsedSec = (Date.now() - etaStartedAt) / 1000;
            if (elapsedSec >= 0.4 && !/\bleft\b/i.test(displayText)) {
              const rate = (received - etaStartCount) / elapsedSec;
              const remSec = Math.max(1, Math.ceil((total - received) / rate));
              const fmt = remSec < 60 ? `~${remSec}s` : `~${Math.floor(remSec / 60)}m${remSec % 60 ? ` ${remSec % 60}s` : ''}`;
              displayText = `${displayText} · ${fmt} left`;
            }
          }
        }
        statusEl.textContent = displayText;
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
    const deadline = Date.now() + timeoutMs;
    while (!cancelled && wrap.isConnected !== false && (!parentDialog || parentDialog.open) && Date.now() < deadline) {
      const [code] = await detector.detect(video).catch(() => []);
      if (cancelled || wrap.isConnected === false || (parentDialog && !parentDialog.open)) break;
      if (code?.rawValue) {
        const res = await onCode(code.rawValue, helpers);
        if (res?.done) return res.value;
      }
      await new Promise((r) => setTimeout(r, 140));
    }
    throw Error(cancelled || wrap.isConnected === false || (parentDialog && !parentDialog.open)
      ? 'Camera scan stopped.'
      : 'QR transfer did not finish in time. Move closer or pause on missing frames.');
  } finally {
    parentDialog?.removeEventListener('close', stopCamera);
    stopCamera();
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
