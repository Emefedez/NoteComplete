// Study: flashcards and quizzes made by the user's own AI tool from the
// note's pages (images with tape lifted, plus typed/PDF/OCR/audio text).
// Decks are kept per note, reviewed and edited here, practised as flip cards
// and exported to Anki's text import.
import { pagesContext, jsonFrom } from './ai-context.js';

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

export function studyController({ ai, pageCanvas, pageText, documentInfo, currentPage, library, fingerprint, jump, status, download, notePath }) {
  let mode = 'cards', running = false, cancelled = false, deck = null, practice = null, quiz = null;
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
    $('studyStatus').textContent = 'Your AI tool reads the chosen pages (tape lifted) and their text. Nothing is sent anywhere else.';
    $('studyProgress').hidden = true;
    $('studyGo').disabled = false; $('studyStop').hidden = true;
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
  $('studyGo').onclick = async () => {
    if (running) return;
    const provider = $('studyProvider').value, model = $('studyModel').value.trim();
    try { localStorage.setItem('notecomplete-ai-provider', provider); localStorage.setItem('notecomplete-ai-model', model); } catch { /* Optional. */ }
    const pages = chosenPages(), title = documentInfo().title;
    running = true; cancelled = false;
    $('studyGo').disabled = true; $('studyStop').hidden = false; $('studyProgress').hidden = false;
    const results = [];
    try {
      for (let i = 0; i < pages.length && !cancelled; i += BATCH) {
        const batch = pages.slice(i, i + BATCH);
        $('studyProgress').value = i / pages.length;
        const context = await pagesContext(batch, { pageCanvas, pageText, onProgress: (n, total, page) => { $('studyStatus').textContent = `Preparing page ${page + 1}…`; } });
        if (cancelled) break;
        $('studyStatus').textContent = `Asking ${$('studyProvider').selectedOptions[0].textContent} about pages ${batch[0] + 1}–${batch.at(-1) + 1}… (this can take a minute)`;
        const { text } = await ai.run({ provider, model, notePath: notePath(), images: context.images,
          prompt: `${prompts(mode, { amount: $('studyAmount').value, language: $('studyLanguage').value, title })}\n\n${context.text}` });
        const parsed = jsonFrom(text);
        results.push(...(mode === 'cards' ? cleanCards(parsed) : cleanQuestions(parsed)));
      }
      $('studyProgress').value = 1;
      if (!results.length) throw Error(cancelled ? 'Stopped before anything was made.' : 'The AI returned nothing usable. Try again or choose other pages.');
      $('studyDialog').close();
      if (mode === 'cards') showDeck({ id: String(Date.now()), title: `${title} · p. ${pages[0] + 1}${pages.length > 1 ? `–${pages.at(-1) + 1}` : ''}`, created: Date.now(), cards: results }, true);
      else startQuiz(results);
    } catch (error) {
      $('studyStatus').textContent = error.message;
    } finally {
      running = false;
      $('studyGo').disabled = false; $('studyStop').hidden = true;
    }
  };
  $('studyStop').onclick = () => { cancelled = true; ai.cancel(); $('studyStatus').textContent = 'Stopping…'; };
  $('studyClose').onclick = () => { if (running) $('studyStop').onclick(); $('studyDialog').close(); };

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

  // Multiple-choice quiz with explanations.
  function startQuiz(questions) {
    quiz = { questions: questions.sort(() => Math.random() - 0.5), at: 0, right: 0, answered: false };
    $('quizDialog').showModal();
    showQuestion();
  }
  function showQuestion() {
    const q = quiz.questions[quiz.at];
    $('quizNext').hidden = true;
    $('quizExplain').textContent = '';
    if (!q) {
      $('quizQuestion').textContent = `Score: ${quiz.right} of ${quiz.questions.length}.`;
      $('quizOptions').replaceChildren();
      $('quizProgress').textContent = '';
      $('quizPage').hidden = true;
      return;
    }
    quiz.answered = false;
    $('quizProgress').textContent = `Question ${quiz.at + 1} of ${quiz.questions.length} · ${quiz.right} right`;
    $('quizQuestion').textContent = q.question;
    $('quizPage').hidden = !q.page;
    $('quizPage').textContent = q.page ? `p. ${q.page}` : '';
    $('quizPage').onclick = () => jump(q.page - 1);
    $('quizOptions').replaceChildren(...q.options.map((option, i) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = option;
      button.onclick = () => {
        if (quiz.answered) return;
        quiz.answered = true;
        if (i === q.answer) quiz.right++;
        for (const [j, b] of [...$('quizOptions').children].entries()) b.dataset.result = j === q.answer ? 'right' : j === i ? 'wrong' : '';
        $('quizExplain').textContent = (i === q.answer ? 'Correct. ' : 'Not quite. ') + q.explanation;
        $('quizNext').hidden = false;
      };
      return button;
    }));
  }
  $('quizNext').onclick = () => { quiz.at++; showQuestion(); };
  $('quizClose').onclick = () => $('quizDialog').close();

  async function openSaved() {
    const decks = await savedDecks();
    if (!decks.length) { status('No saved decks for this note yet. Use Study → Generate flashcards.'); return; }
    $('deckPicker').replaceChildren(...decks.map(d => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${d.title} · ${d.cards.length} cards · ${new Date(d.created).toLocaleDateString()}`;
      button.onclick = () => { $('deckPickerDialog').close(); showDeck(d); };
      item.append(button);
      return item;
    }));
    $('deckPickerDialog').showModal();
  }
  $('deckPickerClose').onclick = () => $('deckPickerDialog').close();
  return { cards: () => open('cards'), quiz: () => open('quiz'), saved: openSaved, fillProviders };
}
