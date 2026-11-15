// Index of AI-generated exams linked back to the resources they came from.

const SETTINGS_STORE = 'settings';
const EXAMS_KEY = 'exams:index';
const MAX_EXAMS = 200;

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeLabel(value) {
  return cleanText(value).replace(/\.[a-z0-9]+$/i, '').toLowerCase();
}

function uniqueStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const val = cleanText(item);
    if (!val || seen.has(val)) continue;
    seen.add(val);
    out.push(val);
  }
  return out;
}

/**
 * Normalizes a persisted exam record so list/matching helpers stay predictable.
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizeExamRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entryKey = cleanText(raw.entryKey);
  const id = cleanText(raw.id || entryKey);
  if (!id && !entryKey) return null;
  return {
    id,
    entryKey,
    title: cleanText(raw.title) || 'Untitled exam',
    fileName: cleanText(raw.fileName),
    pageCount: Number(raw.pageCount) || 0,
    tapeCount: Number(raw.tapeCount) || 0,
    created: Number(raw.created) || Date.now(),
    resourceKeys: uniqueStrings(raw.resourceKeys),
    resourceLabels: uniqueStrings(raw.resourceLabels),
  };
}

/**
 * Loads all indexed exams from the library store.
 * @param {object} store
 * @returns {Promise<object[]>}
 */
export async function listExams(store) {
  if (!store) return [];
  const raw = await store.get(SETTINGS_STORE, EXAMS_KEY);
  const items = Array.isArray(raw) ? raw : [];
  return items.map(normalizeExamRecord).filter(Boolean);
}

/**
 * Saves the normalized exam index to the library store.
 * @param {object} store
 * @param {object[]} items
 * @returns {Promise<object[]>}
 */
async function saveExams(store, items) {
  const normalized = (items || []).map(normalizeExamRecord).filter(Boolean).slice(0, MAX_EXAMS);
  if (store) await store.put(SETTINGS_STORE, EXAMS_KEY, normalized);
  return normalized;
}

/**
 * Prepends or updates an exam entry in the resource-linked exam index.
 * @param {object} store
 * @param {object} spec
 * @returns {Promise<object|null>}
 */
export async function recordExam(store, spec) {
  const record = normalizeExamRecord(spec);
  if (!record || !store) return record;
  const existing = await listExams(store);
  const filtered = existing.filter((item) => item.id !== record.id && (!record.entryKey || item.entryKey !== record.entryKey));
  await saveExams(store, [record, ...filtered]);
  return record;
}

/**
 * Removes an indexed exam by id or entryKey.
 * @param {object} store
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function removeExam(store, id) {
  if (!store || !id) return null;
  const existing = await listExams(store);
  const removed = existing.find((item) => item.id === id || item.entryKey === id) || null;
  if (!removed) return null;
  await saveExams(store, existing.filter((item) => item !== removed));
  return removed;
}

/**
 * Restores a previously removed exam record.
 * @param {object} store
 * @param {object} record
 * @returns {Promise<object|null>}
 */
export async function restoreExam(store, record) {
  return recordExam(store, record);
}

/**
 * Builds canonical resource lookup keys for a resource identity or open document.
 * @param {object} resource
 * @returns {string[]}
 */
export function resourceKeysFor(resource = {}) {
  const folderKeys = (resource.folderIds || []).flatMap((id) => {
    const clean = cleanText(id);
    if (!clean) return [];
    return clean.startsWith('group:') ? [clean, clean.slice(6)] : [clean, `group:${clean}`];
  });
  return uniqueStrings([
    resource.entryKey,
    resource.fingerprint,
    ...(resource.keys || []),
    ...folderKeys,
  ]);
}

/**
 * Filters indexed exams to those generated from the given resource (or its folder).
 * @param {object[]} exams
 * @param {object} resource
 * @returns {object[]}
 */
export function examsForResource(exams, resource = {}) {
  const list = Array.isArray(exams) ? exams : [];
  const wantedKeys = new Set(resourceKeysFor(resource));
  const wantedLabels = new Set([resource.title, resource.name].map(normalizeLabel).filter(Boolean));
  if (!wantedKeys.size && !wantedLabels.size) return [];
  return list.filter((exam) => {
    if ((exam.resourceKeys || []).some((key) => wantedKeys.has(key))) return true;
    if (!wantedLabels.size) return false;
    return (exam.resourceLabels || []).some((label) => wantedLabels.has(normalizeLabel(label)));
  });
}
