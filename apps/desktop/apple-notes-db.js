// Desktop Apple Notes SQLite database (NoteStore.sqlite) reader for NoteComplete.
// Uses built-in `node:sqlite` (DatabaseSync) + `node:zlib` (gunzipSync) — zero native deps.
// Always copies the database to a temporary folder before reading so a live macOS Apple Notes
// database is never locked or modified.
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APPLE_EPOCH_MS = 978307200 * 1000; // 2001-01-01T00:00:00Z
const HERE = path.dirname(fileURLToPath(import.meta.url));

let protoMod = null;
async function getProtoMod() {
  if (protoMod) return protoMod;
  const candidates = [
    path.resolve(HERE, 'reader/apple-notes-import.js'),
    path.resolve(HERE, '../reader/apple-notes-import.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      protoMod = await import(pathToFileURL(p).href);
      return protoMod;
    }
  }
  throw Error('Could not locate apple-notes-import.js decoder.');
}

export function defaultMacAppleNotesPath() {
  return path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.notes', 'NoteStore.sqlite');
}

export async function detectMacAppleNotesDb() {
  if (process.platform !== 'darwin') return { available: false, path: '' };
  const p = defaultMacAppleNotesPath();
  try {
    const s = await stat(p);
    return { available: s.isFile(), path: p };
  } catch {
    return { available: false, path: p };
  }
}

function maybeGunzip(buf) {
  if (!buf || buf.length < 2) return buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return gunzipSync(buf); } catch { return buf; }
  }
  return buf;
}

/**
 * Reads notes and folder hierarchy from an Apple Notes `NoteStore.sqlite` file.
 * @param {string} dbPath
 * @returns {Promise<{ notes: Array<{ title: string, folder: string, markdown: string, createdAt: number, modifiedAt: number, pinned: boolean }>, folders: string[], lockedCount: number, totalCount: number }>}
 */
export async function readAppleNotesSqlite(dbPath) {
  if (!dbPath || !existsSync(dbPath)) throw Error('NoteStore.sqlite file not found.');
  const { decodeAppleNoteProto: decodeProto, decodeAppleNoteTableProto: decodeTable } = await getProtoMod();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nc-apple-notes-'));
  const tmpDb = path.join(tmpDir, 'NoteStore.sqlite');

  try {
    await copyFile(dbPath, tmpDb);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${dbPath}${suffix}`)) {
        await copyFile(`${dbPath}${suffix}`, `${tmpDb}${suffix}`).catch(() => {});
      }
    }

    const db = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      // Discover columns on ZICCLOUDSYNCINGOBJECT so older and newer macOS/iOS schemas both work.
      const cols = new Set(db.prepare('PRAGMA table_info(ZICCLOUDSYNCINGOBJECT)').all().map((r) => r.name));
      if (!cols.size) throw Error('This SQLite file does not look like an Apple Notes NoteStore.sqlite database.');

      const hasDeleted = cols.has('ZMARKEDFORDELETION');
      const hasLocked = cols.has('ZISPASSWORDPROTECTED');
      const hasPinned = cols.has('ZISPINNED');
      const hasFolder = cols.has('ZFOLDER');
      const hasTitle2 = cols.has('ZTITLE2');
      const hasParent = cols.has('ZPARENT');
      const hasSnippet = cols.has('ZSNIPPET');
      const hasCreated = cols.has('ZCREATIONDATE3') ? 'ZCREATIONDATE3' : (cols.has('ZCREATIONDATE1') ? 'ZCREATIONDATE1' : (cols.has('ZCREATIONDATE') ? 'ZCREATIONDATE' : null));
      const hasModified = cols.has('ZMODIFICATIONDATE1') ? 'ZMODIFICATIONDATE1' : (cols.has('ZMODIFICATIONDATE') ? 'ZMODIFICATIONDATE' : null);

      // 1. Folder lookup map (id -> { title, parent })
      const folderMap = new Map();
      if (hasTitle2) {
        const fRows = db.prepare(
          `SELECT Z_PK as id, ZTITLE2 as title${hasParent ? ', ZPARENT as parent' : ''} FROM ZICCLOUDSYNCINGOBJECT WHERE ZTITLE2 IS NOT NULL${hasDeleted ? ' AND (ZMARKEDFORDELETION IS NULL OR ZMARKEDFORDELETION = 0)' : ''}`,
        ).all();
        for (const r of fRows) {
          if (r.title) folderMap.set(Number(r.id), { title: String(r.title).trim(), parent: Number(r.parent) || 0 });
        }
      }
      const folderPathOf = (fid) => {
        const parts = [];
        let cur = Number(fid) || 0;
        const seen = new Set();
        while (cur && folderMap.has(cur) && !seen.has(cur)) {
          seen.add(cur);
          const f = folderMap.get(cur);
          if (f.title) parts.unshift(f.title);
          cur = f.parent;
        }
        return parts.length ? parts.join(' / ') : 'Apple Notes';
      };

      // 2. Attachments lookup map (ZIDENTIFIER -> { title, filename, uti, altText, markdown })
      const attachments = {};
      if (cols.has('ZIDENTIFIER') && cols.has('ZTYPEUTI')) {
        const aCols = ['ZIDENTIFIER as id', 'ZTYPEUTI as uti'];
        if (cols.has('ZTITLE')) aCols.push('ZTITLE as title');
        if (cols.has('ZFILENAME')) aCols.push('ZFILENAME as filename');
        if (cols.has('ZALTTEXT')) aCols.push('ZALTTEXT as altText');
        const mergeCol = cols.has('ZMERGEABLEDATA1') ? 'ZMERGEABLEDATA1' : (cols.has('ZMERGEABLEDATA') ? 'ZMERGEABLEDATA' : null);
        if (mergeCol) aCols.push(`${mergeCol} as mergeable`);
        const aRows = db.prepare(`SELECT ${aCols.join(', ')} FROM ZICCLOUDSYNCINGOBJECT WHERE ZIDENTIFIER IS NOT NULL AND ZTYPEUTI IS NOT NULL`).all();
        for (const a of aRows) {
          if (!a.id) continue;
          const uti = String(a.uti || '');
          let tableMd = '';
          if (uti === 'com.apple.notes.table' && a.mergeable && a.mergeable.length) {
            const rawTable = maybeGunzip(a.mergeable instanceof Uint8Array ? a.mergeable : new Uint8Array(a.mergeable));
            tableMd = decodeTable(rawTable);
          }
          attachments[String(a.id)] = {
            title: a.title ? String(a.title) : '',
            filename: a.filename ? String(a.filename) : '',
            altText: a.altText ? String(a.altText) : '',
            uti,
            markdown: tableMd,
          };
        }
      }

      // 3. Query notes joined with ZICNOTEDATA
      const noteSelect = [
        'o.Z_PK as id',
        'o.ZTITLE1 as title',
        hasSnippet ? 'o.ZSNIPPET as snippet' : 'NULL as snippet',
        hasFolder ? 'o.ZFOLDER as folderId' : '0 as folderId',
        hasLocked ? 'o.ZISPASSWORDPROTECTED as locked' : '0 as locked',
        hasPinned ? 'o.ZISPINNED as pinned' : '0 as pinned',
        hasCreated ? `o.${hasCreated} as created` : '0 as created',
        hasModified ? `o.${hasModified} as modified` : '0 as modified',
        'd.ZDATA as zdata',
      ];
      const rows = db.prepare(
        `SELECT ${noteSelect.join(', ')}
         FROM ZICCLOUDSYNCINGOBJECT o
         LEFT JOIN ZICNOTEDATA d ON d.ZNOTE = o.Z_PK
         WHERE (o.ZTITLE1 IS NOT NULL OR d.ZDATA IS NOT NULL)
           ${hasDeleted ? 'AND (o.ZMARKEDFORDELETION IS NULL OR o.ZMARKEDFORDELETION = 0)' : ''}`,
      ).all();

      const notes = [];
      const folderSet = new Set();
      let lockedCount = 0;

      for (const r of rows) {
        if (Number(r.locked) === 1) {
          lockedCount++;
          continue;
        }
        const folder = folderPathOf(r.folderId);
        let markdown = '';
        let decodedTitle = '';
        if (r.zdata && r.zdata.length) {
          const raw = maybeGunzip(r.zdata instanceof Uint8Array ? r.zdata : new Uint8Array(r.zdata));
          const decoded = decodeProto(raw, { attachments });
          markdown = decoded.markdown;
          decodedTitle = decoded.title;
        }
        const title = String(r.title || decodedTitle || 'Apple Note').trim();
        if (!markdown) {
          const fallbackBody = [title, r.snippet ? String(r.snippet).trim() : ''].filter(Boolean).join('\n\n');
          markdown = fallbackBody;
        }
        if (!markdown.trim()) continue;
        folderSet.add(folder);
        notes.push({
          title,
          folder,
          markdown,
          createdAt: r.created ? Math.round(APPLE_EPOCH_MS + Number(r.created) * 1000) : 0,
          modifiedAt: r.modified ? Math.round(APPLE_EPOCH_MS + Number(r.modified) * 1000) : 0,
          pinned: Number(r.pinned) === 1,
        });
      }

      return {
        notes,
        folders: [...folderSet],
        lockedCount,
        totalCount: notes.length + lockedCount,
      };
    } finally {
      db.close();
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
