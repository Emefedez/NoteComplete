// Ask AI: a conversation about the open note through the user's own AI tool.
// Each question carries the current page (image with tape lifted + its text),
// a crop of the current selection, and, for tools that support it, the note
// file through the bundled MCP server so the AI can look at other pages.
import { canvasImage, textBlock } from './ai-context.js';

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

export function chatController({ ai, pageCanvas, pageText, documentInfo, currentPage, selection, notePath, status, providers }) {
  let history = [], busy = false;
  function add(role, content, note = '') {
    const item = document.createElement('li');
    item.className = `chat-${role}`;
    if (role === 'assistant') item.append(renderAnswer(content));
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
      for (const p of await providers()) select.add(new Option(p.label, p.id, false, false)).disabled = !p.available;
      try { select.value = localStorage.getItem('notecomplete-ai-provider') || select.querySelector('option:not([disabled])')?.value; } catch { /* Optional. */ }
    }
    $('chatNoteLabel').hidden = !notePath() || select.value === 'antigravity';
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
      const { text } = await ai.run({ provider: $('chatProvider').value, prompt, images, notePath: useNote ? notePath() : '' });
      history.push({ role: 'user', content: question }, { role: 'assistant', content: text.trim() });
      waiting.replaceChildren(renderAnswer(text));
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
  $('chatStop').onclick = () => ai?.cancel();
  $('chatClose').onclick = close;
  $('chatClear').onclick = () => { history = []; $('chatMessages').replaceChildren(); open(); };
  $('chatProvider').onchange = () => {
    $('chatNoteLabel').hidden = !notePath() || $('chatProvider').value === 'antigravity';
    try { localStorage.setItem('notecomplete-ai-provider', $('chatProvider').value); } catch { /* Optional. */ }
  };
  return { open, close, toggle: () => ($('chatPanel').hidden ? open() : close()), get visible() { return !$('chatPanel').hidden; } };
}
