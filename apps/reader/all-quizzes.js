// Study → All quizzes and decks…: every quiz and flashcard deck kept on this device, in
// two lists, each under the document it belongs to; opened from here (the document first,
// if it is another one). Both are kept per note fingerprint; `doc:<fingerprint>` remembers
// which file that was. Older ones are matched by reading the fingerprints of Recent notes.
import { score } from './quiz.js';
import { noteFingerprint } from './find.js';
const $ = id => document.getElementById(id);
const KINDS = ['quizzes', 'decks'];

// Items of one kind grouped by document, newest documents first, unknown ones last.
export function groupQuizzes(stored, docs, prefix = 'quizzes:') {
  const groups = [];
  for (const [key, list] of stored) {
    if (!key.startsWith(prefix) || !Array.isArray(list) || !list.length) continue;
    const fp = key.slice(prefix.length);
    groups.push({ fp, doc: docs.get(fp), items: list, quizzes: list });
  }
  return groups.sort((a, b) => (!!b.doc - !!a.doc) || (b.doc?.at || 0) - (a.doc?.at || 0) || (a.doc?.title || '').localeCompare(b.doc?.title || ''));
}

// One line of detail for a quiz or a deck; a damaged record says so instead of failing the list.
export function describe(kind, item) {
  if (kind === 'decks') {
    const cards = Array.isArray(item?.cards) ? item.cards.length : 0;
    return `${cards} card${cards === 1 ? '' : 's'}${item?.created ? ` · ${new Date(item.created).toLocaleDateString()}` : ''}`;
  }
  if (!Array.isArray(item?.questions)) return 'cannot be read';
  const { points, answered, max } = score(item);
  return `${answered}/${item.questions.length} answered · ${points} of ${max} points${item.done ? ' · finished' : ''}${item.created ? ` · ${new Date(item.created).toLocaleDateString()}` : ''}`;
}

export function allQuizzes({ library, status, currentFingerprint, openEntry, openItem, exportItem }) {
  async function read() {
    const keys = (await library.store.keys?.('settings').catch(error => { console.warn('Study keys could not be read', error); return []; })) || [];
    const stored = [], docs = new Map();
    for (const key of keys.filter(k => typeof k === 'string')) {
      if (KINDS.some(kind => key.startsWith(`${kind}:`))) stored.push([key, await library.store.get('settings', key).catch(() => null)]);
      else if (key.startsWith('doc:')) docs.set(key.slice(4), await library.store.get('settings', key).catch(() => null));
    }
    return { stored, docs };
  }
  // Older material: find its document among the notes kept in Recent, once.
  async function backfill(missing, docs) {
    if (!missing.size) return;
    for (const entry of await library.recent(200).catch(() => [])) {
      if (!missing.size) break;
      const file = await library.open(entry).catch(() => null);
      if (!file) continue;
      const fp = await noteFingerprint(file).catch(() => '');
      if (!missing.has(fp)) continue;
      const doc = { title: entry.name.replace(/\.[^.]+$/, ''), entryKey: entry.key, at: entry.openedAt || 0 };
      docs.set(fp, doc); missing.delete(fp);
      await library.store.set('settings', `doc:${fp}`, doc).catch(() => {});
    }
  }
  // Opened from a note: that note's material first, All notes on request; from Home: all.
  let data = null, scope = 'all';
  function setScope(next) {
    scope = next;
    for (const b of $('allScope').querySelectorAll('[data-scope]')) { const on = b.dataset.scope === scope; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); }
  }
  for (const b of $('allScope').querySelectorAll('[data-scope]')) b.onclick = () => { setScope(b.dataset.scope); draw(); };
  function list(kind, groups, filter, current) {
    const nodes = [];
    for (const g of groups) {
      if (scope === 'note' && g.fp !== current) continue;
      const title = g.doc?.title || 'Unknown document';
      const shown = g.items.filter(item => !filter || title.toLowerCase().includes(filter) || String(item?.title || '').toLowerCase().includes(filter));
      if (!shown.length) continue;
      const head = document.createElement('li');
      head.className = 'all-quizzes-doc';
      head.textContent = title + (g.fp === current ? ' · open now' : '');
      nodes.push(head);
      for (const item of shown) {
        const row = document.createElement('li'), open = document.createElement('button'), name = document.createElement('strong'), meta = document.createElement('span'), anki = document.createElement('button');
        open.type = 'button'; open.className = 'saved-open';
        name.textContent = item?.title || (kind === 'decks' ? 'Flashcards' : 'Quiz');
        try { meta.textContent = describe(kind, item); } catch (error) { console.warn('Study item skipped', error); meta.textContent = 'cannot be read'; }
        open.append(name, meta);
        open.disabled = meta.textContent === 'cannot be read' || (g.fp !== current && !g.doc?.entryKey);
        if (g.fp !== current && !g.doc?.entryKey) meta.textContent += ' · open the note once to open it from here';
        open.title = `${name.textContent}\n${meta.textContent}`;
        open.onclick = async () => {
          try {
            if (g.fp !== current && !(await openEntry(g.doc.entryKey))) return;
            $('allQuizzesDialog').close();
            await openItem(kind, item.id);
          } catch (error) { $('allQuizzesStatus').textContent = error.message; }
        };
        anki.type = 'button'; anki.className = 'saved-export'; anki.textContent = 'Anki';
        anki.title = `Export to Anki`; anki.setAttribute('aria-label', `Export ${name.textContent} to Anki`);
        anki.disabled = meta.textContent.startsWith('cannot be read');
        anki.onclick = () => exportItem(kind, item);
        row.append(open, anki);
        nodes.push(row);
      }
    }
    return nodes;
  }
  function draw() {
    if (!data) return;
    const filter = $('allQuizzesFilter').value.trim().toLowerCase(), current = currentFingerprint();
    for (const kind of KINDS) {
      const nodes = list(kind, groupQuizzes(data.stored, data.docs, `${kind}:`), filter, current);
      $(`all-${kind}`).replaceChildren(...nodes);
      $(`all-${kind}-empty`).hidden = nodes.length > 0;
      $(`all-${kind}-empty`).textContent = scope === 'note' ? 'None for this note.' : kind === 'decks' ? 'None yet: Study → Generate flashcards….' : 'None yet: Study → Quiz me….';
    }
  }
  async function render() {
    data = await read();
    const missing = new Set(KINDS.flatMap(kind => groupQuizzes(data.stored, data.docs, `${kind}:`)).filter(g => !g.doc).map(g => g.fp));
    draw();
    if (missing.size) {
      $('allQuizzesStatus').textContent = 'Finding the documents of older material…';
      await backfill(missing, data.docs);
      draw();
    }
    $('allQuizzesStatus').textContent = '';
  }
  $('allQuizzesFilter').oninput = draw;
  $('allQuizzesClose').onclick = () => $('allQuizzesDialog').close();
  return {
    async open() {
      $('allQuizzesFilter').value = '';
      const inNote = !!currentFingerprint();
      $('allScope').hidden = !inNote;
      setScope(inNote ? 'note' : 'all');
      for (const kind of KINDS) $(`all-${kind}`).replaceChildren();
      if (!$('allQuizzesDialog').open) $('allQuizzesDialog').showModal();
      await render().catch(error => { console.warn('Study material could not be listed', error); $('allQuizzesStatus').textContent = `Could not list everything: ${error.message}`; });
    },
  };
}
