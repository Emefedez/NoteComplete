import test from 'node:test';
import assert from 'node:assert/strict';
import { largeRect, floatingWindow, windowOf } from './floating.js';
import { chatController, normalizeThreadMessages } from './chat.js';
import { allQuizzes } from './all-quizzes.js';

function makeDom(ids = []) {
  const byId = new Map();
  const makeClassList = (el) => {
    const tokens = () => new Set(String(el.className || '').split(/\s+/).filter(Boolean));
    return {
      add(...c) { const s = tokens(); c.forEach(x => x && s.add(x)); el.className = [...s].join(' '); },
      remove(...c) { const s = tokens(); c.forEach(x => s.delete(x)); el.className = [...s].join(' '); },
      contains(c) { return tokens().has(c); },
      toggle(c) { const s = tokens(); if (s.has(c)) s.delete(c); else s.add(c); el.className = [...s].join(' '); },
    };
  };
  function createEl(tag = 'div', ns = '') {
    const el = {
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns,
      id: '',
      hidden: false,
      open: false,
      value: '',
      checked: false,
      disabled: false,
      title: '',
      textContent: '',
      innerHTML: '',
      className: '',
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      childNodes: [],
      options: [],
      parentElement: null,
      offsetParent: null,
      focused: false,
      listeners: new Map(),
      setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'id') { this.id = String(v); byId.set(this.id, this); }
      },
      getAttribute(k) { return this.attributes[k] ?? null; },
      append(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'string') this.childNodes.push({ nodeType: 3, textContent: n });
          else if (n) {
            n.parentElement = this;
            this.childNodes.push(n);
            if (n.tagName) this.children.push(n);
          }
        }
      },
      prepend(...nodes) {
        for (const n of [...nodes].reverse()) {
          if (typeof n === 'string') this.childNodes.unshift({ nodeType: 3, textContent: n });
          else if (n) {
            n.parentElement = this;
            this.childNodes.unshift(n);
            if (n.tagName) this.children.unshift(n);
          }
        }
      },
      appendChild(n) { this.append(n); return n; },
      replaceChildren(...nodes) { this.children = []; this.childNodes = []; this.append(...nodes); },
      before(...nodes) {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 0, ...nodes);
      },
      after(...nodes) {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx + 1, 0, ...nodes);
      },
      add(opt) { this.options.push(opt); this.append(opt); },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      removeEventListener() {},
      closest() { return null; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const c of node.children || []) {
            if (matches(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      get lastElementChild() { return this.children.at(-1) || null; },
      get childElementCount() { return this.children.length; },
      getBoundingClientRect() {
        const l = parseFloat(this.style.left) || 0;
        const t = parseFloat(this.style.top) || 0;
        const w = parseFloat(this.style.width) || 380;
        const h = parseFloat(this.style.height) || 500;
        return { left: l, top: t, width: w, height: h };
      },
      focus() { this.focused = true; },
      scrollIntoView() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
    };
    el.classList = makeClassList(el);
    return el;
  }
  function matches(el, sel) {
    if (sel === 'svg') return el.tagName === 'SVG';
    if (sel === '*') return true;
    if (sel === '.chat-head strong') return el.tagName === 'STRONG' && el.parentElement?.classList.contains('chat-head');
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    if (sel.startsWith('[data-sec="')) {
      const m = /\[data-sec="([^"]+)"\]/.exec(sel);
      return m && el.dataset.sec === m[1];
    }
    if (sel === '[data-section-scope]') return 'sectionScope' in el.dataset;
    const opt = /^option\[value="([^"]+)"\]:not\(\[disabled\]\)$/.exec(sel);
    if (opt) return el.tagName === 'OPTION' && el.value === opt[1] && !el.disabled;
    if (sel === 'option:not([disabled])') return el.tagName === 'OPTION' && !el.disabled;
    return false;
  }
  for (const id of ids) {
    const el = createEl(id.endsWith('Dialog') ? 'dialog' : 'div');
    el.id = id;
    byId.set(id, el);
  }
  const body = createEl('body');
  const document = {
    body,
    implementation: {
      createHTMLDocument: () => ({
        createElement: (tag) => {
          const el = createEl(tag);
          Object.defineProperty(el, 'innerHTML', {
            set(v) {
              this._innerHTML = v;
              const p = createEl('p');
              p.textContent = String(v).replace(/<\/?[^>]+>/g, '');
              this.replaceChildren(p);
            },
            get() { return this._innerHTML || ''; },
          });
          return el;
        },
      }),
    },
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => { const el = createEl(tag); el.ownerDocument = document; return el; },
    createElementNS: (ns, tag) => { const el = createEl(tag, ns); el.ownerDocument = document; return el; },
    createDocumentFragment: () => createEl('fragment'),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    addEventListener() {},
  };
  for (const el of byId.values()) el.ownerDocument = document;
  return { document, byId, createEl };
}

async function withFakeGlobals(ids, fn) {
  const keys = ['document', 'localStorage', 'getComputedStyle', 'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'Option', 'innerWidth', 'innerHeight'];
  const saved = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const dom = makeDom(ids);
  const store = new Map();
  const observers = [];
  globalThis.document = dom.document;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  globalThis.getComputedStyle = (el) => ({
    position: el.classList.contains('screen-window') ? 'fixed' : 'absolute',
    top: '10px',
    bottom: 'auto',
    overflowY: 'visible',
  });
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 900;
  globalThis.Option = function Option(text, value) {
    const o = dom.createEl('option');
    o.textContent = text;
    o.value = value;
    return o;
  };
  globalThis.MutationObserver = class MutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    trigger() { this.cb(); }
  };
  try {
    return await fn({ ...dom, store, observers });
  } finally {
    for (const k of keys) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
}

test('largeRect fills most of the screen, centred, with no upper limit, and clamps safely', () => {
  assert.deepEqual(
    largeRect({ width: 1440, height: 900 }, { min: { width: 280, height: 220 } }),
    { left: 43, top: 27, width: 1354, height: 846 }, // 94 % of 1440 × 900
  );
  assert.deepEqual(
    largeRect({ width: 1600, height: 1000 }, { min: { width: 280, height: 220 } }),
    { left: 48, top: 30, width: 1504, height: 940 },
  );
  assert.deepEqual(
    largeRect({ width: 700, height: 500 }, { min: { width: 280, height: 220 } }),
    { left: 21, top: 15, width: 658, height: 470 },
  );
  // Smaller than min: area still wins.
  assert.deepEqual(
    largeRect({ width: 240, height: 180 }, { min: { width: 280, height: 220 } }),
    { left: 0, top: 0, width: 240, height: 180 },
  );
});

test('floatingWindow openLarge expands inside screen() without overwriting saved small rect', async () => {
  await withFakeGlobals(['panel', 'closeBtn'], ({ byId, createEl, store, observers }) => {
    const panel = byId.get('panel');
    panel.hidden = true;
    const head = createEl('div');
    const close = byId.get('closeBtn');
    head.append(close);
    panel.append(head);

    store.set('notecomplete-chat-window:screen', JSON.stringify({ left: 980, top: 20, width: 390, height: 520 }));
    const win = floatingWindow(panel, {
      key: 'notecomplete-chat-window',
      head,
      close,
      label: 'Ask AI',
      compact: { cls: 'compact' },
      minHeight: 220,
      screen: () => ({ left: 0, top: 48, width: 1440, height: 852 }),
    });

    assert.equal(windowOf(panel), win);
    win.openLarge();
    assert.equal(panel.hidden, false);
    assert.equal(win.large, true);
    assert.equal(panel.classList.contains('window-large'), true);
    assert.equal(panel.style.width, '1354px'); // round(1440 * 0.94)
    assert.equal(panel.style.height, '801px'); // round(852 * 0.94) = 801
    assert.equal(panel.style.left, '43px');
    assert.equal(panel.style.top, '74px'); // 48 + round((852 - 801) / 2) = 48 + 26

    // Saved small rect in localStorage was not overwritten.
    assert.deepEqual(JSON.parse(store.get('notecomplete-chat-window:screen')), { left: 980, top: 20, width: 390, height: 520 });

    // Closing resets large mode and restores saved small rect for the next normal open.
    panel.hidden = true;
    for (const o of observers) o.trigger();
    assert.equal(win.large, false);
    assert.equal(panel.classList.contains('window-large'), false);
    assert.equal(panel.style.width, '390px');
    assert.equal(panel.style.height, '520px');
  });
});

test('normalizeThreadMessages clones valid turns and falls back to Markdown', () => {
  const orig = [
    { role: 'user', content: 'What is a B-tree?' },
    { role: 'system', content: 'ignore me' },
    { role: 'assistant', content: '   ' },
    { role: 'assistant', content: 'A balanced search tree.' },
  ];
  const cloned = normalizeThreadMessages(orig);
  assert.deepEqual(cloned, [
    { role: 'user', content: 'What is a B-tree?' },
    { role: 'assistant', content: 'A balanced search tree.' },
  ]);
  cloned[0].content = 'mutated';
  assert.equal(orig[0].content, 'What is a B-tree?');

  assert.deepEqual(
    normalizeThreadMessages([], '**Q1?**\n\nAnswer one.\n\n**Q2?**\n\nAnswer two.'),
    [
      { role: 'user', content: 'Q1?' },
      { role: 'assistant', content: 'Answer one.' },
      { role: 'user', content: 'Q2?' },
      { role: 'assistant', content: 'Answer two.' },
    ],
  );
});

test('chatController.openThread displays full conversation big without calling AI and keeps conversation id', async () => {
  await withFakeGlobals(
    ['chatPanel', 'chatProvider', 'chatModel', 'chatModelOther', 'chatNoteLabel', 'chatNotes', 'chatPageLabel', 'chatPage', 'chatSelection', 'chatNote', 'chatInput', 'chatMessages', 'chatAttachments', 'chatForm', 'chatSend', 'chatStop', 'chatClear', 'chatClose'],
    async ({ byId, createEl }) => {
      const panel = byId.get('chatPanel');
      panel.hidden = true;
      const head = createEl('div');
      head.classList.add('chat-head');
      const strong = createEl('strong');
      const svg = createEl('svg', 'http://www.w3.org/2000/svg');
      strong.append(svg, 'Ask AI');
      head.append(strong);
      panel.append(head);

      const pageWrap = createEl('label');
      pageWrap.append(byId.get('chatPage'));
      const select = byId.get('chatProvider');
      select.add(new Option('Codex', 'codex'));

      let aiCalled = false;
      let largeCalls = 0;
      const kept = [];
      const win = {
        setLarge(on) { if (on) largeCalls++; },
        openLarge() { panel.hidden = false; largeCalls++; },
      };

      const chat = chatController({
        ai: {
          ask() { aiCalled = true; throw new Error('must not call AI'); },
          models: async () => [],
          cancel() {},
        },
        pageCanvas: async () => null,
        pageText: async () => '',
        documentInfo: () => ({ title: 'OS Notes', pages: 4, unit: 'page' }),
        currentPage: () => 0,
        selection: { item: null },
        notePath: () => '/tmp/note.pdf',
        status: () => {},
        providers: async () => [{ id: 'codex', label: 'Codex', available: true }],
        markdown: async (text) => `<p>${text}</p>`,
        toTextBox: () => {},
        notesText: async () => '',
        keep: (entry) => kept.push(entry),
        win,
      });

      await chat.openThread({
        id: 'conv-42',
        title: 'Virtual memory',
        messages: [
          { role: 'user', content: 'How do page tables work?' },
          { role: 'assistant', content: 'They map virtual pages to frames.' },
          { role: 'user', content: 'What about TLB?' },
          { role: 'assistant', content: 'A fast cache of translations.' },
        ],
        big: true,
      });

      assert.equal(aiCalled, false);
      assert.equal(panel.hidden, false);
      assert.ok(largeCalls >= 1);
      assert.equal(byId.get('chatInput').focused, true);
      assert.equal(strong.children[0], svg);
      assert.equal(strong.childNodes[1].textContent, 'Ask AI · Virtual memory');

      const bubbles = byId.get('chatMessages').children;
      assert.equal(bubbles.length, 4);
      assert.equal(bubbles[0].className, 'chat-user');
      assert.equal(bubbles[1].className, 'chat-assistant');
      assert.equal(bubbles[1].querySelector('.chat-body').children[0].textContent, 'They map virtual pages to frames.');

      // Scratchpad button under the 1st assistant answer snapshots up to turn 1 with the same id.
      const scratchBtns = bubbles[1].querySelectorAll('.scratch-keep');
      assert.equal(scratchBtns.length, 1);
      scratchBtns[0].onclick();
      assert.equal(kept.length, 1);
      assert.equal(kept[0].id, 'conv-42');
      assert.equal(kept[0].title, 'Virtual memory');
      assert.equal(kept[0].messages.length, 2);
    },
  );
});

test('allQuizzes renders Open in Ask AI on scratchpad items, closes dialog, and invokes callback', async () => {
  await withFakeGlobals(
    ['allQuizzesDialog', 'allQuizzesSubtitle', 'allQuizzesFilter', 'allQuizzesStatus', 'all-quizzes', 'all-decks', 'all-exams', 'all-scratch', 'all-quizzes-empty', 'all-decks-empty', 'all-exams-empty', 'all-scratch-empty'],
    async ({ byId }) => {
      const storeData = new Map([
        ['doc:fp1', { title: 'OS Notes', at: 100 }],
        ['scratch:fp1', [{
          id: 'conv-1',
          title: 'Paging explained',
          text: '**How does paging work?**\n\nFixed-size frames.',
          messages: [
            { role: 'user', content: 'How does paging work?' },
            { role: 'assistant', content: 'Fixed-size frames.' },
          ],
          at: 200,
        }]],
      ]);
      const openedChats = [];
      const hub = allQuizzes({
        library: {
          store: {
            keys: async () => [...storeData.keys()],
            get: async (_s, k) => storeData.get(k) || null,
            set: async (_s, k, v) => { storeData.set(k, v); },
          },
          recent: async () => [],
        },
        status: () => {},
        currentFingerprint: () => 'fp1',
        openEntry: async () => true,
        openItem: async () => {},
        exportItem: () => {},
        onOpenScratchChat: (item, ctx) => openedChats.push({ item, ctx }),
      });

      await hub.open();
      assert.equal(byId.get('allQuizzesDialog').open, true);

      const list = byId.get('all-scratch');
      const askBtn = list.querySelector('.scratch-open-chat');
      assert.ok(askBtn, 'Open in Ask AI button should be rendered');
      assert.equal(askBtn.getAttribute('aria-label'), 'Open in Ask AI');

      // Existing action buttons (Copy, Delete) remain present.
      const row = list.querySelector('.scratch-saved-row');
      assert.ok(row.children.some(b => b.getAttribute?.('aria-label') === 'Copy conversation Markdown'));
      assert.ok(row.children.some(b => b.classList?.contains('saved-delete')));

      await askBtn.onclick();
      assert.equal(byId.get('allQuizzesDialog').open, false);
      assert.equal(openedChats.length, 1);
      assert.equal(openedChats[0].item.id, 'conv-1');
      assert.equal(openedChats[0].ctx.fp, 'fp1');
    },
  );
});
