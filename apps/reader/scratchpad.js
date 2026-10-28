// Scratchpad: AI answers kept with the note. The Scratchpad button under an answer keeps
// its conversation up to that answer; pressing it again in the same conversation
// rewrites that entry. View → Scratchpad… shows them (Markdown and formulas), each with
// Add to notes, Copy and Delete. Kept per note (`scratch:<fingerprint>`).
import { renderMarkdown } from './rich-text.js';
const $ = id => document.getElementById(id);

// The button under an answer; `snapshot()` gives { id, title, messages } at click time.
export function scratchButton(keep, snapshot) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'scratch-keep'; b.textContent = 'Scratchpad';
  b.title = 'Keep this conversation up to here in the note’s scratchpad (again in the same conversation: rewrites it)';
  b.onclick = () => keep?.(snapshot());
  return b;
}
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export { newId };
// A conversation as Markdown: each question in bold, then its answer.
export function conversationMarkdown(messages) {
  return messages.map(m => (m.role === 'user' ? `**${String(m.content).trim().replace(/\n+/g, ' ')}**` : String(m.content).trim())).filter(Boolean).join('\n\n');
}
// Same conversation: replace its entry (now up to the answer picked last); else add it on top.
export function keepEntry(list, entry) {
  return [entry, ...list.filter(e => e.id !== entry.id)];
}

export function scratchpad({ store, key, markdown, status, notes }) {
  const read = async () => (await store.get('settings', key()).catch(() => null)) || [];
  async function keep({ id, title, messages }) {
    if (!key()) return status('Open a note first.', true);
    const list = await read(), had = list.some(e => e.id === id);
    await store.set('settings', key(), keepEntry(list, { id, title: String(title || 'Ask AI').slice(0, 160), text: conversationMarkdown(messages), at: Date.now() }));
    status(had ? 'Scratchpad entry rewritten up to this answer.' : 'Kept in this note’s scratchpad (View → Scratchpad…).');
    if ($('scratchDialog').open) render();
  }
  async function render() {
    const list = await read();
    $('scratchEmpty').hidden = list.length > 0;
    $('scratchList').replaceChildren(...list.map(entry => {
      const item = document.createElement('li'), head = document.createElement('div'), title = document.createElement('strong'), when = document.createElement('span');
      head.className = 'scratch-head'; when.className = 'muted';
      title.textContent = entry.title; when.textContent = new Date(entry.at).toLocaleString();
      const button = (text, onclick, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = cls; b.onclick = onclick; return b; };
      const remove = button('Delete', async () => {
        if (remove.dataset.armed !== '1') { remove.dataset.armed = '1'; remove.textContent = 'Press again to delete'; return; }
        await store.set('settings', key(), (await read()).filter(e => e.id !== entry.id));
        render();
      }, 'scratch-delete');
      head.append(title, when, document.createElement('span'),
        button('Add to notes', async () => { await notes(`### ${entry.title}\n\n${entry.text}`); status('Added to the Markdown notes.'); }),
        button('Copy', () => navigator.clipboard.writeText(entry.text).then(() => status('Copied.'), () => status('The clipboard is not available here.', true))),
        remove);
      head.children[2].className = 'spacer';
      const body = document.createElement('div');
      body.className = 'chat-body scratch-body';
      renderMarkdown(body, entry.text, markdown).catch(() => { body.textContent = entry.text; });
      item.append(head, body);
      return item;
    }));
  }
  $('scratchClose').onclick = () => $('scratchDialog').close();
  return {
    keep,
    async open() {
      if (!key()) return status('Open a note first.', true);
      if (!$('scratchDialog').open) $('scratchDialog').showModal();
      await render();
    },
  };
}
