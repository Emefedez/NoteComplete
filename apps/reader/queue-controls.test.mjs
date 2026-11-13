import test from 'node:test';
import assert from 'node:assert/strict';
import { queueRow, queueItemLabel, queueStatusIcon, queueButtonState, setQueueButton, markQueueDone, queueButton, selectionCheck, updateQueueControls } from './queue-controls.js';

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

test('the card button has three looks: downloaded, waiting, not queued', () => {
  const done = queueButtonState('done'), idle = queueButtonState(null);
  assert.equal(done.className, 'card-queue-btn is-done');
  assert.equal(done.title, 'Downloaded to library');
  assert.equal(done.icon, '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>');
  for (const status of ['queued', 'downloading']) {
    const waiting = queueButtonState(status);
    assert.equal(waiting.className, 'card-queue-btn is-queued');
    assert.equal(waiting.title, 'Queued for download (click to remove)');
    assert.equal(waiting.icon, '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>');
  }
  assert.equal(idle.className, 'card-queue-btn');
  assert.equal(idle.title, 'Queue for download');
  assert.equal(idle.icon, '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m-4-4 4 4 4-4M5 20h14"/></svg>');
  // A failed download can be queued again, so it looks like a file that is not queued.
  assert.deepEqual(queueButtonState('error'), idle);
});

test('the queue list keeps the exact icons it had', () => {
  assert.equal(queueStatusIcon('done'), '<svg class="queue-status-svg is-done" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>');
  assert.equal(queueStatusIcon('downloading'), '<svg class="queue-status-svg is-downloading" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m-4-4 4 4 4-4M5 20h14"/></svg>');
  assert.equal(queueStatusIcon('error'), '<svg class="queue-status-svg is-error" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>');
  assert.equal(queueStatusIcon('queued'), '<svg class="queue-status-svg is-queued" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 7v5l3 3"/></svg>');
});

// A queue that only remembers what is in it.
function fakeQueue() {
  const status = new Map(), enqueued = [];
  return { status, enqueued, statusOf: (id) => status.get(id) || null, cancel: (id) => status.delete(id), enqueue: (item) => { enqueued.push(item); status.set(item.id, 'queued'); } };
}
const click = (button) => { let stopped = false; button.onclick({ stopPropagation: () => { stopped = true; } }); return stopped; };

test('a click on the card button queues the file, the next takes it out', () => {
  const queue = fakeQueue();
  const button = queueButton({ queue, id: 'drive:1', item: () => ({ id: 'drive:1', name: 'a.pdf' }), doc: fakeDocument() });
  assert.equal(button.tag, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.className, 'card-queue-btn');
  assert.equal(button.title, 'Queue for download');
  assert.equal(click(button), true, 'the click does not open the card');
  assert.deepEqual(queue.enqueued, [{ id: 'drive:1', name: 'a.pdf' }]);
  assert.equal(button.className, 'card-queue-btn is-queued');
  click(button);
  assert.equal(queue.statusOf('drive:1'), null);
  assert.equal(button.className, 'card-queue-btn');
  assert.equal(queue.enqueued.length, 1);
  queue.status.set('drive:1', 'done');
  click(button);
  assert.equal(queue.enqueued.length, 2, 'a downloaded file can be queued again, as before');
});

test('a file the library already keeps shows as downloaded', async () => {
  const queue = fakeQueue();
  const kept = queueButton({ queue, id: 'a', item: () => ({ id: 'a' }), kept: Promise.resolve({ key: 'a' }), doc: fakeDocument() });
  const absent = queueButton({ queue, id: 'b', item: () => ({ id: 'b' }), kept: Promise.resolve(null), doc: fakeDocument() });
  const failed = queueButton({ queue, id: 'c', item: () => ({ id: 'c' }), kept: Promise.reject(Error('no library')), doc: fakeDocument() });
  await new Promise((r) => setTimeout(r));
  assert.equal(kept.className, 'card-queue-btn is-done');
  assert.equal(kept.title, 'Downloaded to library');
  assert.equal(absent.className, 'card-queue-btn');
  assert.equal(failed.className, 'card-queue-btn');
});

test('marking a button done sets its class, icon and title; a missing button is ignored', () => {
  const button = fakeDocument().createElement('button');
  setQueueButton(button, 'queued');
  markQueueDone(button);
  assert.deepEqual([button.className, button.innerHTML, button.title], Object.values(queueButtonState('done')));
  assert.doesNotThrow(() => markQueueDone(null));
  assert.doesNotThrow(() => markQueueDone(undefined));
});

test('the selection check mark', () => {
  const check = selectionCheck(fakeDocument());
  assert.equal(check.tag, 'span');
  assert.equal(check.className, 'note-select-check');
  assert.equal(check.attributes['aria-hidden'], 'true');
  assert.equal(check.innerHTML, '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>');
});

function fakeControls() {
  const classes = new Set();
  const el = () => ({ hidden: false, textContent: '', disabled: false });
  return { mode: el(), download: el(), cancel: el(), all: el(), list: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } }, classes };
}
const hiddenOf = (c) => [c.mode.hidden, c.all.hidden, c.download.hidden, c.cancel.hidden];

test('the list buttons: hidden without files, Select and Queue all, then Download and Cancel', () => {
  const c = fakeControls();
  c.classes.add('queue-selecting');
  updateQueueControls(c, { available: true, count: 0, selecting: true, selected: 0 });
  assert.deepEqual(hiddenOf(c), [true, true, true, true]);
  assert.equal(c.classes.has('queue-selecting'), false);
  updateQueueControls(c, { available: false, count: 4, selecting: false, selected: 0 });
  assert.deepEqual(hiddenOf(c), [true, true, true, true], 'no queue, no buttons');

  updateQueueControls(c, { available: true, count: 4, selecting: false, selected: 0 });
  assert.deepEqual(hiddenOf(c), [false, false, true, true]);
  assert.equal(c.all.textContent, 'Queue all (4)');
  assert.equal(c.classes.has('queue-selecting'), false);

  updateQueueControls(c, { available: true, count: 4, selecting: true, selected: 0 });
  assert.deepEqual(hiddenOf(c), [true, true, false, false]);
  assert.equal(c.download.textContent, 'Download (0)');
  assert.equal(c.download.disabled, true);
  assert.equal(c.classes.has('queue-selecting'), true);
  updateQueueControls(c, { available: true, count: 4, selecting: true, selected: 2 });
  assert.equal(c.download.textContent, 'Download (2)');
  assert.equal(c.download.disabled, false);

  updateQueueControls(c, { available: true, count: 4, selecting: false, selected: 0 });
  assert.equal(c.classes.has('queue-selecting'), false);
});

test('missing buttons and a list without classes are tolerated', () => {
  assert.doesNotThrow(() => updateQueueControls({}, { available: true, count: 2, selecting: true, selected: 1 }));
  assert.doesNotThrow(() => updateQueueControls({ list: {} }, { available: true, count: 2, selecting: false, selected: 0 }));
  assert.doesNotThrow(() => updateQueueControls({ mode: null, list: null }, { available: false, count: 0, selecting: false, selected: 0 }));
});
