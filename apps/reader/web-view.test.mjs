import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLink, linkTitle } from './web-view.js';

test('links: web addresses only, https added when missing', () => {
  assert.equal(normalizeLink('www.notion.so/uni/Tema-1-abc'), 'https://www.notion.so/uni/Tema-1-abc');
  assert.equal(normalizeLink(' https://curso.notion.site/Temario '), 'https://curso.notion.site/Temario');
  assert.equal(normalizeLink('http://example.org'), 'http://example.org/');
  for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'notecomplete://reader/', 'not a link', 'localhost']) assert.equal(normalizeLink(bad), null, bad);
  assert.equal(linkTitle('https://www.notion.so/uni/Tema-1/'), 'notion.so/uni/Tema-1');
});
