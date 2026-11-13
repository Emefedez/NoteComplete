// The download queue's shared interface parts: the rows of the queue list in the Cloud bar.
// File names here come from Google Drive and Internet Archive listings, so they are only
// ever written as text, never as HTML.

const mb = (size) => `${(Number(size) / 1048576).toFixed(1)} MB`;

// The small state icon in front of a queued file's name. Only fixed markup: nothing from
// the item is written into it.
export function queueStatusIcon(status) {
  if (status === "done") {
    return `<svg class="queue-status-svg is-done" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>`;
  }
  if (status === "downloading") {
    return `<svg class="queue-status-svg is-downloading" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m-4-4 4 4 4-4M5 20h14"/></svg>`;
  }
  if (status === "error") {
    return `<svg class="queue-status-svg is-error" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`;
  }
  return `<svg class="queue-status-svg is-queued" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 7v5l3 3"/></svg>`;
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
