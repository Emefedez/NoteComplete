import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonErrorAt, jsonProblem } from './json-code.js';

test('a JSON error is found where Safari does not say', () => {
  const text = '{\n  "a": 1,\n  "b": [1, 2,]\n}';
  let err; try { JSON.parse(text); } catch (e) { err = e; }
  // Safari's words: no place in them.
  const at = jsonErrorAt(text, { message: 'JSON Parse error: Unexpected token \']\'' });
  assert.equal(at.line, 3);
  assert.match(at.message, /comma before \]/);
  // Chromium's own place is used as it is.
  const v8 = jsonErrorAt(text, err);
  assert.equal(v8.line, 3);
});

test('the scanner says what is missing, and nothing for valid JSON', () => {
  assert.equal(jsonProblem('{"a": [1, {"b": null}], "c": "x\\n"}'), null);
  assert.match(jsonProblem('{"a" 1}').message, /Expected :/);
  assert.equal(jsonProblem('{"a": 1,\n "b": 2').message, 'The text ends inside { }: a } is missing');
  assert.match(jsonProblem("{'a': 1}").message, /double quotes/);
  const p = jsonProblem('{\n "a": tru\n}');
  assert.equal('{\n "a": tru\n}'.slice(0, p.index).split('\n').length, 2);
});
