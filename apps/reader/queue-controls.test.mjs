import test from 'node:test';
import assert from 'node:assert/strict';
import { queueRow, queueItemLabel, queueStatusIcon } from './queue-controls.js';

// A stand-in for the page: elements that record what is set on them. Setting `innerHTML`
// keeps the string as given, so a test can see whether a value was ever written as markup.
function fakeDocument() {
  const element = (tag) => ({
    tag, className: '', title: '', innerHTML: '', textContent: '', children: [], attributes: {},
    append(...nodes) { this.children.push(...nodes); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
  });
  return { createElement: element };
}
const everyElement = (el) => [el, ...el.children.flatMap(everyElement)];

test('a file name with markup is written as text, never as HTML', () => {
  const name = '<img src=x onerror="alert(1)">.pdf';
  const li = queueRow({ id: 'drive:1', name, size: 2 * 1048576, status: 'queued', error: '<b>failed</b>' }, { doc: fakeDocument() });
  const all = everyElement(li);
  for (const el of all) {
    assert.ok(!el.innerHTML.includes('<img'), `markup from the name reached innerHTML of <${el.tag}>`);
    assert.ok(!el.innerHTML.includes('onerror'));
    assert.ok(!el.innerHTML.includes('<b>'));
  }
  const [info, remove] = li.children;
  assert.equal(info.className, 'cloud-queue-item-info');
  assert.equal(info.innerHTML, queueStatusIcon('queued'));
  assert.equal(info.children.length, 1);
  assert.equal(info.children[0].textContent, `${name} (2.0 MB)`);
  assert.equal(info.title, '<b>failed</b>');
  assert.equal(remove.attributes['aria-label'], `Remove ${name}`);
});

test('a queue row keeps its classes, title and remove action', () => {
  const removed = [];
  const item = { id: 'archive:a:b.pdf', name: 'b.pdf', status: 'done' };
  const li = queueRow(item, { doc: fakeDocument(), onRemove: (i) => removed.push(i.id) });
  assert.equal(li.tag, 'li');
  assert.equal(li.className, 'cloud-queue-item');
  const [info, remove] = li.children;
  assert.equal(info.title, '');
  assert.equal(info.children[0].textContent, 'b.pdf');
  assert.equal(remove.tag, 'button');
  assert.equal(remove.type, 'button');
  assert.equal(remove.className, 'item-remove');
  assert.equal(remove.title, 'Remove from queue');
  remove.onclick();
  assert.deepEqual(removed, ['archive:a:b.pdf']);
});

test('the label gives the size only when it is known', () => {
  assert.equal(queueItemLabel({ name: 'a.pdf', size: 1572864 }), 'a.pdf (1.5 MB)');
  assert.equal(queueItemLabel({ name: 'a.pdf', size: 0 }), 'a.pdf');
  assert.equal(queueItemLabel({ name: 'a.pdf' }), 'a.pdf');
});

test('each queue state has its own icon, made of fixed markup', () => {
  const icons = ['done', 'downloading', 'error', 'queued'].map(queueStatusIcon);
  assert.equal(new Set(icons).size, 4);
  for (const [i, state] of ['done', 'downloading', 'error', 'queued'].entries()) assert.ok(icons[i].includes(`queue-status-svg is-${state}`));
  assert.equal(queueStatusIcon('anything else'), queueStatusIcon('queued'));
});
