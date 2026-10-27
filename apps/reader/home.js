// Home screen: recent notes kept on this device, the Drive section and the
// downloads-folder footer. The open document stays loaded while home is shown.
import { noteCover, blobReader } from './note-cover.js';
import { shrink } from './drive-thumbs.js';

export function homeScreen({ library, drive, open, status }) {
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
      item.append(button);
      fragment.append(item);
    }
    $('recentList').replaceChildren(fragment);
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
