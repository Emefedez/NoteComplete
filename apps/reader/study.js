// Study: flashcards and quizzes made by the user's own AI tool from the
// note's pages (images with tape lifted, plus typed/PDF/OCR/audio text).
// Decks are kept per note, reviewed and edited here, practised as flip cards
// and exported to Anki's text import.
import { pagesContext, jsonFrom } from './ai-context.js';
import { quizPrompt, prepareQuestions, DEFAULT_QUIZ_PROMPT } from './quiz.js';

const $ = id => document.getElementById(id);
const BATCH = 6;

// Anki text import, same layout as the MCP server's write_anki_deck.
export function ankiText(deck, cards) {
  const cell = s => String(s).replace(/\t/g, '    ').replace(/\r?\n/g, '<br>');
  return [`#separator:tab`, `#html:true`, `#deck:${cell(deck).replace(/<br>/g, ' ')}`, `#tags column:3`,
    ...cards.map(c => `${cell(c.front)}\t${cell(c.back)}\t${c.page ? `p${c.page}` : ''}`)].join('\n') + '\n';
}

export function cleanCards(value) {
  return (value?.cards || []).filter(c => typeof c?.front === 'string' && typeof c?.back === 'string' && c.front.trim() && c.back.trim())
    .map(c => ({ front: c.front.trim(), back: c.back.trim(), page: Number.isInteger(c.page) ? c.page : undefined }));
}
export function cleanQuestions(value) {
  return (value?.questions || []).filter(q => typeof q?.question === 'string' && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .map(q => ({ question: q.question.trim(), options: q.options.map(String), answer: q.answer, explanation: String(q.explanation || ''), page: Number.isInteger(q.page) ? q.page : undefined }));
}

export function prompts(kind, { amount, language, title }) {
  const lang = language ? `Write in ${language}.` : "Write in the note's own language.";
  const intro = `You are helping a student study their own notes, "${title}". You get page images and the text extracted from those pages. Handwriting, highlights and anything under tape are the student's own emphasis and answers: weigh them heavily. Ignore slide decoration and page furniture.`;
  if (kind === 'cards')
    return `${intro}\nMake about ${amount} flashcards per page: one fact or concept per card, a clear question on the front and a short, exact answer on the back (definitions, comparisons, causes and effects, formulas, worked steps). ${lang}\nReply with ONLY this JSON, no prose: {"cards":[{"front":"…","back":"…","page":<page number>}]}`;
  return `${intro}\nWrite about ${amount} multiple-choice questions per page that test understanding, each with 4 plausible options and exactly one correct. ${lang}\nReply with ONLY this JSON, no prose: {"questions":[{"question":"…","options":["…","…","…","…"],"answer":<index of the correct option, 0-3>,"explanation":"why, in one or two sentences","page":<page number>}]}`;
}

export function studyController({ ai, pageCanvas, pageText, documentInfo, currentPage, library, fingerprint, jump, status, download, notePath, jobs, quizzes }) {
  let mode = 'cards', cancelled = false, deck = null, practice = null;
  const instructions = () => { try { return localStorage.getItem('notecomplete-quiz-prompt') || DEFAULT_QUIZ_PROMPT; } catch { return DEFAULT_QUIZ_PROMPT; } };
  const key = () => `decks:${fingerprint() || documentInfo().title}`;
  const savedDecks = async () => (await library.store.get('settings', key()).catch(() => null)) || [];
  async function fillProviders() {
    const select = $('studyProvider');
    if (select.options.length) return;
    const providers = await ai.providers();
    for (const p of providers) select.add(new Option(p.available ? p.label : `${p.label} (not installed)`, p.id, false, false));
    const first = providers.find(p => p.available);
    let saved = '';
    try { saved = localStorage.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
    select.value = providers.some(p => p.id === saved && p.available) ? saved : first?.id || providers[0]?.id;
    try { $('studyModel').value = localStorage.getItem('notecomplete-ai-model') || ''; } catch { /* Optional. */ }
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
    $('studyStatus').textContent = jobs.busy ? 'Another generation is still running; it can be stopped from the bar.' : 'Runs in the background: keep reading while your AI tool works. Pages are sent as images with tape lifted, plus their text.';
    $('studyGo').disabled = jobs.busy;
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
    if (jobs.busy) return;
    const provider = $('studyProvider').value, model = $('studyModel').value.trim();
    const providerName = $('studyProvider').selectedOptions[0].textContent;
    try { localStorage.setItem('notecomplete-ai-provider', provider); localStorage.setItem('notecomplete-ai-model', model); } catch { /* Optional. */ }
    const pages = chosenPages(), title = documentInfo().title, kind = mode;
    const amount = $('studyAmount').value, language = $('studyLanguage').value;
    const batches = [];
    for (let i = 0; i < pages.length; i += BATCH) batches.push(pages.slice(i, i + BATCH));
    $('studyDialog').close();
    cancelled = false;
    const job = jobs.start(kind === 'cards' ? 'Flashcards' : 'Quiz', { pages: pages.length, batches: batches.length, cancel: () => { cancelled = true; ai.cancel(); } });
    (async () => {
      const results = [];
      let prepared = 0;
      try {
        for (const [b, batch] of batches.entries()) {
          const context = await pagesContext(batch, { pageCanvas, pageText, onProgress: () => job.prepared(++prepared) });
          if (cancelled) break;
          job.asking(b, providerName);
          const avoid = kind === 'quiz' ? (await quizzes.disputed()).slice(0, 40) : [];
          const prompt = (kind === 'cards' ? prompts('cards', { amount, language, title }) : quizPrompt(instructions(), { amount, language, title }))
            + (avoid.length ? `\nThe student marked these earlier questions as wrong or unhelpful; do not ask them or close variants:\n${avoid.map(q => `- ${q}`).join('\n')}` : '');
          const { text } = await ai.run({ provider, model, notePath: notePath(), images: context.images, prompt: `${prompt}\n\n${context.text}` });
          if (cancelled) break;
          const parsed = jsonFrom(text);
          results.push(...(kind === 'cards' ? cleanCards(parsed) : prepareQuestions(parsed, batch)));
          job.answered(b);
        }
        if (!results.length) return job.fail(cancelled ? 'Generation stopped.' : 'The AI returned nothing usable. Try again or choose other pages.');
        const name = `${title} · p. ${pages[0] + 1}${pages.length > 1 ? `–${pages.at(-1) + 1}` : ''}`;
        if (kind === 'cards') {
          const value = { id: String(Date.now()), title: name, created: Date.now(), cards: results };
          const decks = await savedDecks();
          await library.store.set('settings', key(), [value, ...decks]);
          job.finish(`${results.length} flashcards ready${cancelled ? ' (stopped early)' : ''}.`, { label: 'Open flashcards', run: () => showDeck(value) });
        } else {
          const value = { id: String(Date.now()), title: name, created: Date.now(), pages, questions: results, answers: {}, at: 0 };
          await quizzes.add(value);
          job.finish(`Quiz ready: ${results.length} questions${cancelled ? ' (stopped early)' : ''}.`, { label: 'Start quiz', run: () => quizzes.open(value) });
        }
      } catch (error) {
        job.fail(cancelled ? 'Generation stopped.' : error.message);
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
    $('deckTitle').value = deck.title;
    $('deckSaved').textContent = unsaved ? 'Not saved yet' : 'Saved with this note';
    renderCards();
    $('deckList').hidden = false; $('deckPractice').hidden = true;
    if (!$('deckDialog').open) $('deckDialog').showModal();
  }
  function renderCards() {
    $('deckCount').textContent = `${deck.cards.length} cards`;
    const fragment = document.createDocumentFragment();
    deck.cards.forEach((card, i) => {
      const item = document.createElement('li');
      const front = document.createElement('textarea'), back = document.createElement('textarea');
      front.value = card.front; back.value = card.back;
      front.rows = back.rows = 2;
      front.setAttribute('aria-label', `Card ${i + 1} question`); back.setAttribute('aria-label', `Card ${i + 1} answer`);
      front.oninput = () => { card.front = front.value; $('deckSaved').textContent = 'Unsaved changes'; };
      back.oninput = () => { card.back = back.value; $('deckSaved').textContent = 'Unsaved changes'; };
      const tools = document.createElement('div');
      if (card.page) {
        const go = document.createElement('button');
        go.type = 'button'; go.textContent = `p. ${card.page}`; go.title = 'Show this page';
        go.onclick = () => jump(card.page - 1);
        tools.append(go);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '✕'; remove.title = 'Delete card'; remove.setAttribute('aria-label', `Delete card ${i + 1}`);
      remove.onclick = () => { deck.cards.splice(i, 1); $('deckSaved').textContent = 'Unsaved changes'; renderCards(); };
      tools.append(remove);
      item.append(front, back, tools);
      fragment.append(item);
    });
    $('deckCards').replaceChildren(fragment);
  }
  $('deckAdd').onclick = () => { deck.cards.push({ front: '', back: '' }); renderCards(); $('deckCards').lastElementChild?.querySelector('textarea')?.focus(); };
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
      $('practiceBack').hidden = true; $('practiceReveal').hidden = true; $('practiceKnow').hidden = $('practiceAgain').hidden = true;
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
  $('practiceBackToList').onclick = () => { $('deckPractice').hidden = true; $('deckList').hidden = false; };

  // Saved decks and quizzes of this note, quizzes with their progress.
  async function openSaved() {
    const decks = await savedDecks(), saved = await quizzes.list();
    if (!decks.length && !saved.length) { status('Nothing saved for this note yet. Use Study → Generate flashcards or Quiz me.'); return; }
    const row = (text, run, remove) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = text;
      button.onclick = () => { $('deckPickerDialog').close(); run(); };
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = '✕'; del.title = 'Delete'; del.className = 'deck-delete';
      del.onclick = async () => { await remove(); item.remove(); };
      item.append(button, del);
      return item;
    };
    $('deckPicker').replaceChildren(
      ...saved.map(q => {
        const answered = Object.keys(q.answers || {}).length;
        const points = Object.entries(q.answers || {}).reduce((n, [i, a]) => n + (a.choice === q.questions[i]?.answer ? (a.hinted ? 1 : 2) : 0), 0);
        return row(`Quiz · ${q.title} · ${answered}/${q.questions.length} answered · ${points} pts`, () => quizzes.open(q), () => quizzes.remove(q.id));
      }),
      ...decks.map(d => row(`Flashcards · ${d.title} · ${d.cards.length} cards`, () => showDeck(d), async () => library.store.set('settings', key(), (await savedDecks()).filter(x => x.id !== d.id)))),
    );
    $('deckPickerDialog').showModal();
  }
  $('deckPickerClose').onclick = () => $('deckPickerDialog').close();
  return { cards: () => open('cards'), quiz: () => open('quiz'), saved: openSaved, fillProviders };
}
