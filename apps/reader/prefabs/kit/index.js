// The prefab kit: what a module's code may use (docs/PREFAB-MODULES-GUIDE.md). Everything here
// is what the chart and diagram editors are built with; a module imports it from
// '../kit/index.js' (shipped) or from the URL its host passes (added modules).
export { editorShell, loadKitStyles, make, button, field, textInput, numberInput, checkInput, selectInput, listInput } from './shell.js';
export { escapeHtml, evalMathExpr, sanitizeSvg } from './svg.js';
export { icon } from '../../icons.js';
export { cheatSheet } from '../../cheat-sheet.js';
export { editorQuickMenu } from '../../editor-quick.js';
export { orderedIds, saveOrder, keyFor, indexOfKey } from '../../palette-order.js';
export { sortable } from '../../reorder.js';
export { figureNotes } from '../../figure-notes.js';
export { resizablePanels } from '../../panel-resize.js';
export { codeBox, jsonErrorAt } from '../../json-code.js';
export { editorTouch, fingerTaps } from '../../editor-touch.js';
// The api version of this kit and of the host contract (module.json "api").
export const API = 1;
export { movableWindow, keepInside, windowArea } from './window.js';
