// File -> Take notes with AI...
// Batch AI note-taking across multiple Recents, folders, local files, Drive notes,
// open document, or topic lists; generates real handwritten .nfedit notebooks.
import { icon } from './icons.js';
import { LOOK_FIELDS, aiPrompt, titleOf, optionsFrom } from './convert.js';
import { modelPicker } from './model-picker.js';
import { compactDialect } from './small-model.js';
import { createDocOrchestrator } from './ai-failover.js';
import { createSourcePicker } from './source-picker.js';
import { resolveSources, formatSourceBundle } from './source-extract.js';
import { safeFileBase } from './exam.js';

const STORE = 'notecomplete-batch-notes-prefs';
const LABELS = {
  look: 'Look',
  paper: 'Paper',
  theme: 'Theme',
  font: 'Handwriting',
  hand: 'Naturalness',
  pen: 'Pen',
  accent: 'Accent',
};

export function batchNotePrompt({ request, title, dialect, look = 'study', language = 'auto', instructions = '' }) {
  const base = aiPrompt({ request, dialect, look });
  const extras = [
    title ? `Heading / note title: "${title}".` : '',
    language && language !== 'auto' ? `Write every word strictly in ${language}.` : 'Keep the primary language of the source material.',
    instructions?.trim() ? `Extra note-taking guidelines: ${instructions.trim()}` : '',
  ].filter(Boolean);
  return extras.length ? `${extras.join('\n')}\n\n${base}` : base;
}

export function batchNotesController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc = () => false,
  openDocTitle = () => 'Current note',
  openDocPages = () => 0,
  pageText,
  pageCanvas,
  notesText,
  jobs,
  ai,
  status,
  openGeneratedFile,
  refreshHome,
  store = globalThis.localStorage,
}) {
  let dialog = null;
  let picker = null;
  let model = null;
  let running = null;
  let createdFiles = [];

  const el = (id) => dialog.querySelector(`#${id}`);
  const loadPrefs = () => { try { return JSON.parse(store?.getItem(STORE) || '{}'); } catch { return {}; } };
  const savePrefs = (p) => { try { store?.setItem(STORE, JSON.stringify(p)); } catch { /* Optional. */ } };

  function build() {
    dialog = document.createElement('dialog');
    dialog.id = 'batchNotesDialog';
    dialog.className = 'ocr-dialog batch-notes-dialog';
    dialog.setAttribute('aria-labelledby', 'bnDialogTitle');

    const lookSelects = Object.entries(LOOK_FIELDS).map(([key, opts]) =>
      `<label class="exam-field">${LABELS[key]}<select id="bn-${key}" data-native>${opts.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>`).join('');

    dialog.innerHTML = `
      <div class="exam-dlg-head">
        <h2 id="bnDialogTitle"></h2>
        <button id="bnCloseX" type="button" class="dlg-close" aria-label="Close"></button>
      </div>
      <p class="muted">Turn selected notes, folders, PDFs, Office docs or topic lists into rich handwritten study notebooks saved straight to your library.</p>
      <div class="exam-dlg-grid">
        <section class="exam-col">
          <h3 class="exam-sub">1. Sources &amp; topics</h3>
          <div id="bnSourceMount"></div>
        </section>
        <section class="exam-col exam-opts">
          <h3 class="exam-sub">2. Output &amp; style</h3>
          <div class="exam-row-2">
            <label class="exam-field">Output mode
              <select id="bnMode" data-native>
                <option value="separate" selected>One handwritten note per source / topic</option>
                <option value="combined">One combined master notebook</option>
              </select>
            </label>
            <label class="exam-field">Combined title
              <input id="bnTitle" type="text" placeholder="Study Notes" spellcheck="false" />
            </label>
          </div>
          <div class="exam-row-2">
            <label class="exam-field">Language
              <select id="bnLanguage" data-native>
                <option value="auto">Match source</option>
                <option value="English">English</option>
                <option value="Spanish">Español</option>
                <option value="French">Français</option>
                <option value="German">Deutsch</option>
              </select>
            </label>
            <label class="exam-field">Save to folder
              <select id="bnFolder" data-native><option value="">Recent only</option></select>
            </label>
          </div>
          <div class="hw-fields">${lookSelects}</div>
          <label class="exam-field">Note-taking style instructions
            <textarea id="bnInstructions" rows="2" placeholder="Optional: e.g., focus on formulas, clinical correlations, summary cards and diagrams…"></textarea>
          </label>
          <div id="bnAiRow" class="hw-ai-row hw-tools"${ai ? '' : ' hidden'}>
            <select id="bnTool" data-native aria-label="AI tool"></select>
            <select id="bnModel" data-native aria-label="Model"></select>
            <input id="bnModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden />
          </div>
          <p id="bnStatus" class="muted hw-ai-status" role="status"></p>
          <div id="bnReadyBar" class="exam-ready" hidden>
            <strong id="bnReadyLabel"></strong>
            <div id="bnCreatedList" class="bn-created-list"></div>
          </div>
        </section>
      </div>
      <div class="ocr-actions">
        <button id="bnCancel" type="button">Cancel</button>
        <button id="bnGenerate" type="button" class="primary"></button>
      </div>
    `;
    document.body.append(dialog);

    el('bnDialogTitle').replaceChildren(icon('batchNotes'), document.createTextNode(' Take notes with AI'));
    el('bnCloseX').replaceChildren(icon('close'));
    el('bnGenerate').replaceChildren(icon('spark'), document.createTextNode(' Generate notes'));

    el('bnCloseX').onclick = () => dialog.close();
    el('bnCancel').onclick = () => {
      if (running) running.abort();
      else dialog.close();
    };
    el('bnMode').onchange = () => {
      el('bnTitle').disabled = el('bnMode').value !== 'combined';
    };

    picker = createSourcePicker(el('bnSourceMount'), {
      library,
      groups,
      hasOpenDoc,
      openDocTitle,
      openDocPages,
      allowTopics: true,
    });

    if (ai) {
      model = modelPicker(el('bnModel'), el('bnModelOther'), ai);
      el('bnTool').onchange = () => {
        try { store?.setItem('notecomplete-ai-provider', el('bnTool').value); } catch { /* Optional. */ }
        model.load(el('bnTool').value);
      };
    }

    el('bnGenerate').onclick = () => generate();
  }

  async function fillFoldersAndTools() {
    const folderSel = el('bnFolder');
    const prev = folderSel.value;
    folderSel.innerHTML = '<option value="">Recent only</option>';
    const all = (await groups?.folders?.().catch(() => [])) || [];
    for (const g of all) {
      if (!g.folder) folderSel.add(new Option(g.name || 'Folder', g.id));
    }
    if (prev && folderSel.querySelector(`option[value="${prev}"]`)) folderSel.value = prev;

    if (!ai) return;
    const select = el('bnTool');
    if (select.options.length) return;
    for (const p of await ai.providers()) {
      const opt = new Option(p.available ? p.label : `${p.label} (not installed)`, p.id);
      opt.disabled = !p.available;
      select.add(opt);
    }
    let saved = '';
    try { saved = store?.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
    if (saved && select.querySelector(`option[value="${saved}"]:not([disabled])`)) select.value = saved;
    else select.value = select.querySelector('option:not([disabled])')?.value || '';
    if (select.value) await model.load(select.value);
    else el('bnStatus').textContent = 'No AI tool found. Install or connect an AI tool under Help → Connect AI tools…';
  }

  function renderCreatedList(items) {
    const host = el('bnCreatedList');
    host.replaceChildren(...items.map((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.append(icon('open'), document.createTextNode(` ${item.title} (${item.pages} p.)`));
      btn.onclick = async () => {
        dialog.close();
        await openGeneratedFile?.(item.file, item.entry);
      };
      return btn;
    }));
  }

  async function generate() {
    if (running) return;
    if (!ai) { el('bnStatus').textContent = 'Connect an AI tool first (Help → Connect AI tools…).'; return; }
    const sources = picker.list();
    if (!sources.length) { el('bnStatus').textContent = 'Select at least one source or add topics first.'; return; }
    const provider = el('bnTool').value;
    if (!provider) { el('bnStatus').textContent = 'No AI tool is available.'; return; }

    const styleValues = {};
    for (const k of Object.keys(LOOK_FIELDS)) styleValues[k] = el(`bn-${k}`).value;
    const prefs = {
      mode: el('bnMode').value,
      language: el('bnLanguage').value,
      style: styleValues,
    };
    savePrefs(prefs);
    const composeOpts = optionsFrom(styleValues);

    const ac = new AbortController();
    running = ac;
    createdFiles = [];
    el('bnGenerate').disabled = true;
    el('bnCancel').textContent = 'Stop';
    el('bnReadyBar').hidden = true;
    el('bnStatus').textContent = 'Reading selected sources…';
    const job = jobs?.start?.('Taking notes with AI…', { onCancel: () => ac.abort() });

    try {
      const resolved = await resolveSources(sources, {
        call,
        openPdf,
        library,
        groups,
        pageText,
        pageCanvas,
        notesText,
        documentInfo: () => ({ pages: openDocPages(), title: openDocTitle() }),
        onProgress: (i, n, label) => {
          el('bnStatus').textContent = `Reading ${i + 1}/${n}: ${label}`;
          job?.progress?.(`Reading ${i + 1}/${n}`);
        },
      });
      if (ac.signal.aborted) throw Error('Cancelled.');
      if (!resolved.length) throw Error('No readable content found in the selected sources.');

      const rawDialect = await call('dialect');
      const m = model.value;
      const orch = await createDocOrchestrator({
        ai,
        primaryProvider: provider,
        primaryModel: m,
        store,
        signal: ac.signal,
        onStatus: (msg) => {
          el('bnStatus').textContent = msg;
          job?.progress?.(msg);
        },
        onSwitch: (info) => {
          status?.(`${info.fromLabel} failed — handing off to ${info.toLabel}.`);
        },
      });
      const caps = orch.capabilities();
      const dialect = (model.small || caps.small) ? compactDialect(rawDialect) : rawDialect;

      const tasks = prefs.mode === 'combined'
        ? [{
            title: el('bnTitle').value.trim() || `${resolved[0].title}${resolved.length > 1 ? ` + ${resolved.length - 1}` : ''} Notes`,
            ...formatSourceBundle(resolved),
          }]
        : resolved.map((doc) => ({
            title: doc.title,
            ...formatSourceBundle([doc], { maxChars: 48000 }),
          }));

      const targetFolderId = el('bnFolder').value;
      const targetGroup = targetFolderId ? (await groups?.folders?.())?.find((g) => g.id === targetFolderId) : null;
      const instructions = el('bnInstructions').value.trim();

      for (let i = 0; i < tasks.length; i++) {
        if (ac.signal.aborted) break;
        const task = tasks[i];
        el('bnStatus').textContent = `Writing note ${i + 1}/${tasks.length}: ${task.title}…`;
        job?.progress?.(`Note ${i + 1}/${tasks.length}: ${task.title}`);

        const prompt = batchNotePrompt({
          request: task.promptText,
          title: task.title,
          dialect,
          look: styleValues.look || 'study',
          language: prefs.language,
          instructions,
        });
        const res = await orch.runStage({
          prompt,
          images: caps.vision === false ? [] : task.images,
          tag: 'batch-notes',
          label: `Notes · ${task.title}`,
          kind: 'note',
          small: model.small,
          vision: caps.vision !== false,
          onDelta: (_chunk, { totalStreamed }) => {
            el('bnStatus').textContent = `Writing "${task.title}" (${i + 1}/${tasks.length})… ${totalStreamed} chars`;
          },
        });
        if (ac.signal.aborted) break;

        const stripFence = (s) => {
          const t = String(s || '').trim();
          const f = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
          return f ? f[1].trim() : t;
        };
        const md = res.partialText
          ? `${stripFence(res.partialText)}\n\n${stripFence(res.text)}`.trim()
          : stripFence(res.text);
        const noteTitle = titleOf(md) || task.title;

        const composed = await call('composeNoteFile', { title: noteTitle, markdown: md, options: composeOpts });
        const outFile = new File([composed.project], `${safeFileBase(noteTitle)}.nfedit`, { type: 'application/octet-stream' });
        let entry = null;
        if (library?.rememberImported) {
          entry = await library.rememberImported(outFile, {
            origin: 'AI Notes',
            folder: targetGroup?.name || '',
          });
          if (targetGroup && groups?.move && entry) {
            await groups.move({ key: entry.key, name: entry.name, source: 'imported' }, targetGroup);
          }
        }
        createdFiles.push({ title: noteTitle, pages: composed.pages || 1, file: outFile, entry });
      }

      refreshHome?.();
      if (!createdFiles.length) throw Error('Cancelled before any note finished.');
      el('bnReadyLabel').textContent = `Created ${createdFiles.length} handwritten notebook${createdFiles.length === 1 ? '' : 's'} (saved to Recent):`;
      renderCreatedList(createdFiles);
      el('bnReadyBar').hidden = false;
      el('bnStatus').textContent = '';
      job?.done?.(`Created ${createdFiles.length} handwritten note${createdFiles.length === 1 ? '' : 's'}.`);
      status?.(`Created ${createdFiles.length} handwritten note${createdFiles.length === 1 ? '' : 's'} with AI and saved to Recent.`);
    } catch (e) {
      el('bnStatus').textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      running = null;
      el('bnGenerate').disabled = false;
      el('bnCancel').textContent = 'Cancel';
    }
  }

  return {
    async open({ preselectOpen = false } = {}) {
      if (!dialog) build();
      const prefs = loadPrefs();
      if (prefs.mode) el('bnMode').value = prefs.mode;
      if (prefs.language) el('bnLanguage').value = prefs.language;
      for (const k of Object.keys(LOOK_FIELDS)) {
        el(`bn-${k}`).value = prefs.style?.[k] ?? LOOK_FIELDS[k][0][0];
      }
      el('bnTitle').disabled = el('bnMode').value !== 'combined';
      el('bnReadyBar').hidden = true;
      el('bnStatus').textContent = '';
      dialog.showModal();
      await picker.refresh({ preselectOpen });
      await fillFoldersAndTools();
    },
    get visible() { return !!dialog?.open; },
  };
}
