// Home screen: recent notes kept on this device, the Drive section and the
// downloads-folder footer. The open document stays loaded while home is shown.
import { noteCover, archiveCover, blobReader, notebookCover, markNotebookCover } from './note-cover.js';
import { shrink } from './drive-thumbs.js';
import { openPdf } from './pdf-background.js';
import { isNotePackageTar } from './archive.js';
import { noteFacts, matches, SIZES, PERIODS, SORTS, TYPES, compareNotes } from './note-facts.js';
import { migrator } from './migrate.js';
import { entryTitle, entrySourceLabel, plainTitle } from './library.js';
import { isTextName, isOfficeName, isMediaName, isImageName } from './text-types.js';
import { fileCoverSvg, hasStaticFileCover } from './file-covers.js';
import { localMember, webMember, starButton } from './groups.js';
import { duplicatesDialog } from './duplicates.js';
import { icon } from './icons.js';
import { CLOUD_PROVIDERS, CLOUD_CONFIG_KEYS } from './cloud-collab.js';
import { selectionCheck } from './queue-controls.js';
import { attachOpenWithMenu } from './open-with-ui.js';
import { setupBatchTranscribe } from './batch-transcribe.js';
import { setupBatchOcr, indexNotes } from './batch-ocr.js';
import { setupBatchShare } from './batch-share.js';
import { contentSearcher } from './content-search.js';
const CATEGORY_ICONS = { types: 'note', period: 'clock', sources: 'cloud', sizes: 'storage', tags: 'hash' };
/** Return true when a document is text/Markdown and should skip raster page-0 cover screengrabs. */
// The cover of a text or Markdown file: its first lines drawn like a page, each wrapped to
// the card's width (long words broken) and stopped where the page ends. `TEXT_COVER` marks
// covers made this way; older ones (lines cut off past the edge) are drawn again.
export const TEXT_COVER = 'data-cover="text2"';
const OFFICE_PREVIEW_RE = /\.(docx|doc|docm|dotx|odt|fodt|rtf)$/i;
export function textCoverSvg(text, badge = '') {
  const W = 240, H = 320, X = 20, usable = W - 2 * X;
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const wrap = (line, chars) => {
    const out = [];
    let cur = '';
    for (let word of line.split(/\s+/)) {
      while (word.length > chars) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(word.slice(0, chars));
        word = word.slice(chars);
      }
      if (!word) continue;
      if (cur && (cur + ' ' + word).length > chars) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
    return out;
  };
  const source = String(text || '').split(/\r?\n/).map((l) => l.trim().replace(/^#+\s*/, '')).filter(Boolean);
  const rows = [];
  let y = 30;
  source.some((line, i) => {
    const fs = i === 0 ? 13 : 10, lh = i === 0 ? 17 : 13.5;
    for (const piece of wrap(line, Math.floor(usable / (fs * 0.58)))) {
      if (y > H - 14) return true;
      rows.push(`<text x="${X}" y="${y.toFixed(1)}" font-size="${fs}" font-weight="${i === 0 ? 700 : 400}" fill="${i === 0 ? '#1d2433' : '#5b6478'}">${esc(piece)}</text>`);
      y += lh;
    }
    y += i === 0 ? 4 : 1.5;
    return false;
  });
  const badgeSvg = badge ? `<rect x="${W - 58}" y="${H - 28}" width="46" height="18" rx="4" fill="#2563eb"/><text x="${W - 35}" y="${H - 15.5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="#ffffff">${esc(badge.toUpperCase())}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${TEXT_COVER} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g font-family="system-ui, sans-serif">${rows.join('')}</g>${badgeSvg}</svg>`;
}

export function shouldSkipCoverFile({ name = '', kind = '' } = {}) {
  if (kind === 'text' || kind === 'office') return true;
  if (kind && ['project', 'noteful', 'pdf', 'image', 'blank', 'handwritten', 'notecomplete'].includes(kind)) return false;
  return Boolean(name && (isTextName(name) || isOfficeName(name) || isMediaName(name)));
}
/** Return true when a cover image is missing or a tiny placeholder (<= 24px, e.g. 16x16 BLANK_COVER_JPEG). */
export function isTinyCoverSize(width, height) {
  return !(Number(width) > 24 && Number(height) > 24);
}
// The group member a Recent entry stands for (groups.js).
export const memberOf = (entry) => entry.source === 'local' ? localMember(entry.path, entry.name)
  : entry.source === 'web' ? webMember(entry.url, entry.name) : { key: entry.key, name: entry.name, source: entry.source || 'drive' };
export function homeScreen({ library, drive, dropbox = null, github = null, webdav = null, open, openLink = null, status, versions = null, current = () => ({}), exportStudy = null, cutHistory = null, exportNote = null, groups = null, archive = null, openArchive = null, jobs = null, pageCanvas = null, findIn = null, onContentKept = () => {}, shareZip = null }) {
  const $ = id => document.getElementById(id);
  // Batch actions over Recent: one selection mode at a time.
  const contents = contentSearcher(library);
  const kept = (fingerprint, data) => { contents.forget(fingerprint); onContentKept(fingerprint, data); };
  const others = (self) => () => { for (const batch of batches) if (batch !== self()) batch.exit(); };
  const batchTranscriber = setupBatchTranscribe({ library, status, jobs, onEnter: others(() => batchTranscriber) });
  const batchOcr = setupBatchOcr({ library, status, jobs, pageCanvas, onKept: kept, onEnter: others(() => batchOcr) });
  const batchShare = setupBatchShare({ library, status, shareZip, onEnter: others(() => batchShare) });
  const batches = [batchTranscriber, batchOcr, batchShare];
  // Search inside notes (set further down): declared first, Recent may draw before.
  let contentMode = false, contentMatches = null, contentRun = 0, contentTimer = 0;
  const ago = time => {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
    return new Date(time).toLocaleDateString();
  };
  // Favourites: a star on a Recent card; kept on this device, by entry key.
  let favourites = new Set();
  try { favourites = new Set(JSON.parse(localStorage.getItem('notecomplete-favourites')) || []); } catch { /* Optional. */ }
  const saveFavourites = () => { try { localStorage.setItem('notecomplete-favourites', JSON.stringify([...favourites])); } catch { /* Optional. */ } };
  let quick = false; // Quick list view: see setView.
  const coverKey = entry => entry.source === 'drive' ? library.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime })
    : (entry.source === 'dropbox' || entry.source === 'github' || entry.source === 'webdav') ? library.coverKey(entry) : entry.key;
  // Identical copies kept before checksums existed are merged once per session.
  let merging = null;
  // Folders (groups.js): the folder open on Home shows its documents in place of Recent.
  let shownFolder = null, lastFolder = null;
  async function folderEntries(group) {
    const members = await groups.members(group);
    return Promise.all(members.map(async m => ({ ...((await library.store.get('entries', m.key).catch(() => null)) || { ...m, openedAt: 0, listed: true }), inFolder: m.inFolder, starred: !!m.starred })));
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
    groups.members(group).then(m => { detail.textContent = `${m.length} document${m.length === 1 ? '' : 's'} · ${group.folder ? 'on disk' : 'in NoteComplete'}`; }).catch(() => { /* Optional. */ });
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
    lastFolder = null;
    groups.touch(group).catch(() => { /* Optional. */ });
    renderRecent();
  }
  function leaveFolder() {
    if (!shownFolder) return false;
    lastFolder = shownFolder;
    shownFolder = null;
    renderRecent();
    return true;
  }
  function reopenFolder() {
    if (shownFolder || !lastFolder) return false;
    showFolder(lastFolder);
    return true;
  }
  $('folderBack').onclick = leaveFolder;
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
  function placeMenu(menu, anchor, { align = 'right', minWidth = 0 } = {}) {
    if (menu.parentElement !== document.body) document.body.append(menu);
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const vw = innerWidth / z, vh = innerHeight / z;
    const r = anchor.getBoundingClientRect();
    const leftEdge = r.left / z, rightEdge = r.right / z, topEdge = r.top / z, bottomEdge = r.bottom / z;
    if (minWidth) menu.style.minWidth = `${Math.min(Math.max(minWidth, Math.round(r.width / z)), Math.round(vw - 16))}px`;
    menu.style.maxWidth = `${Math.max(160, Math.round(vw - 16))}px`;
    const w = menu.offsetWidth || minWidth || 200;
    const x = align === 'left' ? leftEdge : rightEdge - w;
    menu.style.left = `${Math.round(Math.max(8, Math.min(vw - w - 8, x)))}px`;
    const below = vh - bottomEdge - 10, above = topEdge - 10;
    const h = menu.offsetHeight || 200;
    if (below >= h || below >= above) {
      menu.style.maxHeight = `${Math.max(120, Math.round(below))}px`;
      menu.style.top = `${Math.round(bottomEdge + 6)}px`;
    } else {
      const mh = Math.max(120, Math.round(above));
      menu.style.maxHeight = `${mh}px`;
      menu.style.top = `${Math.round(Math.max(8, topEdge - Math.min(h, mh) - 6))}px`;
    }
  }
  function folderMenu(group, anchor) {
    const menu = $('folderMenu');
    $('folderMenuTitle').textContent = group.name;
    $('folderMenuText').textContent = group.folder ? `On disk: ${group.folder}. Removing it here leaves the folder and its files as they are.` : 'Removing the folder keeps its documents in Recent; no file is deleted.';
    $('folderRenameRow').hidden = true;
    $('folderRemove').querySelector('.menu-label').textContent = 'Remove folder'; delete $('folderRemove').dataset.armed;
    const close = () => { menu.hidden = true; anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
    const outside = event => { if (!menu.contains(event.target) && event.target !== anchor) close(); };
    $('folderRename').onclick = () => inlineName($('folderRenameRow'), $('folderRenameName'), group.name, async name => { await groups.rename(group, name); close(); renderFolders(); });
    $('folderRenameSave').onclick = async () => { const v = $('folderRenameName').value.trim(); if (v) { await groups.rename(group, v); close(); renderFolders(); } };
    $('folderRemove').onclick = async () => {
      if ($('folderRemove').dataset.armed !== '1') { $('folderRemove').dataset.armed = '1'; $('folderRemove').querySelector('.menu-label').textContent = 'Press again to remove'; return; }
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
  // Opens a Recent entry as a click on its card does. Resolves once it is shown.
  async function openEntry(entry) {
    try {
      const now = current();
      if (entry.source === 'web') {
        await library.touch(entry.key);
        if (((now.entryKey && now.entryKey === entry.key) || (now.webUrl && now.webUrl === entry.url)) && now.show) return now.show();
        return openLink?.(entry);
      }
      // A notebook inside an archive (a Goodnotes pack): unpacked from the archive.
      if (entry.source === 'archive') return openArchive?.(entry);
      if (now.entryKey && now.entryKey === entry.key && now.show && entry.source !== 'drive' && entry.source !== 'dropbox') {
        await library.touch(entry.key);
        return now.show();
      }
      const file = await library.open(entry);
      // A file listed in a folder but never opened joins Recent now.
      if (file && entry.listed && entry.source === 'local') {
        await library.rememberLocal(entry.path, entry.name, file.size || entry.size || 0);
        delete entry.listed;
      }
      if (!file) {
        status(`${entry.name} is no longer in the downloads folder. Open it again from ${entry.source === 'dropbox' ? 'Dropbox' : 'Drive'}.`, true);
        await library.forget(entry.key);
        return renderRecent();
      }
      // A Drive note may have a newer version there: the user picks first.
      if (await versions?.openRecent(entry, file)) return renderRecent();
      if (now.entryKey && now.entryKey === entry.key && now.show) {
        await library.touch(entry.key);
        return now.show();
      }
      await library.touch(entry.key);
      await open(file, entry);
      if (!$('empty')?.hidden) renderRecent();
    } catch (error) { status(error.message, true); }
  }
  async function renderRecent() {
    merging ||= library.mergeDuplicates?.().then(n => { if (n) renderRecent(); }).catch((e) => console.warn('Merge duplicates:', e));
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
    for (const batch of batches) batch.onRecentRendered();
    if (contentMode && contentQuery()) runContentSearch();
  }
  // One Recent card; an entry that cannot be shown is skipped instead of emptying the list.
  function recentCard(entry) {
    try {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-card';
      button.noteEntry = entry;
      button.dataset.entryKey = entry.key;
      const cover = document.createElement('img');
      cover.className = 'note-cover';
      cover.alt = '';
      const meta = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('span');
      meta.className = 'note-meta';
      name.textContent = entryTitle(entry);
      name.title = entry.title ? `${entry.title}\nFile: ${entry.name}` : entry.name;
      detail.textContent = `${entrySourceLabel(entry)} · ${entry.openedAt ? `opened ${ago(entry.openedAt)}` : 'not opened yet'}`;
      meta.append(name, detail);
      const hit = entry.source === 'web' ? 'Web' : Object.entries(TYPES).find(([, [, re]]) => re.test(entry.name || ''))?.[1][0];
      if (hit) {
        const badge = document.createElement('span');
        badge.className = 'note-badge';
        badge.textContent = hit;
        meta.append(badge);
      }
      button.append(selectionCheck(), cover, meta);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'note-more'; remove.textContent = '⋯';
      remove.title = 'More'; remove.setAttribute('aria-label', `More actions for ${entryTitle(entry)}`); remove.setAttribute('aria-haspopup', 'menu');
      remove.onclick = event => { event.stopPropagation(); confirmRemove(entry, remove); };
      // Office files: Open ▸ / Open with ▸ / Show in folder / More… (the ⋯ popup); others open the popup directly.
      const extra = [
        ...(canShowInFolder(entry) ? [{ label: 'Show in folder', icon: 'folder', run: () => revealEntry(entry).catch(error => status(error.message, true)) }] : []),
        { label: 'More…', icon: 'menu', run: () => confirmRemove(entry, remove) },
      ];
      attachOpenWithMenu(button, entry.name || '', () => openEntry(entry), {
        extra,
        fallback: () => confirmRemove(entry, remove),
      });
      button.note = { name: entry.name, title: entryTitle(entry), modified: Date.parse(entry.modifiedTime) || entry.openedAt, opened: entry.openedAt || 0, favourite: favourites.has(entry.key), size: Number(entry.size) || 0, facts: null, starred: !!entry.starred };
      if (!quick) {
        cover.onerror = () => {
          cover.removeAttribute?.('src');
          cover.classList.add('missing');
        };
        const staticCover = hasStaticFileCover(entry.name || '') ? fileCoverSvg(entry.name || '') : null;
        if (staticCover) {
          cover.classList.remove('missing');
          cover.src = staticCover;
        } else {
          library.cover(coverKey(entry)).then(async url => {
            // An old text cover (lines running off the card) is drawn again, wrapped.
            if (url && isTextName(entry.name || '') && !String(url).includes(encodeURIComponent(TEXT_COVER))) url = null;
            if (url) {
              cover.classList.remove('missing');
              cover.src = url;
            } else {
              try {
                const file = await library.open(entry);
                if (file) {
                  await rememberCover(coverKey(entry), file);
                  const next = await library.cover(coverKey(entry));
                  if (next) { cover.classList.remove('missing'); cover.src = next; return; }
                }
              } catch (e) {}
              const fallback = fileCoverSvg(entry.name || '');
              if (fallback) { cover.classList.remove('missing'); cover.src = fallback; return; }
              cover.classList.add('missing');
            }
          });
        }
        library.facts(coverKey(entry)).then(facts => { if (facts) { button.note.facts = facts; applyFilters(); } });
      }
      button.onclick = () => {
        if (batches.some((batch) => batch.handleCardClick(button, entry))) return;
        void openEntry(entry);
      };
      item.append(button, remove);
      // In a folder: a star keeps the document at the top of it.
      const folder = shownFolder;
      if (folder) item.append(starButton(!!entry.starred, entryTitle(entry), async on => { await groups.star(folder, entry.key, on); renderRecent(); }));
      else {
        const fav = starButton(favourites.has(entry.key), entryTitle(entry), on => { if (on) favourites.add(entry.key); else favourites.delete(entry.key); saveFavourites(); button.note.favourite = on; renderRecent(); });
        fav.title = favourites.has(entry.key) ? 'Favorite (click to remove)' : 'Add to favorites';
        item.append(fav);
      }
      return [item];
    } catch (error) { console.warn('Recent entry skipped', entry?.key, error); return []; }
  }
  // Remove a note from this device; for Drive notes, optionally upload the open
  // document's changes first, or (typed confirmation) move the Drive file to trash.
  const migration = migrator({ library, drive, status, refresh: () => renderRecent() });
  const canShowInFolder = (entry) => Boolean(
    globalThis.notecompleteFiles?.showInFolder
    && entry
    && (entry.source === 'local' ? entry.path : entry.source !== 'web' && entry.source !== 'archive' && entry.filename)
  );
  async function revealEntry(entry) {
    const target = await library.pathOf(entry);
    if (!target) throw Error('This file is not stored in a folder on this device.');
    await globalThis.notecompleteFiles.showInFolder(target);
  }
  function confirmRemove(entry, anchor) {
    const isDrive = entry.source === 'drive', isDropbox = entry.source === 'dropbox', isGithub = entry.source === 'github', isWebdav = entry.source === 'webdav';
    const isCloud = isDrive || isDropbox || isGithub || isWebdav, now = current();
    const canTrashDisk = entry.source === 'local' && Boolean(entry.path && globalThis.notecompleteFiles?.trashOpened);
    const changed = isDrive && now.entryKey === entry.key && now.dirty;
    $('forgetTitle').textContent = entryTitle(entry);
    $('forgetTitle').title = entry.name;
    rename(entry);
    $('forgetText').textContent = isDrive
      ? 'Deletes the copy kept on this device and its cover. The file in Google Drive stays as it is.'
      : isDropbox
        ? 'Deletes the copy kept on this device and its cover. The file in Dropbox stays as it is.'
        : isGithub
          ? 'Deletes the copy kept on this device and its cover. The repository on GitHub stays as it is.'
          : isWebdav
            ? 'Deletes the copy kept on this device and its cover. The file in Nextcloud / WebDAV stays as it is.'
            : entry.listed
              ? 'Moves the file on your computer to the system Trash.'
              : 'Removes it from Recent (or move the file on your computer to the system Trash).';
    $('forgetUpload').hidden = !changed;
    $('forgetDanger').hidden = !isDrive;
    $('forgetDanger').open = false;
    $('forgetConfirm').value = '';
    $('forgetDriveDelete').disabled = true;
    $('forgetStatus').textContent = changed ? 'This note is open with unsaved changes.' : '';
    const close = () => { $('forgetDialog').hidden = true; $('renameRow').hidden = true; anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
    const outside = event => { if (!$('forgetDialog').contains(event.target) && event.target !== anchor) close(); };
    const done = async (text) => { await library.forget(entry.key, { deleteFile: isCloud }); close(); status(text); renderRecent(); };
    $('forgetLocal').hidden = Boolean(entry.listed && canTrashDisk);
    $('forgetLocal').onclick = () => done(isDrive ? 'Removed from this device. Drive is unchanged.' : isDropbox ? 'Removed from this device. Dropbox is unchanged.' : 'Removed from Recent.');
    const trashBtn = $('forgetTrashLocal');
    if (trashBtn) {
      trashBtn.hidden = !canTrashDisk;
      trashBtn.onclick = async () => {
        try {
          await globalThis.notecompleteFiles.trashOpened(entry.path);
          await library.forget(entry.key);
          await groups?.forget?.(entry.key);
          close();
          status(`${entry.name} moved to the trash.`);
          renderRecent();
        } catch (error) {
          $('forgetStatus').textContent = error.message;
        }
      };
    }
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
    const showFolderBtn = $('forgetShowFolder');
    if (showFolderBtn) {
      showFolderBtn.hidden = !canShowInFolder(entry);
      showFolderBtn.onclick = async () => {
        close();
        try { await revealEntry(entry); } catch (error) { status(error.message, true); }
      };
    }
    $('forgetCheck').hidden = (!isDrive && !isDropbox) || !versions;
    $('forgetCheck').textContent = isDropbox ? 'Check Dropbox for updates' : 'Check Drive for updates';
    $('forgetCheck').onclick = async () => {
      close();
      try {
        status(`Checking ${isDropbox ? 'Dropbox' : 'Drive'} for a newer ${entry.name}…`);
        const file = await library.open(entry);
        if (!file) return status(`${entry.name} is no longer kept on this device. Open it again from ${isDropbox ? 'Dropbox' : 'Drive'}.`, true);
        if (await versions.openRecent(entry, file, { force: true })) renderRecent();
      } catch (error) { status(error.message, true); }
    };
    $('forgetCut').hidden = !cutHistory || !/\.nfedit$/i.test(entry.name || '');
    $('forgetCut').onclick = () => { close(); cutHistory?.(entry).catch(error => status(error.message, true)); };
    // Notes (not web pages or loose files) can be opened and exported from here.
    $('forgetFiles').hidden = !exportNote || entry.source === 'web' || !/\.(noteful|nfedit|notecomp|notecomplete|notepart|pdf)$/i.test(entry.name || '');
    for (const b of $('forgetFiles').querySelectorAll('button[data-export]')) b.onclick = () => { close(); exportNote?.(entry, b.dataset.export).catch(error => status(error.message, true)); };
    $('forgetExport').hidden = !exportStudy;
    $('forgetExport').onclick = () => { close(); exportStudy?.(entry).catch(error => status(error.message, true)); };
    $('forgetMigrate').onclick = () => { close(); migration.open(entry).catch(error => status(error.message, true)); };
    // Drop down under the ⋯ button, or up when there is no room below.
    const menu = $('forgetDialog');
    placeMenu(menu, anchor, { align: 'right' });
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    $('forgetDanger').ontoggle = () => {
      const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      if (menu.getBoundingClientRect().bottom / z > innerHeight / z - 8) menu.style.top = `${Math.round(Math.max(8, innerHeight / z - menu.offsetHeight - 8))}px`;
    };
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
  let filters = { since: 0, period: '', tags: [], audio: false, favourites: false, sources: [], sizes: [], types: [], sort: 'name' };
  try { Object.assign(filters, JSON.parse(localStorage.getItem('notecomplete-home-filters')) || {}); } catch { /* Optional. */ }
  if (!Array.isArray(filters.types)) filters.types = [];
  if (!Array.isArray(filters.sources)) filters.sources = [];
  const SOURCES = { drive: 'Google Drive', dropbox: 'Dropbox', github: 'GitHub', webdav: 'Nextcloud / WebDAV', archive: 'Internet Archive' };
  const chip = (label, pressed, onclick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    b.onclick = onclick;
    return b;
  };
  function changed() {
    filters.since = filters.period ? Date.now() - PERIODS[filters.period][1] : 0;
    try { localStorage.setItem('notecomplete-home-filters', JSON.stringify({ ...filters, since: 0 })); } catch { /* Optional. */ }
    renderFilters();
    applyFilters();
  }
  // The filters: one dropdown per category (checkboxes, so several values at once without
  // taking a row each) and two toggles. A dropdown's button says what it has picked.
  let openCategory = null;
  const toggleIn = (key, value) => { filters[key] = filters[key].includes(value) ? filters[key].filter(x => x !== value) : [...filters[key], value]; changed(); };
  function categories() {
    const known = new Set(filters.tags);
    for (const card of document.querySelectorAll('#recentList .note-card, #driveList .note-card, #dropboxList .note-card, #githubList .note-card, #webdavList .note-card, #archiveList .note-card')) for (const t of card.note?.facts?.tags || []) known.add(t);
    return [
      { id: 'types', label: 'Type', options: Object.entries(TYPES).map(([k, [name]]) => ({ value: k, label: name })), on: v => filters.types.includes(v), flip: v => toggleIn('types', v) },
      // Modified takes one value: the periods overlap (today is inside this week).
      { id: 'period', label: 'Modified', single: true, options: Object.entries(PERIODS).map(([k, [name]]) => ({ value: k, label: name })), on: v => filters.period === v, flip: v => { filters.period = filters.period === v ? '' : v; changed(); } },
      { id: 'sources', label: 'Source', options: Object.entries(SOURCES).map(([k, name]) => ({ value: k, label: name })), on: v => filters.sources.includes(v), flip: v => toggleIn('sources', v) },
      { id: 'sizes', label: 'Size', options: Object.entries(SIZES).map(([k, [name]]) => ({ value: k, label: name })), on: v => filters.sizes.includes(v), flip: v => toggleIn('sizes', v) },
      ...(known.size ? [{ id: 'tags', label: 'Tags', options: [...known].sort().map(t => ({ value: t, label: `#${t.replace(/^#/, '')}` })), on: v => filters.tags.includes(v), flip: v => toggleIn('tags', v) }] : []),
    ];
  }
  const TOGGLES = [
    { id: 'favourites', label: 'Favorites', icon: 'star', title: 'Only notes you starred' },
    { id: 'audio', label: 'With audio', icon: 'headphones', title: 'Only notes with recordings' },
  ];
  const isActive = () => filters.sources.length || filters.favourites || filters.period || filters.audio || filters.tags.length || filters.sizes.length || filters.types.length;
  function syncSortButton() {
    const activeSort = SORTS[filters.sort] ? filters.sort : 'name';
    if ($('homeSort') && $('homeSort').value !== activeSort) $('homeSort').value = activeSort;
    if ($('homeSortLabel')) $('homeSortLabel').textContent = SORTS[activeSort];
    if ($('homeSortBtn')) {
      $('homeSortBtn').setAttribute('aria-expanded', String(openCategory === 'sort'));
      $('homeSortBtn').setAttribute('aria-label', `Sort notes: ${SORTS[activeSort]}`);
    }
  }
  function sortCategory() {
    const activeSort = SORTS[filters.sort] ? filters.sort : 'name';
    return {
      id: 'sort',
      label: 'Sort notes',
      single: true,
      options: Object.entries(SORTS).map(([k, name]) => ({ value: k, label: name })),
      on: v => activeSort === v,
      flip: v => {
        filters.sort = v;
        syncSortButton();
        closeFilterMenu();
        changed();
      },
    };
  }
  function renderFilters() {
    const nodes = categories().map(c => {
      const picked = c.options.filter(o => c.on(o.value));
      const b = document.createElement('button');
      b.type = 'button'; b.className = `chip filter-drop${picked.length ? ' has-value' : ''}`; b.dataset.category = c.id;
      b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', String(openCategory === c.id));
      const value = picked.length === 1 ? picked[0].label : picked.length ? String(picked.length) : '';
      b.append(icon(CATEGORY_ICONS[c.id]), c.label, ...(value ? [Object.assign(document.createElement('span'), { className: 'filter-value', textContent: value })] : []), Object.assign(document.createElement('span'), { className: 'filter-caret', ariaHidden: 'true' }));
      b.onclick = () => (openCategory === c.id ? closeFilterMenu() : showFilterMenu(c.id));
      return b;
    });
    for (const t of TOGGLES) { const b = chip(t.label, !!filters[t.id], () => { filters[t.id] = !filters[t.id]; changed(); }); b.prepend(icon(t.icon)); nodes.push(b); }
    $('filterBar').replaceChildren(...nodes);
    for (const [i, t] of TOGGLES.entries()) nodes[nodes.length - TOGGLES.length + i].title = t.title;
    $('filtersClear').hidden = !isActive();
    syncSortButton();
    if (openCategory) showFilterMenu(openCategory);
  }
  // The open dropdown: a checkbox or radio option per value, under its button.
  function showFilterMenu(id) {
    const category = id === 'sort' ? sortCategory() : categories().find(c => c.id === id);
    const anchor = id === 'sort' ? $('homeSortBtn') : $('filterBar').querySelector(`[data-category="${id}"]`);
    const menu = $('filterMenu');
    if (!category || !anchor) return closeFilterMenu();
    const prev = openCategory;
    if (prev && prev !== id) {
      const prevAnchor = prev === 'sort' ? $('homeSortBtn') : $('filterBar').querySelector(`[data-category="${prev}"]`);
      prevAnchor?.setAttribute('aria-expanded', 'false');
    }
    const keep = menu.hidden ? 0 : menu.scrollTop;
    openCategory = id;
    anchor.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', category.label);
    menu.replaceChildren(...category.options.map(o => {
      const on = category.on(o.value), b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', category.single ? 'menuitemradio' : 'menuitemcheckbox'); b.setAttribute('aria-checked', String(on));
      b.className = `filter-option${on ? ' on' : ''}${category.single ? ' radio' : ''}`;
      b.append(Object.assign(document.createElement('span'), { className: 'filter-check' }), o.label);
      b.onclick = () => category.flip(o.value);
      return b;
    }));
    placeMenu(menu, anchor, { align: 'left', minWidth: 168 });
    menu.scrollTop = keep;
    document.addEventListener('pointerdown', outsideFilter, true);
    document.addEventListener('keydown', escapeFilter, true);
  }
  function closeFilterMenu() {
    const was = openCategory;
    openCategory = null;
    $('filterMenu').hidden = true;
    document.removeEventListener('pointerdown', outsideFilter, true);
    document.removeEventListener('keydown', escapeFilter, true);
    if (was === 'sort') $('homeSortBtn')?.setAttribute('aria-expanded', 'false');
    else if (was) $('filterBar').querySelector(`[data-category="${was}"]`)?.setAttribute('aria-expanded', 'false');
  }
  const outsideFilter = event => { if (!$('filterMenu').contains(event.target) && !event.target.closest?.('.filter-drop')) closeFilterMenu(); };
  const escapeFilter = event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      const was = openCategory;
      closeFilterMenu();
      if (was === 'sort') $('homeSortBtn')?.focus();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const rows = [...$('filterMenu').querySelectorAll('.filter-option')];
      if (!rows.length) return;
      event.preventDefault();
      const idx = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? rows.length - 1
        : event.key === 'ArrowDown' ? (idx + 1 + rows.length) % rows.length
        : (idx <= 0 ? rows.length - 1 : idx - 1);
      rows[next]?.focus();
    }
  };
  // Reorder note cards in place; Drive folders keep their place at the top.
  function sortCards() {
    const compare = compareNotes(filters.sort);
    for (const list of [$('recentList'), $('driveList'), $('dropboxList'), $('githubList'), $('webdavList'), $('archiveList')]) {
      if (!list) continue;
      const items = [...list.children], notes = items.filter(li => li.querySelector('.note-card')?.note);
      if (notes.length < 2) continue;
      // Starred and favourite documents stay at the top, sorted among each other by the active sort;
      // then non-favourites follow, also sorted among each other by the active sort.
      const sorted = [...notes].sort((a, b) => {
        const x = a.querySelector('.note-card').note, y = b.querySelector('.note-card').note;
        const favX = (x.starred || x.favourite) ? 1 : 0;
        const favY = (y.starred || y.favourite) ? 1 : 0;
        return (favY - favX) || compare(x, y);
      });
      if (sorted.every((li, i) => li === notes[i])) continue;
      const others = items.filter(li => !notes.includes(li));
      list.append(...others, ...sorted);
    }
  }
  // Collapsible sections: Folders, Recent, Cloud
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem('notecomplete-home-collapsed') || '{}'); } catch {}
  function setupCollapsible(toggleId, contentId, key) {
    const toggle = $(toggleId), content = $(contentId);
    if (!toggle || !content) return;
    const update = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      content.hidden = !open;
      collapsed[key] = !open;
      try { localStorage.setItem('notecomplete-home-collapsed', JSON.stringify(collapsed)); } catch {}
    };
    if (collapsed[key]) update(false);
    toggle.onclick = () => update(toggle.getAttribute('aria-expanded') === 'false');
  }
  setupCollapsible('foldersToggle', 'foldersContent', 'folders');
  setupCollapsible('recentToggle', 'recentContent', 'recent');
  setupCollapsible('cloudToggle', 'cloudContent', 'cloud');
  setupCollapsible('drivePanelToggle', 'drivePanelBody', 'cloud_drive');
  setupCollapsible('dropboxPanelToggle', 'dropboxPanelBody', 'cloud_dropbox');
  setupCollapsible('githubPanelToggle', 'githubPanelBody', 'cloud_github');
  setupCollapsible('webdavPanelToggle', 'webdavPanelBody', 'cloud_webdav');
  setupCollapsible('archivePanelToggle', 'archivePanelBody', 'cloud_archive');

  // Cloud providers multi-select checkbox dropdown & simultaneous cross-cloud search
  const ALL_CLOUD_IDS = CLOUD_PROVIDERS.map(p => p.id);
  const cloudPanels = {
    drive: ['driveSection', drive],
    dropbox: ['dropboxSection', dropbox],
    github: ['githubSection', github],
    webdav: ['webdavSection', webdav],
    archive: ['archiveSection', archive],
  };
  function detectActiveCloudIds() {
    const active = new Set(['drive']);
    try {
      const stored = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
      for (const [id, keys] of Object.entries(CLOUD_CONFIG_KEYS)) {
        // Connected: a saved session or config that says so (or, for archives, a saved source).
        if (keys.some((k) => { const v = stored(k); return Array.isArray(v) ? v.length > 0 : v && (v.connected !== false); })) active.add(id);
      }
    } catch {}
    return ALL_CLOUD_IDS.filter(id => active.has(id));
  }
  let selectedClouds = detectActiveCloudIds();
  try {
    const savedMulti = JSON.parse(localStorage.getItem('notecomplete-cloud-providers') || 'null');
    const savedSingle = localStorage.getItem('notecomplete-cloud-provider');
    const configured = detectActiveCloudIds();
    if (Array.isArray(savedMulti) && savedMulti.length) {
      selectedClouds = ALL_CLOUD_IDS.filter(id => savedMulti.includes(id) || configured.includes(id));
    } else if (savedSingle && ALL_CLOUD_IDS.includes(savedSingle)) {
      selectedClouds = ALL_CLOUD_IDS.filter(id => id === savedSingle || configured.includes(id));
    }
  } catch {}
  if (!selectedClouds.length) selectedClouds = ['drive'];

  function saveSelectedClouds() {
    try {
      localStorage.setItem('notecomplete-cloud-providers', JSON.stringify(selectedClouds));
      localStorage.setItem('notecomplete-cloud-provider', selectedClouds[0] || 'drive');
    } catch {}
  }

  let cloudMenuOpen = false;
  function renderCloudProviderDrop() {
    const drop = $('cloudProviderDrop');
    if (!drop) return;
    const picked = CLOUD_PROVIDERS.filter(p => selectedClouds.includes(p.id));
    const single = picked.length === 1 ? picked[0] : null;
    drop.setAttribute('aria-expanded', String(cloudMenuOpen));
    drop.innerHTML = single
      ? `${single.svg}<span>${single.label}</span><span class="filter-caret" aria-hidden="true"></span>`
      : `${icon('cloud')?.outerHTML || ''}<span>Services</span><span class="filter-value">${picked.length}</span><span class="filter-caret" aria-hidden="true"></span>`;
  }

  function applySelectedCloudPanels() {
    for (const id of ALL_CLOUD_IDS) {
      const [sectionId, controller] = cloudPanels[id] || [];
      const active = selectedClouds.includes(id);
      if ($(sectionId)) $(sectionId).hidden = !active;
      if (active) controller?.show?.();
    }
    renderCloudProviderDrop();
    if (cloudMenuOpen) renderCloudProviderMenu();
  }

  function setCloudProvider(provider) {
    if (!ALL_CLOUD_IDS.includes(provider)) provider = 'drive';
    selectedClouds = [provider];
    saveSelectedClouds();
    applySelectedCloudPanels();
  }

  function toggleCloudProvider(provider) {
    if (!ALL_CLOUD_IDS.includes(provider)) return;
    if (selectedClouds.includes(provider)) {
      if (selectedClouds.length === 1) return; // keep at least one selected
      selectedClouds = selectedClouds.filter(id => id !== provider);
    } else {
      selectedClouds = ALL_CLOUD_IDS.filter(id => selectedClouds.includes(id) || id === provider);
    }
    saveSelectedClouds();
    applySelectedCloudPanels();
    if ($('cloudMultiSearch')?.value.trim()) runMultiCloudSearch($('cloudMultiSearch').value);
  }

  function renderCloudProviderMenu() {
    const menu = $('cloudProviderMenu');
    if (!menu) return;
    menu.replaceChildren(...CLOUD_PROVIDERS.map(p => {
      const on = selectedClouds.includes(p.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', String(on));
      b.className = `filter-option cloud-provider-option${on ? ' on' : ''}`;
      b.dataset.cloudOption = p.id;
      const check = Object.assign(document.createElement('span'), { className: 'filter-check' });
      const iconWrap = document.createElement('span');
      iconWrap.className = 'cloud-option-icon';
      iconWrap.innerHTML = p.svg;
      const label = Object.assign(document.createElement('span'), { className: 'cloud-option-label', textContent: p.label });
      b.append(check, iconWrap, label);
      b.onclick = (event) => {
        if (event.altKey || event.metaKey) setCloudProvider(p.id);
        else toggleCloudProvider(p.id);
      };
      return b;
    }));
  }

  function openCloudProviderMenu() {
    const drop = $('cloudProviderDrop'), menu = $('cloudProviderMenu');
    if (!drop || !menu) return;
    cloudMenuOpen = true;
    renderCloudProviderDrop();
    renderCloudProviderMenu();
    placeMenu(menu, drop, { align: 'right', minWidth: 210 });
    document.addEventListener('pointerdown', outsideCloudMenu, true);
    document.addEventListener('keydown', escapeCloudMenu, true);
  }

  function closeCloudProviderMenu() {
    if (!cloudMenuOpen) return;
    cloudMenuOpen = false;
    if ($('cloudProviderMenu')) $('cloudProviderMenu').hidden = true;
    renderCloudProviderDrop();
    document.removeEventListener('pointerdown', outsideCloudMenu, true);
    document.removeEventListener('keydown', escapeCloudMenu, true);
  }

  const outsideCloudMenu = event => {
    if (!$('cloudProviderMenu')?.contains(event.target) && !$('cloudProviderDrop')?.contains(event.target)) {
      closeCloudProviderMenu();
    }
  };
  const escapeCloudMenu = event => {
    if (event.key === 'Escape') { event.stopPropagation(); closeCloudProviderMenu(); }
  };

  if ($('cloudProviderDrop')) {
    $('cloudProviderDrop').onclick = () => (cloudMenuOpen ? closeCloudProviderMenu() : openCloudProviderMenu());
  }

  function showCloudProvider(provider) {
    if ($('cloudContent')) $('cloudContent').hidden = false;
    if ($('cloudToggle')) $('cloudToggle').setAttribute('aria-expanded', 'true');
    collapsed.cloud = false;
    try { localStorage.setItem('notecomplete-home-collapsed', JSON.stringify(collapsed)); } catch {}
    if (ALL_CLOUD_IDS.includes(provider) && !selectedClouds.includes(provider)) {
      selectedClouds = [...selectedClouds, provider];
      saveSelectedClouds();
    }
    applySelectedCloudPanels();
  }

  // Multi-cloud search bar: searches across all currently checked cloud services simultaneously
  let multiSearchTimer = 0;
  function runMultiCloudSearch(rawQuery, triggerRemote = false) {
    const q = String(rawQuery || '').trim();
    const map = {
      drive: ['driveSearch', 'driveFind'],
      dropbox: ['dropboxSearch', 'dropboxFind'],
      github: ['githubSearch', 'githubFind'],
      webdav: ['webdavSearch', 'webdavFind'],
      archive: ['archiveSearch', null],
    };
    for (const id of selectedClouds) {
      const [inputId, btnId] = map[id] || [];
      const input = inputId ? $(inputId) : null;
      if (input && input.value !== q) {
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (triggerRemote && btnId && $(btnId) && !$(btnId).disabled) {
        $(btnId).click();
      }
    }
    applyFilters();
  }

  if ($('cloudMultiSearch')) {
    $('cloudMultiSearch').oninput = () => {
      const val = $('cloudMultiSearch').value;
      runMultiCloudSearch(val, false);
      clearTimeout(multiSearchTimer);
      multiSearchTimer = setTimeout(() => runMultiCloudSearch(val, true), 320);
    };
    $('cloudMultiSearch').onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(multiSearchTimer);
        runMultiCloudSearch($('cloudMultiSearch').value, true);
      } else if (event.key === 'Escape' && $('cloudMultiSearch').value) {
        event.preventDefault();
        event.stopPropagation();
        $('cloudMultiSearch').value = '';
        runMultiCloudSearch('', true);
      }
    };
  }

  applySelectedCloudPanels();

  // A Source filter shows those clouds' panels while it is on (opened once when it changes);
  // the clouds chosen in the Cloud menu stay as they were and come back without it.
  let shownSources = '';
  function applyFilters() {
    sortCards();
    const sourcesKey = filters.sources.join(',');
    if (sourcesKey !== shownSources) {
      shownSources = sourcesKey;
      const nextClouds = filters.sources.filter(id => ALL_CLOUD_IDS.includes(id));
      if (nextClouds.length) {
        if ($('cloudContent')) $('cloudContent').hidden = false;
        if ($('cloudToggle')) $('cloudToggle').setAttribute('aria-expanded', 'true');
        for (const id of ALL_CLOUD_IDS) {
          const [sectionId, controller] = cloudPanels[id] || [];
          if ($(sectionId)) $(sectionId).hidden = !nextClouds.includes(id);
          if (nextClouds.includes(id)) controller?.show?.();
        }
      } else applySelectedCloudPanels();
    }
    const query = ($('recentSearch')?.value || '').trim().toLowerCase();
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    const cloudQuery = ($('cloudMultiSearch')?.value || '').trim().toLowerCase();
    const cloudTerms = cloudQuery ? cloudQuery.split(/\s+/).filter(Boolean) : [];
    if ($('recentSearchClear')) $('recentSearchClear').hidden = !query;
    const active = filters.sources.length || filters.favourites || filters.period || filters.audio || filters.tags.length || filters.sizes.length || filters.types.length;
    let hidden = 0, unknown = 0, recentVisible = 0, recentTotal = 0;
    for (const card of document.querySelectorAll('#recentList .note-card, #driveList .note-card, #dropboxList .note-card, #githubList .note-card, #webdavList .note-card, #archiveList .note-card')) {
      const inRecent = Boolean(card.closest('#recentList'));
      if (inRecent) recentTotal++;
      let show = !active || !card.note || matches(card.note, filters);
      if (show && inRecent && contentMode) {
        if (contentMatches) show = contentMatches.has(card.noteEntry?.key);
      } else if (show && inRecent && terms.length) {
        const hay = `${card.note?.title || ''} ${card.note?.name || ''} ${card.textContent || ''}`.toLowerCase();
        show = terms.every((t) => hay.includes(t));
      }
      if (show && !inRecent && cloudTerms.length) {
        const hay = `${card.note?.title || ''} ${card.note?.name || ''} ${card.textContent || ''}`.toLowerCase();
        show = cloudTerms.every((t) => hay.includes(t));
      }
      card.closest('li').hidden = !show;
      if (inRecent && show) recentVisible++;
      if (!show) { hidden++; if (filters.tags.length && card.note && card.note.facts?.tags == null) unknown++; }
    }
    if ($('recentSearchEmpty')) {
      $('recentSearchEmpty').hidden = !query || recentTotal === 0 || recentVisible > 0 || (contentMode && !contentMatches);
      $('recentSearchEmpty').textContent = contentMode ? 'No note has these words inside.' : 'No notes match your search.';
    }
    const needsFacts = quick && (filters.audio || filters.tags.length);
    $('filterSummary').textContent = active ? `${hidden} hidden by filters${needsFacts ? ' · the quick list does not read recordings or tags; switch to cards for those filters' : unknown ? ` · ${unknown} not yet read for tags (open them once)` : ''}` : '';
    renderFiltersSoon();
  }
  // Search inside notes (the second magnifier): the same box searches the text of Recent's
  // documents instead of their names (content-search.js). Cards without a match are hidden and
  // the matches are listed under the heading; a match opens the note with Find on the words.
  const contentQuery = () => ($('recentSearch')?.value || '').trim();
  const recentEntries = () => [...document.querySelectorAll('#recentList .note-card')].map((card) => card.noteEntry).filter(Boolean);
  const SOURCE_LABELS = { text: 'Text', pdf: 'PDF', ocr: 'Handwriting', audio: 'Audio' };
  function setContentMode(on) {
    contentMode = on;
    contentRun++;
    contentMatches = null;
    $('recentContentSearch')?.setAttribute('aria-pressed', String(on));
    $('recentSearch').placeholder = on ? 'Search inside notes: PDF, handwriting, OCR, audio…' : 'Search recent notes…';
    $('recentSearch').setAttribute('aria-label', on ? 'Search inside recent notes' : 'Search recent notes');
    $('recentContentSearch')?.closest('.recent-heading')?.classList.toggle('content-mode', on);
    if (!on) $('contentResults').hidden = true;
    if (on && contentQuery()) runContentSearch();
    applyFilters();
  }
  async function runContentSearch() {
    const query = contentQuery(), run = ++contentRun;
    if (!query) { contentMatches = null; $('contentResults').hidden = true; applyFilters(); return; }
    $('contentResults').hidden = false;
    $('contentSummary').textContent = 'Searching inside notes…';
    const { results, unindexed } = await contents.search(recentEntries(), query, {
      cancelled: () => run !== contentRun,
      progress: (done, total) => { if (run === contentRun && total > 8) $('contentSummary').textContent = `Searching inside notes… ${done} of ${total}`; },
    });
    if (run !== contentRun) return;
    contentMatches = new Set(results.map((r) => r.entry.key));
    renderContentResults(query, results, unindexed);
    applyFilters();
  }
  function renderContentResults(query, results, unindexed) {
    const total = results.reduce((n, r) => n + r.hits.length, 0);
    $('contentSummary').textContent = results.length
      ? `${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'note' : 'notes'}${unindexed.length ? ` · ${unindexed.length} not searched yet` : ''}`
      : unindexed.length ? `No matches · ${unindexed.length} ${unindexed.length === 1 ? 'note was' : 'notes were'} not searched yet` : 'No matches inside these notes.';
    const index = $('contentIndex');
    index.hidden = !unindexed.length || !pageCanvas;
    index.lastChild.textContent = `Index ${unindexed.length} ${unindexed.length === 1 ? 'note' : 'notes'}…`;
    index.title = 'Read the text of the notes not searched yet (PDF text, typed text, handwriting it knows, saved transcripts) in the background. Batch OCR also recognizes handwriting and scans.';
    index.onclick = async () => {
      index.disabled = true;
      try { await indexNotes(unindexed, { library, pageCanvas, jobs, onKept: kept }); }
      finally { index.disabled = false; }
      if (contentMode) runContentSearch();
    };
    const fragment = document.createDocumentFragment();
    for (const { entry, hits, counts } of results.slice(0, 40)) {
      const li = document.createElement('li'), head = document.createElement('div'), name = document.createElement('strong');
      head.className = 'content-note';
      name.textContent = entryTitle(entry);
      head.append(name);
      for (const [source, count] of Object.entries(counts)) {
        const badge = document.createElement('span');
        badge.className = `find-badge ${source}`;
        badge.textContent = `${SOURCE_LABELS[source] || source} ${count}`;
        head.append(badge);
      }
      li.append(head);
      for (const hit of hits.slice(0, 3)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'content-hit';
        row.title = 'Open the note and find these words in it';
        const where = document.createElement('span');
        where.className = 'find-where';
        where.textContent = hit.source === 'audio' ? (hit.label || 'Audio') : `p. ${Math.floor(hit.page) + 1}`;
        const snippet = document.createElement('span');
        snippet.className = 'find-snippet';
        const marks = new Set(hit.matched);
        for (const [n, word] of hit.snippet.split(' ').entries()) {
          if (n) snippet.append(' ');
          if (marks.has(word)) { const m = document.createElement('mark'); m.textContent = word; snippet.append(m); } else snippet.append(word);
        }
        row.append(where, snippet);
        row.onclick = async () => { await openEntry(entry); findIn?.(query); };
        li.append(row);
      }
      if (hits.length > 3) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'content-more';
        more.textContent = `${hits.length - 3} more in this note`;
        more.onclick = async () => { await openEntry(entry); findIn?.(query); };
        li.append(more);
      }
      fragment.append(li);
    }
    $('contentList').replaceChildren(fragment);
  }
  if ($('recentContentSearch')) $('recentContentSearch').onclick = () => { setContentMode(!contentMode); $('recentSearch')?.focus(); };
  if ($('recentSearch')) {
    $('recentSearch').oninput = () => {
      if (!contentMode) return applyFilters();
      clearTimeout(contentTimer);
      if ($('recentSearchClear')) $('recentSearchClear').hidden = !contentQuery();
      contentTimer = setTimeout(runContentSearch, 280);
    };
    $('recentSearch').onkeydown = (event) => {
      // Shift Enter: search inside the notes; Enter, in that mode, searches at once.
      if (event.key === 'Enter' && (event.shiftKey || contentMode)) {
        event.preventDefault();
        if (!contentMode) setContentMode(true);
        else { clearTimeout(contentTimer); runContentSearch(); }
        return;
      }
      if (event.key === 'Escape' && ($('recentSearch').value || contentMode)) {
        event.preventDefault(); event.stopPropagation();
        if ($('recentSearch').value) { $('recentSearch').value = ''; if (contentMode) runContentSearch(); }
        else setContentMode(false);
        applyFilters();
      }
    };
  }
  if ($('recentSearchClear')) {
    $('recentSearchClear').onclick = () => {
      if ($('recentSearch')) { $('recentSearch').value = ''; $('recentSearch').focus(); }
      if (contentMode) runContentSearch();
      applyFilters();
    };
  }
  // Cloud listings drawn by their own browsers: filter them when they change.
  if (typeof MutationObserver === 'function') {
    let frame = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(applyFilters); });
    for (const id of ['archiveList', 'githubList', 'webdavList']) {
      if ($(id)) obs.observe($(id), { childList: true });
    }
  }
  let filterFrame = 0;
  // New tags can appear as facts arrive; refresh the chips at most once per frame.
  const renderFiltersSoon = () => { cancelAnimationFrame(filterFrame); filterFrame = requestAnimationFrame(renderFilters); };
  $('filtersClear').onclick = () => { filters = { ...filters, since: 0, period: '', tags: [], audio: false, favourites: false, sources: [], sizes: [], types: [] }; changed(); };
  for (const [value, label] of Object.entries(SORTS)) $('homeSort').add(new Option(label, value));
  $('homeSort').value = SORTS[filters.sort] ? filters.sort : 'name';
  $('homeSort').onchange = () => { filters.sort = $('homeSort').value; syncSortButton(); changed(); };
  if ($('homeSortBtn')) {
    $('homeSortBtn').onclick = () => (openCategory === 'sort' ? closeFilterMenu() : showFilterMenu('sort'));
    $('homeSortBtn').onkeydown = (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && openCategory !== 'sort') {
        event.preventDefault();
        showFilterMenu('sort');
        ($('filterMenu').querySelector('.filter-option.on') || $('filterMenu').querySelector('.filter-option'))?.focus();
      }
    };
  }
  syncSortButton();
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
      if (!key || !file) return;
      const name = file.name || '';
      const kept = await library.cover(key);
      // A text cover from before wrapping (or an old static Word icon) is drawn again; any other kept cover stays.
      if (kept && !((isTextName(name) || OFFICE_PREVIEW_RE.test(name)) && !String(kept).includes(encodeURIComponent(TEXT_COVER)))) return;
      if (/\.nfedit$/i.test(name)) return;
      if (isImageName(name) || file.type?.startsWith('image/')) {
        const url = await shrink(file);
        if (url) await library.saveCover(key, url);
        return;
      }
      if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
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
      // Word / ODF / RTF documents: extract the opening text for a real page preview, falling
      // back to the static format icon if the file is huge or empty.
      if (OFFICE_PREVIEW_RE.test(name) && (file.size || 0) <= 15 * 1024 * 1024) {
        try {
          const { officeDocument } = await import('./office.js');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { markdown } = await officeDocument(bytes, name);
          const clean = String(markdown || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, ' ').trim();
          if (clean) {
            const ext = name.split('.').pop() || 'DOC';
            const svg = textCoverSvg(clean.slice(0, 4000), ext.slice(0, 5));
            await library.saveCover(key, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
            return;
          }
        } catch { /* Fall through to the static icon cover. */ }
      }
      // HTML, audio, video, Office documents, e-books and notebooks get crisp icon covers.
      if (hasStaticFileCover(name) || file.type === 'text/html') {
        const url = fileCoverSvg(name) || fileCoverSvg('page.html');
        if (url) await library.saveCover(key, url);
        return;
      }
      // Goodnotes and Notability notebooks (also zipped): their own picture, right away; the
      // first page replaces it once the notebook is open (app.js, ensureDocumentCover).
      if (/\.(goodnotes|ntb|zip)$/i.test(name)) {
        const own = await notebookCover(blobReader(file), file.size).catch(() => null);
        const url = own && await shrink(new Blob([own.bytes], { type: own.mime }));
        if (url) return void await library.saveCover(key, markNotebookCover(url));
        if (!/\.zip$/i.test(name)) return;
      }
      // Archives: a box with the format (what they hold shows when they are opened).
      if (/\.(zip|tar|tgz|gz|7z|rar)$/i.test(name) && !/\.(goodnotes|ntb)\.zip$/i.test(name)
        && !(/\.tar$/i.test(name) && isNotePackageTar(new Uint8Array(await file.slice(0, 1024).arrayBuffer())))) {
        const url = fileCoverSvg(name);
        if (url) await library.saveCover(key, url);
        return;
      }
      // Text and Markdown: the first lines, drawn like a page.
      if (isTextName(name)) {
        const svg = textCoverSvg(await file.slice(0, 4000).text());
        await library.saveCover(key, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
        return;
      }
      // Noteful notes, and NoteComplete's tar packages (.notecomp, .notepart, .tar) holding one.
      const cover = /\.noteful$/i.test(name) ? await noteCover(blobReader(file), file.size)
        : /\.(notecomp|notecomplete|notepart|tar)$/i.test(name) ? await archiveCover(blobReader(file), file.size) : null;
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
    dropbox?.setQuick?.(quick);
    github?.setQuick?.(quick);
    webdav?.setQuick?.(quick);
  }
  for (const b of document.querySelectorAll('[data-home-view]')) b.onclick = () => { const was = quick; setView(b.dataset.homeView); if (was && !quick) renderRecent(); };
  try { setView(localStorage.getItem('notecomplete-home-view') === 'list' ? 'list' : 'cards'); } catch { setView('cards'); }
  let shown = false;
  const dups = duplicatesDialog({
    library,
    groups,
    bridge: library.bridge,
    onChanged: (batches = []) => {
      let touched = false;
      for (const batch of batches) {
        if (!batch?.keepKey) continue;
        for (const rk of batch.removedKeys || []) {
          if (favourites.delete(rk)) { favourites.add(batch.keepKey); touched = true; }
        }
      }
      if (touched) saveFavourites();
      renderRecent();
    },
    status,
  });
  if ($('findDuplicates')) $('findDuplicates').onclick = () => dups.open();
  return {
    showFolder,
    showCloudProvider,
    back: leaveFolder,
    forward: reopenFolder,
    findDuplicates: () => dups.open(),
    get folder() { return shownFolder; },
    show(hasDocument) {
      $('empty').hidden = false;
      $('homeBack').hidden = !hasDocument;
      document.body?.classList?.toggle('home-open', true);
      document.body?.classList?.toggle('home-over-tab', Boolean(hasDocument));
      if ($('homeButton')) {
        $('homeButton').setAttribute('aria-pressed', 'true');
        $('homeButton').title = hasDocument ? 'Back to open document' : 'Home: recent notes and cloud storage';
      }
      if (!shown) { shown = true; drive?.show?.(); dropbox?.show?.(); github?.show?.(); webdav?.show?.(); archive?.show?.(); }
      renderRecent(); renderFolder();
    },
    hide() {
      $('empty').hidden = true;
      document.body?.classList?.remove('home-open', 'home-over-tab');
      if ($('homeButton')) {
        $('homeButton').setAttribute('aria-pressed', 'false');
        $('homeButton').title = 'Home: recent notes and cloud storage';
      }
      if (shown) { shown = false; drive?.hide?.(); dropbox?.hide?.(); github?.hide?.(); webdav?.hide?.(); archive?.hide?.(); }
    },
    get visible() { return !$('empty').hidden; },
    rememberCover,
    rememberFacts,
    applyFilters,
    renderRecent,
  };
}
