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
  d.innerHTML = `<h2 id="zhSettingsTitle">Chinese</h2>
  <p class="muted">Type Chinese with pinyin in text boxes, notes, Ask AI, cards and Find. <kbd>Ctrl Shift Space</kbd> switches Off → Hanzi → Pinyin; the 中 button does the same, and a right-click or long press on it shows every choice.</p>
  <div class="zh-settings-grid">
    <label>New notes and fields<select name="mode" data-native>${MODES.map(([v, t]) => opt(v, t)).join('')}</select></label>
    <label>Characters<select name="script" data-native>${opt('simplified', 'Simplified 简体')}${opt('traditional', 'Traditional 繁體')}</select></label>
    <label>Enter while typing pinyin<select name="enter" data-native>${opt('auto', 'Auto: like the text around it')}${opt('letters', 'The letters as typed')}${opt('marks', 'Pinyin with tone marks')}</select></label>
    <label>A digit after pinyin (Hanzi)<select name="digits" data-native>${opt('tone', 'Gives the tone (ma3 → 马)')}${opt('choose', 'Chooses candidate n')}</select></label>
    <label>Candidates per page<select name="perPage" data-native>${opt(5, '5')}${opt(9, '9')}</select></label>
  </div>
  <label class="ocr-skip"><input type="checkbox" name="shortcut"> <span><kbd>Ctrl Shift Space</kbd> switches the mode</span></label>
  <label class="ocr-skip"><input type="checkbox" name="shiftLatin"> <span><kbd>Shift</kbd> pressed alone: Latin letters for a while (again to go back)</span></label>
  <label class="ocr-skip"><input type="checkbox" name="fullWidth"> <span>Chinese punctuation in Hanzi mode (，。？！：；、)</span></label>
  <label class="ocr-skip"><input type="checkbox" name="bothScripts"> <span>Show the other script's form beside a candidate</span></label>
  <h3>Pinyin over characters</h3>
  <p class="muted">Pinyin shown above Chinese in notes, text boxes and exports (Pinyin toggle in the Text format bar; a note can keep its own choice).</p>
  <label class="ocr-skip"><input type="checkbox" name="ruby" data-ruby> <span>On in notes that have no choice of their own</span></label>
  <div class="zh-settings-grid">
    <label>Written as<select name="rubyFormat" data-ruby data-native>${opt('marks', 'Tone marks (nǐ hǎo)')}${opt('numbers', 'Tone numbers (ni3 hao3)')}</select></label>
    <label>Only words above HSK level<select name="rubyLevel" data-ruby data-native>${opt(0, 'None: every word')}${[1, 2, 3, 4, 5, 6].map((n) => opt(n, `HSK ${n}`)).join('')}</select></label>
  </div>
  <label class="ocr-skip"><input type="checkbox" name="toneColours" data-ruby> <span>Tone colours (pinyin over characters and over candidates)</span></label>
  <h3>Dictionaries</h3>
  <p class="muted">The common words and every HSK 1–3 word come with NoteComplete. Higher HSK levels are optional downloads, kept on this device; delete them any time.</p>
  <ul class="zh-packs" aria-live="polite"><li class="muted">Loading…</li></ul>
  <h3>Your words</h3>
  <p class="muted">The characters you choose move up the list, and words you build from several choices are learnt. Move them to another device as a file.</p>
  <div class="zh-user"><button type="button" data-user-export>Export my words…</button><button type="button" data-user-import>Import…</button><span class="muted" data-user-status></span></div>
  <div class="ocr-actions"><span class="spacer"></span><button type="button" data-close>Close</button></div>`;
  document.body.append(d);
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
