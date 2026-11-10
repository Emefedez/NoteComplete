import test from 'node:test';
import assert from 'node:assert/strict';
import { voxtypeText, geminiSegments } from './transcriber.js';

test('voxtype output keeps only the transcript lines', () => {
  const out = 'Loading audio file: "/t/piece-0001.wav"\nAudio format: 16000 Hz, 1 channel(s), Int\nProcessing 479317 samples (29.96s)...\n\nEste software sirve para usar el ordenador.\n';
  assert.equal(voxtypeText(out), 'Este software sirve para usar el ordenador.');
});

test('Gemini segments are shifted by the piece offset', () => {
  const reply = 'Sure:\n{"segments":[{"start":6.72,"end":11.73,"text":"Este software sirve"},{"start":12,"text":"  "}]}';
  assert.deepEqual(geminiSegments(reply, 600), [{ start: 606.72, end: 611.73, text: 'Este software sirve' }]);
});

import { transcriber } from './transcriber.js';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const ffmpeg = (() => { try { return execFileSync('sh', ['-c', 'command -v ffmpeg']).toString().trim(); } catch { return ''; } })();
test('a Voxtype piece with invalid UTF-8 is cut in two and retried; the language is passed', { skip: !ffmpeg }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vox-test-')), log = path.join(dir, 'calls');
  // Fails on whole 30 s pieces like whisper.cpp did, succeeds on the halves.
  const fake = path.join(dir, 'voxtype');
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${log}\ncase "$*" in *-0[01].wav*) echo "mitad"; exit 0;; esac\necho "Error: Transcription failed: Invalid UTF-8 detected in a string from Whisper. Index: 137" >&2; exit 1\n`);
  chmodSync(fake, 0o755);
  const wav = path.join(dir, 'in.wav');
  execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '30', wav]);
  const asr = transcriber({ tools: async () => ({ voxtype: fake, ffmpeg }) });
  const updates = [];
  const segments = await asr.run('t', { backend: 'voxtype', bytes: new Uint8Array(readFileSync(wav)), language: 'spanish' }, (...a) => updates.push(a));
  assert.deepEqual(segments.map(s => [s.start, s.text]), [[0, 'mitad'], [15, 'mitad']]);
  assert.match(readFileSync(log, 'utf8'), /--language es transcribe/);
  assert.equal(updates.at(-1)[3], 0);
});

import { voicedSpans, voicedSegments } from './transcriber.js';
test('Voxtype words go to the voiced stretches of a piece, not across its pauses', () => {
  const log = 'silence_start: 0\nsilence_end: 4.2 | silence_duration: 4.2\nsilence_start: 12.5\nsilence_end: 14 | silence_duration: 1.5\nsilence_start: 27.5\n';
  const spans = voicedSpans(log, 30);
  assert.deepEqual(spans, [{ start: 4.2, end: 12.5 }, { start: 14, end: 27.5 }]);
  const segments = voicedSegments('uno dos tres cuatro cinco seis siete ocho nueve diez', spans, 60, 30);
  assert.equal(segments.length, 2);
  assert.ok(segments[0].start >= 64.2 && segments[1].end <= 87.5);
  assert.equal(segments.map(s => s.text).join(' '), 'uno dos tres cuatro cinco seis siete ocho nueve diez');
  assert.deepEqual(voicedSegments('hola', [], 0, 30), [{ start: 0, end: 30, text: 'hola' }]);
});
