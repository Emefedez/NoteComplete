// charts.html: the chart editor on its own page (the desktop app's Tools menu, a bookmark, or
// Insert → Chart and timeline editor): process states, CPU timelines, bar charts, histograms
// and exam plots. What is drawn is kept in this browser between visits; Export saves it as a
// picture or as a NoteComplete figure (.json), which Insert prefab can bring into a note.
import { mountChartEditor, chartName } from './chart-editor.js';
import { editorKind, displaySpec } from './chart-model.js';
import { PREFABS } from './prefabs.js';
import { renderVisualSvg } from './exam-html.js';
import { download } from './download.js';

const KEY = 'notecomplete.chart.draft';
const STARTERS = ['states', 'timeline', 'bar', 'histogram', 'plot'].map((id) => PREFABS.find((p) => p.id === id)).filter(Boolean);
const make = (tag, props = {}, ...children) => { const el = Object.assign(document.createElement(tag), props); el.append(...children); return el; };
const params = new URLSearchParams(location.search);
let initial = null;
try { initial = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* A fresh start. */ }
if (!editorKind(initial)) initial = null;
const asked = STARTERS.find((p) => p.id === params.get('kind'));
if (asked && (!initial || initial.type !== asked.spec.type)) initial = structuredClone(asked.spec);
initial ||= structuredClone(STARTERS[0].spec);

const kindSelect = make('select', { title: 'Start a new figure of this kind' }, make('option', { value: '', textContent: 'New…' }), ...STARTERS.map((p) => make('option', { value: p.id, textContent: p.label })));
const importInput = make('input', { type: 'file', accept: '.json,application/json', hidden: true });
const importBtn = make('button', { type: 'button', textContent: 'Import…', title: 'Open a NoteComplete figure (.json)' });
const exportSelect = make('select', { title: 'Export the figure' },
  make('option', { value: '', textContent: 'Export…' }),
  make('option', { value: 'svg', textContent: 'Picture (.svg)' }),
  make('option', { value: 'png', textContent: 'Picture (.png)' }),
  make('option', { value: 'json', textContent: 'NoteComplete figure (.json)' }));
const save = (spec) => {
  document.title = `${spec.title || chartName(spec)} · NoteComplete`;
  try { localStorage.setItem(KEY, JSON.stringify(spec)); } catch { /* Private window: not kept. */ }
};
const editor = mountChartEditor(document.getElementById('chartRoot'), initial, { onChange: save, extraBar: [kindSelect, importBtn, importInput, exportSelect] });
save(editor.spec());

kindSelect.onchange = () => {
  const p = STARTERS.find((q) => q.id === kindSelect.value);
  kindSelect.value = '';
  if (p) editor.set(structuredClone(p.spec));
};
importBtn.onclick = () => importInput.click();
importInput.onchange = async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  try {
    const spec = JSON.parse(await file.text());
    if (!editorKind(spec)) throw Error('not a chart, timeline or process-state figure');
    editor.set(spec);
  } catch (e) { alertStatus(`Could not open ${file.name}: ${e.message}`); }
};
const fileName = (spec, ext) => `${(spec.title || chartName(spec)).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'figure'}.${ext}`;
exportSelect.onchange = async () => {
  const how = exportSelect.value;
  exportSelect.value = '';
  const spec = editor.spec();
  if (how === 'json') return download(JSON.stringify(spec, null, 2), fileName(spec, 'json'), 'application/json');
  const out = renderVisualSvg(displaySpec(spec), { forMcp: false });
  if (!out?.svg) return alertStatus('Nothing to export yet.');
  const svg = out.svg.replace('<svg ', '<svg font-family="Helvetica, Arial, sans-serif" ');
  if (how === 'svg') return download(svg, fileName(spec, 'svg'), 'image/svg+xml');
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = make('canvas', { width: out.width * 2, height: out.height * 2 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => blob && download(blob, fileName(spec, 'png'), 'image/png'), 'image/png');
};
function alertStatus(text) {
  const s = document.querySelector('.ch-status');
  if (s) { s.textContent = text; s.classList.add('error'); }
}
