import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSlices, slicesFor, embeddedFontCss, HAN } from './fonts.js';
import { CJK_SANS, CJK_SERIF } from '../fonts.js';

const css = `/* a */
@font-face { font-family: 'Noto Sans SC'; src: url(./noto-sans-sc/a.woff2) format('woff2'); unicode-range: U+4f60,U+597d-597f; }
@font-face { font-family: 'Noto Sans SC'; src: url(./noto-sans-sc/b.woff2) format('woff2'); unicode-range: U+4e2d,U+3002; }
@font-face { font-family: 'Noto Sans SC'; src: url(./noto-sans-sc/latin.woff2) format('woff2'); unicode-range: U+0000-00ff; }`;

test('slices: the ones holding the CJK characters, never the Latin one', () => {
  const slices = parseSlices(css, 'https://x/vendor/fonts/noto-sans-sc.css');
  assert.equal(slices.length, 3);
  assert.equal(slices[0].url, 'https://x/vendor/fonts/noto-sans-sc/a.woff2');
  assert.deepEqual(slices[0].ranges, [[0x4f60, 0x4f60], [0x597d, 0x597f]]);
  assert.deepEqual(slicesFor('Hello 你好', slices).map(s => s.url.split('/').pop()), ['a.woff2']);
  assert.deepEqual(slicesFor('中。好', slices).map(s => s.url.split('/').pop()), ['a.woff2', 'b.woff2']);
  assert.deepEqual(slicesFor('plain', slices), []);
});

test('the real stylesheet (when built) covers common characters', { skip: !(() => { try { readFileSync(new URL('../vendor/fonts/noto-sans-sc.css', import.meta.url)); return true; } catch { return false; } })() }, () => {
  const slices = parseSlices(readFileSync(new URL('../vendor/fonts/noto-sans-sc.css', import.meta.url), 'utf8'));
  assert.equal(slices.length, 101);
  const needed = slicesFor('我不知道银行在哪里。', slices);
  assert.ok(needed.length >= 1 && needed.length <= 6, `${needed.length}`);
});

test('embedded CSS: data: URLs of the needed slices only, nothing without Chinese', async () => {
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(String(url).split('/').pop());
    return String(url).endsWith('.css') ? { ok: true, text: async () => css } : { ok: true, arrayBuffer: async () => new Uint8Array([119, 79, 70, 50]).buffer };
  };
  assert.equal(await embeddedFontCss('no Chinese', { fetch }), '');
  const out = await embeddedFontCss('你', { fetch });
  assert.match(out, /^@font-face\{font-family:'Noto Sans SC';[^}]*src:url\(data:font\/woff2;base64,d09GMg==\)[^}]*unicode-range:U\+4f60,U\+597d-597f\}$/);
  assert.deepEqual(fetched, ['noto-sans-sc.css', 'a.woff2']);
  assert.ok(HAN.test('漢') && !HAN.test('かな'));
});

test('the CJK faces are the ones the core names (text.rs text_svg)', () => {
  const rust = readFileSync(new URL('../../../crates/noteful-core/src/text.rs', import.meta.url), 'utf8').replace(/"\s*\n\s*"/g, '');
  assert.ok(rust.includes(`const CJK_SANS: &str =\n    "${CJK_SANS}"`) || rust.includes(`"${CJK_SANS}"`), 'CJK_SANS differs');
  assert.ok(rust.includes(`"${CJK_SERIF}"`), 'CJK_SERIF differs');
});
