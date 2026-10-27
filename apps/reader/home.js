// Home screen: recent notes kept on this device, the Drive section and the
// downloads-folder footer. The open document stays loaded while home is shown.
import { noteCover, blobReader } from './note-cover.js';
import { shrink } from './drive-thumbs.js';
import { noteFacts, matches, SIZES, PERIODS, SORTS, compareNotes } from './note-facts.js';

export function homeScreen({ library, drive, open, status, current = () => ({}) }) {
  const $ = id => document.getElementById(id);
  const ago = time => {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
    return new Date(time).toLocaleDateString();
  };
  let quick = false; // Quick list view: see setView.
  const coverKey = entry => entry.source === 'drive' ? library.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime }) : entry.key;
  async function renderRecent() {
    let entries = [];
    try { entries = await Promise.race([library.recent(), new Promise((_, reject) => setTimeout(() => reject(Error('the note storage did not answer')), 6000))]); }
    catch (error) {
      // Say why instead of silently hiding Recent (seen with several windows open).
      console.warn('Recent could not be read', error);
      status(`Recent notes could not be read: ${error?.message || error}. Reopen the window to retry.`, true);
    }
    $('recentSection').hidden = !entries.length;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) fragment.append(...recentCard(entry));
    $('recentList').replaceChildren(fragment);
    applyFilters();
  }
  // One Recent card; an entry that cannot be shown is skipped instead of emptying the list.
  function recentCard(entry) {
    try {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-card';
      const cover = document.createElement('img');
      cover.className = 'note-cover';
      cover.alt = '';
      const meta = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('span');
      meta.className = 'note-meta';
      name.textContent = entry.name.replace(/\.noteful$/i, '');
      name.title = entry.name;
      detail.textContent = `${entry.source === 'drive' ? 'Drive' : 'This device'} · opened ${ago(entry.openedAt)}`;
      meta.append(name, detail);
      button.append(cover, meta);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'note-more'; remove.textContent = '⋯';
      remove.title = 'More'; remove.setAttribute('aria-label', `More actions for ${entry.name}`); remove.setAttribute('aria-haspopup', 'menu');
      remove.onclick = event => { event.stopPropagation(); confirmRemove(entry, remove); };
      button.oncontextmenu = event => { event.preventDefault(); confirmRemove(entry, remove); };
      button.note = { name: entry.name, modified: Date.parse(entry.modifiedTime) || entry.openedAt, size: Number(entry.size) || 0, facts: null };
      if (!quick) {
        library.cover(coverKey(entry)).then(url => { if (url) cover.src = url; else cover.classList.add('missing'); });
        library.facts(coverKey(entry)).then(facts => { if (facts) { button.note.facts = facts; applyFilters(); } });
      }
      button.onclick = async () => {
        try {
          const file = await library.open(entry);
          if (!file) {
            status(`${entry.name} is no longer in the downloads folder. Open it again from Drive.`, true);
            await library.forget(entry.key);
            return renderRecent();
          }
          await library.touch(entry.key);
          await open(file, entry);
        } catch (error) { status(error.message, true); }
      };
      item.append(button, remove);
      return [item];
    } catch (error) { console.warn('Recent entry skipped', entry?.key, error); return []; }
  }
  // Remove a note from this device; for Drive notes, optionally upload the open
  // document's changes first, or (typed confirmation) move the Drive file to trash.
  function confirmRemove(entry, anchor) {
    const isDrive = entry.source === 'drive', now = current();
    const changed = isDrive && now.entryKey === entry.key && now.dirty;
    $('forgetTitle').textContent = `Remove “${entry.name.replace(/\.noteful$/i, '')}”`;
    $('forgetText').textContent = isDrive
      ? 'Deletes the copy kept on this device and its cover. The file in Google Drive stays as it is.'
      : 'Removes it from Recent. The file on your computer is not deleted.';
    $('forgetUpload').hidden = !changed;
    $('forgetDanger').hidden = !isDrive;
    $('forgetDanger').open = false;
    $('forgetConfirm').value = '';
    $('forgetDriveDelete').disabled = true;
    $('forgetStatus').textContent = changed ? 'This note is open with unsaved changes.' : '';
    const close = () => { $('forgetDialog').hidden = true; anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
    const outside = event => { if (!$('forgetDialog').contains(event.target) && event.target !== anchor) close(); };
    const done = async (text) => { await library.forget(entry.key, { deleteFile: isDrive }); close(); status(text); renderRecent(); };
    $('forgetLocal').onclick = () => done(isDrive ? 'Removed from this device. Drive is unchanged.' : 'Removed from Recent.');
    $('forgetUpload').onclick = async () => {
      try {
        $('forgetStatus').textContent = 'Exporting the note…';
        const blob = await now.exportBlob();
        await drive.update(entry, blob, text => { $('forgetStatus').textContent = text; });
        await done('Changes uploaded to Drive, then removed from this device.');
      } catch (error) { $('forgetStatus').textContent = error.message; }
    };
    $('forgetConfirm').oninput = () => { $('forgetDriveDelete').disabled = $('forgetConfirm').value.trim() !== 'DELETE'; };
    $('forgetDriveDelete').onclick = async () => {
      if ($('forgetConfirm').value.trim() !== 'DELETE') return;
      try {
        $('forgetStatus').textContent = 'Moving the file to Google Drive’s trash…';
        await drive.trash(entry);
        await done('Moved to Google Drive’s trash (restorable there for 30 days) and removed from this device.');
      } catch (error) { $('forgetStatus').textContent = error.message; }
    };
    $('forgetCancel').onclick = close;
    // Drop down under the ⋯ button, or up when there is no room below.
    const menu = $('forgetDialog');
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), h = menu.offsetHeight, w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    menu.style.top = `${innerHeight - r.bottom > h + 12 ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    $('forgetDanger').ontoggle = () => { if (menu.getBoundingClientRect().bottom > innerHeight - 8) menu.style.top = `${Math.max(8, innerHeight - menu.offsetHeight - 8)}px`; };
  }
  async function renderFolder() {
    try { $('libraryFolder').textContent = (await library.location()).label; }
    catch { $('libraryFolder').textContent = 'Not available'; }
    $('libraryChoose').hidden = !library.canChoose;
  }
  $('libraryChoose').onclick = async () => {
    try {
      const folder = await library.choose();
      if (folder) status(`Downloaded notes will be kept in ${folder.label}. Earlier copies stay where they were.`);
      renderFolder();
    } catch (error) { if (error.name !== 'AbortError') status(error.message, true); }
  };
  // Stackable filters over Recent and Drive cards; remembered on this device.
  let filters = { since: 0, period: '', tags: [], audio: false, sizes: [], sort: 'name' };
  try { Object.assign(filters, JSON.parse(localStorage.getItem('notecomplete-home-filters')) || {}); } catch { /* Optional. */ }
  const chip = (label, pressed, onclick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    b.onclick = onclick;
    return b;
  };
  const group = name => document.querySelector(`#homeFilters [data-group="${name}"]`);
  function changed() {
    filters.since = filters.period ? Date.now() - PERIODS[filters.period][1] : 0;
    try { localStorage.setItem('notecomplete-home-filters', JSON.stringify({ ...filters, since: 0 })); } catch { /* Optional. */ }
    renderFilters();
    applyFilters();
  }
  function renderFilters() {
    const label = n => n.querySelector('.filter-label');
    group('period').replaceChildren(label(group('period')), ...Object.entries(PERIODS).map(([k, [name]]) => chip(name, filters.period === k, () => { filters.period = filters.period === k ? '' : k; changed(); })));
    group('sizes').replaceChildren(label(group('sizes')), ...Object.entries(SIZES).map(([k, [name]]) => chip(name, filters.sizes.includes(k), () => { filters.sizes = filters.sizes.includes(k) ? filters.sizes.filter(x => x !== k) : [...filters.sizes, k]; changed(); })));
    const known = new Set(filters.tags);
    for (const card of document.querySelectorAll('#recentList .note-card, #driveList .note-card')) for (const t of card.note?.facts?.tags || []) known.add(t);
    group('tags').hidden = !known.size;
    group('tags').replaceChildren(label(group('tags')), ...[...known].sort().map(t => chip(`#${t.replace(/^#/, '')}`, filters.tags.includes(t), () => { filters.tags = filters.tags.includes(t) ? filters.tags.filter(x => x !== t) : [...filters.tags, t]; changed(); })));
    document.querySelector('#homeFilters [data-filter="audio"]').setAttribute('aria-pressed', String(filters.audio));
    $('filtersClear').hidden = !(filters.period || filters.audio || filters.tags.length || filters.sizes.length);
  }
  // Reorder note cards in place; Drive folders keep their place at the top.
  function sortCards() {
    const compare = compareNotes(filters.sort);
    for (const list of [$('recentList'), $('driveList')]) {
      const items = [...list.children], notes = items.filter(li => li.querySelector('.note-card')?.note);
      if (notes.length < 2) continue;
      const sorted = [...notes].sort((a, b) => compare(a.querySelector('.note-card').note, b.querySelector('.note-card').note));
      if (sorted.every((li, i) => li === notes[i])) continue;
      const others = items.filter(li => !notes.includes(li));
      list.append(...others, ...sorted);
    }
  }
  function applyFilters() {
    sortCards();
    const active = filters.period || filters.audio || filters.tags.length || filters.sizes.length;
    let hidden = 0, unknown = 0;
    for (const card of document.querySelectorAll('#recentList .note-card, #driveList .note-card')) {
      const show = !active || !card.note || matches(card.note, filters);
      card.closest('li').hidden = !show;
      if (!show) { hidden++; if (filters.tags.length && card.note && card.note.facts?.tags == null) unknown++; }
    }
    const needsFacts = quick && (filters.audio || filters.tags.length);
    $('filterSummary').textContent = active ? `${hidden} hidden by filters${needsFacts ? ' · the quick list does not read recordings or tags; switch to cards for those filters' : unknown ? ` · ${unknown} not yet read for tags (open them once)` : ''}` : '';
    renderFiltersSoon();
  }
  let filterFrame = 0;
  // New tags can appear as facts arrive; refresh the chips at most once per frame.
  const renderFiltersSoon = () => { cancelAnimationFrame(filterFrame); filterFrame = requestAnimationFrame(renderFilters); };
  document.querySelector('#homeFilters [data-filter="audio"]').onclick = () => { filters.audio = !filters.audio; changed(); };
  $('filtersClear').onclick = () => { filters = { ...filters, since: 0, period: '', tags: [], audio: false, sizes: [] }; changed(); };
  for (const [value, label] of Object.entries(SORTS)) $('homeSort').add(new Option(label, value));
  $('homeSort').value = SORTS[filters.sort] ? filters.sort : 'name';
  $('homeSort').onchange = () => { filters.sort = $('homeSort').value; changed(); };
  filters.since = filters.period ? Date.now() - (PERIODS[filters.period]?.[1] || 0) : 0;
  renderFilters();
  // Facts of a note that was just opened, for Recent filtering (local files and kept copies).
  async function rememberFacts(key, file) {
    if (!/\.noteful$/i.test(file.name) || await library.facts(key)) return;
    try { await library.saveFacts(key, await noteFacts(blobReader(file), file.size)); } catch { /* Filters treat it as unknown. */ }
  }
  // Keep a cover for files opened from disk so Recent can show them.
  async function rememberCover(key, file) {
    if (!/\.noteful$/i.test(file.name)) return;
    try {
      if (await library.cover(key)) return;
      const cover = await noteCover(blobReader(file), file.size);
      if (cover) await library.saveCover(key, await shrink(new Blob([cover.bytes], { type: cover.mime })));
    } catch { /* A missing cover only affects the Recent card. */ }
  }
  // Cards with covers, or a quick list that reads nothing from the files (remembered).
  function setView(view) {
    quick = view === 'list';
    document.body.classList.toggle('home-list', quick);
    for (const b of document.querySelectorAll('[data-home-view]')) b.setAttribute('aria-checked', String(b.dataset.homeView === view));
    try { localStorage.setItem('notecomplete-home-view', view); } catch { /* Optional. */ }
    drive.setQuick?.(quick);
  }
  for (const b of document.querySelectorAll('[data-home-view]')) b.onclick = () => { const was = quick; setView(b.dataset.homeView); if (was && !quick) renderRecent(); };
  try { setView(localStorage.getItem('notecomplete-home-view') === 'list' ? 'list' : 'cards'); } catch { setView('cards'); }
  let shown = false;
  return {
    show(hasDocument) {
      $('empty').hidden = false;
      $('homeBack').hidden = !hasDocument;
      if (!shown) { shown = true; drive.show(); }
      renderRecent(); renderFolder();
    },
    hide() {
      $('empty').hidden = true;
      if (shown) { shown = false; drive.hide(); }
    },
    get visible() { return !$('empty').hidden; },
    rememberCover,
    rememberFacts,
    applyFilters,
    renderRecent,
  };
}
