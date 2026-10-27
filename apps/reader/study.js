// Study: flashcards and quizzes made by the user's own AI tool from the
// note's pages (images with tape lifted, plus typed/PDF/OCR/audio text).
// Decks are kept per note, reviewed and edited here, practised as flip cards
// and exported to Anki's text import.
import { pagesContext, jsonFrom } from './ai-context.js';
import { quizPrompt, prepareQuestions, DEFAULT_QUIZ_PROMPT } from './quiz.js';
import { modelPicker } from './model-picker.js';

const $ = id => document.getElementById(id);
const BATCH = 6, PARALLEL = 3;

// Anki text import, same layout as the MCP server's write_anki_deck.
export function ankiText(deck, cards) {
  const cell = s => String(s).replace(/\t/g, '    ').replace(/\r?\n/g, '<br>');
  return [`#separator:tab`, `#html:true`, `#deck:${cell(deck).replace(/<br>/g, ' ')}`, `#tags column:3`,
    ...cards.map(c => `${cell(c.front)}\t${cell(c.back)}\t${c.page ? `p${c.page}` : ''}`)].join('\n') + '\n';
}

// Models often write an enumeration inline ("… 1) a. 2) b. 3) c."); put each
// numbered item on its own line. Only a run that counts up from 1 or a) is split,
// so "(8,4)" or a lone "2)" stay where they are.
export function listLines(text) {
  const markers = [...text.matchAll(/(^|[\s:;.])(\d{1,2}|[a-h])\)\s/g)];
  const value = m => /\d/.test(m[2]) ? Number(m[2]) : m[2].charCodeAt(0) - 96;
  const run = [];
  for (const m of markers) if (value(m) === run.length + 1) run.push(m);
  if (run.length < 2) return text;
  let out = '', last = 0;
  for (const m of run) {
    const at = m.index + m[1].length;
    out += text.slice(last, at).replace(/[ \t]+$/, '') + (at && !/\n$/.test(text.slice(0, at)) ? '\n' : '');
    last = at;
  }
  return out + text.slice(last);
}
export function cleanCards(value) {
  return (value?.cards || []).filter(c => typeof c?.front === 'string' && typeof c?.back === 'string' && c.front.trim() && c.back.trim())
    .map(c => ({ front: listLines(c.front.trim()), back: listLines(c.back.trim()), page: Number.isInteger(c.page) ? c.page : undefined }));
}
export function cleanQuestions(value) {
  return (value?.questions || []).filter(q => typeof q?.question === 'string' && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .map(q => ({ question: q.question.trim(), options: q.options.map(String), answer: q.answer, explanation: String(q.explanation || ''), page: Number.isInteger(q.page) ? q.page : undefined }));
}

export function prompts(kind, { amount, language, title }) {
  const lang = language ? `Write in ${language}.` : "Write in the note's own language.";
  const intro = `You are helping a student study their own notes, "${title}". You get page images and the text extracted from those pages. Handwriting, highlights and anything under tape are the student's own emphasis and answers: weigh them heavily. Ignore slide decoration and page furniture.`;
  if (kind === 'cards')
    return `${intro}\nMake about ${amount} flashcards per page: one fact or concept per card, a clear question on the front and a short, exact answer on the back (definitions, comparisons, causes and effects, formulas, worked steps). Keep the answer's structure: each item of a list, case or step goes on its own line (use \\n in the JSON string). ${lang}\nReply with ONLY this JSON, no prose: {"cards":[{"front":"…","back":"…","page":<page number>}]}`;
  return `${intro}\nWrite about ${amount} multiple-choice questions per page that test understanding, each with 4 plausible options and exactly one correct. ${lang}\nReply with ONLY this JSON, no prose: {"questions":[{"question":"…","options":["…","…","…","…"],"answer":<index of the correct option, 0-3>,"explanation":"why, in one or two sentences","page":<page number>}]}`;
}

export function studyController({ ai, pageCanvas, pageText, documentInfo, currentPage, library, fingerprint, jump, status, download, notePath, jobs, quizzes }) {
  let mode = 'cards', cancelled = false, deck = null, practice = null;
  const instructions = () => { try { return localStorage.getItem('notecomplete-quiz-prompt') || DEFAULT_QUIZ_PROMPT; } catch { return DEFAULT_QUIZ_PROMPT; } };
  const key = () => `decks:${fingerprint() || documentInfo().title}`;
  const savedDecks = async () => (await library.store.get('settings', key()).catch(() => null)) || [];
  const model = ai ? modelPicker($('studyModel'), $('studyModelOther'), ai) : null;
  async function fillProviders() {
    const select = $('studyProvider');
    if (select.options.length) return model.load(select.value);
    const providers = await ai.providers();
    for (const p of providers) select.add(new Option(p.available ? p.label : `${p.label} (not installed)`, p.id, false, false));
    const first = providers.find(p => p.available);
    let saved = '';
    try { saved = localStorage.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
    select.value = providers.some(p => p.id === saved && p.available) ? saved : first?.id || providers[0]?.id;
    select.onchange = () => model.load(select.value);
    await model.load(select.value);
  }
  function unavailable() {
    status('Flashcards, quizzes and chat use AI tools installed on your computer (Claude Code, Antigravity or Codex) and are available in the desktop app.', true);
  }
  async function open(kind) {
    if (!ai) return unavailable();
    mode = kind;
    await fillProviders();
    const { pages } = documentInfo();
    $('studyTitle').textContent = kind === 'cards' ? 'Generate flashcards' : 'Quiz me';
    $('studyAmountLabel').firstChild.textContent = kind === 'cards' ? 'Cards per page ' : 'Questions per page ';
    $('studyFrom').max = $('studyTo').max = pages;
    $('studyFrom').value = $('studyTo').value = currentPage() + 1;
    $('studyStatus').textContent = jobs.busy('ai') ? 'Another generation is still running; it can be stopped from the bar.' : 'Runs in the background: keep reading while your AI tool works. Pages are sent as images with tape lifted, plus their text.';
    $('studyGo').disabled = jobs.busy('ai');
    $('studyPromptEdit').hidden = kind !== 'quiz';
    $('studyDialog').showModal();
  }
  function chosenPages() {
    const { pages } = documentInfo();
    const scope = document.querySelector('input[name="studyScope"]:checked').value;
    if (scope === 'all') return [...Array(pages).keys()];
    const from = Math.max(1, Math.min(pages, Number($('studyFrom').value) || 1));
    const to = scope === 'page' ? from : Math.max(from, Math.min(pages, Number($('studyTo').value) || from));
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  }
  $('studyGo').onclick = () => {
    if (jobs.busy('ai')) return;
    const provider = $('studyProvider').value, chosen = model.value;
    const providerName = $('studyProvider').selectedOptions[0].textContent;
    try { localStorage.setItem('notecomplete-ai-provider', provider); localStorage.setItem('notecomplete-ai-model:' + provider, chosen); } catch { /* Optional. */ }
    const pages = chosenPages(), title = documentInfo().title, kind = mode;
    const amount = $('studyAmount').value, language = $('studyLanguage').value;
    const batches = [];
    for (let i = 0; i < pages.length; i += BATCH) batches.push(pages.slice(i, i + BATCH));
    $('studyDialog').close();
    cancelled = false;
    const job = jobs.start(kind === 'cards' ? 'Flashcards' : 'Quiz', { pages: pages.length, batches: batches.length, kind: 'ai', cancel: () => { cancelled = true; ai.cancel('study'); } });
    (async () => {
      // A few batches at a time: each request mostly waits on the AI service,
      // and page preparation for the next batch overlaps the ones in flight.
      const answers = [];
      let prepared = 0, next = 0, failure = null, prompt = '';
      const lane = async () => {
        while (!cancelled && !failure && next < batches.length) {
          const b = next++, batch = batches[b];
          try {
            const context = await pagesContext(batch, { pageCanvas, pageText, onProgress: () => job.prepared(++prepared) });
            if (cancelled) return;
            job.asking(b, providerName);
            const { text } = await ai.run({ provider, model: chosen, notePath: notePath(), images: context.images, prompt: `${prompt}\n\n${context.text}`, tag: 'study' });
            if (cancelled) return;
            const parsed = jsonFrom(text);
            answers[b] = kind === 'cards' ? cleanCards(parsed) : prepareQuestions(parsed, batch);
            job.answered(b);
          } catch (error) {
            // One failed batch stops the rest; what came back is still kept.
            failure ||= error;
            cancelled = true;
            ai.cancel('study');
          }
        }
      };
      try {
        const avoid = kind === 'quiz' ? (await quizzes.disputed()).slice(0, 40) : [];
        prompt = (kind === 'cards' ? prompts('cards', { amount, language, title }) : quizPrompt(instructions(), { amount, language, title }))
          + (avoid.length ? `\nThe student marked these earlier questions as wrong or unhelpful; do not ask them or close variants:\n${avoid.map(q => `- ${q}`).join('\n')}` : '');
        await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, lane));
        const results = answers.flatMap(a => a || []);
        if (failure && !results.length) throw failure;
        if (!results.length) return job.fail(cancelled ? 'Generation stopped.' : 'The AI returned nothing usable. Try again or choose other pages.');
        const stopped = cancelled ? (failure ? ` (stopped early: ${failure.message})` : ' (stopped early)') : '';
        const name = `${title} · p. ${pages[0] + 1}${pages.length > 1 ? `–${pages.at(-1) + 1}` : ''}`;
        if (kind === 'cards') {
          const value = { id: String(Date.now()), title: name, created: Date.now(), cards: results };
          const decks = await savedDecks();
          await library.store.set('settings', key(), [value, ...decks]);
          job.finish(`${results.length} flashcards ready${stopped}.`, { label: 'Open flashcards', run: () => showDeck(value) });
        } else {
          const value = { id: String(Date.now()), title: name, created: Date.now(), pages, questions: results, answers: {}, at: 0 };
          await quizzes.add(value);
          job.finish(`Quiz ready: ${results.length} questions${stopped}.`, { label: 'Start quiz', run: () => quizzes.open(value) });
        }
      } catch (error) {
        job.fail(error === failure || !cancelled ? error.message : 'Generation stopped.');
      }
    })();
  };
  $('studyClose').onclick = () => $('studyDialog').close();
  $('studyPromptEdit').onclick = () => {
    $('quizPromptText').value = instructions();
    $('quizPromptDialog').showModal();
  };
  $('quizPromptSave').onclick = () => {
    try { localStorage.setItem('notecomplete-quiz-prompt', $('quizPromptText').value.trim() || DEFAULT_QUIZ_PROMPT); } catch { /* Optional. */ }
    $('quizPromptDialog').close();
  };
  $('quizPromptReset').onclick = () => { $('quizPromptText').value = DEFAULT_QUIZ_PROMPT; };
  $('quizPromptCancel').onclick = () => $('quizPromptDialog').close();

  // Deck review: every card editable, then save, practise or export.
  function showDeck(value, unsaved = false) {
    deck = structuredClone(value);
    // Decks saved before list items were split get the same line breaks.
    for (const card of deck.cards) { card.front = listLines(card.front); card.back = listLines(card.back); }
    $('deckTitle').value = deck.title;
    $('deckSaved').textContent = unsaved ? 'Not saved yet' : 'Saved with this note';
    renderCards();
    $('deckList').hidden = false; $('deckPractice').hidden = true;
    if (!$('deckDialog').open) $('deckDialog').showModal();
  }
  // Cards read like cards: question over answer. Clicking one edits it in place,
  // with fields that grow to their text instead of scrolling.
  const grow = area => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
  function renderCards(editing = -1) {
    $('deckCount').textContent = `${deck.cards.length} cards`;
    const fragment = document.createDocumentFragment();
    deck.cards.forEach((card, i) => {
      const item = document.createElement('li');
      item.className = 'deck-card';
      const body = document.createElement('div');
      body.className = 'deck-card-body';
      if (i === editing) {
        item.classList.add('editing');
        for (const [field, label] of [['front', 'Question'], ['back', 'Answer']]) {
          const area = document.createElement('textarea');
          area.value = card[field]; area.rows = 1; area.placeholder = label;
          area.setAttribute('aria-label', `Card ${i + 1} ${label.toLowerCase()}`);
          area.oninput = () => { card[field] = area.value; grow(area); $('deckSaved').textContent = 'Unsaved changes'; };
          area.onkeydown = e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); renderCards(); } };
          body.append(area);
          requestAnimationFrame(() => grow(area));
        }
      } else {
        const front = document.createElement('p'), back = document.createElement('p');
        front.className = 'deck-card-front'; back.className = 'deck-card-back';
        front.textContent = card.front || 'Empty question'; back.textContent = card.back || 'Empty answer';
        front.classList.toggle('empty', !card.front); back.classList.toggle('empty', !card.back);
        body.append(front, back);
        body.tabIndex = 0; body.title = 'Click to edit';
        body.setAttribute('role', 'button'); body.setAttribute('aria-label', `Edit card ${i + 1}`);
        body.onclick = () => renderCards(i);
        body.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderCards(i); } };
      }
      const tools = document.createElement('div');
      tools.className = 'deck-card-tools';
      const number = document.createElement('span');
      number.className = 'muted'; number.textContent = i + 1;
      tools.append(number);
      if (card.page) {
        const go = document.createElement('button');
        go.type = 'button'; go.className = 'page-badge'; go.textContent = `p. ${card.page}`; go.title = 'Show this page';
        go.onclick = () => jump(card.page - 1);
        tools.append(go);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'card-delete'; remove.textContent = '✕'; remove.title = 'Delete card'; remove.setAttribute('aria-label', `Delete card ${i + 1}`);
      remove.onclick = () => { deck.cards.splice(i, 1); $('deckSaved').textContent = 'Unsaved changes'; renderCards(); };
      tools.append(remove);
      item.append(body, tools);
      fragment.append(item);
    });
    $('deckCards').replaceChildren(fragment);
    if (editing >= 0) requestAnimationFrame(() => $('deckCards').children[editing]?.querySelector('textarea')?.focus());
  }
  $('deckAdd').onclick = () => { deck.cards.push({ front: '', back: '' }); renderCards(deck.cards.length - 1); $('deckCards').lastElementChild?.scrollIntoView({ block: 'nearest' }); };
  $('deckSave').onclick = async () => {
    deck.title = $('deckTitle').value.trim() || deck.title;
    deck.cards = deck.cards.filter(c => c.front.trim() && c.back.trim());
    const decks = (await savedDecks()).filter(d => d.id !== deck.id);
    await library.store.set('settings', key(), [deck, ...decks]);
    $('deckSaved').textContent = 'Saved with this note';
    renderCards();
  };
  $('deckExport').onclick = async () => {
    const name = ($('deckTitle').value.trim() || 'NoteComplete').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    await download(ankiText(name, deck.cards.filter(c => c.front.trim() && c.back.trim())), `${name}.txt`, 'text/plain');
    status('Anki deck exported. In Anki: File → Import, then choose the file.');
  };
  $('deckClose').onclick = () => $('deckDialog').close();
  // Flip-card practice: unknown cards come back once more at the end.
  $('deckPracticeStart').onclick = () => {
    const queue = deck.cards.filter(c => c.front.trim() && c.back.trim()).sort(() => Math.random() - 0.5);
    if (!queue.length) return;
    practice = { queue, known: 0, seen: 0, total: queue.length, again: new Set() };
    $('deckList').hidden = true; $('deckPractice').hidden = false;
    showCard();
  };
  function showCard() {
    const card = practice.queue[0];
    if (!card) {
      $('practiceFront').textContent = `Done: ${practice.known} of ${practice.total} known first time.`;
      $('practiceBack').textContent = ''; $('practiceBack').hidden = true; $('practiceReveal').hidden = true; $('practiceKnow').hidden = $('practiceAgain').hidden = true;
      $('practiceProgress').textContent = '';
      return;
    }
    $('practiceFront').textContent = card.front;
    $('practiceBack').textContent = card.back;
    $('practiceBack').hidden = true;
    $('practiceReveal').hidden = false; $('practiceKnow').hidden = $('practiceAgain').hidden = true;
    $('practiceProgress').textContent = `${practice.seen + 1} · ${practice.known} known`;
    $('practicePage').hidden = !card.page;
    $('practicePage').textContent = card.page ? `p. ${card.page}` : '';
    $('practicePage').onclick = () => jump(card.page - 1);
  }
  $('practiceReveal').onclick = () => { $('practiceBack').hidden = false; $('practiceReveal').hidden = true; $('practiceKnow').hidden = $('practiceAgain').hidden = false; };
  $('practiceKnow').onclick = () => { const card = practice.queue.shift(); if (!practice.again.has(card)) practice.known++; practice.seen++; showCard(); };
  $('practiceAgain').onclick = () => { const card = practice.queue.shift(); if (!practice.again.has(card)) { practice.again.add(card); practice.queue.push(card); } practice.seen++; showCard(); };
  // Practice keys: Space or Enter shows the answer, 1 not yet, 2 I knew it.
  $('deckDialog').addEventListener('keydown', e => {
    if ($('deckPractice').hidden || e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input,textarea,select')) return;
    const button = { ' ': 'practiceReveal', Enter: 'practiceReveal', 1: 'practiceAgain', 2: 'practiceKnow' }[e.key];
    if (!button || $(button).hidden) return;
    e.preventDefault();
    $(button).click();
  });
  $('practiceBackToList').onclick = () => { $('deckPractice').hidden = true; $('deckList').hidden = false; };

  // Saved decks and quizzes of this note, in two lists. Deleting asks first and
  // can be undone until the dialog closes.
  async function openSaved() {
    const decks = await savedDecks(), saved = await quizzes.list();
    const row = ({ title, detail, kind, run, remove, restore }) => {
      const item = document.createElement('li');
      const show = () => {
        const open = document.createElement('button'), name = document.createElement('strong'), meta = document.createElement('span');
        open.type = 'button'; open.className = 'saved-open';
        name.textContent = title; name.title = title; meta.textContent = detail;
        open.append(name, meta);
        open.onclick = () => { $('deckPickerDialog').close(); run(); };
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'saved-delete'; del.textContent = '✕';
        del.title = `Delete this ${kind}…`; del.setAttribute('aria-label', `Delete ${kind} ${title}`);
        del.onclick = confirm;
        item.replaceChildren(open, del);
      };
      const bar = (text, ...buttons) => {
        const box = document.createElement('div');
        box.className = 'saved-confirm';
        const label = document.createElement('span');
        label.textContent = text; label.style.flex = '1';
        box.append(label, ...buttons);
        item.replaceChildren(box);
        buttons.at(-1).focus();
      };
      const button = (text, onclick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = onclick; return b; };
      function confirm() {
        bar(`Delete “${title}”?`, button('Delete', async () => { await remove(); bar(`Deleted “${title}”.`, button('Undo', async () => { await restore(); show(); })); }, 'danger'), button('Keep', show));
      }
      show();
      return item;
    };
    $('deckPicker').replaceChildren(...decks.map((d, i) => row({
      kind: 'deck', title: d.title, detail: `${d.cards.length} cards${d.created ? ` · ${new Date(d.created).toLocaleDateString()}` : ''}`,
      run: () => showDeck(d),
      remove: async () => library.store.set('settings', key(), (await savedDecks()).filter(x => x.id !== d.id)),
      restore: async () => { const now = (await savedDecks()).filter(x => x.id !== d.id); now.splice(Math.min(i, now.length), 0, d); await library.store.set('settings', key(), now); },
    })));
    $('quizPicker').replaceChildren(...saved.map(q => {
      const answered = Object.keys(q.answers || {}).length;
      const points = Object.entries(q.answers || {}).reduce((n, [i, a]) => n + (a.choice === q.questions[i]?.answer ? (a.hinted ? 1 : 2) : 0), 0);
      return row({ kind: 'quiz', title: q.title, detail: `${answered}/${q.questions.length} answered · ${points} points`, run: () => quizzes.open(q), remove: () => quizzes.remove(q.id), restore: () => quizzes.restore(q) });
    }));
    if (!$('deckPickerDialog').open) $('deckPickerDialog').showModal();
  }
  // Import a deck exported as JSON (one deck, a list of decks, or {cards}) into this note.
  $('deckImport').onclick = () => $('deckFile').click();
  $('deckFile').onchange = async () => {
    const file = $('deckFile').files[0];
    $('deckFile').value = '';
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const list = (Array.isArray(value) ? value : [value]).map((d, i) => ({
        id: `${Date.now()}-${i}`, title: String(d.title || file.name.replace(/\.json$/i, '')), created: Number(d.created) || Date.now(),
        cards: cleanCards({ cards: d.cards }),
      })).filter(d => d.cards.length);
      if (!list.length) throw Error('No cards found in that file.');
      await library.store.set('settings', key(), [...list, ...await savedDecks()]);
      status(`Imported ${list.length === 1 ? `“${list[0].title}”` : `${list.length} decks`}: ${list.reduce((n, d) => n + d.cards.length, 0)} cards.`);
      openSaved();
    } catch (error) { status(`Could not import: ${error.message}`, true); }
  };
  $('deckPickerClose').onclick = () => $('deckPickerDialog').close();
  return { cards: () => open('cards'), quiz: () => open('quiz'), saved: openSaved, fillProviders };
}
