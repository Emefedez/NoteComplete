// Ask AI about one item (a quiz question) inside its own window: the answer streams in
// under it with the tool, model and material chosen in the box, follow-ups keep the
// thread, and the last answer is kept with the item: folded under it behind an arrow,
// editable, and reused instead of asking again. Flashcards have the same box in study.js.
import { scratchButton, newId } from './scratchpad.js';
import { renderMarkdown } from './rich-text.js';
import { renderAnswer } from './chat.js';
import { modelPicker } from './model-picker.js';

const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const chip = (label, title, on) => { const b = el('button', { type: 'button', className: 'chip', title, textContent: label }); b.setAttribute('aria-pressed', String(on)); return b; };

export function explainBox({ ai, markdown, notePath, status, tag, label, mount, savedMount, prompt, context, save, saved, unavailable, handoff = null, keep = null, titleOf = () => '' }) {
  const grow = area => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
  const render = (node, text) => markdown ? renderMarkdown(node, text, markdown).catch(() => node.replaceChildren(renderAnswer(text))) : Promise.resolve(node.replaceChildren(renderAnswer(text)));

  // The saved answer, folded under the item.
  const meta = el('span', { className: 'muted' });
  const savedText = el('div', { className: 'practice-ask-answer chat-body' });
  const editArea = el('textarea', { rows: 3 }); editArea.setAttribute('aria-label', 'Explanation; you can correct it');
  const editSave = el('button', { type: 'button', className: 'primary', textContent: 'Save' }), editCancel = el('button', { type: 'button', textContent: 'Cancel' });
  const edit = el('div', { className: 'practice-explained-edit', hidden: true }, editArea, el('div', { className: 'quiz-actions' }, el('span', { className: 'spacer' }), editCancel, editSave));
  const change = el('button', { type: 'button', textContent: 'Edit' }), more = el('button', { type: 'button' }, 'Continue with AI', el('kbd', { textContent: 'C' }));
  const tools = el('div', { className: 'quiz-actions' }, change, more);
  const folded = el('details', { className: 'practice-explained', hidden: true }, el('summary', {}, 'Explanation ', meta), savedText, tools, edit);
  savedMount.append(folded);

  // The ask box.
  const provider = el('select'), model = el('select'), other = el('input', { type: 'text', className: 'model-other', placeholder: 'Model name', hidden: true });
  provider.setAttribute('aria-label', 'AI tool'); model.setAttribute('aria-label', 'Model'); other.setAttribute('aria-label', 'Other model');
  for (const s of [provider, model]) s.dataset.native = '';
  const chips = {
    page: chip('Region', 'The part of the page that answers it, with the page text', true),
    pdf: chip('Source PDF', 'The PDF this page comes from', false),
    notes: chip('Notes', 'Your Markdown notes for this document', false),
    note: chip('Whole note', 'Lets the tool read any page of the note (slower)', false),
  };
  const materialKey = `notecomplete-${tag}-material`;
  try { const s = JSON.parse(localStorage.getItem(materialKey) || 'null'); if (s) for (const [k, b] of Object.entries(chips)) b.setAttribute('aria-pressed', String(!!s[k])); } catch { /* Optional. */ }
  const material = () => Object.fromEntries(Object.entries(chips).map(([k, b]) => [k, b.getAttribute('aria-pressed') === 'true']));
  for (const b of Object.values(chips)) b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); try { localStorage.setItem(materialKey, JSON.stringify(material())); } catch { /* Optional. */ } };
  const thread = el('div', { className: 'practice-ask-thread' }); thread.setAttribute('role', 'log'); thread.setAttribute('aria-live', 'polite');
  const input = el('input', { type: 'text', autocomplete: 'off', placeholder: handoff ? `Ask a follow-up (it continues in Ask AI)` : `Ask something else about this ${label}` }); input.setAttribute('aria-label', 'Follow-up question');
  const stop = el('button', { type: 'button', textContent: 'Stop', hidden: true }), again = el('button', { type: 'button', textContent: 'Ask again', title: 'Ask for a new explanation; it replaces the saved one' }), close = el('button', { type: 'button', textContent: 'Close' });
  const form = el('form', { className: 'practice-ask-form' }, input, el('button', { type: 'submit', textContent: 'Ask' }), stop, again, close);
  const box = el('div', { className: 'practice-ask', hidden: true },
    el('div', { className: 'practice-ask-bar' }, provider, model, other, el('span', { className: 'practice-ask-material', role: 'group' }, ...Object.values(chips))),
    thread, form);
  mount.append(box);

  const picker = ai ? modelPicker(model, other, ai) : null;
  let loaded = null;
  const loadProviders = () => loaded ||= (async () => {
    const list = await ai.providers();
    for (const p of list) provider.add(new Option(p.available ? p.label : `${p.label} (not installed)`, p.id));
    let last = '';
    try { last = localStorage.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
    provider.value = list.some(p => p.id === last && p.available) ? last : list.find(p => p.available)?.id || list[0]?.id || 'claude';
    provider.onchange = () => { try { localStorage.setItem('notecomplete-ai-provider', provider.value); } catch { /* Optional. */ } picker.load(provider.value); };
    await picker.load(provider.value);
  })().catch(error => { loaded = null; throw error; });

  let item = null, asking = null;
  function showSaved(current) {
    item = current;
    const value = current && saved(current);
    folded.hidden = !value?.text || !box.hidden;
    if (folded.hidden) return;
    edit.hidden = true; savedText.hidden = tools.hidden = false;
    meta.textContent = value.edited ? 'edited by you' : value.provider ? `from ${value.provider}` : '';
    render(savedText, value.text);
  }
  change.onclick = () => {
    const value = item && saved(item);
    if (!value) return;
    folded.open = true; savedText.hidden = tools.hidden = true; edit.hidden = false;
    editArea.value = value.text; grow(editArea); editArea.focus();
  };
  editArea.oninput = () => grow(editArea);
  editCancel.onclick = () => showSaved(item);
  editSave.onclick = async () => {
    if (!item) return;
    const text = editArea.value.trim();
    await save(item, text ? { ...saved(item), text, edited: true, at: Date.now() } : null);
    showSaved(item);
    status(text ? 'Explanation saved.' : 'Explanation removed.');
  };
  more.onclick = () => ask(item);

  function closeBox() {
    if (asking?.busy) ai?.cancel(tag);
    clearInterval(asking?.clock);
    asking = null;
    box.hidden = true; stop.hidden = true;
    showSaved(item);
  }
  function openBox(current) {
    closeBox();
    item = current;
    asking = { item: current, history: [], id: newId() };
    thread.replaceChildren();
    box.hidden = false; folded.hidden = true;
    loadProviders().catch(error => status(error.message, true));
    const value = saved(current);
    if (value?.text) {
      const reply = el('div', { className: 'practice-ask-answer chat-body' });
      thread.append(reply); render(reply, value.text);
      asking.history.push({ role: 'user', content: 'Explain this.' }, { role: 'assistant', content: value.text });
      return true;
    }
    return false;
  }
  // Clarify opens the box and waits for the student's question; nothing is sent until
  // they press Enter (Enter with nothing typed asks for an explanation).
  const hint = () => { input.placeholder = asking?.history.length ? (handoff ? 'Ask a follow-up (it continues in Ask AI; the answer is kept here too)' : `Ask something else about this ${label}`) : `What isn't clear about this ${label}? Enter alone explains it`; };
  async function ask(current, question = '', { fresh = false, send = false } = {}) {
    if (!ai) return unavailable?.();
    if (!current) return;
    if (asking?.item !== current || fresh) {
      openBox(current);
      if (fresh) { asking.history = []; thread.replaceChildren(); }
    }
    hint();
    if (!question && !fresh && !send) { input.focus(); return; }
    const run = asking;
    if (run.busy) return;
    run.busy = true; input.value = ''; stop.hidden = false;
    if (question) thread.append(el('p', { className: 'practice-ask-question', textContent: question }));
    const reply = el('div', { className: 'practice-ask-answer chat-body' });
    thread.append(reply);
    const started = Date.now();
    let streamed = '';
    try {
      await loadProviders().catch(() => {});
      const tool = provider.value || 'claude', name = provider.selectedOptions[0]?.textContent || 'your AI tool', want = material();
      const waiting = () => { if (!streamed) reply.textContent = `Asking ${name}… ${Math.round((Date.now() - started) / 1000)} s`; };
      waiting(); run.clock = setInterval(waiting, 1000);
      const ctx = await context(current, want);
      if (asking !== run) return;
      const text0 = [prompt(current, { history: run.history, question, withImage: !!ctx.images.length }), ...(ctx.notes || []), ctx.text].filter(Boolean).join('\n\n');
      let timer = 0, rendering = Promise.resolve();
      const show = () => { timer = 0; rendering = rendering.then(() => asking === run && render(reply, streamed)); };
      const { text } = await ai.run({ provider: tool, model: picker?.value || '', notePath: want.note ? notePath() : '', images: ctx.images, tag, prompt: text0 }, delta => { streamed += delta; timer ||= setTimeout(show, 120); });
      clearTimeout(timer); await rendering;
      if (asking !== run) return;
      const answer = text.trim();
      run.history.push({ role: 'user', content: question || 'Explain this.' }, { role: 'assistant', content: answer });
      await render(reply, answer);
      const upto = run.history.slice(), title = titleOf(current) || `Clarify: ${label}`;
      if (keep) { const row = el('div', { className: 'chat-actions' }); row.append(scratchButton(keep, () => ({ id: run.id, title, messages: upto }))); reply.append(row); }
      const before = saved(current)?.text;
      // Follow-ups are added under what is kept; the first answer keeps its question.
      const entry = question ? `**${question}**\n\n${answer}` : answer;
      await save(current, { ...ctx.savedFlags, text: before && !fresh ? `${before}\n\n${entry}` : entry, provider: name, at: Date.now() });
    } catch (error) {
      if (asking === run) { reply.textContent = error.message; reply.classList.add('chat-error'); }
    } finally {
      run.busy = false; clearInterval(run.clock);
      if (asking === run) { stop.hidden = true; hint(); input.focus(); }
    }
  }
  // A follow-up moves the conversation to Ask AI with its thread and context.
  form.onsubmit = event => {
    event.preventDefault();
    const q = input.value.trim(), current = asking?.item || item;
    if (!current) return;
    // The first question is answered here; follow-ups move to Ask AI.
    if (!asking?.history.length) return ask(current, q, { send: true });
    if (!q) return;
    if (!handoff) return ask(current, q);
    const history = asking.history;
    input.value = '';
    closeBox();
    // Every answer in that Ask AI conversation is still kept with the item, after what was saved.
    const onAnswer = async (question, answer) => {
      if (!answer) return;
      const before = saved(current);
      await save(current, { ...before, text: before?.text ? `${before.text}\n\n**${question}**\n\n${answer}` : `**${question}**\n\n${answer}`, provider: before?.provider || 'Ask AI', at: Date.now() });
      if (item === current && box.hidden) showSaved(current);
    };
    Promise.resolve(handoff({ item: current, history, question: q, onAnswer })).catch(() => {});
  };
  again.onclick = () => ask(asking?.item || item, '', { fresh: true });
  stop.onclick = () => ai?.cancel(tag);
  close.onclick = closeBox;
  return { ask, close: closeBox, showSaved, get open() { return !box.hidden; } };
}
