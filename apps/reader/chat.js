// Ask AI: a conversation about the open note through the user's own AI tool.
// Each question carries the current page (image with tape lifted + its text),
// a crop of the current selection, and, for tools that support it, the note
// file through the bundled MCP server so the AI can look at other pages.
import { scratchButton, newId } from './scratchpad.js';
import { canvasImage, textBlock, notesBlock, hasClipboardImage, clipboardImages } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { renderMarkdown, plainText, rememberAiFile } from './rich-text.js';

const $ = id => document.getElementById(id);

// Answers are shown as text: paragraphs, **bold** and `code`, never as HTML.
export function renderAnswer(text) {
  const fragment = document.createDocumentFragment();
  for (const paragraph of text.trim().split(/\n{2,}/)) {
    const p = document.createElement('p');
    for (const [i, line] of paragraph.split('\n').entries()) {
      if (i) p.append(document.createElement('br'));
      for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
        if (!part) continue;
        if (part.startsWith('**') && part.endsWith('**')) { const b = document.createElement('strong'); b.textContent = part.slice(2, -2); p.append(b); }
        else if (part.startsWith('`') && part.endsWith('`')) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); p.append(c); }
        else p.append(part);
      }
    }
    fragment.append(p);
  }
  return fragment;
}

// Text documents (documentInfo().unit 'section') send the section being read and
// the selected text instead of page images; their answers have no page to go on.
export function chatController({ ai, pageCanvas, pageText, documentInfo, currentPage, selection, notePath, status, providers, markdown, toTextBox, notesText = async () => '', keep = null, selectedText = () => '' }) {
  const sectioned = () => documentInfo().unit === 'section';
  // `follow`: a conversation continued from a quiz question or flashcard keeps adding
  // each answer to that item's saved explanation, until New.
  let history = [], busy = false, attachments = [], topic = '', conversation = newId(), chatTitle = '', follow = null;
  const model = ai ? modelPicker($('chatModel'), $('chatModelOther'), ai) : null;
  // Answers render as Markdown (lists, tables, code, formulas). Under each, T
  // puts its text in a text box on the current page; ⧉ copies it.
  function answer(item, content) {
    const body = item.querySelector('.chat-body') || item.appendChild(Object.assign(document.createElement('div'), { className: 'chat-body' }));
    return renderMarkdown(body, content, markdown).catch(() => { body.replaceChildren(renderAnswer(content)); });
  }
  function actions(item, content) {
    const row = document.createElement('div');
    row.className = 'chat-actions';
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'chat-to-text';
    box.textContent = 'T';
    box.title = 'Put this answer in a text box on the current page';
    box.onclick = () => toTextBox?.(plainText(content));
    box.hidden = sectioned();
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '⧉';
    copy.title = 'Copy this answer';
    copy.onclick = () => navigator.clipboard.writeText(plainText(content)).then(() => status('Answer copied.'), () => status('The clipboard is not available here.', true));
    // Scratchpad: this conversation up to this answer, kept with the note.
    const upto = history.slice(), id = conversation, title = chatTitle || history.find(m => m.role === 'user')?.content || 'Ask AI';
    row.append(box, copy, scratchButton(keep, () => ({ id, title, messages: upto })));
    item.append(row);
  }
  function add(role, content, note = '') {
    const item = document.createElement('li');
    item.className = `chat-${role}`;
    if (role === 'assistant') answer(item, content);
    else item.textContent = content;
    if (note) { const small = document.createElement('small'); small.textContent = note; item.append(small); }
    $('chatMessages').append(item);
    item.scrollIntoView({ block: 'end' });
    return item;
  }
  async function open() {
    if (!ai) {
      status('Ask AI uses AI tools installed on your computer (Claude Code, Antigravity or Codex) and is available in the desktop app.', true);
      return;
    }
    const select = $('chatProvider');
    if (!select.options.length) {
      for (const p of await providers()) {
        const option = new Option(p.available ? p.label : `${p.label} (not installed)`, p.id);
        option.disabled = !p.available;
        select.add(option);
      }
    }
    try {
      const saved = localStorage.getItem('notecomplete-ai-provider');
      if (saved && select.querySelector(`option[value="${saved}"]:not([disabled])`)) select.value = saved;
      else if (!select.value) select.value = select.querySelector('option:not([disabled])')?.value || '';
    } catch { /* Optional. */ }
    await model.load(select.value);
    $('chatNoteLabel').hidden = !notePath();
    // My notes is on when the note has Markdown notes.
    notesText().then(text => { if (!$('chatNotes').dataset.touched) $('chatNotes').checked = !!String(text || '').trim(); }).catch(() => {});
    $('chatPanel').hidden = false;
    $('chatPageLabel').textContent = sectioned() ? 'This part' : 'This page';
    $('chatPage').parentElement.title = sectioned() ? 'The part of the document you are reading' : '';
    $('chatInput').placeholder = sectioned() ? 'Ask about what you are reading, or select a passage first' : 'Ask about this page, or select something first with Select';
    if (!history.length && !$('chatMessages').children.length)
      add('assistant', sectioned()
        ? 'Ask about what you are reading, or select a passage first: a definition, a formula, a sentence. I get the part of the document in view and the text you select.'
        : 'Ask about this page or select something with **Select** first: a formula, a diagram, a sentence. I can see the page, its text and recognized handwriting, and lift the tape.');
    $('chatInput').focus();
  }
  function close() { $('chatPanel').hidden = true; }
  // A crop of the selected item from the page raster, with some margin.
  async function selectionImage(page) {
    const item = selection.item;
    if (sectioned() || !item || item.page !== page) return null;
    const drawn = await pageCanvas(page, 2200, { liftTape: true });
    if (!drawn) return null;
    const { canvas, scale } = drawn;
    const [x, y, w, h] = item.bounds, m = 40;
    const sx = Math.max(0, (x - m) * scale), sy = Math.max(0, (y - m) * scale);
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.min(canvas.width - sx, (w + 2 * m) * scale));
    crop.height = Math.max(1, Math.min(canvas.height - sy, (h + 2 * m) * scale));
    crop.getContext('2d').drawImage(canvas, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
    canvas.width = canvas.height = 0;
    return { image: await canvasImage(crop, 'selection', 1200), kind: item.kind };
  }
  // Images added from the Grab tool or a quiz question, sent with the next question.
  function attach(url, label) {
    attachments.push({ url, label });
    renderAttachments();
  }
  function renderAttachments() {
    $('chatAttachments').hidden = !attachments.length;
    $('chatAttachments').replaceChildren(...attachments.map((a, i) => {
      const item = document.createElement('figure'), img = document.createElement('img'), remove = document.createElement('button');
      img.src = a.url; img.alt = a.label;
      remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove'; remove.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
      item.append(img, remove);
      return item;
    }));
  }
  async function dataUrlImage(url, label) {
    rememberAiFile(label, { url, label });
    const blob = await (await fetch(url)).blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type === 'image/png' ? 'image/png' : 'image/jpeg', label };
  }
  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true;
    $('chatSend').hidden = true; $('chatStop').hidden = false;
    add('user', question);
    // Three dots pulse until the first words arrive.
    const waiting = add('assistant', '', 'Thinking');
    const dots = document.createElement('span');
    dots.className = 'typing-dots'; dots.setAttribute('aria-hidden', 'true');
    dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    waiting.prepend(dots);
    try {
      const page = currentPage(), { title, unit } = documentInfo(), sections = unit === 'section';
      const images = [], context = [];
      if (topic) context.push(topic);
      if ($('chatPage').checked) {
        const drawn = await pageCanvas(page, 2200, { liftTape: true });
        if (drawn) {
          images.push(await canvasImage(drawn.canvas, `page-${page + 1}`));
          drawn.canvas.width = drawn.canvas.height = 0;
        }
        context.push(textBlock(page, await pageText(page), sections ? 12000 : 6000, unit));
      }
      if ($('chatNotes').checked) {
        const block = notesBlock(await notesText().catch(() => ''));
        if (block) context.push(block);
      }
      for (const [i, a] of attachments.splice(0).entries()) {
        images.push(await dataUrlImage(a.url, `region-${i + 1}`));
        context.push(`The student attached ${a.label} as the image "region-${i + 1}". Focus on it.`);
      }
      renderAttachments();
      const passage = $('chatSelection').checked && sections ? selectedText() : '';
      if (passage) context.push(`The student selected this passage; focus on it:\n"""\n${passage}\n"""`);
      if ($('chatSelection').checked) {
        const picked = await selectionImage(page);
        if (picked) { images.push(picked.image); context.push(`The student selected a ${picked.kind} on page ${page + 1}; its crop is the image labelled "selection". Focus on it.`); }
      }
      const transcript = history.slice(-10).map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${m.content}`).join('\n\n');
      const prompt = [
        sections
          ? `You are a patient tutor helping a student understand their own text document, "${title}" (split into ${documentInfo().pages} sections; they are reading section ${page + 1}). Answer in the student's language, clearly and briefly; use short examples or steps when they help. Say so when something is not in the text.`
          : `You are a patient tutor helping a student understand their own notes, "${title}" (currently on page ${page + 1} of ${documentInfo().pages}). Handwriting, highlights and text under tape are the student's own. Answer in the student's language, clearly and briefly; use short examples or steps when they help. Say so when something is not on the page.`,
        context.join('\n\n'),
        transcript && `Conversation so far:\n${transcript}`,
        `Student: ${question}`,
      ].filter(Boolean).join('\n\n');
      const useNote = $('chatNote').checked && !$('chatNoteLabel').hidden;
      // The answer appears while it is written; Markdown is re-rendered at most
      // every 120 ms so long answers stay cheap.
      let streamed = '', timer = 0, rendering = Promise.resolve();
      const show = () => { timer = 0; rendering = rendering.then(() => answer(waiting, streamed)).then(() => waiting.scrollIntoView({ block: 'end' })); };
      const { text } = await ai.run({ provider: $('chatProvider').value, model: model.value, prompt, images, notePath: useNote ? notePath() : '', tag: 'chat' }, delta => {
        if (!streamed) { waiting.querySelector('small')?.remove(); dots.remove(); }
        streamed += delta;
        timer ||= setTimeout(show, 120);
      });
      clearTimeout(timer);
      await rendering;
      history.push({ role: 'user', content: question }, { role: 'assistant', content: text.trim() });
      waiting.querySelector('small')?.remove();
      dots.remove();
      await answer(waiting, text);
      actions(waiting, text.trim());
      follow?.(question, text.trim());
      return text.trim();
    } catch (error) {
      waiting.replaceChildren(error.message);
      waiting.classList.add('chat-error');
    } finally {
      busy = false;
      $('chatSend').hidden = false; $('chatStop').hidden = true;
    }
  }
  $('chatForm').onsubmit = event => {
    event.preventDefault();
    const q = $('chatInput').value.trim() || (attachments.length ? 'Explain this image.' : '');
    $('chatInput').value = '';
    ask(q);
  };
  $('chatInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('chatForm').requestSubmit(); } };
  $('chatPanel').addEventListener('paste', async event => {
    if (!hasClipboardImage(event.clipboardData)) return;
    event.preventDefault();
    for (const img of await clipboardImages(event.clipboardData).catch(() => [])) attach(img.url, img.label);
  });
  $('chatStop').onclick = () => ai?.cancel('chat');
  $('chatNotes').onchange = () => { $('chatNotes').dataset.touched = '1'; };
  $('chatClose').onclick = close;
  $('chatClear').onclick = () => { history = []; topic = ''; conversation = newId(); chatTitle = ''; follow = null; $('chatMessages').replaceChildren(); open(); };
  $('chatProvider').onchange = () => {
    $('chatNoteLabel').hidden = !notePath();
    try { localStorage.setItem('notecomplete-ai-provider', $('chatProvider').value); } catch { /* Optional. */ }
    model.load($('chatProvider').value);
  };
  return {
    attach,
    // A conversation started in a quiz or flashcard window carries on here: its topic goes
    // with every request until New, its turns join the history, then the new question is asked.
    async continueThread({ title, about, messages = [], image = null, label = 'the part of the notes it is about', extraImages = [], useNote = false, question, onAnswer = null }) {
      await open();
      history = messages.slice(-10);
      topic = about;
      conversation = newId(); chatTitle = title; follow = onAnswer;
      $('chatMessages').replaceChildren();
      const from = add('user', title);
      from.classList.add('chat-from');
      for (const m of history) add(m.role, m.content);
      if (image) attach(image, label);
      for (const a of extraImages) if (a?.url) attach(a.url, a.label || 'a pasted image from the clipboard');
      $('chatSelection').checked = false;
      $('chatPage').checked = false;
      $('chatNote').checked = !!useNote;
      return ask(question);
    },
    async askAbout({ question, image, label = 'a region of the notes' }) {
      await open();
      follow = null;
      if (image) attach(image, label);
      $('chatSelection').checked = false;
      return ask(question);
    },
    open, close, toggle: () => ($('chatPanel').hidden ? open() : close()), get visible() { return !$('chatPanel').hidden; } };
}
