// Migrate content to file… (⋯ on a Recent note): for when two files are the same note
// but the automatic match (Drive versions, content checksums) did not see it. Three steps
// in one dialog: pick the note to move to, choose what to bring (copied; removing it from
// the old note is a separate, unticked choice), then decide what happens to the old file.
import { STUDY, studyCounts, carryStudy } from './versions.js';
import { noteFingerprint } from './find.js';
const $ = id => document.getElementById(id);

// Removing from the old note empties those kinds there; everything else is left alone.
export async function clearStudy(store, fingerprint, kinds) {
  for (const kind of kinds) await store.set('settings', `${kind}:${fingerprint}`, kind === 'notes' ? '' : []);
}

export function migrator({ library, drive, status, refresh }) {
  let from = null, fromPrint = '', target = null, targetPrint = '';
  const step = n => { for (const [i, id] of ['migratePick', 'migrateWhat', 'migrateAfter'].entries()) $(id).hidden = i !== n; };
  const name = entry => entry.name.replace(/\.(noteful|notecomp(lete)?|notepart)$/i, '');
  const fingerprintOf = async entry => {
    const file = await library.open(entry);
    if (!file) throw Error(`${entry.name} is no longer kept on this device. Open it again first.`);
    return noteFingerprint(file);
  };

  async function open(entry) {
    from = entry; target = null;
    $('migrateTitle').textContent = `Migrate content from “${name(entry)}”`;
    $('migrateFilter').value = '';
    $('migrateStatus').textContent = '';
    step(0);
    const others = (await library.recent(200)).filter(e => e.key !== entry.key);
    const render = () => {
      const q = $('migrateFilter').value.trim().toLowerCase();
      $('migrateList').replaceChildren(...others.filter(e => !q || e.name.toLowerCase().includes(q)).map(e => {
        const row = document.createElement('label'), box = document.createElement('input'), text = document.createElement('span'), meta = document.createElement('span');
        row.className = 'migrate-row'; box.type = 'radio'; box.name = 'migrateTarget'; box.value = e.key;
        box.onchange = () => { target = e; $('migrateNext').disabled = false; };
        text.textContent = name(e); meta.className = 'muted';
        meta.textContent = `${e.source === 'drive' ? 'Drive' : 'This device'}${e.modifiedTime ? ` · ${new Date(e.modifiedTime).toLocaleDateString()}` : ''}`;
        row.append(box, text, meta);
        return row;
      }));
    };
    $('migrateFilter').oninput = render;
    $('migrateNext').disabled = true;
    render();
    $('migrateDialog').showModal();
  }

  $('migrateNext').onclick = async () => {
    if (!target) return;
    try {
      $('migrateStatus').textContent = 'Reading both notes…';
      [fromPrint, targetPrint] = await Promise.all([fingerprintOf(from), fingerprintOf(target)]);
      if (fromPrint === targetPrint) throw Error('These two files have the same content: their material is already shared.');
      const counts = await studyCounts(library.store, fromPrint);
      const kinds = STUDY.filter(([kind]) => counts[kind]);
      if (!kinds.length) throw Error(`“${name(from)}” has no flashcards, quizzes, Markdown notes or recordings to move.`);
      $('migrateWhatTitle').textContent = `Bring to “${name(target)}”:`;
      $('migrateKinds').replaceChildren(...kinds.map(([kind, label]) => {
        const row = document.createElement('label'), box = document.createElement('input');
        row.className = 'check'; box.type = 'checkbox'; box.checked = true; box.value = kind;
        row.append(box, ` ${label}${kind === 'notes' ? '' : ` (${counts[kind]})`}`);
        return row;
      }));
      $('migrateRemove').checked = false;
      $('migrateStatus').textContent = '';
      step(1);
    } catch (error) { $('migrateStatus').textContent = error.message; }
  };

  $('migrateGo').onclick = async () => {
    const kinds = [...$('migrateKinds').querySelectorAll('input:checked')].map(b => b.value);
    if (!kinds.length) { $('migrateStatus').textContent = 'Choose something to bring.'; return; }
    try {
      await carryStudy(library.store, fromPrint, targetPrint, kinds);
      if ($('migrateRemove').checked) await clearStudy(library.store, fromPrint, kinds);
      const isDrive = from.source === 'drive';
      $('migrateDone').textContent = `Moved to “${name(target)}”${$('migrateRemove').checked ? ' and removed from the old note' : '; the old note keeps its copy'}. What should happen to “${name(from)}”?`;
      $('migrateLocalLabel').textContent = isDrive ? 'Remove the copy kept on this device' : 'Remove it from Recent (the file on your computer stays)';
      for (const id of ['migrateDriveRow', 'migrateBothRow']) $(id).hidden = !isDrive;
      document.querySelector('[name="migrateOld"][value="keep"]').checked = true;
      delete $('migrateFinish').dataset.armed;
      $('migrateFinish').textContent = 'Done';
      $('migrateStatus').textContent = '';
      step(2);
      refresh();
    } catch (error) { $('migrateStatus').textContent = error.message; }
  };

  // Moving a file to Drive's trash asks for a second press, like other destructive actions.
  document.addEventListener('change', event => {
    if (event.target.name !== 'migrateOld') return;
    delete $('migrateFinish').dataset.armed;
    $('migrateFinish').textContent = 'Done';
  });
  $('migrateFinish').onclick = async () => {
    const choice = document.querySelector('[name="migrateOld"]:checked')?.value || 'keep';
    const isDrive = from.source === 'drive', button = $('migrateFinish');
    if ((choice === 'drive' || choice === 'both') && button.dataset.armed !== '1') {
      button.dataset.armed = '1';
      button.textContent = 'Press again to move it to Drive’s trash';
      return;
    }
    try {
      if (choice === 'drive' || choice === 'both') {
        $('migrateStatus').textContent = 'Moving the file to Google Drive’s trash…';
        await drive.trash(from);
      }
      if (choice === 'local' || choice === 'both') await library.forget(from.key, { deleteFile: isDrive });
      $('migrateDialog').close();
      status({
        keep: 'Content migrated. The old file is unchanged.',
        local: isDrive ? 'Content migrated; the old copy was removed from this device.' : 'Content migrated; the old note was removed from Recent.',
        drive: 'Content migrated; the old file is in Google Drive’s trash (restorable for 30 days). The copy on this device stays.',
        both: 'Content migrated; the old file is in Google Drive’s trash and removed from this device.',
      }[choice]);
      refresh();
    } catch (error) { $('migrateStatus').textContent = error.message; }
  };
  $('migrateCancel').onclick = () => $('migrateDialog').close();
  $('migrateBack').onclick = () => step(0);
  return { open };
}
