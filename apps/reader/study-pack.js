// Study material to send to another NoteComplete (the Study menu's Send…, or a .ncstudy file):
// a note's flashcard decks, quizzes and Markdown notes, as one JSON package. The receiver
// merges it into the same document when it has it (decks and quizzes by id, notes appended),
// else keeps it as a document of its own, listed in Study → All quizzes and decks.
import { mergeStudy } from './versions.js';

export const PACK_FORMAT = 'notecomplete-study', PACK_VERSION = 1;
export const MAX_PACK_BYTES = 20 * 1024 * 1024;
export const KINDS = [['decks', 'Flashcard decks'], ['quizzes', 'Quizzes'], ['notes', 'Markdown notes']];

// A document's study material, as kept on this device: { decks, quizzes, notes } (empty ones left out).
export async function studyOf(store, fingerprint) {
  const out = {};
  for (const [kind] of KINDS) {
    const value = await store.get('settings', `${kind}:${fingerprint}`).catch(() => null);
    if (kind === 'notes' ? String(value || '').trim() : Array.isArray(value) && value.length) out[kind] = value;
  }
  return out;
}

// What a pack holds, for the sender's choices and the receiver's question.
export function summary(pack) {
  const decks = Array.isArray(pack?.decks) ? pack.decks : [], quizzes = Array.isArray(pack?.quizzes) ? pack.quizzes : [];
  return {
    decks: decks.length,
    cards: decks.reduce((n, d) => n + (Array.isArray(d?.cards) ? d.cards.length : 0), 0),
    quizzes: quizzes.length,
    questions: quizzes.reduce((n, q) => n + (Array.isArray(q?.questions) ? q.questions.length : 0), 0),
    notes: typeof pack?.notes === 'string' && pack.notes.trim() ? pack.notes.length : 0,
  };
}
export function describePack(pack) {
  const s = summary(pack), parts = [];
  if (s.decks) parts.push(`${s.decks} flashcard deck${s.decks === 1 ? '' : 's'} (${s.cards} card${s.cards === 1 ? '' : 's'})`);
  if (s.quizzes) parts.push(`${s.quizzes} quiz${s.quizzes === 1 ? '' : 'zes'} (${s.questions} question${s.questions === 1 ? '' : 's'})`);
  if (s.notes) parts.push('Markdown notes');
  return parts.join(', ') || 'nothing';
}

// `include` says which kinds to send ({ decks, quizzes, notes }, all by default).
export function buildPack({ title, fingerprint = '', from = '', study, include = {} }) {
  const pack = { format: PACK_FORMAT, version: PACK_VERSION, title: String(title || 'Shared study material').slice(0, 200), fingerprint: String(fingerprint || ''), from: String(from || '').slice(0, 80), created: Date.now() };
  for (const [kind] of KINDS) if (include[kind] !== false && study?.[kind] != null) pack[kind] = study[kind];
  if (!summary(pack).decks && !summary(pack).quizzes && !summary(pack).notes) throw Error('There is no study material to send for this note yet.');
  return pack;
}

// A pack read from a file or the network: the known kinds only, each of the right shape.
export function readPack(value) {
  const pack = typeof value === 'string' ? JSON.parse(value) : value;
  if (pack?.format !== PACK_FORMAT) throw Error('This is not a NoteComplete study pack.');
  if (!Number.isInteger(pack.version) || pack.version > PACK_VERSION) throw Error('This study pack is from a newer NoteComplete. Update to read it.');
  const out = { format: PACK_FORMAT, version: PACK_VERSION, title: String(pack.title || 'Shared study material').slice(0, 200), fingerprint: String(pack.fingerprint || '').slice(0, 200), from: String(pack.from || '').slice(0, 80), created: Number(pack.created) || Date.now() };
  // Decks and quizzes are copied as plain data (no functions, nothing beyond the records).
  if (Array.isArray(pack.decks)) out.decks = JSON.parse(JSON.stringify(pack.decks.filter((d) => d && typeof d === 'object' && Array.isArray(d.cards))));
  if (Array.isArray(pack.quizzes)) out.quizzes = JSON.parse(JSON.stringify(pack.quizzes.filter((q) => q && typeof q === 'object' && Array.isArray(q.questions))));
  if (typeof pack.notes === 'string') out.notes = pack.notes.slice(0, 2 * 1024 * 1024);
  if (!summary(out).decks && !summary(out).quizzes && !summary(out).notes) throw Error('This study pack is empty.');
  return out;
}

// Keeps a pack on this device. The same document (its fingerprint is known here) gets the
// material merged in; otherwise it becomes a document of its own, "Title (from Name)".
// Returns { fingerprint, merged, counts }.
export async function importPack(store, pack, { known = async (fp) => !!(await store.get('settings', `doc:${fp}`).catch(() => null)), now = Date.now } = {}) {
  const merged = !!pack.fingerprint && (await known(pack.fingerprint));
  const fingerprint = merged ? pack.fingerprint : `received:${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  for (const [kind] of KINDS) {
    if (pack[kind] == null) continue;
    const existing = await store.get('settings', `${kind}:${fingerprint}`).catch(() => null);
    await store.set('settings', `${kind}:${fingerprint}`, mergeStudy(kind, existing, pack[kind]));
  }
  if (!merged) await store.set('settings', `doc:${fingerprint}`, { title: `${pack.title}${pack.from ? ` (from ${pack.from})` : ''}`, entryKey: '', at: now() });
  return { fingerprint, merged, counts: summary(pack) };
}
