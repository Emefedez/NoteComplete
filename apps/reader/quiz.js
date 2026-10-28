// Quizzes: multiple-choice questions about the theory in the note, generated
// in the background, saved per note and resumable. Instead of explanations the
// AI says where each answer is shown (page + box); the hint is cut from that
// region when the question is shown, so nothing but coordinates is stored.
// Scoring: 2 points for a correct answer, 1 if the hint was used, 0 if wrong.
import { renderAnswer } from './chat.js';
import { explainBox } from './explain.js';
import { textBlock, notesBlock } from './ai-context.js';

const $ = id => document.getElementById(id);

export const DEFAULT_QUIZ_PROMPT = `You write multiple-choice questions so a student can check they understood the theory in their own notes.
- Ask about concepts, definitions, properties, comparisons, causes and consequences that the pages explain. Do not turn worked exercises or their solutions into questions (for example, no "how many page hits does this sequence produce").
- At most one question in ten may be a short new exercise that applies the theory; begin its text with **NUEVO EJERCICIO**.
- Give 4 options of similar length, tone and level of detail, all plausible and from the same topic. The correct option must not stand out by being longer or more precise. Exactly one is correct.
- Do not explain the answers.
- For every question say where the notes show the answer: the page number and a box around that region of the page image, as fractions of its width and height [x0, y0, x1, y1].`;

export function quizPrompt(instructions, { amount, language, title }) {
  const lang = language ? `Write in ${language}.` : "Write in the note's own language.";
  return `${instructions.trim()}\nThe notes are "${title}". About ${amount} questions per page. ${lang} Pages are shown with tape lifted so covered parts are readable; ask about all of each page's material evenly, not mainly what is taped or highlighted.\nReply with ONLY this JSON: {"questions":[{"question":"…","options":["…","…","…","…"],"answer":0,"source":{"page":3,"box":[0.05,0.3,0.95,0.5]}}]}`;
}

const validBox = b => Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && b[2] - b[0] > 0.02 && b[3] - b[1] > 0.01;

// Keep well-formed questions, shuffle their options and remember the new answer index.
export function prepareQuestions(value, pages, random = Math.random) {
  return (value?.questions || []).flatMap(q => {
    if (typeof q?.question !== 'string' || !Array.isArray(q.options) || q.options.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) return [];
    const order = q.options.map((_, i) => i).sort(() => random() - 0.5);
    const page = Number.isInteger(q.source?.page) && pages.includes(q.source.page - 1) ? q.source.page : undefined;
    return [{
      question: q.question.trim(),
      options: order.map(i => String(q.options[i])),
      answer: order.indexOf(q.answer),
      source: page ? { page, box: validBox(q.source.box) ? q.source.box : null } : null,
    }];
  });
}

// A question's accepted answer: the student's correction wins over the AI's.
export const correctOf = q => q.correction?.answer ?? q.answer;
// A quiz as flashcards (Anki, like decks): the question with lettered options on
// the front; the accepted answer, the student's correction note and a saved
// explanation on the back. Disputed questions are left out.
export function quizCards(quiz) {
  const letter = i => String.fromCharCode(65 + i);
  return quiz.questions.filter(q => !q.disputed).map(q => {
    const right = correctOf(q);
    const back = [`${letter(right)}. ${q.options[right]}`];
    if (q.correction?.note) back.push(`Correction: ${q.correction.note}`);
    if (q.explanation?.text) back.push(q.explanation.text);
    return { front: [q.question, '', ...q.options.map((o, i) => `${letter(i)}. ${o}`)].join('\n'), back: back.join('\n\n'), page: q.source?.page };
  });
}
// One state per question for the progress bar: right (2 points), hinted (right with
// the hint, 1 point), wrong, disputed, or '' while unanswered.
export function barStates(quiz) {
  return quiz.questions.map((q, i) => {
    const a = quiz.answers?.[i];
    if (q.disputed) return 'disputed';
    if (!a) return '';
    if (a.choice !== correctOf(q)) return 'wrong';
    return a.hinted ? 'hinted' : 'right';
  });
}
// Disputed questions do not count; the rest score 2, or 1 with the hint.
export function score(quiz) {
  let points = 0, answered = 0, counted = 0;
  quiz.questions.forEach((q, i) => {
    if (q.disputed) return;
    counted++;
    const a = quiz.answers?.[i];
    if (!a) return;
    answered++;
    if (a.choice === correctOf(q)) points += a.hinted ? 1 : 2;
  });
  return { points, answered, max: counted * 2 };
}
// Wrong, undisputed questions across all of a note's quizzes, for a retake.
export function wrongQuestions(quizzes) {
  const seen = new Set();
  return quizzes.flatMap(quiz => quiz.questions.filter((q, i) => {
    const a = quiz.answers?.[i];
    if (!a || q.disputed || a.choice === correctOf(q) || seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  })).map(q => ({ ...q }));
}

// A hint image shown large, fitted to the window.
function showLarge(url, alt) {
  const dialog = $('imageViewer'), img = $('imageViewerImage');
  img.src = url; img.alt = alt;
  dialog.onclick = () => dialog.close();
  dialog.showModal();
}

// Clarify (C): the tutor prompt for one question; the correct option only once answered.
export function clarifyPrompt(q, { answered = null, history = [], question = '', withImage = false } = {}) {
  const talk = history.map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${m.content}`).join('\n\n');
  const options = q.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
  return [
    `A student taking a quiz on their own notes does not fully understand this question${answered ? ' and its answer' : ''}${withImage ? ' (the attached image is the part of the notes that answers it)' : ''}. Explain the idea it tests using the notes, clearly and briefly, in the question's language; a short example or steps help.${answered ? '' : ' Do not say which option is correct: they have not answered yet.'}`,
    `Question: ${q.question}\nOptions:\n${options}${answered ? `\nCorrect answer: ${answered.correct + 1}. The student chose ${answered.choice + 1}.` : ''}`,
    talk && `Conversation so far:\n${talk}`,
    question && `Student: ${question}`,
  ].filter(Boolean).join('\n\n');
}

export function quizController({ library, key, pageCanvas, jump, highlight, clarify, status, factCheck, ai = null, markdown = null, notePath = () => '', notesText = async () => '', pagePdf = null, pageText = async () => '', continueInChat = null, keep = null, grow = () => {} }) {
  let quiz = null, hint = null;
  const store = async () => (await library.store.get('settings', key()).catch(() => null)) || [];
  async function save() {
    if (!quiz) return;
    const all = (await store()).filter(q => q.id !== quiz.id);
    await library.store.set('settings', key(), [quiz, ...all]);
  }
  // The hint: the source box cut from the page (tape lifted), or the whole page.
  async function capture(source) {
    if (!source) return null;
    const { canvas, scale } = await pageCanvas(source.page - 1, 1800, { liftTape: true });
    let [x0, y0, x1, y1] = source.box || [0, 0, 1, 1];
    const pad = 0.03;
    [x0, y0, x1, y1] = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(1, x1 + pad), Math.min(1, y1 + pad)];
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round((x1 - x0) * canvas.width));
    crop.height = Math.max(1, Math.round((y1 - y0) * canvas.height));
    crop.getContext('2d').drawImage(canvas, x0 * canvas.width, y0 * canvas.height, crop.width, crop.height, 0, 0, crop.width, crop.height);
    canvas.width = canvas.height = 0;
    void scale;
    return crop.toDataURL('image/jpeg', 0.85);
  }
  function header() {
    const { points, answered, max } = score(quiz);
    $('quizPanelProgress').textContent = `${Math.min(quiz.at + 1, quiz.questions.length)} / ${quiz.questions.length} · ${points} of ${max} points`;
    $('quizMini').textContent = `Quiz ${answered}/${quiz.questions.length} · ${points} pts`;
    // One continuous fill: answered questions in order, each 1/N of the track.
    const states = barStates(quiz), bar = $('quizBar'), filled = states.filter(Boolean);
    bar.replaceChildren(...filled.map(state => { const s = document.createElement('span'); s.dataset.state = state; s.style.width = `${100 / states.length}%`; return s; }));
    const count = s => states.filter(x => x === s).length;
    bar.setAttribute('aria-label', `${answered} of ${states.length} answered: ${count('right')} right, ${count('hinted')} right with the hint, ${count('wrong')} wrong`);
  }
  function show() {
    hint = null;
    $('quizHint').hidden = true;
    $('quizHint').replaceChildren();
    const q = quiz.questions[quiz.at];
    // The ask box belongs to one question; its saved explanation shows under the options.
    explain.close();
    explain.showSaved(q || null);
    header();
    if (!q) {
      const { points, max } = score(quiz);
      quiz.done = true;
      save();
      $('quizPanelQuestion').replaceChildren(`Finished: ${points} of ${max} points.`);
      $('quizPanelOptions').replaceChildren();
      for (const id of ['quizHintButton', 'quizClarify', 'quizWhere', 'quizNextButton']) $(id).hidden = true;
      $('quizRestart').hidden = false;
      return;
    }
    $('quizRestart').hidden = true;
    $('quizCheckBox').hidden = true;
    const answer = quiz.answers[quiz.at];
    $('quizPanelQuestion').replaceChildren(renderAnswer(q.question));
    $('quizPanelOptions').replaceChildren(...q.options.map((option, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      button.append(key, ' ', option);
      if (answer) button.dataset.result = i === correctOf(q) ? 'right' : i === answer.choice ? 'wrong' : '';
      button.onclick = () => choose(i);
      return button;
    }));
    // The hint stays hidden until asked for, also after answering (then it costs nothing).
    $('quizHintButton').hidden = !q.source;
    $('quizClarify').hidden = false;
    $('quizWhere').hidden = !q.source;
    $('quizWhere').textContent = q.source ? `Where it is: p. ${q.source.page}` : '';
    $('quizNextButton').hidden = !answer;
    $('quizDispute').hidden = $('quizCheck').hidden = !answer;
    $('quizDispute').textContent = q.disputed ? 'Disputed: not counted' : 'Dispute';
    $('quizDispute').dataset.armed = '';
    $('quizCorrection').hidden = !q.correction?.note && q.correction?.answer === undefined;
    $('quizCorrection').textContent = q.correction ? `Your correction: option ${q.correction.answer + 1}${q.correction.note ? ` · ${q.correction.note}` : ''}` : '';
  }
  async function revealHint(counts = true) {
    const q = quiz.questions[quiz.at];
    if (!q?.source) return;
    if (counts && !quiz.answers[quiz.at]) { quiz.hinted = { ...(quiz.hinted || {}), [quiz.at]: true }; save(); }
    $('quizHint').hidden = false;
    $('quizHint').replaceChildren('Cutting the region from the page…');
    const url = await capture(q.source).catch(() => null);
    if (quiz.questions[quiz.at] !== q) return;
    hint = url;
    const img = document.createElement('img');
    img.alt = `Page ${q.source.page}`;
    if (url) img.src = url;
    // Click (or Enter) shows it large; Esc or a click closes it.
    if (url) {
      img.tabIndex = 0; img.title = 'Show large';
      img.onclick = () => showLarge(url, img.alt);
      img.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); showLarge(url, img.alt); } };
    }
    $('quizHint').replaceChildren(img);
    $('quizHintButton').hidden = true;
  }
  function choose(i) {
    const q = quiz.questions[quiz.at];
    if (!q || quiz.answers[quiz.at]) return;
    quiz.answers[quiz.at] = { choice: i, hinted: !!quiz.hinted?.[quiz.at] };
    if (i !== correctOf(q)) status('Not right. If you think the quiz is wrong: Dispute (X) or Double check (V).');
    save();
    show();
  }
  function next() { if (quiz && quiz.answers[quiz.at]) { quiz.at++; save(); show(); } }
  function open(value) {
    quiz = value;
    quiz.answers ||= {};
    quiz.at = Math.min(quiz.at || 0, quiz.questions.length);
    $('quizPanel').hidden = false;
    $('quizPanel').classList.remove('minimized', 'in-tray');
    show();
  }
  $('quizHintButton').onclick = () => revealHint();
  $('quizNextButton').onclick = next;
  $('quizWhere').onclick = () => { const q = quiz.questions[quiz.at]; if (q?.source) { jump(q.source.page - 1); highlight(q.source.page - 1, q.source.box); } };
  // Clarify in the quiz itself, like Ask AI on flashcards; the answer is kept with the question.
  const answerOf = q => { const i = quiz?.questions.indexOf(q) ?? -1, a = quiz?.answers[i]; return a ? { choice: a.choice, correct: correctOf(q) } : null; };
  const dataUrlImage = async (url, label) => ({ bytes: new Uint8Array(await (await fetch(url)).arrayBuffer()), type: 'image/jpeg', label });
  const explain = explainBox({
    ai, markdown, notePath, status, tag: 'quiz-clarify', label: 'question', keep, titleOf: q => `From the quiz: ${q.question}`, toggle: $('quizExplainedToggle'), growWindow: grow,
    mount: $('quizExplainBox'), savedMount: $('quizExplainSaved'),
    handoff: continueInChat && (async ({ item: q, history, question, onAnswer, extraImages, useNote }) => {
      const answered = answerOf(q);
      const about = `The conversation is about this quiz question from the student's notes${q.source ? ` (page ${q.source.page})` : ''}:\nQuestion: ${q.question}\nOptions:\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}${answered ? `\nCorrect answer: ${answered.correct + 1}. The student chose ${answered.choice + 1}.` : '\nThe student has not answered yet: do not say which option is correct.'}`;
      const image = q.source ? hint || await capture(q.source).catch(() => null) : null;
      return continueInChat({ title: `From the quiz: ${q.question}`, about, messages: history, image, label: 'the part of the notes that answers the quiz question', question, onAnswer, extraImages, useNote });
    }),
    unavailable: () => status('Clarify uses an AI tool installed on your computer and is available in the desktop app.', true),
    // An explanation made after answering names the correct option: kept hidden until this question is answered.
    saved: q => (q.explanation && (!q.explanation.withAnswer || answerOf(q)) ? q.explanation : null),
    save: async (q, value) => { if (value) q.explanation = value; else delete q.explanation; await save(); },
    prompt: (q, { history, question, withImage }) => clarifyPrompt(q, { answered: answerOf(q), history, question, withImage }),
    async context(q, want) {
      const out = { images: [], text: '', notes: [], savedFlags: { withAnswer: !!answerOf(q) } };
      const page = q.source ? q.source.page - 1 : null;
      if (want.page && q.source) {
        const url = hint || await capture(q.source).catch(() => null);
        if (url) out.images.push(await dataUrlImage(url, 'notes-region'));
        out.text = textBlock(page, await pageText(page).catch(() => ''));
      }
      if (want.pdf && pagePdf && page !== null) {
        const pdf = await pagePdf(page).catch(() => null);
        if (pdf) { out.images.push(pdf); out.notes.push(`The attached PDF is the source document of page ${page + 1}.`); }
      }
      if (want.notes) out.text = [out.text, notesBlock(await notesText().catch(() => ''))].filter(Boolean).join('\n\n');
      return out;
    },
  });
  $('quizClarify').onclick = async () => {
    const q = quiz.questions[quiz.at];
    if (ai) return explain.ask(q);
    const url = hint || (q.source ? await capture(q.source).catch(() => null) : null);
    const answer = quiz.answers[quiz.at];
    clarify({
      question: `I don't understand this quiz question${answer ? ' and its answer' : ''}. Explain the idea it tests, using my notes${q.source ? ` (page ${q.source.page}; the attached image is that region)` : ''}.\n\nQuestion: ${q.question}\nOptions:\n${q.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}${answer ? `\nCorrect answer: ${q.answer + 1}. I chose ${answer.choice + 1}.` : ''}`,
      image: url,
    });
  };
  // Dispute needs a second press: the question stops counting and is remembered.
  $('quizDispute').onclick = async () => {
    const q = quiz.questions[quiz.at];
    if (q.disputed) { q.disputed = false; await save(); return show(); }
    if (!$('quizDispute').dataset.armed) { $('quizDispute').dataset.armed = '1'; $('quizDispute').textContent = 'Press again to dispute'; return; }
    q.disputed = true;
    await save();
    status('Disputed: it no longer counts, is left out of retakes and new quizzes avoid it.');
    show();
  };
  // Double check: ask the AI again with the notes; its reply is editable before saving.
  $('quizCheck').onclick = async () => {
    const q = quiz.questions[quiz.at];
    $('quizCheckBox').hidden = false;
    $('quizCheckText').value = 'Asking your AI tool…';
    $('quizCheckOptions').replaceChildren(...q.options.map((option, i) => {
      const label = document.createElement('label'), radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'quizCheckAnswer'; radio.value = String(i); radio.checked = i === correctOf(q);
      label.append(radio, ` ${i + 1}. ${option}`);
      return label;
    }));
    try {
      const image = hint || (q.source ? await capture(q.source).catch(() => null) : null);
      const verdict = await factCheck(q, image);
      if (quiz.questions[quiz.at] !== q) return;
      $('quizCheckText').value = verdict.reason || '';
      if (Number.isInteger(verdict.answer)) for (const r of document.querySelectorAll('input[name="quizCheckAnswer"]')) r.checked = Number(r.value) === verdict.answer;
    } catch (error) {
      $('quizCheckText').value = `${error.message}\nYou can still choose the right option and write your own answer here.`;
    }
  };
  $('quizCheckSave').onclick = async () => {
    const q = quiz.questions[quiz.at];
    const picked = document.querySelector('input[name="quizCheckAnswer"]:checked');
    q.correction = { answer: picked ? Number(picked.value) : correctOf(q), note: $('quizCheckText').value.trim().slice(0, 1200) };
    await save();
    status('Correction saved with this note’s quizzes.');
    show();
  };
  $('quizCheckCancel').onclick = () => { $('quizCheckBox').hidden = true; };
  $('quizMinimize').onclick = () => $('quizPanel').classList.toggle('minimized');
  $('quizMini').onclick = () => $('quizPanel').classList.remove('minimized');
  $('quizPanelClose').onclick = () => { save(); $('quizPanel').hidden = true; };
  const restart = () => { quiz.answers = {}; quiz.hinted = {}; quiz.at = 0; quiz.done = false; save(); show(); };
  $('quizRestart').onclick = restart;
  // The circling arrow in the head: clearing the answers asks for a second press.
  let disarm = 0;
  $('quizRestartIcon').onclick = () => {
    const b = $('quizRestartIcon');
    clearTimeout(disarm);
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1'; b.title = 'Press again to clear the answers and start over';
      disarm = setTimeout(() => { delete b.dataset.armed; b.title = 'Restart this quiz: clear the answers (press twice)'; }, 3000);
      return status('Press the arrow again to clear the answers and start this quiz over.');
    }
    delete b.dataset.armed; b.title = 'Restart this quiz: clear the answers (press twice)';
    if (quiz) { restart(); status('Quiz restarted.'); }
  };
  // Keys while the quiz panel is open and expanded: 1-4 answer, H hint, C clarify, Enter next, M minimize.
  function onKey(event) {
    // Esc closes the Clarify box even while typing a follow-up in it.
    if (quiz && event.key === 'Escape' && explain.open && !$('quizPanel').hidden) { explain.close(); return true; }
    if (!quiz || $('quizPanel').hidden || event.target.matches?.('input,textarea,select,[contenteditable=true]') || event.ctrlKey || event.metaKey || event.altKey) return false;
    const k = event.key.toLowerCase();
    if (k === 'm') { $('quizPanel').classList.toggle('minimized'); return true; }
    if ($('quizPanel').classList.contains('minimized')) return false;
    if (/^[1-9]$/.test(k) && Number(k) <= (quiz.questions[quiz.at]?.options.length || 0)) { choose(Number(k) - 1); return true; }
    if (k === 'h') { revealHint(); return true; }
    if (k === 'c') { $('quizClarify').click(); return true; }
    if (k === 'x' && !$('quizDispute').hidden) { $('quizDispute').click(); return true; }
    if (k === 'v' && !$('quizCheck').hidden) { $('quizCheck').click(); return true; }
    if (k === 'enter' || k === 'arrowright') { next(); return true; }
    if (k === 'escape') { if (explain.open) explain.close(); else $('quizPanel').classList.add('minimized'); return true; }
    return false;
  }
  async function list() { return store(); }
  async function remove(id) { await library.store.set('settings', key(), (await store()).filter(q => q.id !== id)); }
  // Disputed questions of this note, so new quizzes can be told to avoid them.
  async function disputed() {
    return (await store()).flatMap(q => q.questions.filter(x => x.disputed).map(x => x.question));
  }
  async function retakeWrong() {
    const questions = wrongQuestions(await store());
    if (!questions.length) { status('No wrong answers to retake in this note’s quizzes.'); return; }
    const value = { id: String(Date.now()), title: `Wrong answers · ${new Date().toLocaleDateString()}`, created: Date.now(), questions, answers: {}, at: 0, retake: true };
    await library.store.set('settings', key(), [value, ...(await store())]);
    open(value);
  }
  return { open, key: onKey, list, remove, save, disputed, retakeWrong, get current() { return quiz; },
    // Put a deleted quiz back (Undo in the saved list) without touching the open one.
    async restore(value) { const all = (await store()).filter(q => q.id !== value.id); await library.store.set('settings', key(), [value, ...all]); },
    async add(value) { quiz = null; const all = (await store()).filter(q => q.id !== value.id); await library.store.set('settings', key(), [value, ...all]); } };
}
