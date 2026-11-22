import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { paths, icon } from './icons.js';
import { homeScreen, shouldSkipCoverFile, isTinyCoverSize } from './home.js';

const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

function extractSection(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return html.slice(start, end);
}

function loadSpreadFitWidth() {
  const match = appJs.match(/function spreadFitWidth\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'spreadFitWidth function not found in app.js');
  return vm.runInNewContext(`(${match[0]})`, {});
}

function makeFakeDom() {
  const byId = new Map();
  const makeClassList = (el) => {
    const set = () => new Set(String(el.className || '').split(/\s+/).filter(Boolean));
    return {
      add(...cls) { const s = set(); cls.forEach((c) => c && s.add(c)); el.className = [...s].join(' '); },
      remove(...cls) { const s = set(); cls.forEach((c) => s.delete(c)); el.className = [...s].join(' '); },
      contains(c) { return set().has(c); },
      toggle(c, force) {
        const s = set();
        const on = force === undefined ? !s.has(c) : Boolean(force);
        if (on) s.add(c); else s.delete(c);
        el.className = [...s].join(' ');
        return on;
      },
    };
  };
  const createEl = (tag = 'div', ns = '') => {
    const el = {
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns,
      id: '',
      className: '',
      textContent: '',
      title: '',
      hidden: false,
      value: '',
      attributes: {},
      children: [],
      options: [],
      dataset: {},
      style: {},
      setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'id') { this.id = String(v); byId.set(this.id, this); }
      },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; if (k === 'src') delete this.src; },
      append(...nodes) {
        for (const n of nodes) {
          if (!n || typeof n !== 'object') continue;
          if (n.tagName === 'FRAGMENT') this.children.push(...n.children);
          else this.children.push(n);
        }
      },
      prepend(...nodes) { for (const n of [...nodes].reverse()) if (n && typeof n === 'object') this.children.unshift(n); },
      replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
      add(opt) { this.options.push(opt); },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      select() {},
      closest() { return null; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      classList: null,
    };
    el.classList = makeClassList(el);
    return el;
  };
  const getOrMake = (id) => {
    if (!byId.has(id)) {
      const el = createEl(id === 'homeSort' ? 'select' : 'div');
      el.setAttribute('id', id);
    }
    return byId.get(id);
  };
  return {
    byId,
    document: {
      body: createEl('body'),
      createElement: (tag) => createEl(tag),
      createElementNS: (ns, tag) => createEl(tag, ns),
      createDocumentFragment: () => createEl('fragment'),
      getElementById: (id) => getOrMake(id),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

test('icons.js exports spread and doubleCheck paths and builds valid SVGs', () => {
  assert.equal(typeof paths.spread, 'string');
  assert.ok(paths.spread.length > 10);
  assert.equal(typeof paths.doubleCheck, 'string');
  assert.ok(paths.doubleCheck.length > 10);

  const prevDoc = globalThis.document;
  const fake = makeFakeDom();
  globalThis.document = fake.document;
  try {
    const spreadSvg = icon('spread');
    assert.equal(spreadSvg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(spreadSvg.children[0].getAttribute('d'), paths.spread);

    const doubleCheckSvg = icon('doubleCheck');
    assert.equal(doubleCheckSvg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(doubleCheckSvg.children[0].getAttribute('d'), paths.doubleCheck);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('index.html cleans up File exam items, keeps Study exam items, uses doubleCheck, and adds spread + HTML nav buttons', () => {
  const fileMenu = extractSection(indexHtml, 'id="fileMenu"', 'id="editMenu"');
  assert.equal(fileMenu.includes('id="fileCreateExam"'), false);
  assert.equal(fileMenu.includes('id="fileSolveExam"'), false);

  const studyMenu = extractSection(indexHtml, 'id="studyMenu"', 'id="helpMenu"');
  assert.equal(studyMenu.includes('id="studyCreateExam"'), true);
  assert.equal(studyMenu.includes('id="studySolveExam"'), true);
  assert.match(studyMenu, /id="studyCheck"[^>]*data-icon="doubleCheck"/);

  const viewMenu = extractSection(indexHtml, 'id="viewMenu"', 'id="pagesMenu"');
  assert.match(viewMenu, /id="viewExamHtml"/);
  assert.match(viewMenu, /id="viewSpread"[^>]*data-icon="spread"[^>]*role="menuitemcheckbox"[^>]*aria-checked="false"[^>]*data-palette="Side-by-side pages"/);

  const nav = extractSection(indexHtml, 'class="navigation"', 'class="workspace"');
  assert.match(nav, /id="navExamHtml"[^>]*data-icon="exam"/);
  assert.match(nav, /id="navExamHtml"[\s\S]*?><span>HTML<\/span><\/button/);
  assert.match(nav, /id="pagesSpread"[^>]*data-icon="spread"[^>]*aria-pressed="false"/);
});

test('style.css defines 2-up spread grid layout, navExamHtml pill, scratch-open-chat, and window-large styles', () => {
  assert.match(styleCss, /#pages\[data-spread="2"\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*auto\);/);
  assert.match(styleCss, /#pages\[data-spread="2"\]:has\(>\s*\.sheet:only-of-type\)\s*\{\s*grid-template-columns:\s*auto;\s*\}/);
  assert.match(styleCss, /#pages\[data-spread="2"\]\[data-align="left"\]\s*\{\s*justify-content:\s*start;\s*\}/);
  assert.match(styleCss, /#pages\[data-spread="2"\]\[data-align="right"\]\s*\{\s*justify-content:\s*end;\s*\}/);
  assert.match(styleCss, /#pages\[data-spread="2"\]\s+\.add-page-end\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*justify-self:\s*center;/);
  assert.match(styleCss, /\.navigation\s+\.nav-exam-html\s*\{/);
  assert.match(styleCss, /\.pages-spread-toggle\[aria-pressed="true"\]\s*\{/);
  assert.match(styleCss, /\.scratch-open-chat\s*\{/);
  assert.match(styleCss, /\.chat-panel\.window-large\s+\.chat-messages\s*\{/);
});

test('spreadFitWidth computes single-page and 2-up fit widths cleanly', () => {
  const spreadFitWidth = loadSpreadFitWidth();
  assert.equal(spreadFitWidth(1000, 24, 1, 5), 1000);
  assert.equal(spreadFitWidth(1024, 24, 2, 4), 500);
  assert.equal(spreadFitWidth(1024, 24, 2, 1), 1024);
  assert.equal(spreadFitWidth(10, 24, 2, 3), 1);
  assert.equal(spreadFitWidth(800, 18, 2, 2), 391);
});

test('cover fallback helpers skip text files and detect tiny placeholders', () => {
  assert.equal(shouldSkipCoverFile({ name: 'notes.md', kind: 'text' }), true);
  assert.equal(shouldSkipCoverFile({ name: 'summary.txt', kind: '' }), true);
  assert.equal(shouldSkipCoverFile({ name: 'README', kind: '' }), true);
  assert.equal(shouldSkipCoverFile({ name: 'Untitled note', kind: 'text' }), true);

  assert.equal(shouldSkipCoverFile({ name: 'exam.nfedit', kind: 'project' }), false);
  assert.equal(shouldSkipCoverFile({ name: 'lecture.noteful', kind: 'noteful' }), false);
  assert.equal(shouldSkipCoverFile({ name: 'slides.pdf', kind: 'pdf' }), false);
  assert.equal(shouldSkipCoverFile({ name: 'Untitled note', kind: 'blank' }), false);
  assert.equal(shouldSkipCoverFile({ name: 'Untitled note', kind: 'handwritten' }), false);

  assert.equal(isTinyCoverSize(16, 16), true);
  assert.equal(isTinyCoverSize(24, 24), true);
  assert.equal(isTinyCoverSize(0, 0), true);
  assert.equal(isTinyCoverSize(320, 240), false);
  assert.equal(isTinyCoverSize(25, 25), false);
});

test('homeScreen rememberCover does not throw for .nfedit and recentCard marks missing covers', async () => {
  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  const prevOption = globalThis.Option;
  const fake = makeFakeDom();
  globalThis.document = fake.document;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.Option = function Option(text, value) { return { text, value }; };

  const covers = new Map();
  const entry = { key: 'local:/notes/exam.nfedit', source: 'local', path: '/notes/exam.nfedit', name: 'exam.nfedit', openedAt: Date.now() };
  const nfeditFile = new File(['{"pages":[]}'], 'exam.nfedit', { type: 'application/json' });
  const txtFile = new File(['# Heading\nHello world'], 'readme.md', { type: 'text/markdown' });

  const library = {
    store: { get: async () => null, set: async () => {} },
    coverKey: (f) => `${f.id}@${f.modifiedTime || ''}`,
    cover: async (k) => covers.get(k) || null,
    saveCover: async (k, url) => { covers.set(k, url); },
    facts: async () => null,
    recent: async () => [entry],
    open: async (e) => (e.name === 'exam.nfedit' ? nfeditFile : txtFile),
  };

  try {
    const home = homeScreen({
      library,
      drive: { show() {}, hide() {}, list: () => [], setQuick() {} },
      open: async () => true,
      status: () => {},
    });

    await home.rememberCover(entry.key, nfeditFile);
    assert.equal(covers.has(entry.key), false);

    await home.rememberCover('local:/notes/readme.md', txtFile);
    assert.match(covers.get('local:/notes/readme.md') || '', /^data:image\/svg\+xml/);

    await home.renderRecent();
    await new Promise((r) => setTimeout(r, 15));
    const card = fake.byId.get('recentList').children[0]?.children[0];
    // The selection tick comes first on a card; the cover is the note-cover image.
    const coverImg = card?.children.find((child) => String(child.className).split(' ').includes('note-cover'));
    assert.equal(coverImg?.classList.contains('missing'), true);
  } finally {
    globalThis.document = prevDoc;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
    globalThis.Option = prevOption;
  }
});

test('app.js wires spread persistence, navExamHtml, big scratchpad chat, and removes file exam handlers', () => {
  assert.equal(appJs.includes('fileCreateExam'), false);
  assert.equal(appJs.includes('fileSolveExam'), false);
  assert.match(appJs, /\$\("studyCreateExam"\)\.onclick/);
  assert.match(appJs, /\$\("studySolveExam"\)\.onclick/);
  assert.match(appJs, /\$\("navExamHtml"\)\.onclick\s*=\s*\(\)\s*=>\s*openEmbeddedExamHtml\(\)/);
  assert.match(appJs, /localStorage\.setItem\("notecomplete-page-spread"/);
  assert.match(appJs, /onOpenScratchChat:\s*\(entry\)\s*=>[\s\S]*chat\.openThread\(\{\s*id:\s*entry\.id,\s*title:\s*entry\.title,\s*messages:\s*entry\.messages,\s*text:\s*entry\.text,\s*big:\s*true\s*\}\)/);
  assert.match(appJs, /async function ensureDocumentCover\(/);
});

test('text file covers wrap long lines inside the card and stop at its bottom', async () => {
  const { textCoverSvg, TEXT_COVER } = await import('./home.js');
  const long = '2026-11-16T06:38:18.342Z [tab 1] warning No available adapters. (reader:0) ' + 'x'.repeat(120);
  const svg = textCoverSvg(`Title line\n${long}\n${'line\n'.repeat(80)}`);
  assert.ok(svg.includes(TEXT_COVER));
  const texts = [...svg.matchAll(/<text x="(\d+)" y="([\d.]+)" font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)];
  for (const [, x, , fs, body] of texts) assert.ok(Number(x) + body.length * Number(fs) * 0.58 <= 240 - 20 + 1, `fits: ${body}`);
  assert.ok(Math.max(...texts.map((t) => Number(t[2]))) <= 320 - 14, 'stops at the page end');
  assert.ok(texts.length > 4, 'long line wrapped onto several rows');
});

test('app.js blocks Linux middle-click primary-selection paste and zh-select.js filters falsy toolbar buttons', () => {
  assert.match(appJs, /let middleMouseAt = -Infinity/);
  assert.match(appJs, /performance\.now\(\) - middleMouseAt < 400/);
  assert.match(appJs, /\["mousedown", "mouseup", "auxclick"\]/);
  const zhSelectJs = readFileSync(new URL('./chinese/zh-select.js', import.meta.url), 'utf8');
  assert.match(zhSelectJs, /bar\.replaceChildren\(\.\.\.\[[\s\S]*?\]\.filter\(Boolean\)\)/);
  assert.doesNotMatch(zhSelectJs, /for \(const b of \[\.\.\.bar\.children\]\) if \(!\(b instanceof Element\)\)/);
});

test('narrow screens: the global bar end keeps its icon-only buttons inside the screen', () => {
  // `.bar-end-actions .palette-trigger kbd { display: inline-block }` outranks the plain
  // narrow-screen rules, so the hiding rules must name `.bar-end-actions` too, after it.
  const show = styleCss.indexOf('.bar-end-actions .palette-trigger kbd {');
  assert.ok(show > 0);
  const after = styleCss.slice(show);
  assert.match(after, /@media \(max-width: 960px\) \{ \.bar-end-actions \.palette-trigger :is\(span, kbd\) \{ display: none; \} \}/);
  assert.match(after, /@media \(max-width: 920px\) \{ \.bar-end-actions \.bar-ai span \{ display: none; \} \}/);
  // The app never pans as a page.
  assert.match(styleCss, /html \{\s*overflow: hidden;\s*\}/);
});
