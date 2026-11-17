// Browser check of File → New note with AI (Chromium, after a web build): a document from disk
// goes into the request with the chosen length, focus, language and instructions; a write
// stopped half-way is kept and Continue writing finishes it; Save to Recent creates the note,
// opens it and keeps it in Recent.
//   node tools/new_note_ai_e2e.mjs [screenshots folder]
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const shot = async (p, name) => { if (DIR) await p.screenshot({ path: DIR + name + '.png' }); };
const docs = mkdtempSync(join(tmpdir(), 'nc-note-ai-'));
const notes = join(docs, 'apuntes.md');
writeFileSync(notes, '# Ciclo cardiaco\n\nLa sístole es la contracción ventricular. La diástole es la relajación y el llenado.\n');

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
  await ctx.addInitScript(() => {
    // A stand-in AI tool that streams its answer, slowly when asked to.
    window.notecompleteAI = {
      providers: async () => [{ id: 'claude', label: 'Claude Code', available: true }],
      models: async () => [],
      cancel() {},
      run: async (request, onDelta) => {
        (window.__aiRequests ||= []).push(request);
        const text = window.__answer || '# THE **CARDIAC** CYCLE\n_Physiology · week 3_\n## Systole\n- the ventricles contract';
        for (const chunk of text.match(/[\s\S]{1,20}/g)) { await new Promise((r) => setTimeout(r, window.__slow ? 400 : 20)); onDelta?.(chunk); }
        return { text };
      },
    };
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.evaluate(() => document.getElementById('newWithAi').click());
  await p.waitForSelector('.handwriting-dialog[open] #hwRequest:focus');
  assert.match(await p.textContent('#hwTitleLabel'), /New note with AI/);
  // Nothing written yet: Write the note is the one main action.
  assert.equal(await p.evaluate(() => document.getElementById('hwCreate').classList.contains('primary')), false);
  assert.equal(await p.isDisabled('#hwStrict'), true, 'only-documents needs documents');
  await shot(p, 'open');

  // 1. A document from disk, and the note's options.
  await p.click('#hwDocs > summary');
  await p.click('#hwSourceMount [data-tab="files"]');
  await p.setInputFiles('#hwSourceMount .sp-file-input', notes);
  await p.waitForFunction(() => /1 selected/.test(document.getElementById('hwDocsCount').textContent));
  await p.check('#hwStrict');
  await p.selectOption('#hwLength', 'short');
  await p.selectOption('#hwFocus', 'exam');
  await p.selectOption('#hwLanguage', 'Spanish');
  await p.fill('#hwInstructions', 'una tarjeta resumen al final');
  await shot(p, 'documents');

  // 2. With no request the note is about the documents; stopped half-way, it is kept.
  await p.evaluate(() => { window.__slow = true; });
  await p.click('#hwWrite');
  await p.waitForFunction(() => document.getElementById('hwMarkdown').value.length > 30);
  await p.click('#hwWrite');
  await p.waitForSelector('#hwDraftBar:not([hidden])');
  const prompt = await p.evaluate(() => window.__aiRequests.at(-1).prompt);
  assert.match(prompt, /The documents:\n=== SOURCE: apuntes ===[\s\S]*sístole/);
  assert.match(prompt, /Use only what the documents below say/);
  assert.match(prompt, /Fit it on one page/);
  assert.match(prompt, /exam revision/);
  assert.match(prompt, /Write every word in Spanish/);
  assert.match(prompt, /una tarjeta resumen al final/);
  assert.match(prompt, /The request:\nA study note that covers the documents above\.$/);
  assert.match(await p.textContent('#hwDraftLabel'), /stopped after \d+ characters/);
  await shot(p, 'stopped');

  // 3. Continue writing: the tool gets what was written and only adds to it.
  await p.evaluate(() => { window.__slow = false; window.__answer = '## Diastole\n- they relax and fill'; });
  await p.click('#hwContinue');
  await p.waitForFunction(() => document.getElementById('hwAiStatus').textContent.startsWith('Written'));
  assert.match(await p.evaluate(() => window.__aiRequests.at(-1).prompt), /PREVIOUS PARTIAL OUTPUT/);
  assert.match(await p.inputValue('#hwMarkdown'), /^# THE \*\*CARDIAC\*\*[\s\S]*## Diastole/);
  assert.equal(await p.inputValue('#hwName'), 'THE CARDIAC CYCLE', 'named after its heading, not the document');
  assert.equal(await p.isVisible('#hwDraftBar'), false);
  assert.equal(await p.evaluate(() => document.getElementById('hwCreate').classList.contains('primary')), true);
  await p.waitForFunction(() => document.querySelectorAll('#hwPages svg').length >= 1);
  await shot(p, 'written');

  // 4. Save to Recent: the note opens and stays in Recent.
  await p.selectOption('#hwSaveTo', 'recent');
  await p.click('#hwCreate');
  await p.waitForFunction(() => document.querySelectorAll('.sheet').length >= 1 && /CARDIAC/.test(document.getElementById('title').textContent), null, { timeout: 20000 });
  const kept = await p.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('notecomplete-library');
    r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => resolve(q.result.map((e) => e.name)); };
  }));
  assert.ok(kept.some((n) => /CARDIAC CYCLE\.nfedit$/.test(n)), `saved to Recent: ${kept}`);
  await shot(p, 'created');
  // The options are remembered for the next note.
  await p.evaluate(() => document.getElementById('newWithAi').click());
  await p.waitForSelector('.handwriting-dialog[open]');
  assert.equal(await p.inputValue('#hwLength'), 'short');
  assert.equal(await p.inputValue('#hwSaveTo'), 'recent');
  assert.deepEqual(errors, []);
  console.log('New note with AI end to end: passed.');
} finally {
  await b.close();
  server.close?.();
}
process.exit(0);
