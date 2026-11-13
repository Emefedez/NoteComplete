// Browser check of Study → Fact check (Chromium, after a web build), with a stand-in AI
// tool: the whole note is checked in the background, the findings go into the Markdown
// notes under page badges with their corrections, and a badge jumps to its page.
//   node tools/fact_check_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => {
  // A stand-in AI tool: page 2 has an error, page 3 disagrees with page 2, page 1 is fine.
  const answer = JSON.stringify({ pages: [
    { page: 1, issues: [] },
    { page: 2, issues: [{ kind: 'error', quote: 'det(A) = 2a', problem: 'The determinant is miscalculated', correction: 'det(A) = -8a', confidence: 'high' }] },
    { page: 3, issues: [{ kind: 'inconsistency', quote: 'a = 0', problem: 'Page 2 takes a ≠ 0', correction: 'State which case applies', related: 2, confidence: 'medium' }] },
  ] });
  window.notecompleteAI = {
    providers: async () => [{ id: 'claude', label: 'Claude Code', available: true }],
    models: async () => [],
    cancel() {},
    run: async (request) => { (window.__aiRequests ||= []).push(request); await new Promise(r => setTimeout(r, 300)); return { text: answer }; },
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
await p.waitForSelector('.sheet[data-page="0"] .render svg');

// Shift + F opens the dialog, titled for the check, without an amount.
await p.evaluate(() => { document.activeElement?.blur(); document.getElementById('viewport').focus(); });
await p.keyboard.press('Shift+F');
await p.waitForSelector('#studyDialog[open]');
assert.equal(await p.textContent('#studyTitle'), 'Fact check');
assert.equal(await p.isVisible('#studyAmountLabel'), false, 'no amount to choose');
assert.equal(await p.textContent('#studyGo'), 'Check in background');
if (DIR) await p.screenshot({ path: DIR + 'fact-check-dialog.png' });
await p.evaluate(() => document.querySelector('input[name="studyScope"][value="all"]').click());
await p.click('#studyGo');
await p.waitForFunction(() => /Fact check:/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
const message = await p.textContent('#status');
console.log('·', message);
assert.match(message, /2 suggestions on 2 of 3 pages, added to your notes/);
const request = await p.evaluate(() => window.__aiRequests[0]);
assert.match(request.prompt, /fact-checking pages of the student's notes "[^"]*" \([^)]*\): 1, 2, 3\./);
assert.equal(request.images.length, 3, 'the pages go as images');

// The notes have the findings under page badges: "Open notes" on the finished job shows them.
await p.click('#jobArea button:has-text("Open notes")');
await p.waitForSelector('#notesPanel:not([hidden])');
await p.waitForTimeout(800);
const notes = await p.evaluate(() => document.getElementById('notesPanel').innerText);
assert.match(notes, /AI fact check/);
assert.match(notes, /det\(A\) = -8a/);
assert.match(notes, /Inconsistency with p\. 2/);
assert.match(notes, /Nothing to correct on p\. 1/);
// The page badge (the marker, as the editor or the preview shows it) jumps to its page.
const badge = p.locator('#notesPanel .md-page[data-page="2"], #notesPanel :text("<!-- page 2 -->")').first();
assert.equal(await badge.count(), 1, 'a page badge for page 2');
console.log('· the findings are in the notes, under page badges, with corrections');
if (DIR) await p.screenshot({ path: DIR + 'fact-check-notes.png' });
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Fact check end to end: passed.');
