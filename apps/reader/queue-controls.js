// The download queue's shared interface parts: the rows of the queue list in the Cloud bar,
// the queue button on each file card of the Drive and Internet Archive browsers, the
// check mark of a selected card, and the Select / Queue all / Download / Cancel buttons.
// File names here come from Google Drive and Internet Archive listings, so they are only
// ever written as text, never as HTML.

const mb = (size) => `${(Number(size) / 1048576).toFixed(1)} MB`;

// The drawings, shared by the queue list and the card buttons (24 by 24, stroked).
const svg = (inner, strokeWidth, extra = "") => `<svg${extra} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="${strokeWidth}">${inner}</svg>`;
const TICK = `<path d="M5 13l4 4L19 7"/>`;
const ARROW = `<path d="M12 4v12m-4-4 4 4 4-4M5 20h14"/>`;
const CLOCK = `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`;

// The small state icon in front of a queued file's name. Only fixed markup: nothing from
// the item is written into it.
export function queueStatusIcon(status) {
  const cls = (state) => ` class="queue-status-svg is-${state}"`;
  if (status === "done") return svg(TICK, 2.5, cls("done"));
  if (status === "downloading") return svg(ARROW, 2, cls("downloading"));
  if (status === "error") return svg(`<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>`, 2, cls("error"));
  return svg(`<circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 7v5l3 3"/>`, 2, cls("queued"));
}

// What a queue row says: the file's name and, when known, its size.
export function queueItemLabel(item) {
  return `${item.name}${item.size ? ` (${mb(item.size)})` : ""}`;
}

// One row of the queue list: state icon, name, and a button that takes the file out of the
// queue. `doc` is the document to create elements in (a stand-in in the unit tests).
export function queueRow(item, { onRemove = () => {}, doc = document } = {}) {
  const li = doc.createElement("li");
  li.className = "cloud-queue-item";
  const info = doc.createElement("span");
  info.className = "cloud-queue-item-info";
  info.innerHTML = queueStatusIcon(item.status);
  const label = doc.createElement("span");
  label.textContent = queueItemLabel(item);
  info.append(label);
  if (item.error) info.title = item.error;
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "item-remove";
  remove.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  remove.title = "Remove from queue";
  remove.setAttribute("aria-label", `Remove ${item.name}`);
  remove.onclick = () => onRemove(item);
  li.append(info, remove);
  return li;
}

// How a card's queue button looks for a queue status: downloaded, waiting (or on its way),
// or not in the queue.
export function queueButtonState(status) {
  if (status === "done") return { className: "card-queue-btn is-done", icon: svg(TICK, 2.5), title: "Downloaded to library" };
  if (status === "downloading" || status === "queued") return { className: "card-queue-btn is-queued", icon: svg(CLOCK, 2), title: "Queued for download (click to remove)" };
  return { className: "card-queue-btn", icon: svg(ARROW, 2), title: "Queue for download" };
}

export function setQueueButton(button, status) {
  const state = queueButtonState(status);
  button.className = state.className;
  button.innerHTML = state.icon;
  button.title = state.title;
}

// A card's queue button after its file was saved to the library.
export function markQueueDone(button) {
  if (button) setQueueButton(button, "done");
}

// The queue button of one file card. `id` is the file's id in the queue, `item()` what to
// enqueue for it, and `kept` a promise that tells whether the library already has the file.
// A click takes a waiting file out of the queue, or puts the file in.
export function queueButton({ queue, id, item, kept = null, doc = document }) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "card-queue-btn";
  const show = () => setQueueButton(button, queue.statusOf(id));
  show();
  kept?.then((hit) => { if (hit) markQueueDone(button); }).catch(() => {});
  button.onclick = (e) => {
    e.stopPropagation();
    const status = queue.statusOf(id);
    if (status === "queued" || status === "downloading") queue.cancel(id);
    else queue.enqueue(item());
    show();
  };
  return button;
}

// The check mark shown on a card while files are being selected for the queue.
export function selectionCheck(doc = document) {
  const check = doc.createElement("span");
  check.className = "note-select-check";
  check.setAttribute("aria-hidden", "true");
  check.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
  return check;
}

// The buttons above a file list. With no queue or nothing to download they are all hidden;
// while selecting, Download (with the count) and Cancel; otherwise Select and Queue all.
// Any of the elements may be missing.
export function updateQueueControls({ mode, download, cancel, all, list }, { available, count, selecting, selected }) {
  if (!available || !count) {
    for (const el of [mode, download, cancel, all]) if (el) el.hidden = true;
    list?.classList?.remove?.("queue-selecting");
    return;
  }
  if (mode) mode.hidden = selecting;
  if (all) {
    all.hidden = selecting;
    if (!selecting) all.textContent = `Queue all (${count})`;
  }
  if (download) {
    download.hidden = !selecting;
    if (selecting) {
      download.textContent = `Download (${selected})`;
      download.disabled = selected === 0;
    }
  }
  if (cancel) cancel.hidden = !selecting;
  if (selecting) list?.classList?.add?.("queue-selecting");
  else list?.classList?.remove?.("queue-selecting");
}
