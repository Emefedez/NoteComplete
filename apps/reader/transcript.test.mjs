import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
const { TranscriptController } = await import('./transcript.js');

function element() {
  const classes = new Set();
  return { hidden: false, disabled: false, children: [], attrs: {}, value: '', options: [], dataset: {},
    classList: { toggle(c, on = !classes.has(c)) { on ? classes.add(c) : classes.delete(c); return on; }, add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    add(option) { this.options.push(option); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; } };
}
test('transcripts isolate recordings, click to seek, and stop workers on reset', () => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createDocumentFragment: element, createTextNode: text => text,
  };
  const seeks = [];
  const audio = { time: 0, audio: { paused: true }, seek(t) { seeks.push(t); this.time = t; } };
  const controller = new TranscriptController(audio);
  nodes.get('transcriptPanel').open = true;
  controller.select({ id: 'a' });
  controller.finish([{ text: 'Hola', start: 1, end: 2 }], { id: 'a' });
  controller.buttons[0].onclick(); controller.update();
  assert.deepEqual(seeks, [1]);
  assert.equal(controller.buttons[0].attrs['aria-current'], 'true');
  // A running job survives switching recordings, shows its partial text greyed, and only Cancel or reset stops it.
  let terminated = false;
  controller.job = { asset: { id: 'c' }, partial: [{ text: 'parcial' }], worker: { terminate() { terminated = true; } } };
  controller.select({ id: 'b' });
  assert.equal(terminated, false);
  assert.deepEqual(controller.words, []);
  controller.select({ id: 'c' });
  assert.equal(controller.words[0].text, 'parcial');
  assert.equal(controller.provisional, true);
  controller.select({ id: 'a' });
  assert.equal(controller.words[0].text, 'Hola');
  controller.reset();
  assert.equal(terminated, true);
  assert.equal(controller.results.size, 0);
  assert.equal(nodes.get('transcribeAudio').disabled, true);
  controller.render(Array.from({ length: 5000 }, (_, i) => ({ text: `word${i}`, start: i, end: i + 1 })));
  assert.equal(controller.buttons.length, 100);
  nodes.get('transcriptFollow').checked = true;
  audio.time = 3500;
  controller.update();
  assert.equal(controller.offset, 3500);
  assert.equal(controller.buttons.length, 100);
  nodes.get('transcriptPanel').open = false;
  audio.time = 4900;
  controller.update();
  assert.equal(controller.offset, 3500);
});
test('cancelling while bytes are being read prevents stale work from starting', async () => {
  let release;
  const audio = { time: 0, audio: { paused: true }, read: () => new Promise(r => release = r) };
  const controller = new TranscriptController(audio);
  controller.select({ id: 'a' });
  const pending = controller.start();
  controller.cancel();
  release(new Uint8Array([1, 2, 3]));
  await pending;
  assert.equal(controller.job, null);
  assert.deepEqual(controller.words, []);
});
test('transcription progress fills the bar and the job chip, and hides for other recordings', () => {
  const nodes = new Map();
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createDocumentFragment: element, createTextNode: text => text,
  };
  const audio = { time: 0, audio: { paused: true }, seek() {} };
  const controller = new TranscriptController(audio);
  controller.select({ id: 'a' });
  assert.equal(nodes.get('transcriptProgress').hidden, true);
  const chip = [];
  controller.job = { asset: { id: 'a' }, partial: [], chip: { set: (f, p) => chip.push([f, p]), fail() {} } };
  controller.controls();
  assert.equal(nodes.get('transcriptProgress').hidden, false);
  controller.progress(0.25, 'Piece 1 of 4');
  assert.equal(nodes.get('transcriptProgress').value, 25);
  assert.match(nodes.get('transcriptStatus').textContent, /Piece 1 of 4/);
  assert.deepEqual(chip, [[0.25, 'Piece 1 of 4']]);
  controller.select({ id: 'b' });
  assert.equal(nodes.get('transcriptProgress').hidden, true);
  controller.cancel();
  assert.equal(nodes.get('transcriptProgress').hidden, true);
});
