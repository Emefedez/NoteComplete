// Ask AI: a conversation about the open note through the user's own AI tool.
// Each question carries the current page (image with tape lifted + its text),
// a crop of the current selection, and, for tools that support it, the note
// file through the bundled MCP server so the AI can look at other pages.
import { canvasImage, textBlock, notesBlock } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { renderMarkdown, plainText } from './rich-text.js';

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

export function chatController({ ai, pageCanvas, pageText, documentInfo, currentPage, selection, notePath, status, providers, markdown, toTextBox, notesText = async () => '' }) {
  let history = [], busy = false, attachments = [];
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
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '⧉';
    copy.title = 'Copy this answer';
    copy.onclick = () => navigator.clipboard.writeText(plainText(content)).then(() => status('Answer copied.'), () => status('The clipboard is not available here.', true));
    row.append(box, copy);
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
      try { select.value = localStorage.getItem('notecomplete-ai-provider') || select.querySelector('option:not([disabled])')?.value; } catch { /* Optional. */ }
      model.load(select.value);
    }
    $('chatNoteLabel').hidden = !notePath();
    // My notes is on when the note has Markdown notes.
    notesText().then(text => { if (!$('chatNotes').dataset.touched) $('chatNotes').checked = !!String(text || '').trim(); }).catch(() => {});
    $('chatPanel').hidden = false;
    if (!history.length && !$('chatMessages').children.length)
      add('assistant', 'Ask about this page or select something with **Select** first: a formula, a diagram, a sentence. I can see the page, its text and recognized handwriting, and lift the tape.');
    $('chatInput').focus();
  }
  function close() { $('chatPanel').hidden = true; }
  // A crop of the selected item from the page raster, with some margin.
  async function selectionImage(page) {
    const item = selection.item;
    if (!item || item.page !== page) return null;
    const { canvas, scale } = await pageCanvas(page, 2200, { liftTape: true });
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
    const blob = await (await fetch(url)).blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type === 'image/png' ? 'image/png' : 'image/jpeg', label };
  }
  async function ask(question) {
    if (busy || !question.trim()) return;
    busy = true;
    $('chatSend').hidden = true; $('chatStop').hidden = false;
    add('user', question);
    const waiting = add('assistant', '…', 'Thinking');
    try {
      const page = currentPage(), { title } = documentInfo();
      const images = [], context = [];
      if ($('chatPage').checked) {
        const { canvas } = await pageCanvas(page, 2200, { liftTape: true });
        images.push(await canvasImage(canvas, `page-${page + 1}`));
        canvas.width = canvas.height = 0;
        context.push(textBlock(page, await pageText(page)));
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
      if ($('chatSelection').checked) {
        const picked = await selectionImage(page);
        if (picked) { images.push(picked.image); context.push(`The student selected a ${picked.kind} on page ${page + 1}; its crop is the image labelled "selection". Focus on it.`); }
      }
      const transcript = history.slice(-10).map(m => `${m.role === 'user' ? 'Student' : 'You'}: ${m.content}`).join('\n\n');
      const prompt = [
        `You are a patient tutor helping a student understand their own notes, "${title}" (currently on page ${page + 1} of ${documentInfo().pages}). Handwriting, highlights and text under tape are the student's own. Answer in the student's language, clearly and briefly; use short examples or steps when they help. Say so when something is not on the page.`,
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
        if (!streamed) waiting.querySelector('small')?.remove();
        streamed += delta;
        timer ||= setTimeout(show, 120);
      });
      clearTimeout(timer);
      await rendering;
      history.push({ role: 'user', content: question }, { role: 'assistant', content: text.trim() });
      waiting.querySelector('small')?.remove();
      await answer(waiting, text);
      actions(waiting, text.trim());
    } catch (error) {
      waiting.replaceChildren(error.message);
      waiting.classList.add('chat-error');
    } finally {
      busy = false;
      $('chatSend').hidden = false; $('chatStop').hidden = true;
    }
  }
  $('chatForm').onsubmit = event => { event.preventDefault(); const q = $('chatInput').value; $('chatInput').value = ''; ask(q); };
  $('chatInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('chatForm').requestSubmit(); } };
  $('chatStop').onclick = () => ai?.cancel('chat');
  $('chatNotes').onchange = () => { $('chatNotes').dataset.touched = '1'; };
  $('chatClose').onclick = close;
  $('chatClear').onclick = () => { history = []; $('chatMessages').replaceChildren(); open(); };
  $('chatProvider').onchange = () => {
    $('chatNoteLabel').hidden = !notePath();
    try { localStorage.setItem('notecomplete-ai-provider', $('chatProvider').value); } catch { /* Optional. */ }
    model.load($('chatProvider').value);
  };
  return {
    attach,
    async askAbout({ question, image, label = 'a region of the notes' }) {
      await open();
      if (image) attach(image, label);
      $('chatSelection').checked = false;
      return ask(question);
    },
    open, close, toggle: () => ($('chatPanel').hidden ? open() : close()), get visible() { return !$('chatPanel').hidden; } };
}
