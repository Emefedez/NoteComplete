import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClock, formatClock, clampRange, wordsInRange, shiftWords, wordsText, sliceSamples, wavBytes } from './audio-trim.js';

test('times typed as m:ss, h:mm:ss or seconds, and shown back', () => {
  assert.equal(parseClock('1:30'), 90);
  assert.equal(parseClock('1:02:03.5'), 3723.5);
  assert.equal(parseClock('45,5'), 45.5);
  assert.ok(Number.isNaN(parseClock('1:xx')));
  assert.ok(Number.isNaN(parseClock('')));
  assert.equal(formatClock(90), '1:30.0');
  assert.equal(formatClock(3723.5), '1:02:03.5');
});

test('a segment is ordered, inside the recording and at least half a second', () => {
  assert.deepEqual(clampRange(30, 10, 100), [10, 30]);
  assert.deepEqual(clampRange(-5, 200, 100), [0, 100]);
  assert.deepEqual(clampRange(99.9, 99.9, 100), [99.5, 100]);
});

test('words of a segment from a transcript, and its text', () => {
  const words = [{ text: 'Hola', start: 0, end: 0.5 }, { text: 'mundo', start: 0.5, end: 1 }, { text: ',', start: 1, end: 1.1 }, { text: 'adiós', start: 2, end: 2.5 }];
  assert.deepEqual(wordsInRange(words, 0.4, 1.05).map((w) => w.text), ['Hola', 'mundo', ',']);
  assert.equal(wordsText(wordsInRange(words, 0.4, 1.05)), 'Hola mundo,');
  assert.deepEqual(shiftWords([{ text: 'a', start: 1, end: 2 }], 60), [{ text: 'a', start: 61, end: 62 }]);
});

test('only the segment\'s samples, as a 16-bit WAV for file-based engines', () => {
  const samples = Float32Array.from({ length: 16000 * 3 }, (_, i) => i / (16000 * 3));
  const part = sliceSamples(samples, 16000, 1, 2);
  assert.equal(part.length, 16000);
  assert.ok(Math.abs(part[0] - 1 / 3) < 1e-6);
  const wav = wavBytes(Float32Array.from([0, 1, -1]), 16000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [0, 32767, -32767]);
});
