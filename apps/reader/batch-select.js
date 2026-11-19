// Selection mode over Recent for batch actions (Batch transcribe, Batch OCR): notes the
// action cannot use are greyed out, notes are picked with the standard circle tick, and a
// note with several items (recordings) gets a pill to pick which ones (all by default).
// The action itself (its dialog and its job) belongs to the caller: batch-transcribe.js and
// batch-ocr.js. Only one selection mode runs at a time (home.js exits the others).
import { openContextMenu } from './context-menu.js';

const TICK = (size) => `<span class="note-select-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>`;
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

// config:
//   ids        { mode, selectAll, start, cancel }: the Recent toolbar buttons
//   discover   async (entry) => items [{ id, name, detail? }] the action can use in that note
//   noun       ['audio', 'audios']: what an item is called
//   startLabel (notes, items) => text of the Start button
//   pill       (info, picked) => { text, title }: the chip on a selected card
//   noItems    status message for a click on a note it cannot use
//   annotate   (card, info) optional: after discovery, before the card is drawn
//   open       () => the action's dialog (Start pressed)
//   onEnter    () optional: another selection mode is left
export function batchSelection({ doc = document, status = () => {}, ids, discover, noun, startLabel, pill, noItems, annotate = () => {}, open, onEnter = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let selecting = false;
  // Map<entryKey, { entry, title, items, selectedIds: Set<string> }>
  const noteMap = new Map();
  const selectedNotes = new Set();
  let inspectToken = 0;

  function totals() {
    let notes = 0, items = 0;
    for (const key of selectedNotes) {
      const count = noteMap.get(key)?.selectedIds.size || 0;
      if (count > 0) { notes++; items += count; }
    }
    return { notes, items };
  }
  // The chosen items, note by note.
  function tasks() {
    const out = [];
    for (const key of selectedNotes) {
      const info = noteMap.get(key);
      if (!info) continue;
      for (const item of info.items) if (info.selectedIds.has(item.id)) out.push({ info, item });
    }
    return out;
  }
  const selectableCards = () => [...doc.querySelectorAll('#recentList .note-card.has-items')].filter((c) => !c.closest('li')?.hidden);
  const cardOf = (key) => doc.querySelector(`#recentList .note-card[data-entry-key="${CSS.escape(key)}"]`);

  function updateToolbar() {
    const modeBtn = $(ids.mode), allBtn = $(ids.selectAll), startBtn = $(ids.start), cancelBtn = $(ids.cancel);
    if (!modeBtn) return;
    modeBtn.hidden = selecting;
    if (allBtn) allBtn.hidden = !selecting;
    if (startBtn) startBtn.hidden = !selecting;
    if (cancelBtn) cancelBtn.hidden = !selecting;
    if (!selecting) return;
    const cards = selectableCards();
    const allSelected = cards.length > 0 && cards.every((c) => selectedNotes.has(c.dataset.entryKey));
    if (allBtn) {
      allBtn.textContent = allSelected ? 'Deselect all' : 'Select all';
      allBtn.disabled = cards.length === 0;
    }
    const { notes, items } = totals();
    if (startBtn) {
      startBtn.disabled = items === 0;
      startBtn.textContent = startLabel(notes, items);
    }
  }

  // All of a note's items on or off.
  function setNote(info, on) {
    if (on) { info.items.forEach((i) => info.selectedIds.add(i.id)); selectedNotes.add(info.entry.key); }
    else { info.selectedIds.clear(); selectedNotes.delete(info.entry.key); }
  }
  function toggleItem(info, id) {
    if (info.selectedIds.has(id)) info.selectedIds.delete(id);
    else info.selectedIds.add(id);
    if (info.selectedIds.size === 0) selectedNotes.delete(info.entry.key);
    else selectedNotes.add(info.entry.key);
  }
  function changed(info) {
    const card = info && cardOf(info.entry.key);
    if (card) syncCard(card);
    updateToolbar();
  }

  function syncCard(card) {
    const key = card?.dataset?.entryKey;
    if (!key) return;
    const info = noteMap.get(key);
    const usable = Boolean(info && info.items.length > 0);
    const isSel = usable && selectedNotes.has(key) && info.selectedIds.size > 0;
    card.classList.toggle('has-items', usable);
    card.classList.toggle('no-items', !usable);
    card.classList.toggle('is-selected', isSel);
    let chip = card.parentElement?.querySelector('.card-batch-pick');
    if (!selecting || !usable) {
      if (chip) chip.hidden = true;
      return;
    }
    if (!chip) {
      chip = doc.createElement('button');
      chip.type = 'button';
      chip.className = 'chip card-batch-pick';
      card.parentElement?.append(chip);
    }
    // The note may have been read again since the chip was made: it always opens the current one.
    chip.onclick = (e) => {
      e.stopPropagation();
      if (noteMap.get(key)?.items.length > 1) openItemMenu(chip, noteMap.get(key));
    };
    chip.hidden = false;
    const { text, title } = pill(info, isSel ? info.selectedIds.size : info.items.length);
    chip.textContent = text;
    chip.title = title || '';
  }

  function openItemMenu(anchor, info) {
    if (!selectedNotes.has(info.entry.key) && !info.selectedIds.size) setNote(info, true);
    else selectedNotes.add(info.entry.key);
    const r = anchor.getBoundingClientRect();
    const all = () => info.selectedIds.size === info.items.length;
    const rebuild = () => openContextMenu(r.left, r.bottom + 4, [
      { label: all() ? `Deselect all ${noun[1]} in this note` : `Select all ${noun[1]} in this note`, icon: 'check', run: () => { setNote(info, !all()); changed(info); } },
      '-',
      ...info.items.map((item) => ({
        label: item.detail ? `${item.name} (${item.detail})` : item.name,
        checked: info.selectedIds.has(item.id),
        run: () => { toggleItem(info, item.id); changed(info); setTimeout(rebuild, 0); },
      })),
    ], { title: `${info.title} · ${noun[1][0].toUpperCase()}${noun[1].slice(1)}` });
    rebuild();
  }

  async function inspect() {
    const token = ++inspectToken;
    const cards = [...doc.querySelectorAll('#recentList .note-card')];
    await Promise.all(cards.map(async (card) => {
      const entry = card.noteEntry;
      if (!entry) { card.classList.add('no-items'); return; }
      card.dataset.entryKey = entry.key;
      let info = noteMap.get(entry.key);
      if (!info) {
        const items = await discover(entry).catch(() => []);
        if (token !== inspectToken) return;
        info = { entry, title: card.note?.title || entry.name, items, selectedIds: new Set(items.map((i) => i.id)) };
        noteMap.set(entry.key, info);
      }
      annotate(card, info);
      syncCard(card);
    }));
    if (token === inspectToken) updateToolbar();
  }

  function enter() {
    onEnter();
    selecting = true;
    selectedNotes.clear();
    for (const info of noteMap.values()) info.selectedIds = new Set(info.items.map((i) => i.id));
    $('recentList')?.classList.add('queue-selecting', 'batch-selecting');
    updateToolbar();
    void inspect();
  }
  function exit() {
    if (!selecting) return;
    selecting = false;
    inspectToken++;
    selectedNotes.clear();
    $('recentList')?.classList.remove('queue-selecting', 'batch-selecting');
    for (const card of doc.querySelectorAll('#recentList .note-card')) card.classList.remove('is-selected', 'no-items', 'has-items');
    for (const chip of doc.querySelectorAll('#recentList .card-batch-pick')) chip.hidden = true;
    updateToolbar();
  }

  function handleCardClick(card, entry) {
    if (!selecting) return false;
    const key = entry?.key || card.dataset.entryKey;
    const info = noteMap.get(key);
    if (!info || info.items.length === 0) {
      status(noItems);
      return true;
    }
    setNote(info, !selectedNotes.has(key));
    changed(info);
    return true;
  }

  function toggleAll() {
    if (!selecting) return;
    const cards = selectableCards();
    const allSelected = cards.length > 0 && cards.every((c) => selectedNotes.has(c.dataset.entryKey));
    for (const card of cards) {
      const info = noteMap.get(card.dataset.entryKey);
      if (!info?.items.length) continue;
      setNote(info, !allSelected);
      syncCard(card);
    }
    updateToolbar();
  }

  // The dialog's list of chosen notes, each with its items when it has several; a click on a
  // note or an item changes the selection on the cards too. `labels(items)` gives the summary
  // and the confirm button's text.
  function renderChecklist({ list, summary, confirm, selectAll, labels }) {
    list.replaceChildren();
    const shown = [...noteMap.values()].filter((info) => info.items.length > 0 && (selectedNotes.has(info.entry.key) || info.selectedIds.size > 0));
    const again = () => renderChecklist({ list, summary, confirm, selectAll, labels });
    for (const info of shown) {
      const group = doc.createElement('div');
      group.className = 'bt-note-group';
      const noteSelected = selectedNotes.has(info.entry.key) && info.selectedIds.size > 0;
      const head = doc.createElement('div');
      head.className = `bt-note-head${noteSelected ? ' is-selected' : ''}`;
      head.innerHTML = `${TICK(13)}<strong class="bt-note-title"></strong><span class="muted bt-note-count"></span>`;
      head.querySelector('.bt-note-title').textContent = info.title;
      head.querySelector('.bt-note-count').textContent = info.items.length > 1 ? `${info.selectedIds.size} of ${plural(info.items.length, noun)}` : info.items[0]?.detail || '';
      head.onclick = () => { setNote(info, !(noteSelected && info.selectedIds.size === info.items.length)); changed(info); again(); };
      group.append(head);
      if (info.items.length > 1) {
        const rows = doc.createElement('div');
        rows.className = 'bt-rec-list';
        for (const item of info.items) {
          const on = noteSelected && info.selectedIds.has(item.id);
          const row = doc.createElement('button');
          row.type = 'button';
          row.className = `bt-rec-row${on ? ' is-selected' : ''}`;
          row.innerHTML = `${TICK(12)}<span class="bt-rec-name"></span><span class="muted bt-rec-dur"></span>`;
          row.querySelector('.bt-rec-name').textContent = item.name;
          row.querySelector('.bt-rec-dur').textContent = item.detail || '';
          row.onclick = () => { toggleItem(info, item.id); changed(info); again(); };
          rows.append(row);
        }
        group.append(rows);
      }
      list.append(group);
    }
    const { notes, items } = totals();
    const text = labels(notes, items);
    if (summary) summary.textContent = text.summary;
    if (confirm) { confirm.disabled = items === 0; confirm.textContent = text.confirm; }
    if (selectAll) {
      const allChecked = shown.length > 0 && shown.every((info) => selectedNotes.has(info.entry.key) && info.selectedIds.size === info.items.length);
      selectAll.textContent = allChecked ? 'Deselect all' : 'Select all';
      selectAll.onclick = () => { for (const info of shown) { setNote(info, !allChecked); changed(info); } again(); };
    }
  }

  if ($(ids.mode)) $(ids.mode).onclick = () => enter();
  if ($(ids.selectAll)) $(ids.selectAll).onclick = () => toggleAll();
  if ($(ids.cancel)) $(ids.cancel).onclick = () => exit();
  if ($(ids.start)) $(ids.start).onclick = () => { void open(); };

  return {
    get selecting() { return selecting; },
    tasks, totals, renderChecklist, handleCardClick, exit,
    onRecentRendered: () => { if (selecting) void inspect(); },
  };
}

export { plural };
