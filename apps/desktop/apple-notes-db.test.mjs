import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { readAppleNotesSqlite } from './apple-notes-db.js';

function encodeVarint(n) {
  const out = [];
  let v = n >>> 0;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return out;
}
function fieldVarint(num, val) {
  return [...encodeVarint((num << 3) | 0), ...encodeVarint(val)];
}
function fieldBytes(num, bytes) {
  const arr = typeof bytes === 'string' ? [...new TextEncoder().encode(bytes)] : [...bytes];
  return [...encodeVarint((num << 3) | 2), ...encodeVarint(arr.length), ...arr];
}

test('readAppleNotesSqlite parses folders, gzipped protobuf notes, and skips deleted/locked notes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-apple-test-'));
  const dbPath = path.join(dir, 'NoteStore.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE ZICCLOUDSYNCINGOBJECT (
        Z_PK INTEGER PRIMARY KEY,
        ZTITLE1 TEXT,
        ZTITLE2 TEXT,
        ZSNIPPET TEXT,
        ZFOLDER INTEGER,
        ZPARENT INTEGER,
        ZMARKEDFORDELETION INTEGER,
        ZISPASSWORDPROTECTED INTEGER,
        ZISPINNED INTEGER,
        ZCREATIONDATE3 REAL,
        ZMODIFICATIONDATE1 REAL,
        ZIDENTIFIER TEXT,
        ZTYPEUTI TEXT,
        ZALTTEXT TEXT
      );
      CREATE TABLE ZICNOTEDATA (
        Z_PK INTEGER PRIMARY KEY,
        ZNOTE INTEGER,
        ZDATA BLOB
      );
    `);

    // Folder "Universidad" (pk=1) -> subfolder "Estadística" (pk=2)
    db.prepare('INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE2, ZPARENT, ZMARKEDFORDELETION) VALUES (1, ?, NULL, 0)').run('Universidad');
    db.prepare('INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE2, ZPARENT, ZMARKEDFORDELETION) VALUES (2, ?, 1, 0)').run('Estadística');

    // Note 1 (pk=10) with gzipped protobuf
    const noteText = 'Distribución Normal\nMedia y varianza';
    const noteMsg = [
      ...fieldBytes(2, noteText),
      ...fieldBytes(5, [...fieldVarint(1, 20), ...fieldBytes(2, fieldVarint(1, 0))]),
      ...fieldBytes(5, [...fieldVarint(1, 16), ...fieldVarint(5, 1)]),
    ];
    const proto = Buffer.from(fieldBytes(2, [...fieldVarint(2, 0), ...fieldBytes(3, noteMsg)]));
    const gz = gzipSync(proto);

    db.prepare('INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE1, ZSNIPPET, ZFOLDER, ZMARKEDFORDELETION, ZISPASSWORDPROTECTED, ZISPINNED) VALUES (10, ?, ?, 2, 0, 0, 1)')
      .run('Distribución Normal', 'Media y varianza');
    db.prepare('INSERT INTO ZICNOTEDATA (Z_PK, ZNOTE, ZDATA) VALUES (1, 10, ?)').run(gz);

    // Note 2 (pk=11): password locked
    db.prepare('INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE1, ZFOLDER, ZMARKEDFORDELETION, ZISPASSWORDPROTECTED) VALUES (11, ?, 2, 0, 1)')
      .run('Secret');
    // Note 3 (pk=12): deleted
    db.prepare('INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE1, ZFOLDER, ZMARKEDFORDELETION, ZISPASSWORDPROTECTED) VALUES (12, ?, 2, 1, 0)')
      .run('Deleted');
    db.close();

    const res = await readAppleNotesSqlite(dbPath);
    assert.equal(res.notes.length, 1);
    assert.equal(res.lockedCount, 1);
    assert.equal(res.notes[0].title, 'Distribución Normal');
    assert.equal(res.notes[0].folder, 'Universidad / Estadística');
    assert.equal(res.notes[0].pinned, true);
    assert.match(res.notes[0].markdown, /^# Distribución Normal/m);
    assert.match(res.notes[0].markdown, /\*\*Media y varianza\*\*/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
