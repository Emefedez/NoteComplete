// Home screen: recent notes kept on this device, the Drive section and the
// downloads-folder footer. The open document stays loaded while home is shown.
import { noteCover, blobReader } from './note-cover.js';
import { shrink } from './drive-thumbs.js';
import { openPdf } from './pdf-background.js';
import { noteFacts, matches, SIZES, PERIODS, SORTS, TYPES, compareNotes } from './note-facts.js';
import { migrator } from './migrate.js';
import { entryTitle, plainTitle } from './library.js';
import { isTextName } from './text-types.js';
import { localMember, webMember, starButton } from './groups.js';
import { icon } from './icons.js';
// The group member a Recent entry stands for (groups.js).
export const memberOf = (entry) => entry.source === 'local' ? localMember(entry.path, entry.name)
  : entry.source === 'web' ? webMember(entry.url, entry.name) : { key: entry.key, name: entry.name, source: entry.source || 'drive' };
export function homeScreen({ library, drive, open, openLink = null, status, versions = null, current = () => ({}), exportStudy = null, groups = null }) {
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
  // Identical copies kept before checksums existed are merged once per session.
  let merging = null;
  // Folders (groups.js): the folder open on Home shows its documents in place of Recent.
  let shownFolder = null;
  async function folderEntries(group) {
    const members = await groups.members(group);
    return Promise.all(members.map(async m => ({ ...((await library.store.get('entries', m.key).catch(() => null)) || { key: m.key, source: m.source, path: m.path, url: m.url, name: m.name, openedAt: 0, listed: true }), inFolder: m.inFolder, starred: !!m.starred })));
  }
  async function renderFolders() {
    if (!groups) return;
    const list = shownFolder ? [] : await groups.folders().catch(() => []);
    $('foldersSection').hidden = Boolean(shownFolder);
    $('foldersEmpty').hidden = list.length > 0;
    $('folderList').replaceChildren(...list.map(folderCard));
  }
  function folderCard(group) {
    const li = document.createElement('li'), button = document.createElement('button'), meta = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('span');
    button.type = 'button';
    button.className = 'folder-card';
    name.textContent = group.name;
    name.title = group.folder || group.name;
    detail.textContent = group.folder ? 'Folder on disk' : 'In NoteComplete';
    groups.members(group).then(m => { detail.textContent = `${m.length} document${m.length === 1 ? '' : 's'} · ${group.folder ? 'on disk' : 'in NoteComplete'}`; }).catch(() => {});
    meta.className = 'folder-meta';
    meta.append(name, detail);
    button.append(icon('folder'), meta);
    button.onclick = () => showFolder(group);
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'note-more'; more.textContent = '⋯'; more.title = 'More';
    more.setAttribute('aria-label', `More actions for ${group.name}`); more.setAttribute('aria-haspopup', 'menu');
    more.onclick = event => { event.stopPropagation(); folderMenu(group, more); };
    button.oncontextmenu = event => { event.preventDefault(); folderMenu(group, more); };
    li.append(button, more);
    return li;
  }
  function showFolder(group) {
    shownFolder = group;
    groups.touch(group).catch(() => {});
    renderRecent();
  }
  $('folderBack').onclick = () => { shownFolder = null; renderRecent(); };
  function inlineName(row, input, value, done) {
    row.hidden = false;
    input.value = value;
    input.focus(); input.select();
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); const v = input.value.trim(); if (v) done(v); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); row.hidden = true; }
    };
  }
  $('folderNew').onclick = () => inlineName($('folderNewRow'), $('folderNewName'), 'New folder', create);
  $('folderNewCreate').onclick = () => { const v = $('folderNewName').value.trim(); if (v) create(v); };
  $('folderNewCancel').onclick = () => { $('folderNewRow').hidden = true; };
  async function create(name) {
    $('folderNewRow').hidden = true;
    await groups.create(name);
    status(`Folder ${name} made. Put notes in it with ⋯ → Move to folder.`);
    renderFolders();
  }
  function placeMenu(menu, anchor) {
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), h = menu.offsetHeight, w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    menu.style.top = `${innerHeight - r.bottom > h + 12 ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  }
  function folderMenu(group, anchor) {
    const menu = $('folderMenu');
    $('folderMenuTitle').textContent = group.name;
    $('folderMenuText').textContent = group.folder ? `On disk: ${group.folder}. Removing it here leaves the folder and its files as they are.` : 'Removing the folder keeps its documents in Recent; no file is deleted.';
    $('folderRenameRow').hidden = true;
    $('folderRemove').textContent = 'Remove folder'; delete $('folderRemove').dataset.armed;
    const close = () => { menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
    const outside = event => { if (!menu.contains(event.target) && event.target !== anchor) close(); };
    $('folderRename').onclick = () => inlineName($('folderRenameRow'), $('folderRenameName'), group.name, async name => { await groups.rename(group, name); close(); renderFolders(); });
    $('folderRenameSave').onclick = async () => { const v = $('folderRenameName').value.trim(); if (v) { await groups.rename(group, v); close(); renderFolders(); } };
    $('folderRemove').onclick = async () => {
      if ($('folderRemove').dataset.armed !== '1') { $('folderRemove').dataset.armed = '1'; $('folderRemove').textContent = 'Press again to remove'; return; }
      await groups.delete(group); close(); status(`${group.name} removed from Folders.`); renderFolders();
    };
    placeMenu(menu, anchor);
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  // ⋯ → Move to folder…: the folders made here, or a new one.
  async function moveRow(entry, close) {
    const row = $('moveRow');
    const folders = (await groups.folders()).filter(g => g.kind === 'folder');
    const current = await groups.of(memberOf(entry)).catch(() => null);
    const buttons = folders.map(g => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.textContent = g.name;
      if (current?.id === g.id) { b.disabled = true; b.title = 'Already in this folder'; }
      b.onclick = async () => { await groups.move(memberOf(entry), g); close(); status(`${entryTitle(entry)} moved to ${g.name}.`); renderRecent(); };
      return b;
    });
    const fresh = document.createElement('button');
    fresh.type = 'button'; fresh.setAttribute('role', 'menuitem'); fresh.textContent = 'New folder…';
    fresh.onclick = () => inlineName($('moveNewRow'), $('moveNewName'), 'New folder', async name => { const g = await groups.create(name); await groups.move(memberOf(entry), g); close(); status(`${entryTitle(entry)} moved to ${name}.`); renderRecent(); });
    row.replaceChildren(...buttons, fresh);
    if (shownFolder && !entry.inFolder && shownFolder.members?.some(m => m.key === entry.key)) {
      const out = document.createElement('button');
      out.type = 'button'; out.setAttribute('role', 'menuitem'); out.textContent = `Take out of ${shownFolder.name}`;
      out.onclick = async () => { await groups.remove(shownFolder, entry.key); close(); status(`${entryTitle(entry)} taken out of ${shownFolder.name}.`); renderRecent(); };
      row.append(out);
    }
  }
  async function renderRecent() {
    merging ||= library.mergeDuplicates?.().then(n => { if (n) renderRecent(); }).catch(() => {});
    renderFolders();
    let entries = [];
    try {
      const read = shownFolder ? folderEntries(shownFolder) : library.recent();
      entries = await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(Error('the note storage did not answer')), 6000))]);
    }
    catch (error) {
      // Say why instead of silently hiding Recent (seen with several windows open).
      console.warn('Recent could not be read', error);
      status(`Recent notes could not be read: ${error?.message || error}. Reopen the window to retry.`, true);
    }
    $('recentTitle').textContent = shownFolder ? shownFolder.name : 'Recent';
    $('folderBack').hidden = !shownFolder;
    $('folderEmpty').hidden = !shownFolder || entries.length > 0;
    $('recentSection').hidden = !shownFolder && !entries.length;
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
      name.textContent = entryTitle(entry);
      name.title = entry.title ? `${entry.title}\nFile: ${entry.name}` : entry.name;
      detail.textContent = `${entry.source === 'drive' ? 'Drive' : entry.source === 'web' ? 'Web link' : 'This device'} · ${entry.openedAt ? `opened ${ago(entry.openedAt)}` : 'not opened yet'}`;
      meta.append(name, detail);
      const hit = entry.source === 'web' ? 'Web' : Object.entries(TYPES).find(([, [, re]]) => re.test(entry.name || ''))?.[1][0];
      if (hit) {
        const badge = document.createElement('span');
        badge.className = 'note-badge';
        badge.textContent = hit;
        meta.append(badge);
      }
      button.append(cover, meta);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'note-more'; remove.textContent = '⋯';
      remove.title = 'More'; remove.setAttribute('aria-label', `More actions for ${entryTitle(entry)}`); remove.setAttribute('aria-haspopup', 'menu');
      remove.onclick = event => { event.stopPropagation(); confirmRemove(entry, remove); };
      button.oncontextmenu = event => { event.preventDefault(); confirmRemove(entry, remove); };
      button.note = { name: entry.name, title: entryTitle(entry), modified: Date.parse(entry.modifiedTime) || entry.openedAt, size: Number(entry.size) || 0, facts: null, starred: !!entry.starred };
      if (!quick) {
        library.cover(coverKey(entry)).then(async url => {
          if (url) {
            cover.src = url;
          } else {
            try {
              const file = await library.open(entry);
              if (file) {
                await rememberCover(coverKey(entry), file);
                const next = await library.cover(coverKey(entry));
                if (next) { cover.src = next; return; }
              }
            } catch (e) {}
            cover.classList.add('missing');
          }
        });
        library.facts(coverKey(entry)).then(facts => { if (facts) { button.note.facts = facts; applyFilters(); } });
      }
      button.onclick = async () => {
        try {
          if (entry.source === 'web') { await library.touch(entry.key); return openLink?.(entry); }
          const file = await library.open(entry);
          // A file listed in a folder but never opened joins Recent now.
          if (file && entry.listed && entry.source === 'local') await library.rememberLocal(entry.path, entry.name, file.size);
          if (!file) {
            status(`${entry.name} is no longer in the downloads folder. Open it again from Drive.`, true);
            await library.forget(entry.key);
            return renderRecent();
          }
          // A Drive note may have a newer version there: the user picks first.
          if (await versions?.openRecent(entry, file)) return renderRecent();
          await library.touch(entry.key);
          await open(file, entry);
        } catch (error) { status(error.message, true); }
      };
      item.append(button, remove);
      // In a folder: a star keeps the document at the top of it.
      const folder = shownFolder;
      if (folder) item.append(starButton(!!entry.starred, entryTitle(entry), async on => { await groups.star(folder, entry.key, on); renderRecent(); }));
      return [item];
    } catch (error) { console.warn('Recent entry skipped', entry?.key, error); return []; }
  }
  // Remove a note from this device; for Drive notes, optionally upload the open
  // document's changes first, or (typed confirmation) move the Drive file to trash.
  const migration = migrator({ library, drive, status, refresh: () => renderRecent() });
  function confirmRemove(entry, anchor) {
    const isDrive = entry.source === 'drive', now = current();
    const changed = isDrive && now.entryKey === entry.key && now.dirty;
    $('forgetTitle').textContent = entryTitle(entry);
    $('forgetTitle').title = entry.name;
    rename(entry);
    $('forgetText').textContent = isDrive
      ? 'Deletes the copy kept on this device and its cover. The file in Google Drive stays as it is.'
      : 'Removes it from Recent. The file on your computer is not deleted.';
    $('forgetUpload').hidden = !changed;
    $('forgetDanger').hidden = !isDrive;
    $('forgetDanger').open = false;
    $('forgetConfirm').value = '';
    $('forgetDriveDelete').disabled = true;
    $('forgetStatus').textContent = changed ? 'This note is open with unsaved changes.' : '';
    const close = () => { $('forgetDialog').hidden = true; $('renameRow').hidden = true; anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
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
    $('moveRow').hidden = true; $('moveNewRow').hidden = true;
    $('moveOpen').hidden = !groups;
    $('moveOpen').onclick = async () => { const row = $('moveRow'); if (row.hidden) await moveRow(entry, close); row.hidden = !row.hidden; };
    $('forgetExport').hidden = !exportStudy;
    $('forgetExport').onclick = () => { close(); exportStudy?.(entry).catch(error => status(error.message, true)); };
    $('forgetMigrate').onclick = () => { close(); migration.open(entry).catch(error => status(error.message, true)); };
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
  // ⋯ → Rename…: only the title Recent shows changes; the file keeps its name.
  function rename(entry) {
    const row = $('renameRow'), input = $('renameInput');
    row.hidden = true;
    $('renameOpen').setAttribute('aria-expanded', 'false');
    const save = async (title) => {
      try {
        const renamed = await library.rename(entry.key, title);
        if (!renamed) return;
        $('forgetDialog').hidden = true; row.hidden = true;
        status(renamed.title ? `Shown as “${renamed.title}” in Recent. The file is still ${entry.name}.` : `Shown by its file name, ${plainTitle(entry.name)}.`);
        renderRecent();
      } catch (error) { status(error.message, true); }
    };
    $('renameOpen').onclick = () => {
      row.hidden = !row.hidden;
      $('renameOpen').setAttribute('aria-expanded', String(!row.hidden));
      if (row.hidden) return;
      input.value = entryTitle(entry);
      $('renameOriginal').textContent = `File name: ${entry.name}`;
      $('renameRestore').hidden = !entry.title;
      input.focus(); input.select();
    };
    $('renameSave').onclick = () => save(input.value);
    $('renameRestore').onclick = () => save('');
    input.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); save(input.value); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); row.hidden = true; $('renameOpen').focus(); }
    };
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
  let filters = { since: 0, period: '', tags: [], audio: false, sizes: [], types: [], sort: 'name' };
  try { Object.assign(filters, JSON.parse(localStorage.getItem('notecomplete-home-filters')) || {}); } catch { /* Optional. */ }
  if (!Array.isArray(filters.types)) filters.types = [];
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
    group('types').replaceChildren(label(group('types')), ...Object.entries(TYPES).map(([k, [name]]) => chip(name, filters.types.includes(k), () => { filters.types = filters.types.includes(k) ? filters.types.filter(x => x !== k) : [...filters.types, k]; changed(); })));
    group('sizes').replaceChildren(label(group('sizes')), ...Object.entries(SIZES).map(([k, [name]]) => chip(name, filters.sizes.includes(k), () => { filters.sizes = filters.sizes.includes(k) ? filters.sizes.filter(x => x !== k) : [...filters.sizes, k]; changed(); })));
    const known = new Set(filters.tags);
    for (const card of document.querySelectorAll('#recentList .note-card, #driveList .note-card')) for (const t of card.note?.facts?.tags || []) known.add(t);
    group('tags').hidden = !known.size;
    group('tags').replaceChildren(label(group('tags')), ...[...known].sort().map(t => chip(`#${t.replace(/^#/, '')}`, filters.tags.includes(t), () => { filters.tags = filters.tags.includes(t) ? filters.tags.filter(x => x !== t) : [...filters.tags, t]; changed(); })));
    document.querySelector('#homeFilters [data-filter="audio"]').setAttribute('aria-pressed', String(filters.audio));
    $('filtersClear').hidden = !(filters.period || filters.audio || filters.tags.length || filters.sizes.length || filters.types.length);
  }
  // Reorder note cards in place; Drive folders keep their place at the top.
  function sortCards() {
    const compare = compareNotes(filters.sort);
    for (const list of [$('recentList'), $('driveList')]) {
      const items = [...list.children], notes = items.filter(li => li.querySelector('.note-card')?.note);
      if (notes.length < 2) continue;
      // Starred documents of a folder stay first, whatever the sort.
      const sorted = [...notes].sort((a, b) => { const x = a.querySelector('.note-card').note, y = b.querySelector('.note-card').note; return (y.starred ? 1 : 0) - (x.starred ? 1 : 0) || compare(x, y); });
      if (sorted.every((li, i) => li === notes[i])) continue;
      const others = items.filter(li => !notes.includes(li));
      list.append(...others, ...sorted);
    }
  }
  function applyFilters() {
    sortCards();
    const active = filters.period || filters.audio || filters.tags.length || filters.sizes.length || filters.types.length;
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
  $('filtersClear').onclick = () => { filters = { ...filters, since: 0, period: '', tags: [], audio: false, sizes: [], types: [] }; changed(); };
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
    try {
      if (await library.cover(key)) return;
      if (/\.(jpe?g|png|webp)$/i.test(file.name) || file.type?.startsWith('image/')) {
        const url = await shrink(file);
        if (url) await library.saveCover(key, url);
        return;
      }
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdf = await openPdf(bytes);
        try {
          const page = await pdf.getPage(1);
          const vp = page.getViewport({ scale: 1 });
          const scale = Math.min(1, 320 / Math.max(1, vp.width));
          const scaled = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(scaled.width));
          canvas.height = Math.max(1, Math.round(scaled.height));
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
          const url = canvas.toDataURL('image/jpeg', 0.8);
          canvas.width = canvas.height = 0;
          page.cleanup();
          if (url) await library.saveCover(key, url);
        } finally {
          await pdf.loadingTask.destroy();
        }
        return;
      }
      if (/\.html?$/i.test(file.name) || file.type === 'text/html') {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240"><rect width="320" height="240" fill="#f8fafc"/><rect x="40" y="30" width="240" height="180" rx="8" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/><text x="160" y="115" font-family="system-ui, sans-serif" font-size="32" font-weight="bold" fill="#0284c7" text-anchor="middle">&lt;HTML/&gt;</text><text x="160" y="150" font-family="system-ui, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Interactive Exercise</text></svg>`;
        const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        await library.saveCover(key, url);
        return;
      }
      // Text and Markdown: the first lines, drawn like a page.
      if (isTextName(file.name)) {
        const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
        const lines = (await file.slice(0, 4000).text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 14);
        const rows = lines.map((l, i) => `<text x="22" y="${34 + i * 15}" font-size="${i === 0 ? 13 : 10}" font-weight="${i === 0 ? 700 : 400}" fill="${i === 0 ? '#1d2433' : '#5b6478'}">${esc(l.replace(/^#+\s*/, '').slice(0, 44))}</text>`).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" width="240" height="320"><rect width="240" height="320" fill="#ffffff"/><g font-family="system-ui, sans-serif">${rows}</g></svg>`;
        await library.saveCover(key, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
        return;
      }
      if (/\.noteful$/i.test(file.name)) {
        const cover = await noteCover(blobReader(file), file.size);
        if (cover) await library.saveCover(key, await shrink(new Blob([cover.bytes], { type: cover.mime })));
      }
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
    showFolder,
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
