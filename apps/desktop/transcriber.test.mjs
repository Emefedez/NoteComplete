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
