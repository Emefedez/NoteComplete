import test from 'node:test';
import assert from 'node:assert/strict';
import { WELCOME_KEY, welcomeWanted, setWelcomeWanted } from './welcome-pref.js';

function storage() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}

test('the welcome note opens until it is turned off, and again once turned back on', () => {
  const s = storage();
  assert.equal(welcomeWanted(s), true);
  setWelcomeWanted(false, s);
  assert.equal(s.map.get(WELCOME_KEY), 'off');
  assert.equal(welcomeWanted(s), false);
  setWelcomeWanted(true, s);
  assert.equal(welcomeWanted(s), true);
});

test('without storage (private browsing) the welcome note still opens', () => {
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(welcomeWanted(broken), true);
  assert.doesNotThrow(() => setWelcomeWanted(false, broken));
  assert.equal(welcomeWanted(undefined), true);
});
