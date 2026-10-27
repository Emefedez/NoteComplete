// Transcription backends outside the reader's on-device Whisper:
//   voxtype      local whisper.cpp through the voxtype CLI (WAV 16 kHz mono, text only)
//   antigravity  Gemini through the user's Antigravity CLI (audio leaves the device)
// ffmpeg splits the recording so each piece gets its start time and the
// reader can show text while the rest is still being transcribed.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PIECE = { voxtype: 30, antigravity: 600 };
const PARALLEL = { voxtype: 1, antigravity: 3 };

function run(binary, args, { cwd, timeout = 15 * 60 * 1000, input = null, kill } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    kill?.(child);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(Error('Transcription stopped.'));
      else if (code) reject(Error(`${path.basename(binary)} failed: ${(err || out).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`));
      else resolve(out);
    });
    child.stdin.end(input ?? undefined);
  });
}

// Voxtype prints log lines before the text; the transcript is what follows the last log line.
export function voxtypeText(output) {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  const text = lines.filter(l => !/^(Loading audio file|Audio format|Processing \d+ samples|whisper_|ggml_|\[)/.test(l));
  return text.join(' ').trim();
}

export function geminiSegments(response, offset) {
  const json = response.slice(response.indexOf('{'), response.lastIndexOf('}') + 1);
  const value = JSON.parse(json);
  return (value.segments || []).filter(s => typeof s?.text === 'string' && s.text.trim() && Number.isFinite(s.start))
    .map(s => ({ start: offset + s.start, end: offset + (Number.isFinite(s.end) ? s.end : s.start), text: s.text.trim() }));
}

export function transcriber({ tools }) {
  const running = new Map();
  return {
    async backends() {
      const found = await tools();
      return [
        { id: 'voxtype', label: 'Voxtype (local whisper.cpp)', available: !!(found.voxtype && found.ffmpeg) },
        { id: 'antigravity', label: 'Gemini via Antigravity (cloud)', available: !!(found.antigravity && found.ffmpeg) },
      ];
    },
    cancel(owner) { for (const child of running.get(owner) || []) child.kill('SIGTERM'); },
    // Returns segments [{start, end, text}]; `progress(done, total, segments)` streams pieces as they finish.
    async run(owner, { backend, bytes, language = '' }, progress = () => {}) {
      if (!PIECE[backend]) throw Error('Unknown transcription backend.');
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error('No audio to transcribe.');
      const found = await tools();
      if (!found.ffmpeg) throw Error('ffmpeg is needed to prepare the audio.');
      const binary = backend === 'voxtype' ? found.voxtype : found.antigravity;
      if (!binary) throw Error(`${backend === 'voxtype' ? 'Voxtype' : 'Antigravity'} was not found.`);
      const dir = await mkdtemp(path.join(tmpdir(), 'notecomplete-asr-'));
      const children = new Set();
      running.set(owner, children);
      try {
        await writeFile(path.join(dir, 'recording'), bytes);
        const ext = backend === 'voxtype' ? 'wav' : 'ogg';
        const codec = backend === 'voxtype' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libopus', '-b:a', '24k'];
        await run(found.ffmpeg, ['-loglevel', 'error', '-y', '-i', 'recording', '-ac', '1', '-ar', '16000', ...codec, '-f', 'segment', '-segment_time', String(PIECE[backend]), `piece-%04d.${ext}`], { cwd: dir, kill: c => children.add(c) });
        const pieces = (await readdir(dir)).filter(f => f.startsWith('piece-')).sort();
        const results = new Array(pieces.length);
        let next = 0, done = 0;
        const worker = async () => {
          while (next < pieces.length) {
            const i = next++, file = path.join(dir, pieces[i]), offset = i * PIECE[backend];
            if (backend === 'voxtype') {
              const text = voxtypeText(await run(binary, ['-q', 'transcribe', file], { cwd: dir, kill: c => children.add(c) }));
              results[i] = text ? [{ start: offset, end: offset + PIECE.voxtype, text }] : [];
            } else {
              const prompt = `Transcribe the audio file ${file} exactly, in its spoken language${language ? ` (${language})` : ''}. Times are seconds from the start of this file. Reply with ONLY JSON: {"segments":[{"start":0.0,"end":0.0,"text":"…"}]}`;
              const out = await run(binary, ['-p', prompt, '--output-format', 'json', '--add-dir', dir, '--print-timeout', '900s'], { cwd: dir, kill: c => children.add(c) });
              results[i] = geminiSegments(JSON.parse(out).response, offset);
            }
            done++;
            progress(done, pieces.length, results.flat().filter(Boolean));
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL[backend], pieces.length) }, worker));
        return results.flat();
      } finally {
        running.delete(owner);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
