import test from 'node:test';
import assert from 'node:assert/strict';
import { convertedCopyName, officeViewer, ooxmlTargetExt, savePlanFor } from './office-view.js';

test('ooxmlTargetExt and convertedCopyName map legacy/ODF formats to OOXML beside original', () => {
  assert.equal(ooxmlTargetExt('doc', 'word'), 'docx');
  assert.equal(ooxmlTargetExt('odt', 'word'), 'docx');
  assert.equal(ooxmlTargetExt('xls', 'cell'), 'xlsx');
  assert.equal(ooxmlTargetExt('csv', 'cell'), 'xlsx');
  assert.equal(ooxmlTargetExt('ppt', 'slide'), 'pptx');
  assert.equal(ooxmlTargetExt('odp', 'slide'), 'pptx');
  assert.equal(convertedCopyName('Budget.xls', 'xlsx'), 'Budget.xlsx');
  assert.equal(convertedCopyName('Thesis.odt', 'docx'), 'Thesis.docx');
});

test('savePlanFor routes edit in place, lossy-edit with choice, convert as OOXML copy, view as none', () => {
  assert.deepEqual(savePlanFor({ mode: 'edit', name: 'Report.docx' }), { kind: 'in-place', name: 'Report.docx' });
  assert.deepEqual(savePlanFor({ mode: 'view', name: 'Diagram.vsdx' }), { kind: 'none', name: 'Diagram.vsdx' });
  assert.deepEqual(savePlanFor({ mode: 'convert', name: 'Legacy.doc', documentType: 'word' }), { kind: 'copy', name: 'Legacy.docx' });
  assert.deepEqual(savePlanFor({ mode: 'convert', name: 'Sheet.ods', documentType: 'cell' }), { kind: 'copy', name: 'Sheet.xlsx' });
  assert.deepEqual(savePlanFor({ mode: 'lossy-edit', name: 'Data.csv', documentType: 'cell' }), { kind: 'ask-lossy', inPlaceName: 'Data.csv', copyName: 'Data.xlsx' });
  assert.deepEqual(savePlanFor({ mode: 'lossy-edit', name: 'Data.csv', documentType: 'cell', lossyChoice: 'in-place' }), { kind: 'in-place', name: 'Data.csv' });
  assert.deepEqual(savePlanFor({ mode: 'lossy-edit', name: 'Data.csv', documentType: 'cell', lossyChoice: 'copy' }), { kind: 'copy', name: 'Data.xlsx' });
});

test('officeViewer only shows the first-launch font hint when fontsGenerated is false', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runCase = async (fontsGenerated) => {
    const stateEl = { textContent: '' };
    let resolveOpen;
    const bridge = {
      status: async () => ({ installed: true, fontsGenerated }),
      open: () => new Promise((r) => { resolveOpen = r; }),
      close: async () => {},
    };
    const viewer = officeViewer({ stateEl, getBridge: () => bridge });
    const openPromise = viewer.open(new File(['x'], 'Report.docx'), { mode: 'edit' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(4500);
    const seen = stateEl.textContent;
    resolveOpen({ sessionId: 's1', apiUrl: 'http://127.0.0.1:9/api.js', config: {} });
    await viewer.close({ save: false });
    await openPromise;
    return seen;
  };
  assert.equal(await runCase(true), 'Starting Euro-Office…');
  assert.equal(await runCase(false), 'Starting Euro-Office… (first launch builds fonts, ~45 s)');
});
