import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAudioClock, cleanTrackTitle } from './global-audio.js';

test('formatAudioClock formats seconds cleanly for short and hour-long tracks', () => {
  assert.equal(formatAudioClock(0), '0:00');
  assert.equal(formatAudioClock(5.9), '0:05');
  assert.equal(formatAudioClock(75), '1:15');
  assert.equal(formatAudioClock(3661), '1:01:01');
  assert.equal(formatAudioClock(NaN), '0:00');
  assert.equal(formatAudioClock(-12), '0:00');
});

test('cleanTrackTitle strips directory prefixes and .mp3 extension', () => {
  assert.equal(cleanTrackTitle('HSK1/Lesson 01.mp3'), 'Lesson 01');
  assert.equal(cleanTrackTitle('C:\\Audio\\Track.MP3'), 'Track');
  assert.equal(cleanTrackTitle(''), 'Audio');
});
