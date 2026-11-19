// Settings → Chinese (docs/CHINESE-INPUT.md §9, §15): localStorage "notecomplete-zh-<name>", and the dialog.
import { icon } from '../icons.js';
import { rubySettings, RUBY_DEFAULTS } from './ruby.js';

export const ZH_DEFAULTS = Object.freeze({
  mode: 'off',          // new fields and notes: off | hanzi | pinyin
  script: 'simplified', // simplified | traditional
  shortcut: true,       // Ctrl+Shift+Space cycles Off → Hanzi → Pinyin
  shiftLatin: true,     // Shift alone: Latin letters for a while
  enter: 'auto',        // Enter with a buffer in Hanzi mode: auto | letters | marks
  fullWidth: true,      // ， 。 ？ ！ in Hanzi mode
  perPage: 9,           // 5 | 9 candidates
  bothScripts: false,   // the other script's form beside a candidate
  toneColours: true,    // tone colours on the pinyin over candidates
  digits: 'tone',       // a digit right after pinyin in Hanzi mode: tone (filter) | choose (candidate n)
  lang: 'en',           // meanings and translations: en | es (the es | en toggle of the Chinese windows)
});
const KEY = (k) => `notecomplete-zh-${k}`;
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// zhSettings() → the current values; zhSettings({fullWidth: false}) saves and returns them.
export function zhSettings(patch = null) {
  const ls = store();
  if (patch && ls) {
    for (const [k, v] of Object.entries(patch)) if (k in ZH_DEFAULTS) try { ls.setItem(KEY(k), JSON.stringify(v)); } catch { /* Full or blocked. */ }
    globalThis.dispatchEvent?.(new CustomEvent('zh-settings', { detail: zhSettings() }));
  }
  const out = { ...ZH_DEFAULTS };
  if (ls) for (const k of Object.keys(ZH_DEFAULTS)) {
    try { const v = ls.getItem(KEY(k)); if (v != null) out[k] = JSON.parse(v); } catch { /* Default. */ }
  }
  return out;
}

// A field's remembered mode ("notecomplete-zh-mode-<field>"); new fields start with the default mode.
export function fieldMode(field) {
  try { const v = store()?.getItem(KEY(`mode-${field}`)); if (v) return v; } catch { /* Default. */ }
  return zhSettings().mode;
}
export function setFieldMode(field, mode) {
  try { store()?.setItem(KEY(`mode-${field}`), mode); if (mode !== 'off') store()?.setItem(KEY('used'), '1'); } catch { /* Not kept. */ }
}
// Chinese mode was turned on once: the small 中 buttons appear in the other fields.
export const zhEverUsed = () => { try { return store()?.getItem(KEY('used')) === '1'; } catch { return false; } };

const MODES = [['off', 'Off'], ['hanzi', 'Hanzi (characters)'], ['pinyin', 'Pinyin with tone marks']];

const fmtBytes = (n) => (!n ? '' : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

let dialog = null;
// The Settings → Chinese window. `client`: () => Promise of chinese() (packs, installPack, removePack).
export function openZhSettings({ client = null } = {}) {
  if (!dialog) dialog = build(client);
  fill();
  dialog.showModal();
  listPacks(client);
}

function build(client) {
  const d = document.createElement('dialog');
  d.className = 'ocr-dialog zh-settings';
  d.setAttribute('aria-labelledby', 'zhSettingsTitle');
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  d.innerHTML = `<div class="zh-settings-head">
    <h2 id="zhSettingsTitle">Chinese Input &amp; Pinyin</h2>
    <div class="expand-mode-pills" role="tablist" aria-label="Chinese settings sections">
      <button type="button" role="tab" data-zh-tab="input" aria-selected="true">Input &amp; Keys</button>
      <button type="button" role="tab" data-zh-tab="pinyin" aria-selected="false">Pinyin (Ruby)</button>
      <button type="button" role="tab" data-zh-tab="packs" aria-selected="false">Dictionaries &amp; Words</button>
    </div>
  </div>
  <div class="zh-settings-stage">
    <section class="zh-settings-panel" data-zh-panel="input" role="tabpanel">
      <div class="zh-settings-grid">
        <label>Default mode (new notes)<select name="mode" data-native>${MODES.map(([v, t]) => opt(v, t)).join('')}</select></label>
        <label>Character script<select name="script" data-native>${opt('simplified', 'Simplified 简体')}${opt('traditional', 'Traditional 繁體')}</select></label>
        <label>Enter key in Pinyin buffer<select name="enter" data-native>${opt('auto', 'Auto (match surrounding text)')}${opt('letters', 'Keep raw Latin letters')}${opt('marks', 'Convert to tone-marked Pinyin')}</select></label>
        <label>Number keys (1–5) in Hanzi<select name="digits" data-native>${opt('tone', 'Filter by tone (ma3 → 马)')}${opt('choose', 'Pick candidate n')}</select></label>
        <label>Candidates per page<select name="perPage" data-native>${opt(5, '5 candidates')}${opt(9, '9 candidates')}</select></label>
      </div>
      <div class="zh-settings-checks">
        <label class="ocr-skip"><input type="checkbox" name="shortcut"> <span><kbd>Ctrl Shift Space</kbd> cycles Off → Hanzi → Pinyin</span></label>
        <label class="ocr-skip"><input type="checkbox" name="shiftLatin"> <span>Tap <kbd>Shift</kbd> alone to type temporary Latin letters</span></label>
        <label class="ocr-skip"><input type="checkbox" name="fullWidth"> <span>Full-width Chinese punctuation in Hanzi mode (，。？！)</span></label>
        <label class="ocr-skip"><input type="checkbox" name="bothScripts"> <span>Show Simplified / Traditional counterpart beside candidates</span></label>
      </div>
    </section>
    <section class="zh-settings-panel" data-zh-panel="pinyin" role="tabpanel" hidden>
      <div class="zh-settings-grid">
        <label>Pinyin format<select name="rubyFormat" data-ruby data-native>${opt('marks', 'Tone marks (nǐ hǎo)')}${opt('numbers', 'Tone numbers (ni3 hao3)')}</select></label>
        <label>Show above HSK level<select name="rubyLevel" data-ruby data-native>${opt(0, 'All words (HSK 1–9)')}${[1, 2, 3, 4, 5, 6].map((n) => opt(n, `Above HSK ${n}`)).join('')}</select></label>
      </div>
      <div class="zh-settings-checks">
        <label class="ocr-skip"><input type="checkbox" name="ruby" data-ruby> <span>Enable Pinyin over characters by default in new notes</span></label>
        <label class="ocr-skip"><input type="checkbox" name="toneColours" data-ruby> <span>Colour Pinyin syllables by tone (1st–4th &amp; neutral)</span></label>
      </div>
    </section>
    <section class="zh-settings-panel" data-zh-panel="packs" role="tabpanel" hidden>
      <ul class="zh-packs" aria-live="polite"><li class="muted">Loading…</li></ul>
      <div class="zh-user-card">
        <div class="zh-user-info">
          <strong>Learned vocabulary &amp; frequency</strong>
          <small class="muted">Backup or transfer your personal word choices across devices</small>
        </div>
        <div class="zh-user">
          <button type="button" class="chip" data-user-export>Export…</button>
          <button type="button" class="chip" data-user-import>Import…</button>
          <span class="muted" data-user-status></span>
        </div>
      </div>
    </section>
  </div>
  <div class="ocr-actions zh-settings-foot"><span class="spacer"></span><button type="button" class="primary" data-close>Done</button></div>`;
  document.body.append(d);
  d.querySelector('[data-user-export]')?.prepend(icon('export'));
  d.querySelector('[data-user-import]')?.prepend(icon('import'));
  for (const tabBtn of d.querySelectorAll('[data-zh-tab]')) {
    tabBtn.onclick = () => {
      const target = tabBtn.dataset.zhTab;
      for (const b of d.querySelectorAll('[data-zh-tab]')) {
        const active = b.dataset.zhTab === target;
        b.setAttribute('aria-selected', String(active));
        b.setAttribute('aria-pressed', String(active));
      }
      for (const p of d.querySelectorAll('[data-zh-panel]')) {
        p.hidden = p.dataset.zhPanel !== target;
      }
    };
  }
  d.addEventListener('change', (e) => {
    const t = e.target;
    // Pinyin over characters: ruby.js's keys (it redraws the pinyin; toneColours is shared).
    if (t.name in RUBY_DEFAULTS) rubySettings({ [t.name]: t.type === 'checkbox' ? t.checked : t.name === 'rubyLevel' ? Number(t.value) : t.value });
    if (!t.name || !(t.name in ZH_DEFAULTS)) return;
    zhSettings({ [t.name]: t.type === 'checkbox' ? t.checked : t.name === 'perPage' ? Number(t.value) : t.value });
  });
  d.querySelector('[data-close]').onclick = () => d.close();
  const say = (t) => { d.querySelector('[data-user-status]').textContent = t; };
  d.querySelector('[data-user-export]').onclick = async () => {
    try {
      const data = await (await client?.())?.exportUser?.();
      if (!data) return say('Nothing to export.');
      const a = Object.assign(document.createElement('a'), { download: 'notecomplete-chinese-words.json', href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })) });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say('Exported.');
    } catch (e) { say(`Export failed: ${e.message}`); }
  };
  d.querySelector('[data-user-import]').onclick = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        await (await client?.())?.importUser?.(data);
        say('Imported.');
      } catch (e) { say(`Import failed: ${e.message}`); }
    };
    input.click();
  };
  d.__client = client;
  return d;
}

function fill() {
  const s = { ...rubySettings(), ...zhSettings() };
  for (const el of dialog.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = String(s[el.name]);
  }
}

async function listPacks(client) {
  const list = dialog.querySelector('.zh-packs');
  let zh;
  try { zh = await client?.(); } catch { zh = null; }
  let packs = null;
  try { packs = zh ? await zh.packs() : null; } catch (e) { list.replaceChildren(row('Dictionaries could not be read: ' + e.message)); return; }
  if (!packs) { list.replaceChildren(row('The dictionary is not available in this build. Pinyin with tone marks works without it.')); return; }
  list.replaceChildren(...packs.map((p) => packRow(zh, p, client)));
}
const row = (text) => Object.assign(document.createElement('li'), { className: 'muted', textContent: text });

function packRow(zh, p, client) {
  const li = document.createElement('li');
  li.className = 'zh-pack';
  const name = Object.assign(document.createElement('span'), { className: 'zh-pack-name' });
  name.append(Object.assign(document.createElement('strong'), { textContent: p.name || p.id }));
  const info = [p.words ? `${Number(p.words).toLocaleString()} words` : '', fmtBytes(p.bytes), p.bundled ? 'built in' : p.installed ? 'downloaded' : 'not downloaded'].filter(Boolean).join(' · ');
  name.append(Object.assign(document.createElement('small'), { className: 'muted', textContent: info }));
  li.append(name);
  if (p.bundled) return li;
  const progress = Object.assign(document.createElement('progress'), { max: 1, value: 0, hidden: true });
  const b = Object.assign(document.createElement('button'), { type: 'button' });
  b.append(icon(p.installed ? 'trash' : 'import'), document.createTextNode(p.installed ? 'Delete' : 'Download'));
  if (p.installed) b.classList.add('danger');
  b.onclick = async () => {
    b.disabled = true;
    try {
      if (p.installed) await zh.removePack(p.id);
      else {
        progress.hidden = false;
        await zh.installPack(p.id, (x) => { progress.value = typeof x === 'number' ? x : x?.total ? x.loaded / x.total : x?.fraction ?? 0; });
      }
    } catch (e) {
      li.append(row(`${p.installed ? 'Delete' : 'Download'} failed: ${e.message}`));
    }
    listPacks(client);
  };
  li.append(progress, b);
  return li;
}
