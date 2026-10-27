// Study: flashcards and quizzes made by the user's own AI tool from the
// note's pages (images with tape lifted, plus typed/PDF/OCR/audio text).
// Decks are kept per note, reviewed and edited here, practised as flip cards
// and exported to Anki's text import.
import { pagesContext, jsonFrom } from './ai-context.js';
import { quizPrompt, prepareQuestions, DEFAULT_QUIZ_PROMPT } from './quiz.js';
import { modelPicker } from './model-picker.js';
import { renderMarkdown } from './rich-text.js';
import { renderAnswer } from './chat.js';

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

// Double check of one flashcard while practising: the AI re-reads the card's
// page and keeps or fixes the answer (and the question only if it must).
export function cardCheckPrompt(card, withPage) {
  return `A student practising a flashcard made from their notes thinks it may be wrong${withPage ? ' (the attached image and text are the page it comes from)' : ''}. Using the notes, check the answer and fix it if it is wrong, incomplete or misleading: keep it short and put each item of a list on its own line (\\n). Change the question only if it is ambiguous or does not match the answer. Write in the card's language.\nQuestion: ${card.front}\nAnswer: ${card.back}\nReply with ONLY JSON: {"correct": true or false, "front": "the question", "back": "the answer", "reason": "two or three sentences that cite the notes"}`;
}
// Ask AI about a card while practising: a short tutor explanation, then follow-ups.
export function cardAskPrompt(card, withPage, history = [], question = '') {
  const talk = history.map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${m.content}`).join('\n\n');
  return [
    `A student practising a flashcard made from their notes does not fully understand it${withPage ? ' (the attached image and text are the page it comes from)' : ''}. Explain the idea behind it using the notes, clearly and briefly, in the card's language; a short example or steps help. Say so if the notes do not cover it.`,
    `Question: ${card.front}\nAnswer: ${card.back}`,
    talk && `Conversation so far:\n${talk}`,
    question && `Student: ${question}`,
  ].filter(Boolean).join('\n\n');
}
export function cardVerdict(value, card) {
  const text = (v, fallback) => typeof v === 'string' && v.trim() ? listLines(v.trim()) : fallback;
  return { correct: value?.correct === true, front: text(value?.front, card.front), back: text(value?.back, card.back), reason: typeof value?.reason === 'string' ? value.reason.trim() : '' };
}

export function prompts(kind, { amount, language, title }) {
  const lang = language ? `Write in ${language}.` : "Write in the note's own language.";
  const intro = `You are helping a student study their own notes, "${title}". You get page images and the text extracted from those pages. Handwriting, highlights and anything under tape are the student's own emphasis and answers: weigh them heavily. Ignore slide decoration and page furniture.`;
  if (kind === 'cards')
    return `${intro}\nMake about ${amount} flashcards per page: one fact or concept per card, a clear question on the front and a short, exact answer on the back (definitions, comparisons, causes and effects, formulas, worked steps). Keep the answer's structure: each item of a list, case or step goes on its own line (use \\n in the JSON string). ${lang}\nReply with ONLY this JSON, no prose: {"cards":[{"front":"…","back":"…","page":<page number>}]}`;
  return `${intro}\nWrite about ${amount} multiple-choice questions per page that test understanding, each with 4 plausible options and exactly one correct. ${lang}\nReply with ONLY this JSON, no prose: {"questions":[{"question":"…","options":["…","…","…","…"],"answer":<index of the correct option, 0-3>,"explanation":"why, in one or two sentences","page":<page number>}]}`;
}

export function studyController({ ai, pageCanvas, pageText, documentInfo, currentPage, library, fingerprint, jump, status, download, notePath, jobs, quizzes, markdown = null, pagePdf = null }) {
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
    if ($('deckDialog').classList.contains('floating')) { $('deckDialog').close(); $('deckDialog').classList.remove('floating', 'minimized'); $('deckDialog').style.left = $('deckDialog').style.top = ''; }
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
  $('deckDialog').addEventListener('close', () => { closeFix(); closeAsk(); });
  // Flip-card practice: unknown cards come back once more at the end. It runs in a
  // floating window, like the quiz, so the pages stay visible and usable beside it.
  const POSITION = 'notecomplete-practice-position';
  function floatDeck(on) {
    const dialog = $('deckDialog');
    if (dialog.open) dialog.close();
    dialog.classList.toggle('floating', on);
    dialog.classList.remove('minimized');
    dialog.style.left = dialog.style.top = '';
    if (on) {
      try { const at = JSON.parse(localStorage.getItem(POSITION) || 'null'); if (at) place(at.left, at.top); } catch { /* Optional. */ }
      dialog.show();
    } else dialog.showModal();
  }
  // Keep the window on screen wherever it is put.
  function place(left, top) {
    const dialog = $('deckDialog'), w = dialog.offsetWidth || 520, h = dialog.offsetHeight || 300;
    dialog.style.left = `${Math.max(0, Math.min(innerWidth - Math.min(w, innerWidth), left))}px`;
    dialog.style.top = `${Math.max(0, Math.min(innerHeight - 40, top))}px`;
    void h;
  }
  $('deckDialog').querySelector('.deck-head').addEventListener('pointerdown', down => {
    const dialog = $('deckDialog');
    if (!dialog.classList.contains('floating') || down.button !== 0 || down.target.closest('input, button, select')) return;
    const box = dialog.getBoundingClientRect(), dx = down.clientX - box.left, dy = down.clientY - box.top;
    const move = e => place(e.clientX - dx, e.clientY - dy);
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      try { localStorage.setItem(POSITION, JSON.stringify({ left: parseFloat(dialog.style.left), top: parseFloat(dialog.style.top) })); } catch { /* Optional. */ }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    down.preventDefault();
  });
  $('deckMinimize').onclick = () => $('deckDialog').classList.toggle('minimized');
  $('deckFloatClose').onclick = () => $('deckDialog').close();
  $('deckPracticeStart').onclick = () => {
    const queue = deck.cards.filter(c => c.front.trim() && c.back.trim()).sort(() => Math.random() - 0.5);
    if (!queue.length) return;
    practice = { queue, known: 0, seen: 0, total: queue.length, again: new Set() };
    $('deckList').hidden = true; $('deckPractice').hidden = false;
    floatDeck(true);
    showCard();
  };
  const revealed = () => !$('practiceBack').hidden && !!practice?.queue[0];
  function showCard() {
    const card = practice.queue[0];
    closeFix(); closeAsk();
    $('practiceEdit').hidden = $('practiceCheck').hidden = $('practiceDiscard').hidden = $('practiceAsk').hidden = true;
    $('practiceDiscard').dataset.armed = ''; $('practiceDiscard').textContent = 'Discard';
    $('practiceExplained').hidden = true;
    if (!card) {
      $('practiceFront').textContent = `Done: ${practice.known} of ${practice.total} known first time.`;
      $('practiceBack').textContent = ''; $('practiceBack').hidden = true; $('practiceReveal').hidden = true; $('practiceKnow').hidden = $('practiceAgain').hidden = true;
      $('practiceProgress').textContent = '';
      $('practicePage').hidden = true;
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
  $('practiceReveal').onclick = () => {
    $('practiceBack').hidden = false; $('practiceReveal').hidden = true; $('practiceKnow').hidden = $('practiceAgain').hidden = false;
    $('practiceEdit').hidden = $('practiceCheck').hidden = $('practiceDiscard').hidden = $('practiceAsk').hidden = false;
    showExplained();
  };
  // 2 / I knew it: the card is done. 1 / Not yet: it comes back once more at the end.
  $('practiceKnow').onclick = () => { const card = practice.queue.shift(); if (!practice.again.has(card)) practice.known++; practice.seen++; showCard(); };
  $('practiceAgain').onclick = () => { const card = practice.queue.shift(); if (!practice.again.has(card)) { practice.again.add(card); practice.queue.push(card); } practice.seen++; showCard(); };
  // Correcting a card while practising, as quizzes do: edit it, have the AI
  // double check it against its page, or discard it. Changes are saved at once.
  async function saveDeck() {
    deck.title = $('deckTitle').value.trim() || deck.title;
    const decks = await savedDecks(), value = { ...deck, cards: deck.cards.filter(c => c.front.trim() && c.back.trim()) };
    const at = decks.findIndex(d => d.id === deck.id);
    if (at >= 0) decks[at] = value; else decks.unshift(value);
    await library.store.set('settings', key(), decks);
    $('deckSaved').textContent = 'Saved with this note';
  }
  // The AI tool and model for card requests, chosen in the Ask AI box and remembered.
  const cardModel = ai ? modelPicker($('practiceAskModel'), $('practiceAskModelOther'), ai) : null;
  let providersLoaded = null;
  function loadProviders() {
    return providersLoaded ||= (async () => {
      const select = $('practiceAskProvider'), providers = await ai.providers();
      for (const p of providers) select.add(new Option(p.available ? p.label : `${p.label} (not installed)`, p.id));
      let saved = '';
      try { saved = localStorage.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
      select.value = providers.some(p => p.id === saved && p.available) ? saved : providers.find(p => p.available)?.id || providers[0]?.id || 'claude';
      select.onchange = () => { try { localStorage.setItem('notecomplete-ai-provider', select.value); } catch { /* Optional. */ } cardModel.load(select.value); };
      await cardModel.load(select.value);
    })().catch(error => { providersLoaded = null; throw error; });
  }
  async function aiChoice() {
    await loadProviders().catch(() => {});
    const provider = $('practiceAskProvider').value || 'claude';
    return { provider, model: cardModel?.value || '', label: $('practiceAskProvider').selectedOptions[0]?.textContent || 'your AI tool' };
  }
  // What goes with a card request: its page (image and text), the page's source PDF,
  // and the whole note through the note's MCP tools (slower: the tool may read other pages).
  const material = () => ({ page: $('practiceAskPage').getAttribute('aria-pressed') === 'true', pdf: $('practiceAskPdf').getAttribute('aria-pressed') === 'true', note: $('practiceAskNote').getAttribute('aria-pressed') === 'true' });
  for (const id of ['practiceAskPage', 'practiceAskPdf', 'practiceAskNote']) {
    $(id).onclick = () => {
      $(id).setAttribute('aria-pressed', String($(id).getAttribute('aria-pressed') !== 'true'));
      try { localStorage.setItem('notecomplete-card-material', JSON.stringify(material())); } catch { /* Optional. */ }
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem('notecomplete-card-material') || 'null');
    if (saved) for (const [id, on] of [['practiceAskPage', saved.page], ['practiceAskPdf', saved.pdf], ['practiceAskNote', saved.note]]) $(id).setAttribute('aria-pressed', String(!!on));
  } catch { /* Optional. */ }
  const contexts = new Map();
  async function cardContext(card, want) {
    const out = { images: [], text: '', notes: [] };
    if (!card.page) return out;
    const page = card.page - 1;
    if (want.page) {
      const k = `page:${page}`;
      if (!contexts.has(k)) contexts.set(k, pagesContext([page], { pageCanvas, pageText, width: 1400 }).catch(error => { contexts.delete(k); throw error; }));
      const context = await contexts.get(k);
      out.images.push(...context.images); out.text = context.text;
    }
    if (want.pdf && pagePdf) {
      const k = `pdf:${page}`;
      if (!contexts.has(k)) contexts.set(k, pagePdf(page).catch(() => null));
      const pdf = await contexts.get(k);
      if (pdf) { out.images.push(pdf); out.notes.push(`The attached PDF is the source document of page ${card.page}${pdf.page ? ` (its page ${pdf.page})` : ''}.`); }
      else out.notes.push('');
    }
    return out;
  }
  let fixing = null;
  function closeFix() {
    if (fixing?.asking) ai?.cancel('card-check');
    fixing = null;
    $('practiceFixBox').hidden = true;
  }
  function openFix() {
    const card = practice?.queue[0];
    if (!card) return null;
    closeFix(); closeAsk();
    fixing = { card };
    $('practiceFixReason').textContent = '';
    $('practiceFixFront').value = card.front; $('practiceFixBack').value = card.back;
    $('practiceFixBox').hidden = false;
    for (const area of [$('practiceFixFront'), $('practiceFixBack')]) grow(area);
    return fixing;
  }
  for (const area of [$('practiceFixFront'), $('practiceFixBack')]) area.oninput = () => grow(area);
  $('practiceEdit').onclick = () => { if (openFix()) $('practiceFixBack').focus(); };
  $('practiceCheck').onclick = async () => {
    if (!ai) return unavailable();
    const fix = openFix();
    if (!fix) return;
    const { card } = fix;
    fix.asking = true;
    $('practiceFixReason').textContent = 'Asking your AI tool to check this card against its page…';
    try {
      const { provider, model } = await aiChoice(), want = material();
      const context = await cardContext(card, { ...want, page: true });
      if (fixing !== fix) return;
      const { text } = await ai.run({ provider, model, notePath: want.note ? notePath() : '', images: context.images, tag: 'card-check', prompt: [cardCheckPrompt(card, !!card.page), ...context.notes.filter(Boolean), context.text].filter(Boolean).join('\n\n') });
      fix.asking = false;
      if (fixing !== fix) return;
      const verdict = cardVerdict(jsonFrom(text), card);
      $('practiceFixReason').textContent = `${verdict.correct ? 'The card looks right.' : 'Suggested correction below; edit it if you like.'}${verdict.reason ? ` ${verdict.reason}` : ''}`;
      $('practiceFixFront').value = verdict.front; $('practiceFixBack').value = verdict.back;
      for (const area of [$('practiceFixFront'), $('practiceFixBack')]) grow(area);
    } catch (error) {
      fix.asking = false;
      if (fixing === fix) $('practiceFixReason').textContent = `${error.message} You can still correct the card yourself here.`;
    }
  };
  $('practiceFixSave').onclick = async () => {
    const card = fixing?.card, front = $('practiceFixFront').value.trim(), back = $('practiceFixBack').value.trim();
    if (!card || !front || !back) return;
    card.front = front; card.back = back;
    closeFix();
    $('practiceFront').textContent = card.front; $('practiceBack').textContent = card.back;
    await saveDeck();
    status('Card corrected and saved with this note.');
  };
  $('practiceFixCancel').onclick = closeFix;

  // The card's last explanation is kept with the deck: shown folded under the
  // answer (the arrow opens it), editable, and reused instead of asking again.
  const renderInto = (element, text) => markdown ? renderMarkdown(element, text, markdown).catch(() => element.replaceChildren(renderAnswer(text))) : Promise.resolve(element.replaceChildren(renderAnswer(text)));
  function showExplained() {
    const card = practice?.queue[0], saved = card?.explanation;
    $('practiceExplained').hidden = !saved?.text || !revealed() || !$('practiceAskBox').hidden;
    if ($('practiceExplained').hidden) return;
    $('practiceExplainedEdit').hidden = true; $('practiceExplainedText').hidden = false; $('practiceExplainedTools').hidden = false;
    $('practiceExplainedMeta').textContent = saved.edited ? 'edited by you' : saved.provider ? `from ${saved.provider}` : '';
    renderInto($('practiceExplainedText'), saved.text);
  }
  $('practiceExplainedChange').onclick = () => {
    const card = practice?.queue[0];
    if (!card?.explanation) return;
    $('practiceExplained').open = true;
    $('practiceExplainedText').hidden = true; $('practiceExplainedTools').hidden = true;
    $('practiceExplainedEdit').hidden = false;
    $('practiceExplainedArea').value = card.explanation.text;
    grow($('practiceExplainedArea'));
    $('practiceExplainedArea').focus();
  };
  $('practiceExplainedArea').oninput = () => grow($('practiceExplainedArea'));
  $('practiceExplainedSave').onclick = async () => {
    const card = practice?.queue[0], text = $('practiceExplainedArea').value.trim();
    if (!card) return;
    card.explanation = text ? { ...card.explanation, text, edited: true, at: Date.now() } : undefined;
    await saveDeck();
    showExplained();
    status(text ? 'Explanation saved with the card.' : 'Explanation removed from the card.');
  };
  $('practiceExplainedCancel').onclick = showExplained;
  $('practiceExplainedAsk').onclick = () => ask();

  // Ask AI (C): the explanation streams in under the card, with the tool, model and
  // material chosen in the box; follow-ups keep the thread. The last answer is saved.
  let asking = null;
  function closeAsk() {
    if (asking?.busy) ai?.cancel('card-ask');
    clearInterval(asking?.clock);
    asking = null;
    $('practiceAskBox').hidden = true;
    $('practiceAskStop').hidden = true;
    showExplained();
  }
  function openAsk(card) {
    closeFix(); closeAsk();
    asking = { card, history: [] };
    $('practiceAskThread').replaceChildren();
    $('practiceAskBox').hidden = false;
    $('practiceExplained').hidden = true;
    loadProviders().catch(error => status(error.message, true));
    // A saved explanation opens as the thread's first answer: no new request.
    if (card.explanation?.text) {
      const reply = Object.assign(document.createElement('div'), { className: 'practice-ask-answer chat-body' });
      $('practiceAskThread').append(reply);
      renderInto(reply, card.explanation.text);
      asking.history.push({ role: 'user', content: 'Explain this card.' }, { role: 'assistant', content: card.explanation.text });
      return true;
    }
    return false;
  }
  async function ask(question = '', { again = false } = {}) {
    if (!ai) return unavailable();
    const card = practice?.queue[0];
    if (!card) return;
    if (asking?.card !== card || again) {
      const reused = openAsk(card);
      if (again) { asking.history = []; $('practiceAskThread').replaceChildren(); }
      else if (reused && !question) { $('practiceAskInput').focus(); return; }
    }
    const thread = asking;
    if (thread.busy) return;
    thread.busy = true;
    $('practiceAskInput').value = '';
    $('practiceAskStop').hidden = false;
    if (question) $('practiceAskThread').append(Object.assign(document.createElement('p'), { className: 'practice-ask-question', textContent: question }));
    const reply = Object.assign(document.createElement('div'), { className: 'practice-ask-answer chat-body' });
    $('practiceAskThread').append(reply);
    const started = Date.now();
    let streamed = '';
    try {
      const { provider, model, label } = await aiChoice(), want = material();
      const waiting = () => { if (!streamed) reply.textContent = `Asking ${label}… ${Math.round((Date.now() - started) / 1000)} s`; };
      waiting();
      thread.clock = setInterval(waiting, 1000);
      const context = await cardContext(card, want);
      if (asking !== thread) return;
      const prompt = [cardAskPrompt(card, want.page && !!card.page, thread.history, question), ...context.notes.map(n => n || 'This page has no source PDF.'), context.text].filter(Boolean).join('\n\n');
      // Re-rendered at most every 120 ms while it streams, like the chat.
      let timer = 0, rendering = Promise.resolve();
      const show = () => { timer = 0; rendering = rendering.then(() => asking === thread && renderInto(reply, streamed)); };
      const { text } = await ai.run({ provider, model, notePath: want.note ? notePath() : '', images: context.images, tag: 'card-ask', prompt }, delta => { streamed += delta; timer ||= setTimeout(show, 120); });
      clearTimeout(timer);
      await rendering;
      if (asking !== thread) return;
      const answer = text.trim();
      thread.history.push({ role: 'user', content: question || 'Explain this card.' }, { role: 'assistant', content: answer });
      await renderInto(reply, answer);
      card.explanation = { text: question ? `${card.explanation?.text ? `${card.explanation.text}\n\n` : ''}**${question}**\n\n${answer}` : answer, provider: label, at: Date.now() };
      await saveDeck();
    } catch (error) {
      if (asking === thread) { reply.textContent = error.message; reply.classList.add('chat-error'); }
    } finally {
      thread.busy = false;
      clearInterval(thread.clock);
      if (asking === thread) { $('practiceAskStop').hidden = true; $('practiceAskInput').focus(); }
    }
  }
  $('practiceAsk').onclick = () => ask();
  $('practiceAskForm').onsubmit = event => { event.preventDefault(); const q = $('practiceAskInput').value.trim(); if (q) ask(q); };
  $('practiceAskAgain').onclick = () => ask('', { again: true });
  $('practiceAskStop').onclick = () => ai?.cancel('card-ask');
  $('practiceAskClose').onclick = closeAsk;
  // Discard needs a second press: the card leaves the deck for good.
  $('practiceDiscard').onclick = async () => {
    const card = practice?.queue[0];
    if (!card) return;
    if (!$('practiceDiscard').dataset.armed) { $('practiceDiscard').dataset.armed = '1'; $('practiceDiscard').textContent = 'Press again to discard'; return; }
    practice.queue.shift();
    practice.total--;
    deck.cards = deck.cards.filter(c => c !== card);
    $('deckCount').textContent = `${deck.cards.length} cards`;
    await saveDeck();
    status('Card discarded from the deck.');
    showCard();
  };
  // Practice keys, asked first by the app's key handler (the window floats, so the
  // pages keep their own keys otherwise): Space/Enter show the answer, 1 not yet,
  // 2 I knew it, E edit, V double check, X (twice) discard, C ask AI, M minimize.
  // Esc closes an open box.
  function onKey(e) {
    if (!$('deckDialog').open || $('deckPractice').hidden) return false;
    if (e.key === 'Escape' && (fixing || asking)) { closeFix(); closeAsk(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input,textarea,select,[contenteditable=true]')) return false;
    if (e.key.toLowerCase() === 'm' && $('deckDialog').classList.contains('floating')) { $('deckDialog').classList.toggle('minimized'); return true; }
    if ($('deckDialog').classList.contains('minimized')) return false;
    const button = { ' ': 'practiceReveal', Enter: 'practiceReveal', 1: 'practiceAgain', 2: 'practiceKnow', e: 'practiceEdit', v: 'practiceCheck', x: 'practiceDiscard', c: 'practiceAsk' }[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!button || $(button).hidden) return false;
    $(button).click();
    return true;
  }
  $('practiceBackToList').onclick = () => { closeFix(); closeAsk(); $('deckPractice').hidden = true; $('deckList').hidden = false; floatDeck(false); renderCards(); };

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
  return { cards: () => open('cards'), quiz: () => open('quiz'), saved: openSaved, fillProviders, key: onKey };
}
