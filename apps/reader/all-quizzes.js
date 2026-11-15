// Study -> Saved resources...: unified, wide resource hub for this device with per-section
// "This note" vs "All" toggles across Quizzes, Flashcard decks, Exams (linked to sources),
// and Scratchpad (AI conversations kept per note).
import { score } from './quiz.js';
import { noteFingerprint } from './find.js';
import { icon } from './icons.js';
import { listExams, removeExam, examsForResource } from './exam-index.js';
import { parseConversation } from './scratchpad.js';
import { renderMarkdown } from './rich-text.js';

const $ = id => document.getElementById(id);
const KINDS = ['quizzes', 'decks'];
const SECTIONS = ['quizzes', 'decks', 'exams', 'scratch'];

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

export function groupHeading(g, current = '') {
  const base = g.doc?.title || (g.fp?.startsWith('general:') ? 'General quiz' : 'Standalone study material');
  const tags = [];
  if (g.doc?.general || g.fp?.startsWith('general:')) tags.push('General');
  if (g.fp === current && current) tags.push('open now');
  return tags.length ? `${base} · ${tags.join(' · ')}` : base;
}

export function describeExam(exam, activeKey = '') {
  const parts = [];
  if (exam?.pageCount) parts.push(`${exam.pageCount}p`);
  if (exam?.tapeCount) parts.push(`${exam.tapeCount} tape`);
  if (exam?.created) parts.push(new Date(exam.created).toLocaleDateString());
  if (activeKey && exam?.entryKey === activeKey) parts.push('open now');
  const labels = (exam?.resourceLabels || []).slice(0, 3);
  if (labels.length) {
    const more = (exam.resourceLabels?.length || 0) - labels.length;
    parts.push(`From: ${labels.join(', ')}${more > 0 ? ` +${more}` : ''}`);
  }
  return parts.join(' · ') || 'AI Exam (.nfedit)';
}

export function scratchSnippet(entry) {
  const msgs = Array.isArray(entry?.messages) && entry.messages.length ? entry.messages : parseConversation(entry?.text || '');
  const turns = Math.max(1, Math.ceil(msgs.length / 2));
  const when = entry?.at ? new Date(entry.at).toLocaleDateString() : '';
  return [ `${turns} turn${turns === 1 ? '' : 's'}`, when ].filter(Boolean).join(' · ');
}

function makeIconBtn(name, titleText, onclick, cls = 'saved-export saved-icon') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.title = titleText;
  btn.setAttribute('aria-label', titleText);
  btn.append(icon(name));
  btn.onclick = onclick;
  return btn;
}

export function allQuizzes({
  library,
  status,
  currentFingerprint,
  currentResource = () => ({}),
  openEntry,
  openItem,
  openExam = null,
  exportItem,
  qrItem = null,
  importStudy = null,
  appendNotes = null,
  canNote = () => false,
  markdown = null,
  onOpenScratchChat = null,
  openScratch = null,
}) {
  const openScratchChat = onOpenScratchChat || openScratch;
  let data = null;
  const scopes = { quizzes: 'note', decks: 'note', exams: 'note', scratch: 'note' };

  async function read() {
    const keys = (await library.store.keys?.('settings').catch(error => { console.warn('Study keys could not be read', error); return []; })) || [];
    const stored = [], docs = new Map();
    for (const key of keys.filter(k => typeof k === 'string')) {
      if ([...KINDS, 'scratch'].some(kind => key.startsWith(`${kind}:`))) {
        stored.push([key, await library.store.get('settings', key).catch(() => null)]);
      } else if (key.startsWith('doc:')) {
        docs.set(key.slice(4), await library.store.get('settings', key).catch(() => null));
      }
    }
    const exams = await listExams(library.store).catch(() => []);
    return { stored, docs, exams };
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
      docs.set(fp, doc);
      missing.delete(fp);
      await library.store.set('settings', `doc:${fp}`, doc).catch(() => { /* Optional. */ });
    }
  }

  function syncScopeUI(inNote, counts = {}) {
    const dlg = $('allQuizzesDialog');
    if (!dlg) return;
    for (const sec of SECTIONS) {
      const box = dlg.querySelector(`[data-sec="${sec}"]`);
      if (!box) continue;
      const active = inNote ? scopes[sec] : 'all';
      for (const b of box.querySelectorAll('[data-section-scope]')) {
        const s = b.dataset.sectionScope;
        const disabled = !inNote && s === 'note';
        b.disabled = disabled;
        const on = active === s;
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-checked', String(on));
        const base = s === 'note' ? 'This note' : 'All';
        const c = counts[sec]?.[s];
        b.textContent = typeof c === 'number' ? `${base} (${c})` : base;
      }
    }
  }

  function wireSectionToggles() {
    const dlg = $('allQuizzesDialog');
    if (!dlg || dlg.dataset.wired) return;
    dlg.dataset.wired = '1';
    for (const b of dlg.querySelectorAll('[data-section-scope]')) {
      b.onclick = () => {
        const sec = b.closest('[data-sec]')?.dataset.sec;
        if (!sec || b.disabled) return;
        scopes[sec] = b.dataset.sectionScope;
        draw();
      };
    }
  }

  async function deleteSettingItem(storageKey, id, predicate) {
    const list = (await library.store.get('settings', storageKey).catch(() => null)) || [];
    const next = list.filter((x) => !predicate(x, id));
    await library.store.set('settings', storageKey, next);
    await render(true);
  }

  function armDelete(btn, onConfirm) {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '0';
      onConfirm();
      return;
    }
    btn.dataset.armed = '1';
    btn.title = 'Click again to delete';
    btn.setAttribute('aria-label', 'Click again to delete');
    btn.classList.add('armed');
    btn.replaceChildren(icon('check'));
  }

  function listStudy(kind, groups, filter, current) {
    const secScope = current ? scopes[kind] : 'all';
    const nodes = [];
    for (const g of groups) {
      if (secScope === 'note' && g.fp !== current) continue;
      const heading = groupHeading(g, current);
      const shown = g.items.filter(item => !filter || heading.toLowerCase().includes(filter) || String(item?.title || '').toLowerCase().includes(filter));
      if (!shown.length) continue;
      if (secScope === 'all') {
        const head = document.createElement('li');
        head.className = 'all-quizzes-doc';
        head.textContent = heading;
        nodes.push(head);
      }
      for (const item of shown) {
        const row = document.createElement('li');
        const open = document.createElement('button');
        const name = document.createElement('strong');
        const meta = document.createElement('span');
        open.type = 'button';
        open.className = 'saved-open';
        name.textContent = item?.title || (kind === 'decks' ? 'Flashcards' : 'Quiz');
        try { meta.textContent = describe(kind, item); } catch (error) { console.warn('Study item skipped', error); meta.textContent = 'cannot be read'; }
        open.append(name, meta);
        open.disabled = meta.textContent === 'cannot be read';
        open.title = `${name.textContent}\n${meta.textContent}`;
        open.onclick = async () => {
          try {
            if (g.fp !== current && g.doc?.entryKey && !(await openEntry(g.doc.entryKey))) return;
            $('allQuizzesDialog').close();
            await openItem(kind, item.id, g.fp);
          } catch (error) { $('allQuizzesStatus').textContent = error.message; }
        };
        const extras = [];
        if (qrItem) {
          const qrBtn = makeIconBtn('qr', `Share ${name.textContent} via QR`, () => qrItem(kind, item));
          qrBtn.disabled = meta.textContent.startsWith('cannot be read');
          extras.push(qrBtn);
        }
        const ankiBtn = makeIconBtn('export', `Export ${name.textContent} to Anki`, () => exportItem(kind, item));
        ankiBtn.disabled = meta.textContent.startsWith('cannot be read');
        extras.push(ankiBtn);
        const delBtn = makeIconBtn('trash', `Delete ${name.textContent}`, () => {
          armDelete(delBtn, () => deleteSettingItem(`${kind}:${g.fp}`, item.id, (x, id) => x.id === id));
        }, 'saved-delete saved-icon');
        extras.push(delBtn);
        row.append(open, ...extras);
        nodes.push(row);
      }
    }
    return nodes;
  }

  function listExamsSection(exams, filter, current, res) {
    const secScope = current ? scopes.exams : 'all';
    const noteMatches = current
      ? exams.filter((e) => (res.entryKey && e.entryKey === res.entryKey) || examsForResource([e], res).length > 0)
      : exams;
    const base = secScope === 'note' ? noteMatches : exams;
    const shown = base.filter((e) => {
      if (!filter) return true;
      const hay = `${e.title} ${(e.resourceLabels || []).join(' ')} ${e.fileName || ''}`.toLowerCase();
      return hay.includes(filter);
    });
    const nodes = shown.map((exam) => {
      const row = document.createElement('li');
      const open = document.createElement('button');
      const name = document.createElement('strong');
      const meta = document.createElement('span');
      open.type = 'button';
      open.className = 'saved-open';
      name.textContent = exam.title || 'AI Exam';
      meta.textContent = describeExam(exam, res.entryKey);
      open.append(name, meta);
      open.title = `${name.textContent}\n${meta.textContent}`;
      open.onclick = async () => {
        try {
          if (openExam) {
            const ok = await openExam(exam);
            if (ok !== false) $('allQuizzesDialog').close();
          } else if (exam.entryKey) {
            const ok = await openEntry(exam.entryKey);
            if (ok !== false) $('allQuizzesDialog').close();
          }
        } catch (err) {
          $('allQuizzesStatus').textContent = err?.message || String(err);
        }
      };
      const delBtn = makeIconBtn('trash', `Remove ${name.textContent} from exam index`, () => {
        armDelete(delBtn, async () => {
          await removeExam(library.store, exam.id);
          await render(true);
        });
      }, 'saved-delete saved-icon');
      row.append(open, delBtn);
      return row;
    });
    return {
      nodes,
      counts: { note: noteMatches.length, all: exams.length },
    };
  }

  function listScratchSection(groups, filter, current) {
    const secScope = current ? scopes.scratch : 'all';
    const nodes = [];
    const canWriteNote = canNote();
    for (const g of groups) {
      if (secScope === 'note' && g.fp !== current) continue;
      const heading = groupHeading(g, current);
      const shown = g.items.filter((entry) => {
        if (!filter) return true;
        const hay = `${heading} ${entry?.title || ''} ${entry?.text || ''}`.toLowerCase();
        return hay.includes(filter);
      });
      if (!shown.length) continue;
      if (secScope === 'all') {
        const head = document.createElement('li');
        head.className = 'all-quizzes-doc';
        head.textContent = heading;
        nodes.push(head);
      }
      for (const entry of shown) {
        const wrap = document.createElement('li');
        wrap.className = 'scratch-saved-item';
        const row = document.createElement('div');
        row.className = 'scratch-saved-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'saved-open';
        const name = document.createElement('strong');
        const meta = document.createElement('span');
        name.textContent = entry.title || 'AI conversation';
        if (markdown) renderMarkdown(name, String(entry.title || '').replace(/\n+/g, ' '), markdown).catch(() => {});
        meta.textContent = scratchSnippet(entry);
        toggle.append(name, meta);

        const detail = document.createElement('div');
        detail.className = 'scratch-saved-detail';
        detail.hidden = true;
        toggle.onclick = () => {
          detail.hidden = !detail.hidden;
          if (!detail.hidden && !detail.childElementCount) {
            const body = document.createElement('ul');
            body.className = 'scratch-chat';
            const msgs = Array.isArray(entry.messages) && entry.messages.length ? entry.messages : parseConversation(entry.text);
            for (const m of msgs) {
              const bubble = document.createElement('li');
              bubble.className = m.role === 'user' ? 'chat-user' : 'chat-assistant';
              if (m.role === 'user') bubble.textContent = m.content;
              else {
                const inner = document.createElement('div');
                inner.className = 'chat-body scratch-body';
                bubble.append(inner);
                if (markdown) renderMarkdown(inner, m.content, markdown).catch(() => { inner.textContent = m.content; });
                else inner.textContent = m.content;
              }
              body.append(bubble);
            }
            detail.append(body);
          }
        };

        const extras = [];
        if (openScratchChat) {
          const askBtn = document.createElement('button');
          askBtn.type = 'button';
          askBtn.className = 'scratch-open-chat';
          askBtn.title = 'Open in Ask AI';
          askBtn.setAttribute('aria-label', 'Open in Ask AI');
          const label = document.createElement('span');
          label.textContent = 'Open in Ask AI';
          askBtn.append(icon('spark'), label);
          askBtn.onclick = async () => {
            try {
              $('allQuizzesDialog')?.close?.();
              await openScratchChat(entry, { fp: g.fp, doc: g.doc, current });
            } catch (error) {
              const msg = error?.message || String(error);
              status?.(msg, true);
              if ($('allQuizzesStatus')) $('allQuizzesStatus').textContent = msg;
            }
          };
          extras.push(askBtn);
        }
        if (g.fp !== current && g.doc?.entryKey) {
          extras.push(makeIconBtn('open', `Open note “${heading}”`, async () => {
            if (await openEntry(g.doc.entryKey)) $('allQuizzesDialog').close();
          }));
        }
        if (canWriteNote && g.fp === current && appendNotes) {
          extras.push(makeIconBtn('note', 'Add to Markdown notes', async () => {
            await appendNotes(`### ${entry.title}\n\n${entry.text}`);
            status?.('Added to the Markdown notes.');
          }));
        }
        extras.push(makeIconBtn('copy', 'Copy conversation Markdown', () => {
          navigator.clipboard?.writeText(entry.text || '').then(
            () => status?.('Copied.'),
            () => status?.('The clipboard is not available here.', true),
          );
        }));
        const delBtn = makeIconBtn('trash', `Delete “${entry.title}”`, () => {
          armDelete(delBtn, () => deleteSettingItem(`scratch:${g.fp}`, entry.id, (x, id) => x.id === id));
        }, 'saved-delete saved-icon');
        extras.push(delBtn);

        row.append(toggle, ...extras);
        wrap.append(row, detail);
        nodes.push(wrap);
      }
    }
    return nodes;
  }

  function countItems(groups, current) {
    let all = 0, note = 0;
    for (const g of groups) {
      all += g.items.length;
      if (current && g.fp === current) note += g.items.length;
    }
    return { note, all };
  }

  function draw() {
    if (!data) return;
    const filter = ($('allQuizzesFilter')?.value || '').trim().toLowerCase();
    const current = currentFingerprint();
    const res = { ...(currentResource?.() || {}), fingerprint: current };
    const titleEl = $('allQuizzesSubtitle');
    if (titleEl) {
      titleEl.textContent = current && res.title ? `Current note: ${res.title}` : 'Viewing all saved resources on this device';
    }

    const counts = {};
    for (const kind of KINDS) {
      const groups = groupQuizzes(data.stored, data.docs, `${kind}:`);
      counts[kind] = countItems(groups, current);
      const nodes = listStudy(kind, groups, filter, current);
      const ul = $(`all-${kind}`);
      const empty = $(`all-${kind}-empty`);
      if (ul) ul.replaceChildren(...nodes);
      if (empty) {
        empty.hidden = nodes.length > 0;
        empty.textContent = (current && scopes[kind] === 'note')
          ? 'None for this note — switch this section to All or create one from Study.'
          : kind === 'decks'
            ? 'None yet: Study → Generate flashcards….'
            : 'None yet: Study → Quiz me….';
      }
    }

    const examResult = listExamsSection(data.exams, filter, current, res);
    counts.exams = examResult.counts;
    if ($('all-exams')) $('all-exams').replaceChildren(...examResult.nodes);
    if ($('all-exams-empty')) {
      $('all-exams-empty').hidden = examResult.nodes.length > 0;
      $('all-exams-empty').textContent = (current && scopes.exams === 'note')
        ? 'No exams linked to this resource yet — switch to All or create one from File/Study → Create exam (AI)….'
        : 'None yet: File / Study → Create exam (AI)….' ;
    }

    const scratchGroups = groupQuizzes(data.stored, data.docs, 'scratch:');
    counts.scratch = countItems(scratchGroups, current);
    const scratchNodes = listScratchSection(scratchGroups, filter, current);
    if ($('all-scratch')) $('all-scratch').replaceChildren(...scratchNodes);
    if ($('all-scratch-empty')) {
      $('all-scratch-empty').hidden = scratchNodes.length > 0;
      $('all-scratch-empty').textContent = (current && scopes.scratch === 'note')
        ? 'No saved AI conversations for this note yet — click Scratchpad under any Ask AI answer.'
        : 'No scratchpad conversations kept on this device yet.';
    }

    syncScopeUI(!!current, counts);
  }

  async function render(keepScopes = false) {
    data = await read();
    const current = currentFingerprint();
    const allGroups = [...KINDS, 'scratch'].flatMap((kind) => groupQuizzes(data.stored, data.docs, `${kind}:`));
    const missing = new Set(allGroups.filter(g => !g.doc && !String(g.fp).startsWith('general:') && !String(g.fp).startsWith('received:')).map(g => g.fp));

    if (!keepScopes && current) {
      // If a section is set to 'note' and has 0 matches for this note while having items in 'all', keep it intuitive or stay as requested.
    }
    draw();
    if (missing.size) {
      $('allQuizzesStatus').textContent = 'Finding the documents of older material…';
      await backfill(missing, data.docs);
      draw();
    }
    $('allQuizzesStatus').textContent = '';
  }

  if ($('allQuizzesFilter')) $('allQuizzesFilter').oninput = draw;
  if ($('allQuizzesClose')) $('allQuizzesClose').onclick = () => $('allQuizzesDialog').close();
  if ($('allQuizzesImport')) $('allQuizzesImport').onclick = () => {
    $('allQuizzesDialog').close();
    if (importStudy) importStudy();
    else $('deckFile')?.click();
  };

  return {
    async open({ scope: wantedScope = null, section = null } = {}) {
      wireSectionToggles();
      if ($('allQuizzesFilter')) $('allQuizzesFilter').value = '';
      const inNote = !!currentFingerprint();
      for (const sec of SECTIONS) {
        scopes[sec] = !inNote ? 'all' : (wantedScope || 'note');
      }
      for (const id of ['all-quizzes', 'all-decks', 'all-exams', 'all-scratch']) $(id)?.replaceChildren();
      if (!$('allQuizzesDialog').open) $('allQuizzesDialog').showModal();
      await render(true).catch(error => {
        console.warn('Study material could not be listed', error);
        $('allQuizzesStatus').textContent = `Could not list everything: ${error.message}`;
      });
      if (section) {
        $('allQuizzesDialog').querySelector(`[data-sec="${section}"]`)?.scrollIntoView?.({ block: 'nearest' });
      }
    },
  };
}
