# Chinese mode: pinyin input, character look-up, pinyin over characters, stroke order

Status: **being implemented** (2026-11-19, branch `feat/chinese-mode`); the owner's answers are in §15. Owner's requests:

> Plan out a Chinese mode, where you can easily type pinyin, get the automatic versions with the
> proper accents and their respective characters in an easy to choose and input manner, using a
> menu that follows where you type and has clickable and keyboard actionable input.

and, added later: stroke order animated like Hanzi Writer (replay, step, trace practice with the
pen); a right-click / long-press panel on any Chinese character; a toggle to show or hide pinyin
over characters (ruby) per note and globally, in text boxes, Markdown and exports. The owner asked
for the plan at implementation level: stack, data pipeline, algorithms, UI, integration points,
storage, tests and a phase-by-phase task list.

Every file and function named as existing below was checked on `origin/main` at `ff9fc55`
(1.2.42). Names marked *new* do not exist yet. All sizes in **Measurements** were measured on
2026-11-18/19 with throwaway scripts (nothing of them is committed); the rest are labelled as
estimates.

---

## 1. What exists today (findings)

**Where text is typed**

| Place | Element | Code |
|---|---|---|
| Text boxes on pages | `<textarea class="text-editor" wrap="off">` absolutely placed in the page element `p.el`, sized in % of the page; a format bar above it; MathLive field over it for formulas | `text-box.js` `open()` (≈ line 395–530); keys in `area.addEventListener("keydown")` (Esc commits, Shift+Esc discards, Ctrl+Enter commits, then `e.stopPropagation()`); blur → `commit()` |
| Markdown notes panel | TinyMDE (`vendor/tinymde`, loaded by `notes.js` `loadEditor()`), a contenteditable with one child per line | `notes.js`; it already computes caret rectangles for collaborators: `caretBox(index)` (Range over the line's text nodes) |
| Ask AI | `<textarea id="chatInput">` | `index.html` 946, `chat.js` |
| Flashcard editing / practice | textareas created in `study.js` (≈ 358), `#practiceFixFront`, `#practiceFixBack`, `#practiceExplainedArea` | `study.js`, `index.html` 1196–1205 |
| Quiz checking | `#quizCheckText` | `quiz.js` |
| Find, dialogs, scratchpad | `<input>` / `<textarea>` | `find.js`, `scratchpad.js` |

**Keys and IME.** There is no `compositionstart`/`compositionend` handling anywhere in
`apps/reader`; only `modal-dialogs.js` checks `e.isComposing` (for Esc). Global shortcuts are
gated by `typingIn(t)` in `app.js` (line 6965: inputs except buttons/sliders, textareas, selects,
contenteditable) and `quickKeyAllowed`. The text box's own keydown stops propagation, so keys
typed in it never reach tool shortcuts. Today an OS IME (fcitx5, Gboard pinyin, iPad pinyin)
already works in all of these fields because nothing intercepts composition, but text-box Esc
during an OS composition would commit the box (a small bug to fix while we are here:
`if (e.isComposing) return;` first).

**Rendering of typed text.** Page text boxes are drawn by the Rust core as SVG
(`crates/noteful-core/src/text.rs` `text_svg`): one `<text>` per line, `<tspan font-family="'<family>',
'<name>', <generic>">`, generic = `Arial, sans-serif` (or serif / mono / Comic Neue). No CJK
family is named, so on screen the browser's font fallback picks whatever CJK font the OS has.
The page SVG is inserted inline (`render.innerHTML = result.svg`, `app.js` 1367/1646), so fonts
registered in the document (style.css `@font-face`, `fonts.js` `registerFont`) do apply on screen.

**Exports.** PDF and picture exports rasterise the page: `pageCanvas()` (`app.js` 7788) serialises
the page SVG into a `Blob` and draws it through an `<img>`. An SVG used as an image cannot use
document fonts or fetch any, so **exports only show Chinese if the OS has a CJK font** (Linux
without `noto-fonts-cjk`, some Android builds): tofu boxes otherwise. `page-export.js` binds the
rasters into a PDF via the core (`page_pdf.rs`), so no font embedding exists in PDF either.
`.noteful` export keeps the characters as text (Noteful on iPad shows them with PingFang).

**Text wrapping.** `text-box.js` `wrapText()` breaks only at spaces, so a long Chinese line
(no spaces) never wraps (used when AI/answer text is placed on a page, lines 611/628).

**Search and OCR already know Chinese.** `search-index.js` `words()` splits Han/Kana runs into
single characters and `normalize()` strips combining marks (so `nǐ` already matches `ni`).
`ocr.js` `OCR_LANGUAGES` includes `chi_sim` / `chi_tra`; language data comes from jsDelivr on
first use (measured: `chi_sim.traineddata.gz` 1 718 768 B, `chi_tra` 1 656 239 B, the
`4.0.0_best_int` builds). `ocr-dictionary.js` corrects every OCR language but Chinese.

**Markdown preview.** Rendered by the core (`markdown.rs` `markdown_html`, pulldown-cmark): raw
HTML is escaped (tested: `<script>` → `&lt;script&gt;`), so `<ruby>` cannot be typed as HTML
today; a syntax extension is needed.

**Lazy vendored assets and offline.** `tools/build_web.py` copies vendor files into
`apps/reader/vendor/` (git-ignored). `LAZY` there lists the folders the service worker (`sw.js`)
does not precache at install but keeps once used (transformers, tesseract, mammoth, sheetjs,
katex, mathlive, darkreader, pdfjs cmaps/fonts/wasm). Desktop (`apps/desktop/stage.mjs`, assets
served from the `notecomplete://reader/` protocol, `asset-path.js`) and Android (assets served on
`127.0.0.1:8768`) ship **every** vendored file, so anything put in `vendor/` adds to every
installer. Data that is not shipped is fetched on first use from pinned URLs (Tesseract language
data and the OCR word lists from jsDelivr / `raw.githubusercontent.com` at a pinned commit;
WebLLM checked against `WEBLLM_SHA256`), and the CSP `connect-src https:` (`tools/reader-csp.mjs`)
already allows that. The FrequencyWords word lists (CC BY-SA 4.0) are already used this way, with
attribution in `docs/USER_GUIDE.md`.

**Menus and windows to reuse.** `context-menu.js` `openContextMenu(x, y, entries, {title})`
(right-click and long press on pages, `app.js` `itemMenu` 7337, `contextmenu` listener 4119,
`longPress` in the page pointer handlers ≈ 854); `prefabs/kit/window.js` (movable non-modal
window, remembers place); `math-keypad.js` (an on-screen key strip shown while typing math,
which already handles the phone keyboard covering the screen via `keepTextVisible()`).

**Prefab modules.** `apps/reader/prefabs/<id>/module.json` + `render.js` (pure spec → SVG) +
optional `editor.js`; see `docs/PREFAB-MODULES.md`. A shared step player is planned in
`docs/ALGORITHM-ANIMATIONS.md` (branch `feat/algorithms`, commit `f420e80`): play/pause (Space),
← →, Home/End, speed, scrub, caption, prefers-reduced-motion; "show this step on the page".

**Storage.** Settings are in `localStorage` under `notecomplete-*` keys (e.g.
`notecomplete-pen-smoothing`); larger local data in IndexedDB stores (`notecomplete-fonts` in
`fonts.js`, `notecomplete-transcripts`, the library). The project JSON (`spec/nfedit-v1.md`)
**rejects unknown keys**, so a per-note setting stored in the note needs a spec + core change.

**Repository licence.** The repository has no `LICENSE` file; this matters for share-alike and
LGPL data (see §3.4 and the open questions).

---

## 2. Measurements

Downloaded into a scratch folder on 2026-11-18; compressed with `gzip -9` and `brotli -q 11`.

| Data | Raw | gzip | brotli |
|---|---|---|---|
| CC-CEDICT (2026-11-18 release, 125 439 entries) `cedict_1_0_ts_utf-8_mdbg.txt` | 9 878 223 | 3 982 097 | 2 793 042 |
| IME pack: simplified, traditional (if different), toneless-joined pinyin with tone digits, frequency — 123 531 entries (entries whose pinyin is not pure syllables dropped) | 3 561 114 | 1 453 133 | **1 109 836** |
| Same + first English gloss cut at 40 chars | 6 552 407 | 2 893 969 | 2 119 644 |
| "Common" IME pack: entries with a frequency or single characters (36 124) | 813 108 | 375 428 | **295 265** |
| FrequencyWords `zh_cn_50k.txt` (commit 525f9b5) | 565 895 | 295 940 | 239 773 |
| Unihan 17 subset: 44 355 characters with `kMandarin` → char, readings, strokes, radical, 3 variant fields, definition ≤ 80 chars | 1 721 376 | 677 137 | **519 310** |
| Make Me a Hanzi `dictionary.txt` (9 574 chars: decomposition, radical, etymology) | 2 570 140 | 337 094 | 240 847 |
| Make Me a Hanzi `graphics.txt` (9 574 chars: stroke outlines + medians) | 30 778 076 | 12 373 483 | 9 293 840 |
| — top 500 characters by frequency | 1 089 240 | 444 095 | 361 081 |
| — top 3 000 | 8 248 565 | 3 355 832 | **2 647 313** |
| — top 6 000 | 15 054 763 | 6 123 221 | 4 806 492 |
| one character (hanzi-writer-data `我.json`) | 2 476 | 1 147 | 960 |
| OpenCC `STCharacters` / `STPhrases` / `TSCharacters` / `TSPhrases` | 36 026 / 1 008 747 / 104 520 / 9 177 | — | 13 831 / 314 542 / 20 010 / 3 598 |
| Noto Sans SC variable, Fontsource 5.3.1: 101 `unicode-range` woff2 slices | 4 500 544 total, 2–76 KB each | (woff2) | |
| Tesseract `chi_sim` / `chi_tra` traineddata (gz, best_int) | | 1 718 768 / 1 656 239 | |

Facts from the same data: 423 distinct toneless syllables in CC-CEDICT; 998 traditional
characters in OpenCC map to several simplified ones and 277 simplified to several traditional
(发 → 發 髮, 干 → 幹 乾 干 榦, 后 → 後 后, 里 → 裏 里 哩).

**Engine speed (prototype, Node 26 on an M1 Max, full 123 k-entry pack in memory):** index build
147 ms, ≈ 107 MB JS heap (plain objects; the packed layout in §4.3 is far smaller); candidate list
for one keystroke 0.001 ms; sentence (Viterbi) + list 0.005 ms per keystroke over 20-letter inputs.
Results: `nihao` → 你好; `wobuzhidao` → 我不知道; `jintiantianqihenhao` → 今天天气很好;
`woxihuanxuexizhongwen` → 我喜欢学习中文. Even 50× slower on a tablet this is far under the
16 ms budget; **loading** (fetch + decompress + index) is the cost to manage, not lookup. The
prototype also showed two ranking faults the real build must fix: duplicates when traditional
forms differ (merge by simplified form per script), and a whole-word frequency applied to a rare
reading (见 ranked first for `xian` because 见 has a rare reading xiàn) — fixed with per-reading
weights (§4.4).

---

## 3. Data: sources, licences, attribution

### 3.1 Sources (pinned)

| Use | Source | URL (pin) | Licence |
|---|---|---|---|
| Words, pinyin, glosses | CC-CEDICT | `https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz` — MDBG publishes only "latest", so the build script stores the file's SHA-256 and the `#! date=` line in `tools/chinese-data.lock.json` and fails on mismatch; a copy of the exact release is kept as a GitHub release asset of this repo for reproducible builds | CC BY-SA 4.0 |
| Character data: readings, strokes, radicals, variants, definitions | Unicode Unihan 17.0 | `https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip` | Unicode License v3 |
| Word frequency (simplified / traditional) | FrequencyWords (OpenSubtitles 2018) | `https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/zh_cn/zh_cn_50k.txt` and `…/zh_tw/zh_tw_50k.txt` (the commit `ocr-dictionary.js` already pins) | content CC BY-SA 4.0 |
| Per-reading frequency of polyphones | Unihan `kHanyuPinlu` (3 800 characters) | in Unihan.zip | Unicode License v3 |
| Simplified ↔ traditional | OpenCC data | `https://github.com/BYVoid/OpenCC` at a pinned tag, `data/dictionary/{STCharacters,STPhrases,TSCharacters,TSPhrases,TWVariants,HKVariants}.txt` | Apache-2.0 |
| Stroke order | hanzi-writer-data 2.0.1 (per-character JSON derived from Make Me a Hanzi `graphics.txt`) | npm `hanzi-writer-data@2.0.1` | Arphic Public License (ARPHICPL.TXT) |
| Decomposition, etymology hint, radical | Make Me a Hanzi `dictionary.txt` | `https://github.com/skishore/makemeahanzi` at a pinned commit | LGPL-3.0-or-later |
| Stroke animation code (optional, see §7) | hanzi-writer 3.7.3 | npm | MIT |
| CJK font | Noto Sans SC / TC (variable), Fontsource 5.3.1 | npm `@fontsource-variable/noto-sans-sc`, `…-tc` | SIL OFL 1.1 |

**Considered and not chosen:** libpinyin data (GPL-3.0; would bind the app's licence), rime-essay
and rime-luna-pinyin (LGPL-3.0; usable as separate data files, but CC-CEDICT + frequency already
covers it, and essay's frequencies are unattributed web text), SUBTLEX-CH and BCC/Jun Da
frequency lists (research-only or unclear terms), KanjiVG (Japanese stroke forms differ from
mainland standards; CC BY-SA 3.0).

### 3.2 What CC BY-SA 4.0 means for bundling

- **Attribution**: name, licence link, and that it was changed. Shown in a new "Chinese data"
  section of Help → About / licences, in `docs/USER_GUIDE.md`, and in a `LICENSE-cc-cedict.txt`
  beside the pack. Text:
  > Chinese dictionary data from CC-CEDICT (https://cc-cedict.org/wiki/), © MDBG and
  > contributors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
  > Word frequencies from FrequencyWords by Hermit Dave (OpenSubtitles 2018), CC BY-SA 4.0.
  > Converted and reduced for NoteComplete (fields removed, re-encoded); the converted pack is
  > available under the same licence.
- **Share-alike** applies to the *adapted database* (our `.bin` packs), not to the app's code:
  the pack is a separate file in a "collection". We must ship the pack under CC BY-SA 4.0 and
  not add DRM/technical measures that stop reuse (a plain binary format with a documented layout
  is fine; we document it in this file, §4.3).
- **User dictionary entries** are the user's own data; they are not derived from CC-CEDICT when
  only counts and the user's chosen strings are stored.

**Unicode License v3**: include the licence text with the Unihan-derived pack
(`LICENSE-unihan.txt`). **Apache-2.0** (OpenCC): include LICENSE and a NOTICE line. **Arphic
Public License** (stroke data): GPL-like for the data; redistribution of the data files with the
licence text is allowed, modifications must stay under APL; keep the stroke pack a separate data
file with `ARPHICPL.TXT`, never merged into app code. **LGPL-3.0** (`dictionary.txt`): ship the
derived fields as a separate replaceable data file with the LGPL text and a note of where the
source is; do not compile it into the app.

### 3.3 Packs and where they live

| Pack (*new*) | Content | Size (br) | Shipped how |
|---|---|---|---|
| `vendor/chinese/pinyin.js` (code, no data) | syllable table (423 + `r` forms), tone placement, segmentation | ≈ 10 KB | in the app shell |
| `vendor/chinese/ime-core.bin` | the common IME pack (built 2026-11-19 from CC-CEDICT 2026-11-18): 38 248 entries = words in FrequencyWords zh_cn/zh_tw + every single character (12 799) + every HSK 1–3 word (2 526), simplified + traditional + reading + 2 frequencies + HSK level + first English gloss ≤ 40 chars | **576 KB** (1 473 KB raw; budget 600 KB, checked by the build) | **in installers**, lazy (in `LAZY`) |
| HSK 4, 5, 6, 7–9 expansions | the words of that level from `complete-hsk-vocabulary` (≈ 970 / 1 060 / 1 120 / 5 600 words), cut on the device from the pinned list (2.9 MB raw, fetched once, SHA-256 checked) | not shipped | **download** (Settings → Chinese → Dictionaries), IndexedDB store `packs`, deletable (`packs.js`) |
| `vendor/chinese/chars.bin` | Unihan 17 subset + Make Me a Hanzi decomposition/etymology for 44 394 characters | **515 KB** (2 471 KB raw) | in installers, lazy |
| `vendor/chinese/opencc.bin` | ST/TS characters + phrases (OpenCC ver.1.4.2) | **320 KB** (1 176 KB raw) | in installers, lazy |
| `vendor/chinese/strokes/<shard>.bin` | stroke data, top 3 000 characters, 64 shards of ≈ 40 KB | ≈ 2.6 MB | in installers, lazy per shard |
| strokes for the rest (≈ 6 500 chars) | per-character JSON from jsDelivr `hanzi-writer-data@2.0.1/<char>.json` | ≈ 1 KB each | download on first use, cached |
| `vendor/fonts/noto-sans-sc/*.woff2` + `noto-sans-tc` | 101 unicode-range slices each | ≈ 4.5 MB per script | **decision needed** (§8): ship SC, fetch TC; or system fonts only |

Installer growth with the recommendation: ≈ 5 MB data + 4.5 MB font (SC) ≈ **9.5 MB** per
installer; the web app's first visit is unchanged (everything is in `LAZY`). Without the font:
≈ 5 MB.

Why bundle the IME packs instead of downloading on first use like OCR data: an input method that
fails on a plane is useless, the core pack is tiny, and Android/desktop are used offline. Glosses
and rare stroke data are reference material and can wait for a connection.

Download packs follow `ocr-dictionary.js`: a pinned URL (a GitHub release asset of this repo,
e.g. `https://github.com/Emefedez/NoteComplete/releases/download/chinese-data-1/gloss.bin`, or
jsDelivr of the same tag), a SHA-256 in `chinese-data.js` checked before use, stored in the Cache
Storage `notecomplete-chinese` so it survives app updates; `raw.githubusercontent.com` /
jsDelivr are already allowed by the CSP and listed in `tools/reader-csp.mjs` `inventory` (add the
release host there and to its test).

---

## 4. The input engine

### 4.1 Stack and placement

```
apps/reader/
  chinese/                      (new folder; plain ES modules like the rest of the reader)
    pinyin.js        pure: syllables, normalisation, tone marks, segmentation          main + worker + Node
    engine.js        pure: pack decoding, candidate search, sentence DP, ranking       worker + Node
    engine-worker.js module worker: loads packs, answers {id, input, opts} → candidates
    client.js        main thread: starts the worker lazily, request/response with ids,
                     drops stale answers, falls back to tone-only mode while loading
    convert.js       pure: simplified ↔ traditional (OpenCC tables, longest match)
    ime.js           the controller: modes, keys, composition buffer, commit into the target
    ime-menu.js      the candidate menu DOM, positioning, pointer/keyboard
    caret.js         caret rectangles for textarea/input/contenteditable/page text boxes
    user-dict.js     IndexedDB store of chosen candidates
    ruby.js          pinyin over characters (DOM and page SVG)
    lookup-panel.js  the right-click character panel
    strokes.js       stroke data loading, shard index
  prefabs/hanzi/     the stroke-order prefab module (§7)
tools/build_chinese_data.mjs    (new) sources → packs, run by build_web.py
tools/chinese-data.lock.json    (new) URLs, versions, SHA-256 of every source
```

**JS, not Rust/WASM.** Lookup is microseconds in JS (§2); the reader's similar features
(`ocr-dictionary.js`, `search-index.js`) are JS and tested with `node test.mjs`; the core WASM
(`pkg/`) is shared by everything and must not grow by megabytes of dictionary; a separate WASM
crate (like `noteful-import-wasm`) would add a build stage for no speed gain. Rust is touched only
for Markdown ruby syntax (§6.3) and the per-note setting in the project JSON (§9).

**Worker for the dictionary.** Fetching, brotli-free decoding (the server/Electron/Android serve
the `.bin` raw; HTTP compression only on the web) and building the index take ≈ 100–300 ms on a
tablet; doing that in `engine-worker.js` (a module worker like `transcript-worker.js` /
`local-ai-worker.js`) keeps typing smooth while it loads. Per-keystroke requests are
`postMessage` round trips (≈ 0.1–1 ms). The **tone-mark mode needs no data** and runs on the main
thread in `pinyin.js`, so it works from the first keystroke; Hanzi mode shows "Loading
dictionary…" in the menu for the first ≈ 0.3 s once per session.

### 4.2 Pinyin rules (`pinyin.js`)

```js
export const SYLLABLES /* Set<string> */;   // 423 toneless syllables incl. lü, nüe, lüe, and "r"; ê, m, n, ng, hm, hng
export function normalise(raw)        // "Lv3" → "lü3"; "u:"/"v" → "ü"; NFC; lower-case; keeps capitalisation flag
export function markTone(syl, tone)   // ("hao", 3) → "hǎo"; tone 5/0 → unmarked; keeps an initial capital
export function numbersToMarks(text)  // "ni3 hao3, Zhong1guo2" → "nǐ hǎo, Zhōngguó"
export function marksToNumbers(text)  // "nǐ hǎo" → "ni3 hao3"
export function segment(letters)      // "xian" → [["xian"], ["xi","an"]] (ranked), honours "'"
export function splitInput(buffer)    // "ni3hao" → [{syl:"ni", tone:3}, {syl:"hao", tone:null}]
```

**Normalisation.** `v` and `u:` → `ü` (also `U:`/`V`). After `j q x y`, `u` is already `ü` and is
written `u` (ju, que, xun, yuan); after `n l`, `nv`/`nü` stays ü (`nü`, `lüe`) while `nu`, `lu` are
the plain vowel. Tone digits 1–4 mark, 5 or 0 is the neutral tone (no mark). Input like `nü3` or
`nǚ` is accepted too (marks are stripped into numbers internally).

**Mark placement** (standard rule, in this order):
1. If the syllable has `a` or `e`, the mark goes on it (`hǎo`, `méi`, `xuě`).
2. Else if it has `ou`, the mark goes on `o` (`dǒu`, `zhōu`).
3. Else on the **last** vowel: so `iu` → `u` (`liù`, `jiǔ`) and `ui` → `i` (`duì`, `huí`);
   `ü` takes the combining mark on ü (`lǜ`, `nǚ`).
Vowels for rule 3: `a e i o u ü`; for `m`, `n`, `ng`, `hm`, `hng`, `ê` the mark goes on `m`/`n`/`ê`
(`ḿ`, `ň`, `ê̄`): rare, kept for completeness. Characters are composed with the precomposed
code points where they exist (`āáǎà ēéěè īíǐì ōóǒò ūúǔù ǖǘǚǜ`), else base + U+0304/0301/030C/0300,
then NFC.

**Segmentation of continuous pinyin** (`segment`): dynamic programming over the letter string with
the syllable table (max syllable length 6, `zhuang`). Each split is scored, lowest first:
- number of syllables (fewer is better: `xian` beats `xi an`);
- a split that leaves a syllable starting with a vowel after a consonant-final syllable is
  penalised (`xi'an` only by apostrophe or as the 2nd alternative, `fang'an` vs `fan gan`);
- in Hanzi mode the dictionary rescoring (§4.4) re-ranks splits by whether words exist for them
  (`xian` → 先 / 现 / 西安 both appear; `fangan` → 方案 ranks above 反感 when more frequent).
An apostrophe typed by the user is a hard boundary; a trailing incomplete syllable (`zh`, `xia`
while typing `xiang`) is accepted as a prefix: candidates whose next syllable *starts with* it.
Initials only (`bjdx` → 北京大学) is a later extension (Phase 4): match each letter as the initial
of one syllable, only for ≥ 2 letters and only below full-syllable matches.

**Tone filters.** A digit typed right after a syllable in Hanzi mode filters candidates to that
tone (`ma3` → 马 码 蚂; 妈 ma1 and 吗 ma5 are filtered out). In tone-mark mode the digit applies the mark.

### 4.3 Pack format (`ime-*.bin`)

As built (`chinese/pack.js`, `tools/build_chinese_data.mjs`). Every pack is one little-endian
container of columns; one per field instead of one record per entry, because columns compress
far better (brotli) and need no padding:

```
header   "NCZH", u8 version (1), u8 0, u16 section count n, then n × (u32 offset, u32 length);
         every section starts on a 4-byte boundary
section 0  UTF-8 JSON meta: kind ("ime" | "chars" | "opencc"), rows, the syllable table
           (meta.syllables = pinyin.js SYLLABLE_LIST at build time: ids are its indexes),
           freqScale, logTotal {s, t} (log2 of the corpus sizes, for the sentence costs), CEDICT date
string column = a lengths section (u8, or u16 when any string is longer than 255; UTF-16 code
           units) + a UTF-8 blob section; the reader decodes each blob once and slices it
```

`ime-*.bin` sections, one value per entry: 1 `nsyl` u8; 2 `keys` u16 per syllable, `id << 3 |
tone` (tone 1–5, 5 = neutral); 3 `fs`, 4 `ft` u16 = log2(count + 1) × 32 from zh_cn / zh_tw
(a form missing from its own list is looked up in the other; single characters use max(own count,
corpus character count / 8) × their reading's kHanyuPinlu share; "variant of" forms / 256; words
without a count are estimated below the lists' minimum and flagged); 5 HSK level u8 (1–6, 7 =
7–9, 0 none); 6 flags u8 (1 proper noun, 2 only "variant of", 4 estimated frequency, 8 HSK word
CC-CEDICT lacks); 7–8 simplified, 9–10 traditional ("" = same), 11–12 first gloss (string
columns); 13 index u32: first entry per first-syllable *rank*. Entries are sorted by the
alphabetical rank of their syllables (then tones, then frequency), so "words whose syllables
start ni, h…" is one contiguous range: the index gives the first syllable, a binary search per
further syllable narrows it, and an unfinished last syllable ("h") is a rank range.

`chars.bin`: 1 code points u32 (sorted, binary search), 2 total strokes u8, then string columns
`readings` ("xíng:2943 háng:218 xìng", kHanyuPinlu counts first, then kMandarin, kTGHZ2013),
`radical` (kRSUnicode "144.0"), `definition` (≤ 80), `simplified`, `traditional`, `variants`
(semantic, specialized semantic, Z), `decomposition`, `etymology` ("type|hint|phonetic|semantic").
`opencc.bin`: per table (STPhrases, STCharacters, TSPhrases, TSCharacters) keys and values as
string columns (alternatives separated by spaces, OpenCC's default first).

The engine builds no object per entry for typing: it walks the range in the typed arrays and
decodes only the strings of matching rows. Measured on the M1 Max (Node 26): pack decode 6–13 ms,
a 21-letter sentence input ≈ 0.8 ms per keystroke, ≈ 30 MB heap with the pack loaded. The maps
for `annotate`/`lookup` (written form → entries, character → words) are built on first use.

### 4.4 Ranking

score(entry) = `w_f · logfreq(entry, script)` + `w_r · reading(entry)` + `w_u · user(entry)` +
`w_l · length(entry)` + `w_x · exact(entry)`, all integers in the worker:

- `logfreq`: from FrequencyWords zh_cn (simplified mode) or zh_tw (traditional), `log2(count+1)`;
  missing words get the frequency of their characters' product scaled down.
- `reading`: per-reading weight for single characters: `kHanyuPinlu` gives counts per reading
  (见 jiàn ≫ xiàn), so a word's frequency is multiplied by the share of that reading; characters
  without `kHanyuPinlu` use the order of `kMandarin` (first reading = common one).
- `user`: chosen candidates (`user-dict.js`), `log2(1+count)` with recency decay (half-life 30
  days), so 的 / 得 / 地 adapt to the person.
- `length`: entries covering more of the typed syllables first (the whole input as one word or
  sentence first, then shorter prefixes, as every phone IME does).
- `exact`: exact tone matches when tones were typed.

The first candidate is the **sentence**: Viterbi over the syllables with cost `−log P(word)`
(prototype above: 我不知道, 今天天气很好), shown only when it differs from the best single entry
and covers ≥ 2 words. Choosing a partial candidate consumes its syllables and the menu continues
with the rest (`wobuzhidao` → choose 我 → `buzhidao` remains).

### 4.5 Simplified / traditional (`convert.js`)

- **Output script** comes from the pack: entries carry both forms, so traditional mode shows
  CC-CEDICT's traditional form and ranks by zh_tw frequency. No conversion is needed while typing.
- **Converting existing text** (selection → "Convert to traditional/simplified", and the look-up
  panel) uses OpenCC tables with longest-match over phrases first (`STPhrases`, then
  `STCharacters`): phrases resolve the one-to-many cases (头发 → 頭髮, 发现 → 發現; 干净 → 乾淨,
  干部 → 幹部; 皇后 → 皇后, 以后 → 以後). When a single character still has several targets and no
  phrase decides, the first OpenCC target is used and the character is underlined in the result
  preview with a menu of the alternatives (only in the explicit convert dialog).
- Taiwan/Hong Kong variants (`TWVariants`, `HKVariants`) as an option of traditional mode later.

### 4.6 User dictionary (`user-dict.js`)

IndexedDB `notecomplete-chinese`, store `chosen`, key `"<script>:<toneless key>:<hanzi>"`,
value `{ count, last, tones }`; store `words` for user-added words `{ hanzi, pinyin, added }`
(added from the look-up panel or by choosing a sequence the dictionary did not have as one
word: after the user picks 小 then 明 for `xiaoming` twice, offer 小明 as a word). Cap 50 000 rows,
pruned by score. Exported/imported as JSON in Settings → Chinese (for moving devices); not synced
to notes. The worker receives the user rows at start and deltas after each choice.

---

## 5. The candidate menu and the input controller

### 5.1 Modes and switching

| Mode | Typing `ni3hao3` gives | Typing `nihao` gives |
|---|---|---|
| Off | `ni3hao3` (browser/OS default) | `nihao` |
| **Pinyin (marks)** | `nǐhǎo` (space typed by the user stays) | menu offers `nǐ hǎo`, `ní hǎo`… only when the toneless syllable has a dictionary word (needs the pack), else text as typed |
| **Hanzi** | menu: 你好 (tone-filtered) | menu: 你好 你 呢 尼 … |

- Script: **Simplified / Traditional**, independent of the mode.
- Toolbar: a `中` toggle in the text format bar (`text-box.js` `showTextFormat`) and in the notes
  panel toolbar; long-press/right-click on it opens the mode menu (Off / Pinyin marks / Hanzi;
  Simplified / Traditional; Pinyin over characters on/off). The same toggle appears in the chat
  form, the study card editor and Find (a small `中` button inside the field's right edge, only
  when Chinese mode was ever enabled, so other users see nothing).
- Shortcut: **Ctrl+Shift+Space** cycles Off → Hanzi → Pinyin → Off while typing (Ctrl+Space is
  taken by OS IMEs on Linux/Windows); **Shift alone** (press and release with no other key) toggles
  Latin passthrough temporarily, as Chinese IMEs do; both configurable in Settings → Chinese.
- Remembered **per target**: per text box (the last mode used in a note's text boxes, stored with
  the note, §9), per note for the Markdown panel, and globally for chat/study/Find (localStorage
  `notecomplete-zh-mode-<field>`). New notes start Off unless "Chinese mode by default" is set.

### 5.2 Controller (`ime.js`)

```js
export function attachIme(target, { kind, getMode, setMode, anchor }) // returns { detach() }
// kind: "textarea" | "input" | "contenteditable" | "pagebox"
// anchor(): DOMRect of the caret in viewport px (caret.js), recomputed on every change
```

State: `buffer` (letters, digits, apostrophes typed), `selected` (index), `committedSyllables`
(for partial choices), `composing` (an OS IME composition is active).

Keys handled in a **capturing** `keydown` on the target, before `text-box.js`'s own handler, only
while `buffer` is non-empty or the key starts one:

| Key | Action |
|---|---|
| a–z (no modifiers) | append to buffer (Hanzi / Pinyin modes); the field itself is not changed until commit |
| `'` | syllable boundary |
| 1–5 directly after a syllable | tone (Pinyin mode: mark; Hanzi: filter) |
| 1–9 (after a tone, after paging or moving the highlight, or 6–9 at any time; Settings: "digits choose") | choose candidate n of the page |
| Space (Hanzi mode, pinyin typed) | held, not typed: on **release** it chooses the highlighted (first) candidate; key repeat does nothing |
| **Space held + 1–9** (owner's request, 2026-11-19) | choose candidate n of the page at once; the release then writes nothing more; several digits in one hold make successive partial choices (Space+2, Space+1 → 你 then 好). A letter pressed before Space is released (rolled keys) first takes Space's choice. Losing the focus while Space is held drops the hold. Pinyin mode: Space is typed as before |
| Enter | commit the raw text: Hanzi mode → the pinyin with marks (`nǐhǎo`); Shift+Enter → the letters as typed |
| Esc | clear the buffer (does **not** commit/close the text box; `text-box.js`'s Esc acts only when the buffer is empty) |
| Backspace | delete the last letter of the buffer; after a partial choice, undo that choice back into the buffer |
| ← → | move the highlight; ↑ ↓ in the vertical (phone) layout |
| Page Up / Page Down, `-` / `=`, `,` / `.` | previous / next page of 9 |
| Tab / Shift+Tab | next / previous candidate |
| Ctrl/Alt/Meta + key | not handled (shortcuts keep working) |
| punctuation `,` `.` `?` `!` `:` `;` with empty buffer, Hanzi mode | full-width `，。？！：；` (setting, default on); `\` → `、` |

Commit writes into the target with `document.execCommand('insertText')` for textareas/inputs
(keeps native undo) and through TinyMDE's own API for the notes panel (its `setContent` +
`setSelection` path in `notes.js`, so the Yjs sharing in `collab.js` sees one change), then
dispatches `input` so `text-box.js` `refit()` runs. The text box's `textBoxSize()` measure then
includes the Chinese text.

**OS IME stands down.** `compositionstart` on the target sets `composing = true`, hides the menu
and clears the buffer; `compositionend` clears it; every handled key checks `e.isComposing ||
e.keyCode === 229` first and returns. On Android (Gboard), `keydown` is mostly 229 and letters
arrive in `beforeinput`/`input` with `inputType: "insertCompositionText"`: when the on-screen
keyboard composes, our mode handles nothing and shows a one-time hint "Your keyboard is typing
Chinese itself; NoteComplete's Chinese mode works with its own keys only." For Latin on-screen
keyboards (no composition), we read `beforeinput` `insertText` letters instead of `keydown`
(`keydown` key is "Unidentified" on Android), cancel it (`preventDefault`), and feed the buffer:
this is what makes the mode usable on phones and tablets without a Chinese keyboard installed.

### 5.3 The menu (`ime-menu.js`)

DOM (one per document, re-used):

```html
<div class="zh-ime" role="listbox" aria-label="Chinese candidates" aria-activedescendant="zh-c-0">
  <div class="zh-ime-reading" aria-live="polite">nǐ hǎo<span class="zh-ime-rest">ma</span></div>
  <ol class="zh-ime-list">
    <li id="zh-c-0" role="option" aria-selected="true" data-i="0">
      <span class="n">1</span><ruby>你好<rt>nǐ hǎo</rt></ruby></li>
    …
  </ol>
  <div class="zh-ime-foot"><button data-page="-1">‹</button><span>1/7</span><button data-page="1">›</button>
       <button class="zh-ime-mode">简</button></div>
</div>
```

- Pinyin with marks above each candidate (`<rt>`), coloured by tone when "tone colours" is on
  (§6.4); a candidate's simplified/traditional counterpart in small grey when they differ and the
  "show both scripts" setting is on (learning).
- **Positioning** (`caret.js`):
  - textarea / input: a hidden mirror `<div>` copying the computed font, padding, border,
    `white-space`, `wrap` (textareas here use `wrap="off"`), `letter-spacing` and
    `text-transform`, with the text up to `selectionEnd` and a marker `<span>`; the marker's
    rect + the textarea's `getBoundingClientRect()` − `scrollLeft/Top`. One mirror reused,
    measured in the same frame as the input.
  - contenteditable (TinyMDE): `getSelection().getRangeAt(0).getClientRects()` (as
    `notes.js` `caretBox` does), falling back to the line's rect when the range is collapsed at a
    line start.
  - page text boxes: the textarea mirror above. Its rect is in viewport pixels **after** CSS
    transforms, so the pinch zoom (`#pages` `transform: scale(...)`, `app.js` 3748) and page zoom
    are included automatically. Text boxes are edited axis-aligned (a moved/rotated box is edited
    at its `bounds`; `text-box.js` `open()`), so no rotation appears while editing; if a rotated
    editor is ever introduced, `getBoundingClientRect()` of the marker is still the right anchor.
  - The menu is `position: fixed`, placed below the caret line (4 px gap); flipped above when it
    would cross `visualViewport` bottom (the on-screen keyboard: `visualViewport.height +
    offsetTop`, as `keepTextVisible()` computes) or the math keypad (`mathKeys.top`); clamped
    to 8 px from the window sides. Repositioned on `input`, `scroll` (capture, any ancestor),
    `visualViewport` resize/scroll and `resize`, in one `requestAnimationFrame`.
- **Pointer**: `pointerdown` on the menu calls `preventDefault()` so the field keeps focus (and the
  text box's blur → `commit()` in `text-box.js` does not fire; also add the menu to the checks
  there, as is done for `textFormatBar.contains(...)`); `pointerup` on a candidate chooses it.
  Touch targets ≥ 40 px tall in the phone layout, 32 px on desktop. Pen hover highlights.
  Horizontal swipe on the list pages it.
- **Phone layout** (`max-width: 700px`, the media query `app.js` uses, or `pointer: coarse` with
  the on-screen keyboard visible): the menu docks as a strip right above the keyboard (full width,
  candidates scroll horizontally, a ▾ expands a grid of 4 rows), instead of floating at the caret,
  which would be under the user's thumb or the keyboard.
- **Accessibility**: `role="listbox"`/`option`, `aria-activedescendant` on the field
  (`aria-controls` points at the list), reading announced in a polite live region, numbers
  visible, focus never moves into the menu; high-contrast tokens from `style.css`
  (`--surface`, `--line`, `--accent`), like `.context-menu`.
- **Style**: new rules in `style.css` next to `.context-menu`, same radius/shadow; CJK candidates
  at 1.35× the UI font size in the CJK font stack (§6.1).

### 5.4 Wiring into each field

| Field | Hook |
|---|---|
| Page text boxes | `text-box.js` `open()`: after creating `area`, `attachIme(area, { kind: "pagebox", … })`; `endText()` detaches; the existing keydown keeps Esc/Ctrl+Enter only when `!ime.busy`. The MathLive field never gets the IME. |
| Notes panel | `notes.js`, after TinyMDE is created: `attachIme(editorEl, { kind: "contenteditable" })`; commit via the editor API so `collab.js` sees the change |
| Ask AI, card editors, quiz check, Find, scratchpad | a helper `chineseField(el)` called where these elements are set up (`chat.js`, `study.js`, `quiz.js`, `find.js`, `scratchpad.js`) |
| Global | `app.js` `typingIn()` unchanged (the IME only acts in typing targets); add `!document.querySelector('.zh-ime:not([hidden])')` to `quickKeyAllowed` so number keys never pick tools while the menu is up |

---

## 6. Rendering, pinyin over characters, exports, search, OCR

### 6.1 Fonts

- On screen: a family stack appended everywhere text can be Chinese:
  `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC",
  sans-serif` (TC equivalents in traditional mode). `fonts.js` `genericFor()` and the core's
  generic in `text.rs` `text_svg` get the CJK names appended **after** the Latin generic, so Latin
  text keeps its font and Han characters fall through to a CJK face (the core and `fonts.js` must
  stay mirrored, as their comments say). A serif option (Noto Serif SC / Songti) for text boxes
  in Times.
- Bundled font: Noto Sans SC variable from Fontsource, its 101 `unicode-range` slices declared
  with `@font-face` in a new `vendor/fonts/noto-sans-sc.css`, loaded only when a document has Han
  characters or Chinese mode is turned on (a slice downloads only when a character in its range
  is drawn). `vendor/fonts/noto-sans-sc/` goes into `LAZY`. The CSP `font-src 'self'` already
  allows it.
- Text wrapping: `wrapText()` in `text-box.js` gains a break opportunity between any two Han
  characters (and after CJK punctuation, not before `，。、）` — basic *kinsoku*), using
  `Intl.Segmenter` with `granularity: "word"` where available for Latin+CJK mixes.

### 6.2 Exports

- **PDF / PNG / JPEG / QR picture**: in `pageCanvas()` (`app.js` 7788), when the page SVG
  contains Han characters, inject `<style>@font-face{font-family:"Noto Sans SC";src:url(data:font/woff2;base64,…)}</style>`
  into the serialised SVG with only the slices needed (characters on the page → slice set; ≈
  50–300 KB per page typically). This is the only way fonts reach an SVG drawn as an `<img>`, and
  `data:` is already in `font-src`. Pinyin ruby (§6.4) is drawn into that same SVG, so it exports.
- **SVG export** (`page-export.js` `pageSvg`): same injection, optional ("Embed Chinese font").
- **.noteful / .notecomp**: characters are text; ruby is not part of Noteful's format (see §6.4).
- **Markdown export**: ruby written as the source syntax (`{你好|nǐ hǎo}`) or, as an option,
  HTML `<ruby>` for other Markdown viewers.
- **Exam/HTML exports** (`exam-html.js`): HTML `<ruby>`; the font stack above.
- **Printing** (browser print of HTML/Markdown views): ruby kept when shown on screen; a print
  setting "Pinyin when printing: as shown / always / never".

### 6.3 Markdown ruby syntax (core)

`markdown.rs` `markdown_html`: a small inline extension handled on `Event::Text`:
`{漢字|hàn zì}` → `<ruby>漢<rt>hàn</rt>字<rt>zì</rt></ruby>` (one `<rt>` per character when the
number of syllables equals the number of characters, else one `<rt>` for the group); escaped as
`\{`. Tone numbers inside (`{你好|ni3 hao3}`) are converted to marks in Rust by a small port of
`markTone` (≈ 40 lines, tested against the same cases as `pinyin.js`). Unit tests in
`markdown.rs` tests (`ruby_groups`, `ruby_tone_numbers`, `ruby_escaped`, `ruby_not_in_code`).

### 6.4 Pinyin over characters (automatic ruby)

A display layer, not stored text: characters stay plain in the note; pinyin is computed from the
dictionary at display time, with per-occurrence overrides for polyphones.

- **Toggle**: View → "Pinyin over characters" (global, localStorage
  `notecomplete-zh-ruby`), overridden per note (§9: `chinese.ruby: "on" | "off" | null`);
  options: marks / numbers, tone colours on/off, only characters above an HSK level (Phase 6,
  needs an HSK list with a clear licence — open question).
- **Choosing the reading**: `engine.js` `annotate(text)` → segment the Han run into dictionary
  words (longest match + frequency, the same Viterbi as §4.4 but over characters), each word's
  most frequent reading; tone sandhi is **not** applied (dictionary tones, as textbooks print,
  e.g. 不 bù, 一 yī) — option in Phase 6. Overrides: the look-up panel's "Reading here: …" stores
  `{ itemId|mdOffset, index, pinyin }` in the note's `chinese.readings` (§9).
- **Markdown preview / HTML views / study cards**: `ruby.js` walks text nodes under the rendered
  container (skipping `code`, `pre`, `rt`, `.katex`), wraps Han runs in
  `<ruby>字<rt>zì</rt></ruby>` per character; re-run after each render (`notes.js` `render()`,
  `rich-text.js` `renderMarkdown` callers). CSS `ruby-position: over`, `rt { font-size: .5em }`.
- **Page text boxes (SVG from the core)**: after a page renders (`renderPage` in `app.js`),
  `ruby.js` finds `[data-item^="text:"] text` elements, reads each Han character's position with
  `SVGTextContentElement.getStartPositionOfChar(i)` / `getExtentOfChar(i)` (exact after the
  browser's own layout, no re-implementation of `text_svg`'s metrics), and appends a
  `<g class="zh-ruby" aria-hidden="true">` with `<text text-anchor="middle" font-size="0.45×">`
  above each character, in the item's transform. Line spacing: the core already leaves `max(8,
  size/5+8)` between lines; pinyin at 0.45× size fits above the first line only when the box has
  that margin, so the layer shifts nothing and may overlap the line above in tight boxes
  (acceptable for a display aid; documented). Selectable text layer (`text-layer.js`) is not
  affected. For exports `pageCanvas()` gets the same annotations through a helper
  `addRubyToSvg(svg, annotations)` working on the detached SVG: positions there are computed
  from the live page's measurements cached by item id (pages not on screen are laid out in an
  off-screen `<svg>` attached to the document for measuring).
- **PDF text layer and OCR words** (`text-layer.js` transparent words): an optional "pinyin over
  PDF text" draws the same layer over Han words using their boxes (`w.box`), divided evenly
  per character. Off by default.
- **Exports** keep ruby when it is on for that note at export time; the Export dialog gets a
  checkbox "Pinyin over Chinese" defaulting to the current view.
- **Tone colours** (Pleco/MDBG convention, configurable): 1 red, 2 orange/green, 3 green/blue,
  4 blue/purple, 5 grey; applied to the `<rt>` text, and optionally to the characters (CSS class
  per tone on the character span; on pages, `fill` on a duplicated `tspan`… — characters on
  pages stay their own colour in Phase 3, colouring them is Phase 6).

### 6.5 Search and OCR

- Find: already character-based. Add pinyin search: a query of Latin letters in a note with Han
  text also matches by pinyin (`nihao` finds 你好) using `annotate()` readings indexed per unit in
  `search-index.js` (a new `pinyin` alt-form alongside `altNorms`; normalised toneless).
- OCR: Chinese recognition exists. Add Chinese to `ocr-dictionary.js` corrections later (word
  list = the IME pack's words; "correction" = choose among Tesseract's alternative characters
  the one forming a dictionary word); Phase 6.
- Handwriting recognised with OCR becomes text in the OCR layer: the look-up panel and ruby work
  on it like on PDF text.

---

## 7. Stroke order (Hanzi Writer style)

### 7.1 Data and loading (`chinese/strokes.js`)

- Data per character: `{ strokes: [svgPath…], medians: [[[x,y]…]…], radStrokes?: [i…] }` in a
  1024 × 1024 box (y up, Make Me a Hanzi convention), the hanzi-writer-data JSON shape.
- Build: `build_chinese_data.mjs` reads `hanzi-writer-data@2.0.1` from `node_modules` (add to
  `apps/reader/package.json`), quantises paths to integers (they are already integral), drops
  whitespace, and writes the top 3 000 characters (by zh_cn + zh_tw frequency) into 64 shards
  `vendor/chinese/strokes/NN.bin` (≈ 40 KB br each; shard = `hash(char) % 64`, an index file
  `strokes/index.json` maps character → shard so a missing character is known without fetching).
  Rarer characters are fetched from `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json`
  on demand, SHA-checked against a per-character hash list (≈ 9 574 × 4 bytes, part of the index),
  cached in Cache Storage `notecomplete-chinese`. Traditional characters are in the same data
  (Make Me a Hanzi covers ≈ 9 500 simplified+traditional); a character with no data says
  "No stroke order for 𠀀".
- **As built** (`tools/build_chinese_strokes.mjs`, run by `build_web.py`): shards are **compact
  JSON**, `strokes/NN.json` (`{"你": {"s": [path…], "m": [[x,y,x,y…]…], "r": [i…]?}}`; paths without
  the spaces around commands, medians flattened), not `.bin`: the web host compresses JSON but not
  `.bin`, installers compress anyway, and the data stays plain under its licence. Shards are cut
  in **frequency order** (shard 0 = the 47 most frequent characters; frequency = FrequencyWords
  zh_cn + zh_tw word counts summed per character, SHA-256 pinned), so a sentence needs one or two.
  `index.json`: `{shards: ["<chars of shard 0>", …], remote: "<chars>", hashes: "<12 hex of
  SHA-256 per remote char>"}`. Sizes: 3 000 characters, 7.35 MB raw (3.3 MB gzip, 2.67 MB br),
  largest shard 137 KB; index 108 KB (69 KB gzip); 6 574 characters on demand. `vendor/chinese/
  strokes/` is in `LAZY`. The hanzi prefab's cards carry no stroke data (it would be inlined into
  `prefabs/index.js`, app code); its editor and MCP `add_prefab` (`prefabPrepare` in prefabs.js →
  the module's `prepare(spec)`) add it to the spec.

### 7.2 Player and practice

- **Animation code**: write our own small renderer (`chinese/stroke-player.js`, ≈ 250 lines)
  rather than embedding hanzi-writer: the page needs a pure `render(spec) → SVG` for a prefab and
  a step model shared with the algorithm player; hanzi-writer's technique (each stroke drawn as
  a clip-path of the outline revealed by a thick `stroke-dasharray`-animated polyline along its
  median) is reproduced. hanzi-writer (MIT, 3.7.3, ≈ 860 KB unpacked, ≈ 30 KB min) remains the
  fallback if time is short: it is MIT, accepts our data loader (`charDataLoader`), and can run
  in the look-up panel.
- **Shared step player**: the controls of `docs/ALGORITHM-ANIMATIONS.md` (play/pause Space,
  ← → steps, Home/End, speed, scrubber, caption, prefers-reduced-motion) are factored as
  `prefabs/kit/step-player.js` (*new*, shared with the algorithms module): `stepPlayer(host,
  { steps: n, caption(i), draw(i, t) })`. For a character a step is one stroke; `draw(i, t)` draws
  strokes `< i` complete and stroke `i` at progress `t`. Caption: "Stroke 3 of 7 · 横折 (héngzhé)"
  (stroke type names from the stroke direction classification, Phase 6; Phase 5 shows just the
  number).
- **Practice** (trace with pen/finger), checked like Hanzi Writer's quiz: the user draws one
  stroke; we resample it to 32 points, compare with the expected median (normalised to the
  1024 box): average point distance < 350/1024 × 0.25, start/end direction cosine > 0, length
  ratio 0.5–1.8, and it must match the *expected* stroke better than any other remaining one;
  misses show a hint after 2 attempts (the stroke flashes). Pointer input goes through the same
  `pointerdown/move/up` + `getCoalescedEvents()` the ink tools use (stroke smoothing from
  `stroke-smoothing.js` off for scoring). Results: per-stroke ok/miss, total mistakes, stored in
  the study log (§7.4).
- **Outline mode**: grey outline, then strokes fill as you go; "Show the character" toggle; a
  grid (米字格 / 田字格) background option.

### 7.3 Where it shows

1. The candidate menu: a ▶ on the highlighted candidate (or **Ctrl+.**) opens a small stroke
   popover next to the menu, playing each character of the candidate.
2. The look-up panel (§8): first section, autoplay once, replay/step buttons, Practise.
3. **Prefab module `prefabs/hanzi/`** (*new*): `module.json` `{ "id": "hanzi", "kind": "custom",
   "output": "picture", "types": ["hanzi"], "editor": "editor.js", "groups": { "languages":
   "Languages" } }`, spec `{ type: "hanzi", text: "你好", script: "simplified", show:
   "strokes" | "numbers" | "steps", step: null | n, grid: "mi" | "tian" | "none", pinyin: true,
   colour }`. `render.js` (pure, no DOM, usable by MCP `add_prefab` and exams) draws the
   characters at step `n` (all strokes when null), optionally a "stroke sequence" strip (the
   classic 1, 1–2, 1–3… row) and pinyin above. It needs the stroke data synchronously: the spec
   stores the stroke data of its characters (`spec.data = { "你": {strokes, medians} }`, ≈ 2–3 KB
   per character), so the figure renders anywhere without the packs (and is covered by the prefab
   spec size limit). `editor.js` opens the player in a `prefabs/kit/window.js` movable window
   with "Show this step on the page", as the algorithm plan does. Playing inline on the page (a ▶
   on the figure) follows the algorithms plan's later step.
4. Study: flashcard back side can include the stroke strip; a "Writing practice" study mode over
   a deck's characters (Phase 6).

### 7.4 Study log

Practice results go to IndexedDB `notecomplete-chinese` store `practice`: `{ char, at, mistakes,
strokes }`, used to suggest characters to review; exported with the user dictionary JSON.

---

## 8. The character panel (right-click / long press)

**Trigger**: right-click or long press (finger or pen; the existing `longPress` path in the page
pointer handlers) on a Han character in: page text boxes (hit test with `call("pick")` like
`itemMenu`, then the character index from `getCharNumAtPosition(point)` on the item's SVG
`<text>`), the PDF/OCR text layer (`text-layer.js` words: the character from the word's box
divided per character, or the browser selection), Markdown preview/HTML/text views
(`document.caretPositionFromPoint`/`caretRangeFromPoint` → text node offset), study cards and
chat messages. With a selection of Han characters, the panel is for the selection (a word).
The existing context menus get an entry "Look up 你好" on top (so right-click keeps its other
entries), and a long press directly on a character opens the panel straight away; Ctrl+click /
the `中` toolbar's "Look up" opens it too.

**Panel** (`chinese/lookup-panel.js`): a `prefabs/kit/window.js` movable window on desktop
(remembered place; several can be pinned), a bottom sheet on phones. Sections, each lazy:

1. Header: the character (large, CJK font), pinyin with marks for every reading (polyphones
   listed with the reading used here first, "Use this reading here" sets an override for ruby),
   tone colours, a ▶ stroke animation (§7) with step/replay/Practise.
2. Meanings: CC-CEDICT glosses per reading (gloss pack; offline message if not downloaded:
   "Meanings need a one-time 2 MB download").
3. Forms: simplified / traditional (OpenCC + Unihan `kSimplifiedVariant`/`kTraditionalVariant`),
   other variants (`kSemanticVariant`, `kSpecializedSemanticVariant`, `kZVariant`), each
   clickable.
4. Structure: radical (from `kRSUnicode`: radical number → the Kangxi radical character and its
   meaning, a 214-entry table) + residual strokes, total strokes (`kTotalStrokes`),
   decomposition (`dictionary.txt`, e.g. 好 ⿰女子) with each component clickable, the etymology
   hint where present.
5. Words: up to 30 words containing it, ordered by frequency (from the IME pack: a reverse index
   char → entry ids built in the worker on first use), each with pinyin and the first gloss.
6. Actions: Copy (character / with pinyin / pinyin only), Add to flashcards (deck chosen; card
   = front 你好, back `nǐ hǎo — hello` + optional stroke strip), Convert here
   (simplified ↔ traditional of that occurrence), Insert stroke-order figure (the prefab),
   Add to my words (user dictionary).

---

## 9. Settings and per-note storage

- Global settings (Settings → **Chinese**, a new section; localStorage `notecomplete-zh-*`):
  mode default, script, shortcut, full-width punctuation, tone colours, ruby default and format,
  candidates per page (5/9), show both scripts, phone strip vs floating, download packs now.
- Per note: `chinese: { mode, script, ruby, readings: [...] }`. The project JSON rejects unknown
  keys, so this needs an optional field in `spec/nfedit-v1.md` and the core's project validation
  (omitted when empty, so older versions remain valid, like `study`), and the same key in the
  `.notecomp` `manifest.json`. Until that lands (Phase 3), the per-note values are kept in the
  library entry in IndexedDB (`library.js`), keyed by the note's id.
- Per text box: the mode the box was last typed in, kept in the same per-note map by item id;
  not written into `.noteful`.

---

## 10. Flashcards and Anki

- Cards from the look-up panel and a new "Make vocabulary cards" on a selection of Chinese text
  (every word → card), using `study.js`'s deck model `{ front, back, page }`.
- Anki export (`study.js` `ankiText`, `#html:true` already): front `你好`, back `nǐ hǎo<br>hello`;
  option "Pinyin as ruby" writes `<ruby>你好<rt>nǐ hǎo</rt></ruby>`, and option "Anki furigana
  syntax" writes `你好[nǐhǎo]` for users of Anki's `{{furigana:}}` filter. A third column
  layout (Hanzi / Pinyin / Meaning) as a separate "Chinese vocabulary" export, keeping the
  existing two-field layout for other decks. The MCP `write_anki_deck` gets the same fields only
  if asked (open question).
- Audio (`chinese/speech.js`): no audio data shipped or stored; each 🔊 streams a short clip on
  demand (only the browser's HTTP cache may keep it). Sources, tried in order until one plays:
  1. one character read a known way (the reading used here, a reading in the header, a syllable
     clicked anywhere in the panel): a human recording of that syllable and tone from jsDelivr
     (`davinfifield/mp3-chinese-pinyin-sound`, `hao4.mp3`, ü as v), so polyphones and tones are
     heard exactly; neutral-tone syllables have none and fall through;
  2. words and sentences: online TTS (Google Translate `translate_tts`, zh-CN or zh-TW by the
     note's script; Youdao `dictvoice` when that fails), up to 180 characters;
  3. offline or every online source failed: the system's `zh-CN` / `zh-TW` `speechSynthesis` voice.
  A source that has not started within 6 s is skipped. The panel's 🔊 (`S`, Shift = 70 % speed)
  is shown whenever the app is online or the OS has a Chinese voice; every pinyin syllable in the
  panel plays its own tone on click, each "Words with" row has a small 🔊, and the Chinese menus
  (right-click / long press, a selection) have **Listen to …**. The three hosts are in the CSP's
  `media-src` (`tools/reader-csp.mjs`).

---

## 11. Tests and budgets

**Unit (`node test.mjs`, new files `chinese/*.test.mjs`)**

- `pinyin.test.mjs`: `markTone` for every vowel rule: hao3→hǎo, mei2→méi, xue3→xuě, dou3→dǒu,
  zhou1→zhōu, liu4→liù, jiu3→jiǔ, dui4→duì, hui2→huí, lv4/lu:4/lü4→lǜ, nve4→nüè, ju2→jú (no ü),
  er2→ér, ma5/ma0→ma, ng2→ńg, Ni3→Nǐ; `numbersToMarks("ni3 hao3, Zhong1guo2")`; round trip with
  `marksToNumbers` over all 423×5 forms; `segment`: nihao, xian (xian first, xi'an second),
  xi'an, fangan, zhuang, Xi'an, "zh" partial, invalid "qqq" → null; `splitInput("ni3hao")`.
- `engine.test.mjs` (with a fixture pack of ≈ 200 entries built by the same builder): nihao → 你好
  first; ma3 filter; sentence wobuzhidao; partial choice consumes syllables; user history moves 得
  above 的 after 3 choices; traditional mode ranks 後 for hou4 in 以后; reading weight puts 先
  above 见 for xian.
- `convert.test.mjs`: 头发→頭髮, 发现→發現, 干净→乾淨, 干部→幹部, 以后→以後, 皇后→皇后, round trips.
- `caret.test.mjs`: mirror measurement with a fake layout (pure parts), menu placement flips at
  the keyboard edge and clamps to sides (pure function `placeMenu(caretRect, menuSize, viewport,
  keypadTop)`).
- `ime.test.mjs`: key sequences → buffer/commits (pure reducer `imeReduce(state, key)`), Esc with
  a buffer doesn't reach the box, Backspace after a partial choice, composition stand-down.
- `ruby.test.mjs`: `annotate("我不知道银行在哪里")` readings (行 háng in 银行, 哪里 nǎlǐ), overrides.
- `strokes.test.mjs` + `prefabs/hanzi/test/`: shard lookup, render at step n produces n paths,
  practice scoring accepts the median itself, rejects reversed and wrong strokes.
- Rust: `markdown.rs` ruby tests (§6.3); project JSON with/without `chinese`.
- `tools/build_chinese_data.mjs` self-check: header counts, every entry decodes, a sample of 1 000
  CC-CEDICT lines round-trips, sizes printed and compared with a budget (fail if the core pack
  > 400 KB br or full > 1.4 MB br).
- CSP test (`tools/reader-csp.mjs` test) updated for any new download host.

**End-to-end** (Playwright, like `tools/site_e2e.mjs`, `tools/office_import_e2e.mjs`):
nothing from `vendor/chinese/` is fetched at startup; typing `nihao` + Space in a page text box
gives 你好 and the box saves; Esc with a buffer keeps the box open; the menu follows the caret
across a line and after pinch zoom; clicking a candidate keeps focus; phone viewport (390×844)
docks the strip; the notes panel commit appears in a second collaborator; ruby toggle shows
`rt` in the preview and the page layer; exported PNG of a page with 你好 on a machine without CJK
fonts (container image) shows the glyphs (pixel check that the box is not tofu: compare against
a reference crop); offline (service worker, network blocked) after one use, Hanzi mode still
works.

**Performance budgets** (measured in e2e with `performance.mark` in `ime.js`, logged through
`lag-log.js`):
- keystroke → menu painted: p95 < 16 ms on a mid-range tablet (Chrome on Android 2022, 4× CPU
  throttling in DevTools as the CI proxy); lookup itself < 2 ms.
- first Hanzi candidate after enabling the mode: < 400 ms with the pack cached, < 1.5 s cold.
- worker memory with the full pack: < 25 MB.
- ruby layer for a page with 500 characters: < 30 ms; Markdown preview of 20 000 characters:
  < 80 ms (annotate in the worker, DOM wrap in one pass).
- stroke animation: 60 fps, < 2 ms per frame for 20 strokes.

---

## 12. Phases (each ships on its own)

Effort in focused days for one developer familiar with the codebase; estimates.

**Phase 1 — Pinyin with tone marks, menu skeleton (≈ 4 d).** Ships: Chinese mode toggle (`中` in
the text format bar, notes toolbar, Ctrl+Shift+Space), "Pinyin (marks)" mode everywhere listed in
§5.4: `ni3` → `nǐ` as you type, `v`/`u:` → ü; the floating reading strip at the caret showing the
syllables being typed; Esc/Enter/Backspace; composition stand-down; the Esc-during-composition fix
in `text-box.js`; `pinyin.js` + tests; `caret.js` + `placeMenu`; CJK font stack names in
`fonts.js` and `text.rs`; `wrapText` CJK breaks. No data packs.

**Phase 2 — Hanzi candidates (≈ 7 d).** `tools/build_chinese_data.mjs` + lock file + licences;
`ime-core.bin`, `ime-full.bin` in `vendor/chinese/` (in `LAZY`); `engine.js`, worker, client;
candidate list with numbers, paging, pointer/pen/finger, ruby pinyin above candidates, sentence
candidate, partial choice, simplified/traditional output, full-width punctuation, user dictionary
in IndexedDB, phone docked strip and `beforeinput` path for Latin on-screen keyboards; Settings →
Chinese; About → licences; e2e + perf budget.

**Phase 3 — Reading Chinese: fonts, ruby, exports (≈ 6 d).** Noto Sans SC slices (if approved),
font injection in `pageCanvas()`/`pageSvg()`; the pinyin-over-characters toggle (global + per
note) in Markdown preview, HTML views, study cards and page text boxes (SVG layer), with marks/
numbers and tone colours on `rt`; Export dialog checkbox; Markdown `{漢字|pinyin}` syntax in
`markdown.rs`; `chinese` field in the project JSON / `.notecomp` manifest; pinyin search in Find.

**Phase 4 — Character panel and conversion (≈ 6 d).** `chars.bin` (Unihan + decomposition),
`opencc.bin`, gloss download pack; right-click/long-press entry points in text boxes, Markdown,
PDF/OCR text layer, cards, chat; the panel (§8) without stroke order; "Use this reading here"
overrides; Convert to simplified/traditional on a selection; Add to flashcards; vocabulary cards
from a selection; Anki ruby/furigana options; initials-only input (`bjdx`).

**Phase 5 — Stroke order (≈ 8 d).** Stroke shards + on-demand fetch; `stroke-player.js`; the
shared `prefabs/kit/step-player.js` (coordinate with `feat/algorithms`: whichever lands first
owns it, the other adopts it); the panel's animation and Practice; the `hanzi` prefab module with
"show this step", stroke-sequence strip, grids, MCP `add_prefab` support through its `ai.md`;
candidate menu ▶ popover; practice log.

**Phase 6 — Polish and learning extras (≈ 5 d, pick and choose).** Writing-practice study mode
over a deck; tone sandhi option for ruby; tone colours on characters; HSK-level filter for ruby
(if a licensable list is found); Chinese OCR corrections via the word list; TW/HK variants;
stroke type names; 🔊 pronunciation streamed on demand (§10, `chinese/speech.js`).

Total ≈ 36 days; Phases 1–2 (≈ 11 d) already deliver the owner's request; 3–5 add the later
asks.

---

## 13. Risks

- **OS IMEs and Android keyboards.** `beforeinput` behaviour differs between Gboard, Samsung
  Keyboard and SwiftKey (some compose Latin words too, i.e. `insertCompositionText` for English
  with suggestions on). Mitigation: detect composition and stand down; document "turn off
  suggestions" if needed; test on the owner's devices early in Phase 2.
- **TinyMDE internals**: committing through its API while Yjs sharing is active; caret rects in
  its line DOM. Mitigation: reuse `notes.js` `caretBox` logic and the existing remote-edit path.
- **Text box Esc/blur semantics**: the IME must never commit or discard a box by accident (menu
  pointerdown, Esc). Covered by tests.
- **Licences**: CC BY-SA share-alike on our packs and the APL/LGPL stroke and decomposition data
  must stay separate files with their licence texts; the repository itself has no licence file
  yet, which makes the app's own terms unclear to downstream users.
- **Installer size** (+5 to +10 MB) and the web app's lazy files (none at startup).
- **Ruby layout on pages**: pinyin above the first line of a tight box overlaps content above it;
  exports must use the same measurements; a page not on screen must be laid out to measure.
- **Dictionary quality**: CC-CEDICT is a dictionary, not an IME lexicon; frequencies come from
  subtitles (colloquial bias). Ranking will be good for common words, weaker for technical terms;
  the user dictionary compensates.
- **Fonts in exports**: embedding slices increases PDF size (≈ 50–300 KB per page with Chinese).
- **Stroke data coverage**: ≈ 9 500 characters; rarer ones have none.

## 14. Open questions for the owner

1. **Font**: bundle Noto Sans SC (+4.5 MB per installer; TC fetched on demand), bundle both
   (+9 MB), or rely on system fonts (and accept tofu in exports on machines without CJK fonts)?
2. **Full dictionary in installers** (+1.1 MB br) or only the common 36 k-entry pack (+0.3 MB)
   with the full one downloaded on first use?
3. **Default script**: simplified or traditional? Taiwan/HK variant forms needed?
4. **Shortcut**: Ctrl+Shift+Space OK? Should Shift alone toggle Latin like system IMEs?
5. **Enter with a buffer** in Hanzi mode: commit pinyin with marks (proposed) or the raw letters?
6. **Pinyin over characters** on pages: acceptable that it is a display layer (not stored, not in
   `.noteful`), or should it be written into text boxes as real text for Noteful on the iPad?
7. **Exports**: should exported PDFs keep pinyin when it is on (proposed: checkbox defaulting to
   the view), and printing likewise?
8. **Repository licence**: which licence does NoteComplete use? (CC BY-SA data and APL/LGPL
   stroke data are fine as separate files under most licences, but this should be written down.)
9. **Stroke order**: write our own player (proposed, shares the algorithm step player) or embed
   hanzi-writer (MIT) for speed?
10. **Study**: is HSK-level filtering wanted (needs a list with a usable licence)? Should the MCP
    server's `write_anki_deck` and `add_prefab` learn the Chinese fields?
11. **Learning features order**: after Phase 2, which first — ruby (3), the look-up panel (4) or
    stroke order (5)?

## 15. Owner's answers (2026-11-19) and the module contract

**Answers.**
1. Font: **bundle** Noto Sans SC (the 101 unicode-range slices, lazy on the web, shipped in
   installers). Traditional text uses the same face's coverage plus system fonts.
2. Dictionary: bundle the **common** pack (frequent words + every single character + all HSK 1–3
   words, with short English glosses) and offer **downloadable, deletable expansions by HSK
   level**: HSK 4, HSK 5, HSK 6, HSK 7–9 (Settings → Chinese → Dictionaries). Source of the
   expansions: `drkameleon/complete-hsk-vocabulary` (MIT) `complete.min.json` at commit
   `7ac65bf1a6387d35f1ade478906172a19311c7f9` from `raw.githubusercontent.com` (already allowed by
   the CSP), SHA-256 pinned; each level's words are extracted on the device and kept in IndexedDB.
3. Default script: **simplified** (traditional selectable).
4. Shortcut: **Ctrl+Shift+Space** cycles Off → Hanzi → Pinyin → Off while typing; the `中` button
   does the same; **Shift alone** (press and release) switches to Latin letters temporarily while a
   Chinese mode is on. Both can be turned off in Settings → Chinese.
5. Enter with a buffer follows the **mode and the text around the caret**: Pinyin mode → the
   pinyin with tone marks; Hanzi mode → the pinyin with tone marks when the text before the caret
   on that line already has tone-marked pinyin, otherwise the letters as typed (as system IMEs do,
   so English words can be typed without switching off). Shift+Enter always writes the letters as
   typed. Setting: Auto (default) / Letters / Pinyin with marks.
6. Pinyin over characters: as proposed (a display layer; the per-note on/off is saved in the note;
   exports keep it when it is on, with a checkbox in the Export dialog).
7. Licence: **MIT** for the app (`LICENSE`); data packs keep their own licences beside them.
8. Stroke player: our own (pure `render(spec)` for the prefab), hanzi-writer's technique.
9. HSK: levels are shown on candidates and in the character panel; the bundled pack is the
   beginner set (HSK 1–3), the expansions take it up to HSK 7–9. Ruby can be limited to words
   above a chosen level.
10. After phase 2: all of phases 3–6.

**Module contract** (`apps/reader/chinese/`):

| File | Owner area | Exports |
|---|---|---|
| `pinyin.js` | input | `SYLLABLES`, `normalise`, `markTone`, `numbersToMarks`, `marksToNumbers`, `segment`, `splitInput` (§4.2); pure, main + worker + Node |
| `engine.js` | data | pure pack decoding and search, used by the worker and Node tests |
| `engine-worker.js`, `client.js` | data | `chinese()` singleton (below) |
| `convert.js` | data | `convertText(text, "s2t"\|"t2s", tables)` pure |
| `user-dict.js`, `packs.js` | data | user dictionary; expansion download/delete |
| `caret.js`, `ime.js`, `ime-menu.js`, `settings.js` | input | `attachIme(el, opts)`, `chineseField(el)`, `zhSettings()` |
| `ruby.js`, `fonts.js` | reading | ruby layers; CJK font loading and export embedding |
| `strokes.js`, `stroke-player.js`, `practice.js`, `prefabs/hanzi/` | strokes | stroke data, player, practice, prefab |
| `lookup-panel.js` | panel | the character panel |

`client.js` (`import {chinese} from "./chinese/client.js"`; every method is async and starts the
worker on first use):

```js
chinese().candidates(input, {script, limit=60})
  // → {reading: "nǐ hǎo", rest: "", items: [{text, pinyin /*marked, spaced*/, consumed /*input chars used*/,
  //     level /*1–7 or 0*/, gloss /*short or ""*/, sentence /*bool*/}]}
chinese().choose(input, item, script)          // learn (user dictionary)
chinese().annotate(text, {script})            // → [{start, end, text, pinyin: ["nǐ","hǎo"], level}] for Han runs
chinese().lookup(textOrChar, {script})        // → {entries:[{simp, trad, pinyin, gloss:[], level}], char?:{readings,
  //     strokes, radical, variants:{simp,trad}, decomposition}, words:[{text,pinyin,gloss,level}]}
chinese().convert(text, "s2t"|"t2s")          // → string
chinese().packs()                             // → [{id, name, levels, bundled, installed, words, bytes}]
chinese().installPack(id, onProgress) / removePack(id)
```
