import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from './vendor/qrcode/qrcode.mjs';
import jsQR from './vendor/jsqr/jsqr.mjs';
import { canScanQr, openCameraStream, createQrDetector, scanQrFrames } from './qr-scan.js';

function restoreProperty(obj, key, desc) {
  if (desc) Object.defineProperty(obj, key, desc);
  else delete obj[key];
}

test('canScanQr reflects mediaDevices.getUserMedia regardless of BarcodeDetector', () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const bdDesc = Object.getOwnPropertyDescriptor(globalThis, 'BarcodeDetector');
  try {
    delete globalThis.BarcodeDetector;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => ({}) } },
    });
    assert.equal(canScanQr(), true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    assert.equal(canScanQr(), false);
  } finally {
    restoreProperty(globalThis, 'navigator', navDesc);
    restoreProperty(globalThis, 'BarcodeDetector', bdDesc);
  }
});

test('openCameraStream falls back to plain video constraint and maps permission errors', async () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    const calls = [];
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async (constraints) => {
            calls.push(constraints);
            if (calls.length === 1) {
              const err = new Error('Overconstrained');
              err.name = 'OverconstrainedError';
              throw err;
            }
            return fakeStream;
          },
        },
      },
    });
    assert.equal(await openCameraStream(), fakeStream);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { audio: false, video: true });

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('Denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      },
    });
    await assert.rejects(openCameraStream(), /Camera permission was denied/);
  } finally {
    restoreProperty(globalThis, 'navigator', navDesc);
  }
});

test('vendored jsqr decodes a QR payload without BarcodeDetector', async () => {
  const payload = 'notecomplete-test-qr-payload-v1';
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const scale = 4;
  const quiet = 4;
  const side = (count + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < count && my < count && qr.isDark(my, mx);
      const v = dark ? 0 : 255;
      const idx = (y * side + x) * 4;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  const decoded = jsQR(rgba, side, side, { inversionAttempts: 'dontInvert' });
  assert.equal(decoded?.data, payload);

  const bdDesc = Object.getOwnPropertyDescriptor(globalThis, 'BarcodeDetector');
  const docDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    delete globalThis.BarcodeDetector;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: rgba, width: side, height: side }),
      }),
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: (tag) => (tag === 'canvas' ? fakeCanvas : null) },
    });
    const detector = await createQrDetector();
    const hits = await detector.detect({ videoWidth: side, videoHeight: side });
    assert.deepEqual(hits, [{ rawValue: payload }]);

    // Even if BarcodeDetector exists, unsupported qr_code falls back cleanly to jsQR.
    globalThis.BarcodeDetector = class UnsupportedDetector {
      static async getSupportedFormats() { return ['ean_13']; }
    };
    const fallbackDetector = await createQrDetector();
    assert.deepEqual(await fallbackDetector.detect({ videoWidth: side, videoHeight: side }), [{ rawValue: payload }]);

    // Supported native BarcodeDetector is used when present.
    globalThis.BarcodeDetector = class NativeDetector {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return [{ rawValue: 'NATIVE-QR' }]; }
    };
    const nativeDetector = await createQrDetector();
    assert.deepEqual(await nativeDetector.detect({}), [{ rawValue: 'NATIVE-QR' }]);
  } finally {
    restoreProperty(globalThis, 'BarcodeDetector', bdDesc);
    restoreProperty(globalThis, 'document', docDesc);
  }
});

test('scanQrFrames captures frames, updates status and stops camera tracks on completion', async () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const bdDesc = Object.getOwnPropertyDescriptor(globalThis, 'BarcodeDetector');
  const docDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let stopped = 0;
  let removed = false;
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() { stopped++; } }],
          }),
        },
      },
    });
    globalThis.BarcodeDetector = class SeqDetector {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return ++calls === 2 ? [{ rawValue: 'FRAME-OK' }] : []; }
    };
    const fakeEl = (tag) => ({
      tagName: tag.toUpperCase(),
      isConnected: true,
      children: [],
      style: {},
      className: '',
      hidden: false,
      textContent: '',
      closest() { return null; },
      setAttribute() {},
      replaceChildren(...nodes) { this.children = nodes; },
      append(...nodes) { this.children.push(...nodes); },
      after() {},
      remove() { removed = true; },
      play: async () => {},
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: fakeEl,
        createElementNS: (_ns, tag) => fakeEl(tag),
      },
    });
    const statusEl = fakeEl('p');
    const result = await scanQrFrames((raw) => ({ done: true, value: raw }), statusEl);
    assert.equal(result, 'FRAME-OK');
    assert.equal(stopped, 1);
    assert.equal(removed, true);
  } finally {
    restoreProperty(globalThis, 'navigator', navDesc);
    restoreProperty(globalThis, 'BarcodeDetector', bdDesc);
    restoreProperty(globalThis, 'document', docDesc);
  }
});

test('scanQrFrames stops camera tracks immediately when enclosing dialog closes', async () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const bdDesc = Object.getOwnPropertyDescriptor(globalThis, 'BarcodeDetector');
  const docDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let stopped = 0;
  let removed = false;
  const closeListeners = new Set();
  const dialog = {
    open: true,
    addEventListener(type, fn) { if (type === 'close') closeListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'close') closeListeners.delete(fn); },
    close() {
      this.open = false;
      for (const fn of [...closeListeners]) fn();
    },
  };
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() { stopped++; } }],
          }),
        },
      },
    });
    let calls = 0;
    globalThis.BarcodeDetector = class NeverDetector {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() {
        calls += 1;
        if (calls === 2) dialog.close();
        return [];
      }
    };
    const fakeEl = (tag) => ({
      tagName: tag.toUpperCase(),
      isConnected: true,
      children: [],
      style: {},
      className: '',
      hidden: false,
      textContent: '',
      closest(sel) { return sel === 'dialog' ? dialog : null; },
      setAttribute() {},
      replaceChildren(...nodes) { this.children = nodes; },
      append(...nodes) { this.children.push(...nodes); },
      after() {},
      remove() { removed = true; },
      play: async () => {},
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: fakeEl,
        createElementNS: (_ns, tag) => fakeEl(tag),
      },
    });
    await assert.rejects(
      () => scanQrFrames(() => null, fakeEl('p'), { timeoutMs: 10_000 }),
      /Camera scan stopped/,
    );
    assert.ok(stopped >= 1);
    assert.equal(removed, true);
    assert.equal(closeListeners.size, 0);
  } finally {
    restoreProperty(globalThis, 'navigator', navDesc);
    restoreProperty(globalThis, 'BarcodeDetector', bdDesc);
    restoreProperty(globalThis, 'document', docDesc);
  }
});
