import { noteIndex, blobReader } from './note-cover.js';
import { noteFingerprint } from './find.js';
import { carryStudy, STUDY } from './versions.js';
import { entryTitle, entrySourceLabel } from './library.js';

const ALL_STUDY_KINDS = [...STUDY.map(([k]) => k), 'scratch'];
const MAX_FULL_HASH_BYTES = 64 * 1024 * 1024;
const MAX_NFEDIT_PARSE_BYTES = 48 * 1024 * 1024;

const STRIP_EXT_RE = /\.(noteful|nfedit|notepart|notecomp|notecomplete|goodnotes|ntb|rnote|pdf|markdown|md|html?|txt|docx|docm|dotx|doc|rtf|odt|fodt|xlsx|xlsm|xlsb|xls|ods|fods|pptx|pptm|ppt|odp|epub|ipynb|png|jpe?g|webp|gif|bmp|avif)$/i;
// Copy markers: "(2)", "(copy)", and the id/hash tags older versions added: "(a1b2c3)", "(12oD0v)".
const COPY_SUFFIX_RE = /(?:\s*(?:\((?:\d+|[a-f0-9]{5,8}(?:-\d+)?|copy|copia)\)|[-_ ]+(?:copy|copia)(?:\s*\d+)?))+$/gi;

// A Drive id tag ("(12oD0v)"): six letters/digits with a digit and a lower→upper case change,
// which words like "(Tema12)" do not have. Case-sensitive, unlike COPY_SUFFIX_RE.
const ID_TAG_RE = /\s*\((?=[\w-]*\d)(?=[\w-]*[a-z][A-Z])[\w-]{6}\)$/;

export function normalizeNoteName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Strip known extensions twice cleanly in case of ".pdf.nfedit" or similar.
  s = s.replace(STRIP_EXT_RE, '').replace(STRIP_EXT_RE, '');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(COPY_SUFFIX_RE, '').replace(ID_TAG_RE, '').trim();
  }
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function decodeBase64(b64) {
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle?.digest) return '';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function notefulIdsFromBlob(blob) {
  const out = [];
  const idx = await noteIndex(blobReader(blob), blob.size).catch(() => null);
  for (const key of idx?.keys || []) {
    const m = /^n:(.+)$/i.exec(key);
    if (!m) continue;
    const rawId = m[1].trim().toLowerCase();
    // Legacy converted/created Noteful packages share "n:imported", which is NOT exclusive.
    if (!rawId || rawId === 'imported') continue;
    out.push(`noteful:${rawId}`);
  }
  return out;
}

export async function extractExclusiveIds(entry, file) {
  const ids = new Set();
  if (entry?.driveId) ids.add(`drive:${entry.driveId}`);
  if (entry?.archiveId) ids.add(`archive:${entry.archiveId}:${entry.path || entry.name || ''}`);
  if (entry?.url) ids.add(`web:${entry.url}`);
  if (!file) return [...ids];

  const name = String(entry?.name || file.name || '');
  if (/\.noteful$/i.test(name)) {
    for (const id of await notefulIdsFromBlob(file)) ids.add(id);
  } else if (/\.nfedit$/i.test(name) && file.size > 0 && file.size <= MAX_NFEDIT_PARSE_BYTES) {
    try {
      // A v13 .nfedit is a tar: its note is the `note.noteful` member.
      const member = await tarMember(file, 'note.noteful');
      if (member) {
        for (const id of await notefulIdsFromBlob(member)) ids.add(id);
        return [...ids];
      }
      const text = await file.text();
      const m = /"source_base64"\s*:\s*"([A-Za-z0-9+/=]+)"/.exec(text);
      if (m?.[1]) {
        const baseBytes = decodeBase64(m[1]);
        const baseBlob = new Blob([baseBytes]);
        for (const id of await notefulIdsFromBlob(baseBlob)) ids.add(id);
      }
    } catch { /* Ignore unreadable or malformed project text. */ }
  }
  return [...ids];
}

// One member of a ustar archive, as a Blob slice (no copy), or null.
async function tarMember(file, wanted) {
  let at = 0;
  while (at + 512 <= file.size) {
    const head = new Uint8Array(await file.slice(at, at + 512).arrayBuffer());
    if (head.every((b) => b === 0)) return null;
    if (new TextDecoder().decode(head.subarray(257, 262)) !== 'ustar') return null;
    const name = new TextDecoder().decode(head.subarray(0, 100)).replace(/\0.*$/s, '');
    const size = parseInt(new TextDecoder().decode(head.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) return null;
    if (name === wanted) return file.slice(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

export async function countEntryStudy(store, fingerprint) {
  if (!store || !fingerprint) return 0;
  let total = 0;
  for (const kind of ALL_STUDY_KINDS) {
    const val = await store.get('settings', `${kind}:${fingerprint}`).catch(() => null);
    if (kind === 'notes') total += String(val || '').trim() ? 1 : 0;
    else if (Array.isArray(val)) total += val.length;
  }
  return total;
}

export async function inspectDuplicateEntry(entry, { library, readFile } = {}) {
  const nameFromFile = entryTitle(entry) || entry?.name || '';
  const nameKey = normalizeNoteName(entry?.name || '') || normalizeNoteName(entry?.title || '');
  const titleKey = entry?.title ? normalizeNoteName(entry.title) : '';
  const nameKeys = [...new Set([nameKey, titleKey].filter((k) => k.length >= 2))];

  const file = readFile
    ? await readFile(entry).catch(() => null)
    : (library ? await library.open(entry).catch(() => null) : null);

  let fingerprint = '';
  const hashes = [];
  if (entry?.md5) hashes.push(`md5:${String(entry.md5).toLowerCase()}`);

  if (file) {
    try {
      fingerprint = await noteFingerprint(file);
    } catch { /* Ignore fingerprint failure. */ }
    if (file.size <= MAX_FULL_HASH_BYTES) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (library?.md5 && !entry?.md5) {
          const m = await library.md5(bytes).catch(() => '');
          if (m) hashes.push(`md5:${String(m).toLowerCase()}`);
        }
        const sha = await sha256Hex(bytes);
        if (sha) hashes.push(`sha256:${sha}`);
      } catch { /* Ignore read error. */ }
    }
    if (!hashes.length && fingerprint) hashes.push(`fp:${fingerprint}`);
  }

  const exclusiveIds = await extractExclusiveIds(entry, file);
  const studyCount = await countEntryStudy(library?.store, fingerprint);

  return {
    entry,
    name: nameFromFile,
    nameKeys,
    hashes: [...new Set(hashes)],
    exclusiveIds,
    fingerprint,
    studyCount,
    available: Boolean(file || entry?.source === 'web'),
  };
}

function sourceRank(entry) {
  if (entry?.source === 'local') return 3;
  if (entry?.source === 'imported') return 2;
  if (entry?.source === 'drive' || entry?.source === 'dropbox' || entry?.source === 'archive') return 1;
  return 0;
}

function formatRank(name = '') {
  if (/\.nfedit$/i.test(name)) return 4;
  if (/\.noteful$/i.test(name)) return 3;
  if (/\.(notecomp|notecomplete|notepart)$/i.test(name)) return 2;
  if (/\.pdf$/i.test(name)) return 1;
  return 0;
}

export function pickRecommendedKeep(items) {
  const sorted = [...items].sort((a, b) => {
    const fmt = formatRank(b.entry.name) - formatRank(a.entry.name);
    if (fmt) return fmt;
    if (Boolean(b.available) !== Boolean(a.available)) return b.available ? 1 : -1;
    const src = sourceRank(b.entry) - sourceRank(a.entry);
    if (src) return src;
    const timeB = Math.max(Number(b.entry.openedAt || 0), Date.parse(b.entry.modifiedTime || 0) || 0);
    const timeA = Math.max(Number(a.entry.openedAt || 0), Date.parse(a.entry.modifiedTime || 0) || 0);
    if (timeB !== timeA) return timeB - timeA;
    const sizeDiff = Number(b.entry.size || 0) - Number(a.entry.size || 0);
    if (sizeDiff) return sizeDiff;
    return String(a.entry.key).localeCompare(String(b.entry.key));
  });
  return sorted[0]?.entry?.key || '';
}

export function groupDuplicates(records) {
  const n = records.length;
  if (n < 2) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const clusterReasons = Array.from({ length: n }, () => new Set());
  const addIndex = (map, key, idx) => {
    if (!key) return;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(idx);
  };

  const byHash = new Map();
  const byId = new Map();
  const byName = new Map();
  records.forEach((rec, i) => {
    for (const h of rec.hashes) addIndex(byHash, h, i);
    for (const id of rec.exclusiveIds) addIndex(byId, id, i);
    for (const nm of rec.nameKeys) addIndex(byName, nm, i);
  });

  const connectBuckets = (buckets, label) => {
    for (const idxs of buckets.values()) {
      if (idxs.length < 2) continue;
      for (let i = 1; i < idxs.length; i++) unite(idxs[0], idxs[i]);
      for (const idx of idxs) clusterReasons[idx].add(label);
    }
  };
  connectBuckets(byHash, 'Hash');
  connectBuckets(byId, 'Note ID');
  connectBuckets(byName, 'Name');

  const components = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let comp = components.get(root);
    if (!comp) {
      comp = { items: [], reasons: new Set() };
      components.set(root, comp);
    }
    comp.items.push(records[i]);
    for (const r of clusterReasons[i]) comp.reasons.add(r);
  }

  const groups = [];
  for (const [id, comp] of components.entries()) {
    if (comp.items.length < 2) continue;
    const recommendedKeepKey = pickRecommendedKeep(comp.items);
    const keepItem = comp.items.find((x) => x.entry.key === recommendedKeepKey) || comp.items[0];
    groups.push({
      id: `dup-${id}`,
      label: entryTitle(keepItem.entry) || keepItem.entry.name || 'Untitled',
      reasons: ['Hash', 'Note ID', 'Name'].filter((r) => comp.reasons.has(r)),
      recommendedKeepKey,
      items: comp.items,
    });
  }
  groups.sort((a, b) => b.reasons.length - a.reasons.length || b.items.length - a.items.length || a.label.localeCompare(b.label));
  return groups;
}

export async function scanDuplicates({ library, readFile, onProgress } = {}) {
  const allEntries = (await library.store.values('entries'))
    .filter((e) => e && e.key && e.source !== 'web')
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  const records = [];
  for (let i = 0; i < allEntries.length; i++) {
    onProgress?.({ done: i, total: allEntries.length, current: allEntries[i].name || '' });
    records.push(await inspectDuplicateEntry(allEntries[i], { library, readFile }));
  }
  onProgress?.({ done: allEntries.length, total: allEntries.length, current: '' });
  return {
    total: allEntries.length,
    groups: groupDuplicates(records),
  };
}

const coverKeyFor = (library, entry) => (entry.source === 'drive'
  ? library.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime })
  : entry.source === 'dropbox'
    ? library.coverKey(entry)
    : entry.key);

export async function combineDuplicateGroup({
  group,
  keepKey,
  trashLocalFiles = false,
  library,
  groups = null,
  bridge = null,
} = {}) {
  const keep = group.items.find((i) => i.entry.key === keepKey) || group.items[0];
  if (!keep) return { kept: null, removed: 0, mergedStudy: false };
  const extras = group.items.filter((i) => i.entry.key !== keep.entry.key);
  if (!extras.length) return { kept: keep.entry, removed: 0, mergedStudy: false };

  const store = library.store;
  const allEntries = await store.values('entries').catch(() => []);
  const extraKeys = new Set(extras.map((e) => e.entry.key));
  const remainingEntries = allEntries.filter((e) => !extraKeys.has(e.key));

  // 1. Carry study resources (decks, quizzes, notes, recordings, scratch) onto kept fingerprint.
  let mergedStudy = false;
  if (keep.fingerprint) {
    for (const extra of extras) {
      if (!extra.fingerprint || extra.fingerprint === keep.fingerprint) continue;
      if (extra.studyCount > 0) {
        await carryStudy(store, extra.fingerprint, keep.fingerprint, ALL_STUDY_KINDS);
        mergedStudy = true;
      }
      const docMeta = await store.get('settings', `doc:${extra.fingerprint}`).catch(() => null);
      if (docMeta) {
        const curDoc = await store.get('settings', `doc:${keep.fingerprint}`).catch(() => null);
        if (!curDoc) {
          await store.set('settings', `doc:${keep.fingerprint}`, {
            ...docMeta,
            title: entryTitle(keep.entry) || docMeta.title,
            entryKey: keep.entry.key,
          }).catch(() => {});
        }
        await store.delete('settings', `doc:${extra.fingerprint}`).catch(() => {});
      }
      // Clean up orphaned study keys if no other library entry still uses extra.fingerprint.
      for (const kind of ALL_STUDY_KINDS) {
        await store.delete('settings', `${kind}:${extra.fingerprint}`).catch(() => {});
      }
    }
  }

  // 2. Preserve cover thumbnail if the kept copy has none.
  const keepCoverKey = coverKeyFor(library, keep.entry);
  if (!(await library.cover(keepCoverKey))) {
    for (const extra of extras) {
      const cov = (await library.cover(coverKeyFor(library, extra.entry))) || (await library.cover(extra.entry.key));
      if (cov) {
        await library.saveCover(keepCoverKey, cov);
        break;
      }
    }
  }

  // 3. Preserve title and latest openedAt timestamp if missing on kept copy.
  let updatedKeep = { ...keep.entry };
  for (const extra of extras) {
    updatedKeep.openedAt = Math.max(Number(updatedKeep.openedAt || 0), Number(extra.entry.openedAt || 0));
    if (!updatedKeep.title && extra.entry.title) updatedKeep.title = extra.entry.title;
  }
  await store.set('entries', updatedKeep.key, updatedKeep);

  // 4. Remap groups / folders / starred flags from extras -> kept copy.
  if (groups) {
    const keepMember = {
      key: updatedKeep.key,
      name: updatedKeep.name,
      source: updatedKeep.source || 'drive',
      ...(updatedKeep.path ? { path: updatedKeep.path } : {}),
      ...(updatedKeep.url ? { url: updatedKeep.url } : {}),
    };
    for (const g of await groups.all()) {
      let touched = false;
      const seen = new Set();
      const nextMembers = [];
      for (const m of g.members || []) {
        const mapped = extraKeys.has(m.key) ? keepMember : m;
        if (mapped?.key && !seen.has(mapped.key)) {
          seen.add(mapped.key);
          nextMembers.push(mapped);
        }
        if (extraKeys.has(m.key)) touched = true;
      }
      const starSeen = new Set();
      const nextStarred = [];
      for (const k of g.starred || []) {
        const mapped = extraKeys.has(k) ? updatedKeep.key : k;
        if (!starSeen.has(mapped)) {
          starSeen.add(mapped);
          nextStarred.push(mapped);
        }
        if (extraKeys.has(k)) touched = true;
      }
      if (touched) {
        g.members = nextMembers;
        g.starred = nextStarred;
        await groups.save(g);
      }
    }
  }

  // 5. Remap saved exam links referencing removed entryKeys.
  const exams = await store.get('settings', 'exams').catch(() => null);
  if (Array.isArray(exams) && exams.some((ex) => ex && extraKeys.has(ex.entryKey))) {
    const nextExams = exams.map((ex) => (ex && extraKeys.has(ex.entryKey) ? { ...ex, entryKey: updatedKeep.key } : ex));
    await store.set('settings', 'exams', nextExams).catch(() => {});
  }

  // 6. Remove extras cleanly from Recent / library cache (and Trash local files only if opted in).
  let removed = 0;
  for (const extra of extras) {
    if (extra.entry.source === 'local') {
      if (
        trashLocalFiles
        && bridge?.trashOpened
        && extra.entry.path
        && extra.entry.path !== updatedKeep.path
      ) {
        await bridge.trashOpened(extra.entry.path).catch(() => {});
      }
      await library.forget(extra.entry.key);
    } else {
      const stillReferenced = Boolean(extra.entry.filename && (
        extra.entry.filename === updatedKeep.filename
        || remainingEntries.some((r) => r.filename === extra.entry.filename)
      ));
      await library.forget(extra.entry.key, { deleteFile: !stillReferenced });
    }
    removed++;
  }

  return { kept: updatedKeep, removed, mergedStudy };
}

function formatSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function duplicatesDialog({ library, groups, bridge, onChanged, status }) {
  const $ = (id) => document.getElementById(id);
  let scanResult = null;
  const chosenKeep = new Map();
  const checkedGroups = new Set();

  function render() {
    const list = $('duplicatesList');
    const summary = $('duplicatesSummary');
    const controls = $('duplicatesControls');
    const combineAllBtn = $('duplicatesCombineAll');
    list.replaceChildren();
    const found = scanResult?.groups || [];
    if (!found.length) {
      controls.hidden = true;
      combineAllBtn.disabled = true;
      summary.textContent = scanResult
        ? `Scanned ${scanResult.total} ${scanResult.total === 1 ? 'note' : 'notes'} — no duplicates found.`
        : '';
      return;
    }
    controls.hidden = false;
    summary.textContent = `Scanned ${scanResult.total} notes: found ${found.length} duplicate ${found.length === 1 ? 'group' : 'groups'}. Pick which copy to keep in each group.`;

    const trashLocalAllowed = Boolean(bridge?.trashOpened)
      && found.some((g) => g.items.some((it) => it.entry.source === 'local'));
    $('dupTrashLocalRow').hidden = !trashLocalAllowed;

    for (const g of found) {
      const card = document.createElement('section');
      card.className = 'dup-group';
      const keepKey = chosenKeep.get(g.id) || g.recommendedKeepKey;
      chosenKeep.set(g.id, keepKey);

      const hdr = document.createElement('div');
      hdr.className = 'dup-group-head';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = checkedGroups.has(g.id);
      toggle.setAttribute('aria-label', `Select ${g.label}`);
      toggle.onchange = () => {
        if (toggle.checked) checkedGroups.add(g.id);
        else checkedGroups.delete(g.id);
        combineAllBtn.disabled = checkedGroups.size === 0;
      };

      const title = document.createElement('strong');
      title.textContent = `${g.label} (${g.items.length})`;
      const badges = document.createElement('span');
      badges.className = 'dup-reasons';
      for (const reason of g.reasons) {
        const b = document.createElement('span');
        b.className = `dup-badge ${reason === 'Hash' ? 'hash' : reason === 'Note ID' ? 'id' : 'name'}`;
        b.textContent = reason;
        badges.append(b);
      }

      const combineOneBtn = document.createElement('button');
      combineOneBtn.type = 'button';
      combineOneBtn.className = 'chip';
      combineOneBtn.textContent = 'Combine';
      combineOneBtn.onclick = async () => {
        combineOneBtn.disabled = true;
        try {
          const trashLocalFiles = !$('dupTrashLocalRow').hidden && $('dupTrashLocal').checked;
          const res = await combineDuplicateGroup({
            group: g,
            keepKey: chosenKeep.get(g.id),
            trashLocalFiles,
            library,
            groups,
            bridge,
          });
          const removedKeys = g.items.map((it) => it.entry.key).filter((k) => k !== res.kept?.key);
          scanResult.groups = scanResult.groups.filter((x) => x.id !== g.id);
          checkedGroups.delete(g.id);
          render();
          onChanged?.([{ keepKey: res.kept?.key, removedKeys }]);
          status?.(`Combined “${g.label}” (removed ${res.removed} extra ${res.removed === 1 ? 'copy' : 'copies'}).`);
        } catch (error) {
          combineOneBtn.disabled = false;
          status?.(error.message, true);
        }
      };

      hdr.append(toggle, title, badges, combineOneBtn);
      card.append(hdr);

      const itemsBox = document.createElement('div');
      itemsBox.className = 'dup-items';
      for (const item of g.items) {
        const row = document.createElement('label');
        row.className = 'dup-item';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `keep-${g.id}`;
        radio.value = item.entry.key;
        radio.checked = item.entry.key === keepKey;
        radio.onchange = () => chosenKeep.set(g.id, item.entry.key);

        const body = document.createElement('div');
        body.className = 'dup-item-body';
        const src = entrySourceLabel(item.entry);
        const study = item.studyCount > 0 ? ` · ${item.studyCount} study item${item.studyCount === 1 ? '' : 's'}` : '';
        const nameRow = document.createElement('div');
        nameRow.className = 'dup-item-name';
        nameRow.textContent = item.entry.name || item.name;
        if (item.entry.key === g.recommendedKeepKey) {
          const rec = document.createElement('span');
          rec.className = 'dup-rec';
          rec.textContent = 'Recommended';
          nameRow.append(' ', rec);
        }
        const metaRow = document.createElement('div');
        metaRow.className = 'dup-item-meta';
        metaRow.textContent = `${src} · ${formatSize(item.entry.size)}${study}`;
        body.append(nameRow, metaRow);
        row.append(radio, body);
        itemsBox.append(row);
      }
      card.append(itemsBox);
      list.append(card);
    }
    combineAllBtn.disabled = checkedGroups.size === 0;
  }

  async function runScan() {
    const summary = $('duplicatesSummary');
    const list = $('duplicatesList');
    $('duplicatesControls').hidden = true;
    $('duplicatesCombineAll').disabled = true;
    $('duplicatesRescan').disabled = true;
    list.replaceChildren();
    summary.textContent = 'Scanning library entries, note IDs, and hashes…';
    try {
      scanResult = await scanDuplicates({
        library,
        onProgress: ({ done, total, current }) => {
          summary.textContent = total
            ? `Scanning ${done}/${total}${current ? `: ${current}` : ''}…`
            : 'Scanning…';
        },
      });
      chosenKeep.clear();
      checkedGroups.clear();
      for (const g of scanResult.groups) {
        chosenKeep.set(g.id, g.recommendedKeepKey);
        if (g.reasons.includes('Hash') || g.reasons.includes('Note ID')) checkedGroups.add(g.id);
      }
      render();
    } catch (error) {
      summary.textContent = error.message || 'Scan failed.';
      status?.(error.message, true);
    } finally {
      $('duplicatesRescan').disabled = false;
    }
  }

  $('duplicatesCancel').onclick = () => $('duplicatesDialog').close();
  $('duplicatesRescan').onclick = () => { void runScan(); };
  $('dupSelectAll').onclick = () => {
    const found = scanResult?.groups || [];
    const allSelected = found.length > 0 && checkedGroups.size === found.length;
    checkedGroups.clear();
    if (!allSelected) for (const g of found) checkedGroups.add(g.id);
    render();
  };
  $('duplicatesCombineAll').onclick = async () => {
    const selected = (scanResult?.groups || []).filter((g) => checkedGroups.has(g.id));
    if (!selected.length) return;
    $('duplicatesCombineAll').disabled = true;
    const trashLocalFiles = !$('dupTrashLocalRow').hidden && $('dupTrashLocal').checked;
    let totalRemoved = 0;
    const mergedBatches = [];
    try {
      for (const g of selected) {
        const res = await combineDuplicateGroup({
          group: g,
          keepKey: chosenKeep.get(g.id),
          trashLocalFiles,
          library,
          groups,
          bridge,
        });
        totalRemoved += res.removed;
        mergedBatches.push({
          keepKey: res.kept?.key,
          removedKeys: g.items.map((it) => it.entry.key).filter((k) => k !== res.kept?.key),
        });
        scanResult.groups = scanResult.groups.filter((x) => x.id !== g.id);
        checkedGroups.delete(g.id);
      }
      render();
      onChanged?.(mergedBatches);
      status?.(`Combined ${selected.length} ${selected.length === 1 ? 'group' : 'groups'} (${totalRemoved} extra ${totalRemoved === 1 ? 'copy' : 'copies'} removed).`);
    } catch (error) {
      status?.(error.message, true);
    }
  };

  return {
    open() {
      $('duplicatesDialog').showModal();
      void runScan();
    },
  };
}
