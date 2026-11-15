import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crc32,
  encodeQrFrames,
  parseQrFrame,
  QrReceiver,
  describeQrEnvelope,
  formatEtaSeconds,
  estimateQrRemainingSeconds,
} from './qr-transfer.js';

test('single-frame study transfer round-trips small quiz payloads cleanly', async () => {
  const envelope = {
    kind: 'study',
    pack: {
      format: 'notecomplete-study',
      version: 1,
      title: 'Organic Chemistry',
      fingerprint: 'fp-chem-1',
      decks: [],
      quizzes: [{ id: 'q1', title: 'Alkenes', questions: [{ q: 'Which reagent adds syn-OH?', a: 'OsO₄' }] }],
      notes: '',
    },
  };
  const encoded = await encodeQrFrames(envelope, { maxChunk: 400, id: 'abc123' });
  assert.equal(encoded.total, 1);
  assert.equal(encoded.frames.length, 1);
  assert.match(encoded.frames[0], /^NCQR1\|abc123\|1\/1\|[0-9a-f]{8}\|/);

  const receiver = new QrReceiver();
  const res = await receiver.accept(encoded.frames[0]);
  assert.equal(res.done, true);
  assert.deepEqual(res.payload, envelope);
});

test('multi-frame progressive QR handles out-of-order, duplicate, and concurrent frames', async () => {
  const cards = Array.from({ length: 18 }, (_, i) => ({
    id: `c${i}`,
    front: `Term ${i}: α-helix & β-sheet hydrogen bonding #${i}`,
    back: `Definition ${i}: backbone N-H to C=O every ${i + 3} residues.`,
  }));
  const envelope = {
    kind: 'study',
    pack: {
      format: 'notecomplete-study',
      version: 1,
      title: 'Biochemistry Lecture 4',
      decks: [{ id: 'd1', title: 'Protein Folding', cards }],
      quizzes: [],
      notes: '',
    },
  };
  const encoded = await encodeQrFrames(envelope, { maxChunk: 100, id: 'bio404' });
  assert.ok(encoded.total > 2, `expected multi-frame transfer, got ${encoded.total}`);

  const receiver = new QrReceiver();
  // Unrelated non-NCQR codes are ignored without error.
  assert.deepEqual(await receiver.accept('https://example.com/hello'), { ignored: true });

  // Feed in reverse order + duplicate frame + noise from another id.
  const oddFirst = [...encoded.frames.filter((_, i) => i % 2 === 1), ...encoded.frames.filter((_, i) => i % 2 === 0)];
  let finished = null;
  for (let i = 0; i < oddFirst.length; i++) {
    const step = await receiver.accept(oddFirst[i]);
    if (i === 0) {
      assert.equal(step.done, false);
      assert.equal(step.received, 1);
      // Duplicate scan reports duplicate: true without advancing received count.
      const dup = await receiver.accept(oddFirst[0]);
      assert.equal(dup.duplicate, true);
      assert.equal(dup.received, 1);
    }
    if (step.done) finished = step;
  }
  assert.ok(finished?.done);
  assert.deepEqual(finished.payload, envelope);
});

test('CRC verification rejects corrupted reassembled transfers', async () => {
  const encoded = await encodeQrFrames({ kind: 'anki', name: 'Vocab', text: 'hola\thello\nadios\tbye\n' }, { maxChunk: 40, compress: false, id: 'bad01' });
  assert.ok(encoded.total >= 2);
  const receiver = new QrReceiver();
  for (let i = 0; i < encoded.frames.length - 1; i++) {
    const step = await receiver.accept(encoded.frames[i]);
    assert.equal(step.done, false);
  }
  // Flip one character in the final chunk while preserving header CRC.
  const parts = encoded.frames.at(-1).split('|');
  parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1);
  const corrupted = parts.join('|');
  const last = await receiver.accept(corrupted);
  assert.equal(last.done, false);
  assert.match(last.error, /Checksum mismatch/);
});

test('parseQrFrame validates headers and describeQrEnvelope summarizes payloads', () => {
  assert.equal(parseQrFrame('not a frame'), null);
  assert.equal(parseQrFrame('NCQR1|bad id|1/2|deadbeef|data'), null);
  assert.equal(parseQrFrame('NCQR1|ok12|3/2|deadbeef|data'), null);
  assert.equal(parseQrFrame('NCQR1|ok12|1/2|nothex!!|data'), null);
  assert.deepEqual(parseQrFrame('NCQR1|ok12|2/3|0123abcd|hello'), {
    id: 'ok12', index: 2, total: 3, crc: '0123abcd', data: 'hello',
  });
  assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926');
  assert.match(describeQrEnvelope({ kind: 'study', pack: { decks: [{}], quizzes: [{}, {}] } }), /1 deck, 2 quizzes/);
  assert.match(describeQrEnvelope({ kind: 'anki', name: 'Spanish' }), /Spanish/);
});

test('large compressed payloads round-trip without stream backpressure deadlock', async () => {
  const cards = Array.from({ length: 400 }, (_, i) => ({
    front: `Question ${i}: Explain membrane transport step ${i} across lipid bilayers (${(i * 7919).toString(36)})`,
    back: `Answer ${i}: Active/passive transport detail ${(i * 104729).toString(36)}`,
  }));
  const envelope = { kind: 'study', pack: { format: 'notecomplete-study', version: 1, title: 'Large Deck', fingerprint: 'fp-large', decks: [{ id: 'd-large', title: 'Large', cards }], quizzes: [], notes: '' } };
  const encoded = await encodeQrFrames(envelope, { maxChunk: 300, id: 'big01' });
  assert.ok(encoded.rawBytes > 40000);
  const receiver = new QrReceiver();
  let result = null;
  for (const frame of encoded.frames) result = await receiver.accept(frame);
  assert.equal(result?.done, true);
  assert.deepEqual(result.payload, envelope);
});

test('multi-frame protocol starts with Info QR (0/N), keeps slots strictly ordered, and flags skipped slots until cycled back', async () => {
  const envelope = {
    kind: 'note',
    name: 'Calculus.nfedit',
    mime: 'application/json',
    base64: 'x'.repeat(600),
  };
  const encoded = await encodeQrFrames(envelope, { maxChunk: 100, compress: false, id: 'calc1' });
  assert.ok(encoded.total >= 4);
  assert.match(encoded.infoFrame, new RegExp(`^NCQR1\\|calc1\\|0/${encoded.total}\\|[0-9a-f]{8}\\|`));
  assert.equal(encoded.streamFrames[0], encoded.infoFrame);
  assert.deepEqual(encoded.streamFrames.slice(1), encoded.frames);

  const rx = new QrReceiver();
  const infoStep = await rx.accept(encoded.infoFrame);
  assert.equal(infoStep.kind, 'info');
  assert.equal(infoStep.total, encoded.total);
  assert.equal(infoStep.received, 0);
  assert.match(infoStep.meta.title, /Calculus\.nfedit/);

  // Scan segment 1, skip segment 2, scan segment 3: slot 2 MUST remain empty and be flagged skipped.
  const s1 = await rx.accept(encoded.frames[0]);
  assert.equal(s1.index, 1);
  assert.deepEqual(s1.skipped, []);

  const s3 = await rx.accept(encoded.frames[2]);
  assert.equal(s3.index, 3);
  assert.equal(s3.received, 2);
  assert.deepEqual(s3.receivedSlots, [1, 3]);
  assert.deepEqual(s3.skipped, [2]);
  assert.ok(s3.missing.includes(2));

  // Cycle rest except segment 2, then return to segment 2 on next pass.
  for (let i = 3; i < encoded.frames.length; i++) await rx.accept(encoded.frames[i]);
  const s1Again = await rx.accept(encoded.frames[0]);
  assert.equal(s1Again.done, false);
  assert.deepEqual(s1Again.skipped, [2]);

  const doneStep = await rx.accept(encoded.frames[1]);
  assert.equal(doneStep.done, true);
  assert.equal(doneStep.index, 2);
  assert.deepEqual(doneStep.payload, envelope);
});

test('ETA helpers format durations and estimate remaining QR stream seconds accurately', () => {
  assert.equal(formatEtaSeconds(0), '~0s');
  assert.equal(formatEtaSeconds(12.2), '~12s');
  assert.equal(formatEtaSeconds(95), '~1m 35s');
  assert.equal(formatEtaSeconds(120), '~2m');
  // 50 total segments at 250ms per frame (4/s): full cycle ceil(12.5s)=13s; at index 10, 40 frames left = 10s; at end = 0s.
  assert.equal(estimateQrRemainingSeconds(0, 50, 250), 13);
  assert.equal(estimateQrRemainingSeconds(10, 50, 250), 10);
  assert.equal(estimateQrRemainingSeconds(50, 50, 250), 0);
});
