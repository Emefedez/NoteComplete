// Study → All quizzes…: every quiz kept on this device, with the document it belongs to,
// opened from here (the document first, if it is another one). Quizzes are kept per
// note fingerprint; `doc:<fingerprint>` remembers which file that was. Quizzes from
// before that index are matched by reading the fingerprints of the notes in Recent.
import { score } from './quiz.js';
import { noteFingerprint } from './find.js';
const $ = id => document.getElementById(id);

// Quizzes grouped by document, newest documents first.
export function groupQuizzes(stored, docs) {
  const groups = new Map();
  for (const [key, list] of stored) {
    const fp = key.slice('quizzes:'.length);
    if (!Array.isArray(list) || !list.length) continue;
    const doc = docs.get(fp);
    groups.set(fp, { fp, doc, quizzes: list });
  }
  return [...groups.values()].sort((a, b) => (b.doc?.at || 0) - (a.doc?.at || 0) || (a.doc?.title || '').localeCompare(b.doc?.title || ''));
}

export function allQuizzes({ library, status, currentFingerprint, openEntry, openQuiz, exportQuiz }) {
  async function read() {
    const keys = (await library.store.keys?.('settings').catch(() => [])) || [];
    const stored = [], docs = new Map();
    for (const key of keys.filter(k => typeof k === 'string')) {
      if (key.startsWith('quizzes:')) stored.push([key, await library.store.get('settings', key).catch(() => null)]);
      else if (key.startsWith('doc:')) docs.set(key.slice(4), await library.store.get('settings', key).catch(() => null));
    }
    return { stored, docs };
  }
  // Older quizzes: find their document among the notes kept in Recent, once.
  async function backfill(missing, docs) {
    if (!missing.size) return;
    for (const entry of await library.recent(200).catch(() => [])) {
      if (!missing.size) break;
      const file = await library.open(entry).catch(() => null);
      if (!file) continue;
      const fp = await noteFingerprint(file).catch(() => '');
      if (!missing.has(fp)) continue;
      const doc = { title: entry.name.replace(/\.[^.]+$/, ''), name: entry.name, entryKey: entry.key, at: entry.openedAt || 0 };
      docs.set(fp, doc); missing.delete(fp);
      await library.store.set('settings', `doc:${fp}`, doc).catch(() => {});
    }
  }
  async function render() {
    const { stored, docs } = await read();
    let groups = groupQuizzes(stored, docs);
    const missing = new Set(groups.filter(g => !g.doc).map(g => g.fp));
    if (missing.size) {
      $('allQuizzesStatus').textContent = 'Finding the documents of older quizzes…';
      await backfill(missing, docs);
      groups = groupQuizzes(stored, docs);
    }
    $('allQuizzesStatus').textContent = '';
    const q = $('allQuizzesFilter').value.trim().toLowerCase();
    const current = currentFingerprint();
    const nodes = [];
    for (const g of groups) {
      const title = g.doc?.title || 'Unknown document';
      const shown = g.quizzes.filter(quiz => !q || title.toLowerCase().includes(q) || String(quiz.title).toLowerCase().includes(q));
      if (!shown.length) continue;
      const head = document.createElement('li');
      head.className = 'all-quizzes-doc';
      head.textContent = title + (g.fp === current ? ' · open now' : '');
      if (!g.doc?.entryKey && g.fp !== current) head.title = 'Not found in Recent: open the note once to open its quizzes from here.';
      nodes.push(head);
      for (const quiz of shown) {
        const { points, answered, max } = score(quiz);
        const row = document.createElement('li'), open = document.createElement('button'), name = document.createElement('strong'), meta = document.createElement('span'), anki = document.createElement('button');
        open.type = 'button'; open.className = 'saved-open';
        name.textContent = quiz.title || 'Quiz';
        meta.textContent = `${answered}/${quiz.questions.length} answered · ${points} of ${max} points${quiz.done ? ' · finished' : ''}${quiz.created ? ` · ${new Date(quiz.created).toLocaleDateString()}` : ''}`;
        open.append(name, meta);
        open.disabled = g.fp !== current && !g.doc?.entryKey;
        if (open.disabled) meta.textContent += ' · open the note once to open it from here';
        open.onclick = async () => {
          try {
            if (g.fp !== current && !(await openEntry(g.doc.entryKey))) return;
            $('allQuizzesDialog').close();
            await openQuiz(quiz.id);
          } catch (error) { $('allQuizzesStatus').textContent = error.message; }
        };
        anki.type = 'button'; anki.className = 'saved-export'; anki.textContent = 'Anki';
        anki.title = 'Export this quiz to Anki'; anki.setAttribute('aria-label', `Export ${quiz.title} to Anki`);
        anki.onclick = () => exportQuiz(quiz, title);
        row.append(open, anki);
        nodes.push(row);
      }
    }
    $('allQuizzesList').replaceChildren(...nodes);
    $('allQuizzesEmpty').hidden = nodes.length > 0;
  }
  $('allQuizzesFilter').oninput = () => render();
  $('allQuizzesClose').onclick = () => $('allQuizzesDialog').close();
  return {
    async open() {
      $('allQuizzesFilter').value = '';
      $('allQuizzesList').replaceChildren();
      if (!$('allQuizzesDialog').open) $('allQuizzesDialog').showModal();
      await render().catch(error => { $('allQuizzesStatus').textContent = error.message; });
    },
  };
}
