import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const windowTarget = new EventTarget();
globalThis.window = windowTarget;
globalThis.document = new EventTarget();
globalThis.FileReader = class {
  async readAsDataURL(blob) {
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
    this.onload();
  }
};

const { download, isAppleMobile, shareableFile } = await import('./download.js');

function withEnv(overrides, fn) {
  const saved = {
    ReactNativeWebView: window.ReactNativeWebView,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    document: globalThis.document,
    URL_create: URL.createObjectURL,
    URL_revoke: URL.revokeObjectURL,
    File: globalThis.File,
  };
  const restore = () => {
    window.ReactNativeWebView = saved.ReactNativeWebView;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
    else delete globalThis.navigator;
    globalThis.document = saved.document;
    URL.createObjectURL = saved.URL_create;
    URL.revokeObjectURL = saved.URL_revoke;
    globalThis.File = saved.File;
  };
  return (async () => {
    try {
      if ('navigator' in overrides) {
        Object.defineProperty(globalThis, 'navigator', {
          value: overrides.navigator,
          configurable: true,
        });
      }
      if ('document' in overrides) globalThis.document = overrides.document;
      if ('URL_create' in overrides) URL.createObjectURL = overrides.URL_create;
      if ('URL_revoke' in overrides) URL.revokeObjectURL = overrides.URL_revoke;
      if ('File' in overrides) globalThis.File = overrides.File;
      if ('ReactNativeWebView' in overrides) window.ReactNativeWebView = overrides.ReactNativeWebView;
      return await fn();
    } finally {
      restore();
    }
  })();
}

function makeMockDoc() {
  const appended = [];
  const created = [];
  const body = {
    appended,
    appendChild(el) {
      appended.push(el);
      el._parent = body;
      return el;
    },
  };
  const doc = {
    body,
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        children: [],
        listeners: {},
        append(...kids) {
          this.children.push(...kids);
        },
        appendChild(k) {
          this.children.push(k);
          return k;
        },
        setAttribute() {},
        addEventListener(type, fn) {
          (this.listeners[type] ||= []).push(fn);
        },
        remove() {
          this.removed = true;
        },
        click() {
          this.clicked = true;
          this.wasConnectedOnClick = Boolean(this._parent);
        },
      };
      if (tag === 'dialog') {
        el.showModal = () => {
          el.open = true;
        };
        el.close = () => {
          el.open = false;
        };
      }
      created.push(el);
      return el;
    },
  };
  return { doc, body, created };
}

test('Expo download transfers exact bytes, waits for the share sheet, and propagates failures', async () => {
  let request;
  window.ReactNativeWebView = {
    postMessage(data) {
      request = JSON.parse(data);
    },
  };
  let complete = false;
  const operation = download(new Uint8Array([0, 1, 128, 255]), 'Note.noteful', 'application/octet-stream').then((result) => {
    complete = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(complete, false);
  assert.equal(request.type, 'noteful-export');
  assert.deepEqual([...Buffer.from(request.base64, 'base64')], [0, 1, 128, 255]);
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'noteful-export-result', id: request.id }) }));
  assert.deepEqual(await operation, { shared: true });
  const failure = download('abc', 'Note.nfedit', 'application/json');
  await new Promise((resolve) => setImmediate(resolve));
  document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'noteful-export-result', id: request.id, error: 'No storage' }) }));
  await assert.rejects(failure, /No storage/);
  window.ReactNativeWebView = undefined;
});

test('isAppleMobile and shareableFile handle iOS/iPadOS Safari MIME rules', () => {
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)' }), true);
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 }), false);

  const accepted = [];
  const nav = {
    canShare({ files }) {
      accepted.push(files[0].type);
      return files[0].type === 'application/octet-stream';
    },
  };
  const f = shareableFile(new Blob(['# Hi'], { type: 'text/markdown' }), 'notes.md', nav);
  assert.ok(f);
  assert.equal(f.type, 'application/octet-stream');
  assert.deepEqual(accepted, ['text/markdown', 'application/octet-stream']);
});

test('iOS export shares via Web Share sheet, reports cancel, and offers fresh-tap modal when gesture expired', async () => {
  const { doc, created } = makeMockDoc();
  const sharedPayloads = [];
  let shareBehavior = 'ok';
  const nav = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    canShare: () => true,
    async share(payload) {
      sharedPayloads.push(payload);
      if (shareBehavior === 'abort') throw Object.assign(Error('cancelled'), { name: 'AbortError' });
      if (shareBehavior === 'not-allowed') throw Object.assign(Error('expired'), { name: 'NotAllowedError' });
    },
  };
  await withEnv(
    {
      ReactNativeWebView: undefined,
      navigator: nav,
      document: doc,
      URL_create: () => 'blob:ios-test',
      URL_revoke: () => {},
    },
    async () => {
      // 1. Direct Web Share works
      assert.deepEqual(await download(new Uint8Array([1, 2]), 'Exam.noteful', 'application/octet-stream'), { shared: true });
      assert.equal(sharedPayloads[0].files[0].name, 'Exam.noteful');

      // 2. AbortError returns { shared: false, cancelled: true } without broken fallback download
      shareBehavior = 'abort';
      assert.deepEqual(await download(new Uint8Array([1, 2]), 'Exam.noteful', 'application/octet-stream'), { shared: false, cancelled: true });
      assert.equal(created.filter((e) => e.tagName === 'A').length, 0);

      // 3. NotAllowedError after async prep shows top-layer modal; clicking Save / Share runs fresh share
      shareBehavior = 'not-allowed';
      const pendingExport = download(new Uint8Array([1, 2]), 'Exam.noteful', 'application/octet-stream');
      await new Promise((resolve) => setImmediate(resolve));
      const dialogEl = created.find((e) => e.tagName === 'DIALOG');
      assert.ok(dialogEl?.open);
      const findShareBtn = (node) => {
        if (node.tagName === 'BUTTON' && node.textContent === 'Save / Share') return node;
        for (const c of node.children || []) {
          const hit = findShareBtn(c);
          if (hit) return hit;
        }
        return null;
      };
      const shareBtn = findShareBtn(dialogEl);
      assert.ok(shareBtn);
      shareBehavior = 'ok';
      shareBtn.onclick();
      assert.deepEqual(await pendingExport, { shared: true });
    },
  );
});

test('desktop browser download attaches link to body before clicking', async () => {
  const { doc, created } = makeMockDoc();
  await withEnv(
    {
      ReactNativeWebView: undefined,
      navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 },
      document: doc,
      URL_create: () => 'blob:desktop-test',
      URL_revoke: () => {},
    },
    async () => {
      const res = await download('hello', 'note.txt', 'text/plain');
      assert.deepEqual(res, { shared: false });
      const a = created.find((e) => e.tagName === 'A');
      assert.ok(a?.clicked);
      assert.equal(a.wasConnectedOnClick, true);
      assert.equal(a.removed, true);
    },
  );
});
