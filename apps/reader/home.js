// Home screen: recent notes kept on this device, the Drive section and the
// downloads-folder footer. The open document stays loaded while home is shown.
import { noteCover, blobReader } from './note-cover.js';
import { shrink } from './drive-thumbs.js';

export function homeScreen({ library, drive, open, status, current = () => ({}) }) {
  const $ = id => document.getElementById(id);
  const ago = time => {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
    return new Date(time).toLocaleDateString();
  };
  const coverKey = entry => entry.source === 'drive' ? library.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime }) : entry.key;
  async function renderRecent() {
    let entries = [];
    try { entries = await library.recent(); } catch { /* No storage: nothing to list. */ }
    $('recentSection').hidden = !entries.length;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
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
      remove.type = 'button'; remove.className = 'note-remove'; remove.textContent = '×';
      remove.title = 'Remove from this device'; remove.setAttribute('aria-label', `Remove ${entry.name} from this device`);
      remove.onclick = event => { event.stopPropagation(); confirmRemove(entry); };
      library.cover(coverKey(entry)).then(url => { if (url) cover.src = url; else cover.classList.add('missing'); });
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
      fragment.append(item);
    }
    $('recentList').replaceChildren(fragment);
  }
  // Remove a note from this device; for Drive notes, optionally upload the open
  // document's changes first, or (typed confirmation) move the Drive file to trash.
  function confirmRemove(entry) {
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
    const done = async (text) => { await library.forget(entry.key, { deleteFile: isDrive }); $('forgetDialog').close(); status(text); renderRecent(); };
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
    $('forgetCancel').onclick = () => $('forgetDialog').close();
    $('forgetDialog').showModal();
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
  // Keep a cover for files opened from disk so Recent can show them.
  async function rememberCover(key, file) {
    if (!/\.noteful$/i.test(file.name)) return;
    try {
      if (await library.cover(key)) return;
      const cover = await noteCover(blobReader(file), file.size);
      if (cover) await library.saveCover(key, await shrink(new Blob([cover.bytes], { type: cover.mime })));
    } catch { /* A missing cover only affects the Recent card. */ }
  }
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
    renderRecent,
  };
}
