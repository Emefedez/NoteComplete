import test from 'node:test';
import assert from 'node:assert/strict';
import { convertedCopyName, ooxmlTargetExt, savePlanFor } from './office-view.js';

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
