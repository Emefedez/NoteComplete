import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTarNoteRecordings,
  discoverNoteRecordings,
  transcriptCacheKey,
} from './batch-transcribe.js';
import {
  embedPrefabSpecInSvg,
  extractPrefabSpecFromDataUri,
  markdownTraceBlockFor,
} from './chinese/zh-menu.js';
import { decorateTinyMdeLines } from './notes.js';

describe('batch-transcribe recording discovery', () => {
  it('computes deterministic SHA-256 transcript cache keys matching transcript.js', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const res = await transcriptCacheKey(bytes, {
      backend: 'whisper',
      model: 'base',
      language: 'es',
      settings: { silence: true },
    });
    assert.ok(res.key.startsWith('whisper-v2:base:es:{"silence":true}:'));
    assert.equal(res.effectiveModel, 'base');
  });

  it('rejects non-audio files in discoverNoteRecordings', async () => {
    const recs = await discoverNoteRecordings({ name: 'lecture.pdf', source: 'local' }, {
      open: async () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'lecture.pdf'),
    });
    assert.deepEqual(recs, []);
  });

  it('extracts added_audio recordings from a .nfedit tar package', async () => {
    const makeTarEntry = (name, payload) => {
      const header = new Uint8Array(512);
      const enc = new TextEncoder();
      header.set(enc.encode(name), 0);
      header.set(enc.encode('0000644\0'), 100);
      header.set(enc.encode(payload.length.toString(8).padStart(11, '0') + '\0'), 124);
      header[156] = 48; // '0' regular file
      header.set(enc.encode('ustar\0'), 257);
      header.fill(32, 148, 156);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += header[i];
      header.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
      const pad = (512 - (payload.length % 512)) % 512;
      const out = new Uint8Array(512 + payload.length + pad);
      out.set(header, 0);
      out.set(payload, 512);
      return out;
    };
    const manifestJson = new TextEncoder().encode(JSON.stringify({
      added_audio: [{ id: 'rec1', name: 'Lecture Part 1', duration: 42, mime: 'audio/mp4' }],
    }));
    const e1 = makeTarEntry('manifest.json', manifestJson);
    const e2 = makeTarEntry('audio/0', new Uint8Array([1, 2, 3, 4, 5, 6]));
    const tar = new Uint8Array(e1.length + e2.length + 1024);
    tar.set(e1, 0);
    tar.set(e2, e1.length);
    const read = async (a, b) => tar.subarray(a, b);
    const recs = await readTarNoteRecordings(read, tar.length);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].id, 'added:rec1');
    assert.equal(recs[0].name, 'Lecture Part 1');
    assert.equal((await recs[0].readBytes()).length, 6);
  });
});

describe('Markdown trace prefab insertion & medallion decoration', () => {
  it('returns empty string for empty or space-only input so invalid prefabs are never generated', async () => {
    assert.equal(await markdownTraceBlockFor(''), '');
    assert.equal(await markdownTraceBlockFor('   '), '');
    assert.equal(await markdownTraceBlockFor('hello 123'), '');
  });

  it('embeds and extracts prefab spec from SVG data URI for right-click editing', () => {
    const spec = { type: 'hanzi', text: '漢字', show: 'steps', grid: 'mi' };
    const svg = embedPrefabSpecInSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', spec);
    const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    const parsed = extractPrefabSpecFromDataUri(uri, 'Stroke order 漢字');
    assert.deepEqual(parsed, spec);
  });

  it('tags TinyMDE lines containing prefab SVG data URIs with data-prefab medallion label', () => {
    const line1 = { textContent: '<!-- page 3 -->', dataset: {} };
    const line2 = { textContent: '![Stroke order 你好 · nǐ hǎo · hello](data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E)', dataset: {} };
    const line3 = { textContent: 'Regular markdown text', dataset: { prefab: 'old' } };
    decorateTinyMdeLines({ children: [line1, line2, line3] });
    assert.equal(line1.dataset.page, '3');
    assert.equal(line2.dataset.prefab, 'Stroke order 你好 · nǐ hǎo · hello');
    assert.equal(line3.dataset.prefab, undefined);
  });
});
