// Offline progressive QR code transfer for small payloads (quizzes, flashcard decks,
// study packs, Anki exports). Splits compressed JSON into self-verified chunks (`NCQR1|...`)
// so two devices can transfer without Internet, local servers, or files.
import { icon } from './icons.js';

const PREFIX = 'NCQR1';
const DEFAULT_MAX_CHUNK = 220;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let qrLoading = null;
/** Lazily renders a crisp crisp SVG QR code with white quiet-zone padding. */
export async function renderQrSvg(text) {
  const { default: qrcode } = await (qrLoading ||= import('./vendor/qrcode/qrcode.mjs'));
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

/** Standard IEEE 802.3 CRC-32 as 8 lowercase hex digits. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function base64UrlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4 || 4).replace(/^===$/, '');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function runStream(bytes, StreamCtor, format) {
  const stream = new StreamCtor(format);
  // Drain readable concurrently with writing/closing writable so transform backpressure cannot deadlock.
  const reading = (async () => {
    const chunks = [];
    const reader = stream.readable.getReader();
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  })();
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  const [out] = await Promise.all([reading, writing]);
  return out;
}

export async function deflateRaw(rawBytes) {
  if (typeof CompressionStream !== 'function') throw Error('Compression is not supported on this device.');
  return runStream(rawBytes, CompressionStream, 'deflate-raw');
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw Error('Decompression is not supported on this device.');
  return runStream(bytes, DecompressionStream, 'deflate-raw');
}

async function compressPayload(rawBytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const zipped = await deflateRaw(rawBytes);
      if (zipped.byteLength < rawBytes.byteLength) return { mode: 'z', bytes: zipped };
    } catch { /* Fall back to uncompressed when deflate-raw is unsupported. */ }
  }
  return { mode: 'r', bytes: rawBytes };
}

async function decompressPayload(mode, bytes) {
  if (mode === 'r') return bytes;
  if (mode !== 'z') throw Error('Unsupported QR encoding.');
  if (typeof DecompressionStream !== 'function') throw Error('This device cannot open compressed QR transfers.');
  return inflateRaw(bytes);
}

function randomId() {
  const buf = new Uint8Array(3);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < 3; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encodes any JSON-serializable envelope into ordered `NCQR1` QR frame strings.
 * Multi-frame transfers include an Info QR (`0/<total>`) with title/kind/byte count/
 * segment total, followed strictly by data segments `1/<total>` .. `<total>/<total>`.
 * @param {unknown} envelope
 * @param {{ maxChunk?: number, id?: string, compress?: boolean }} [options]
 */
export async function encodeQrFrames(envelope, { maxChunk = DEFAULT_MAX_CHUNK, id = randomId(), compress = true } = {}) {
  const chunkLimit = Math.max(40, Math.floor(maxChunk));
  const rawBytes = encoder.encode(JSON.stringify(envelope));
  const { mode, bytes } = compress ? await compressPayload(rawBytes) : { mode: 'r', bytes: rawBytes };
  const encoded = mode + base64UrlEncode(bytes);
  const crc = crc32(encoder.encode(encoded));
  const total = Math.max(1, Math.ceil(encoded.length / chunkLimit));
  const frames = [];
  for (let i = 0; i < total; i++) {
    const part = encoded.slice(i * chunkLimit, (i + 1) * chunkLimit);
    frames.push(`${PREFIX}|${id}|${i + 1}/${total}|${crc}|${part}`);
  }
  const meta = total > 1
    ? {
        v: 2,
        kind: envelope?.kind || 'study',
        title: describeQrEnvelope(envelope),
        name: String(envelope?.name || envelope?.pack?.title || ''),
        rawBytes: rawBytes.byteLength,
        segments: total,
        compressed: mode === 'z',
      }
    : null;
  const infoFrame = meta
    ? `${PREFIX}|${id}|0/${total}|${crc}|${base64UrlEncode(encoder.encode(JSON.stringify(meta)))}`
    : null;
  const streamFrames = infoFrame ? [infoFrame, ...frames] : [...frames];
  return {
    id,
    frames,
    infoFrame,
    streamFrames,
    meta,
    total,
    crc,
    rawBytes: rawBytes.byteLength,
    encodedBytes: encoded.length,
    compressed: mode === 'z',
  };
}

/** Parses one `NCQR1|<id>|<index>/<total>|<crc32>|<data>` frame (`index === 0` is info) or returns null. */
export function parseQrFrame(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(`${PREFIX}|`)) return null;
  const parts = raw.split('|');
  if (parts.length !== 5) return null;
  const [, id, frac, crc, data] = parts;
  if (!/^[a-zA-Z0-9_-]{2,24}$/.test(id) || !/^[0-9a-f]{8}$/.test(crc)) return null;
  const match = /^(\d+)\/(\d+)$/.exec(frac);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || index > total) return null;
  return { id, index, total, crc, data };
}

function decodeInfoMeta(data) {
  try {
    const json = JSON.parse(decoder.decode(base64UrlDecode(data)));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function missingSlots(parts) {
  const missing = [];
  for (let i = 0; i < parts.length; i++) if (parts[i] === null) missing.push(i + 1);
  return missing;
}

/** Reassembles multi-frame `NCQR1` QR scans strictly into their numbered slots, tracking skipped/missing segments. */
export class QrReceiver {
  constructor() {
    this.transfers = new Map();
    this.activeId = null;
  }

  /**
   * Processes one scanned QR string.
   * Returns `{ ignored: true }` if the QR is not an `NCQR1` frame.
   */
  async accept(raw) {
    const frame = parseQrFrame(raw);
    if (!frame) return { ignored: true };
    let state = this.transfers.get(frame.id);
    if (!state || state.total !== frame.total || state.crc !== frame.crc) {
      state = {
        id: frame.id,
        total: frame.total,
        crc: frame.crc,
        meta: null,
        infoSeen: false,
        parts: new Array(frame.total).fill(null),
        received: 0,
        lastIndex: 0,
        wrapped: false,
        skipped: new Set(),
      };
      this.transfers.set(frame.id, state);
    }
    this.activeId = frame.id;

    if (frame.index === 0) {
      const duplicate = state.infoSeen;
      state.infoSeen = true;
      const meta = decodeInfoMeta(frame.data);
      if (meta) state.meta = meta;
      if (state.lastIndex > 0 && state.received < state.total) {
        state.wrapped = true;
        for (const s of missingSlots(state.parts)) state.skipped.add(s);
      }
      state.lastIndex = 0;
      const missing = missingSlots(state.parts);
      return {
        ignored: false,
        kind: 'info',
        index: 0,
        duplicate,
        transferId: state.id,
        meta: state.meta,
        received: state.received,
        total: state.total,
        missing,
        skipped: [...state.skipped].filter((n) => state.parts[n - 1] === null).sort((a, b) => a - b),
        wrapped: state.wrapped,
        done: false,
      };
    }

    const slot = frame.index - 1;
    const duplicate = state.parts[slot] !== null;
    if (!duplicate) {
      state.parts[slot] = frame.data;
      state.received++;
    }
    state.skipped.delete(frame.index);
    if (state.lastIndex > 0 && state.received < state.total) {
      if (frame.index < state.lastIndex) {
        state.wrapped = true;
        for (const s of missingSlots(state.parts)) state.skipped.add(s);
      } else if (frame.index > state.lastIndex + 1) {
        for (let s = state.lastIndex + 1; s < frame.index; s++) {
          if (state.parts[s - 1] === null) state.skipped.add(s);
        }
      }
    }
    state.lastIndex = frame.index;

    const missing = missingSlots(state.parts);
    const skipped = [...state.skipped].filter((n) => state.parts[n - 1] === null).sort((a, b) => a - b);
    const receivedSlots = [];
    for (let i = 0; i < state.parts.length; i++) if (state.parts[i] !== null) receivedSlots.push(i + 1);

    if (state.received < state.total) {
      return {
        ignored: false,
        kind: 'segment',
        index: frame.index,
        duplicate,
        transferId: state.id,
        meta: state.meta,
        received: state.received,
        total: state.total,
        receivedSlots,
        missing,
        skipped,
        wrapped: state.wrapped,
        done: false,
      };
    }

    const joined = state.parts.join('');
    if (crc32(encoder.encode(joined)) !== state.crc) {
      this.transfers.delete(frame.id);
      return {
        ignored: false,
        kind: 'segment',
        index: frame.index,
        duplicate: false,
        transferId: state.id,
        meta: state.meta,
        received: 0,
        total: state.total,
        receivedSlots: [],
        missing: Array.from({ length: state.total }, (_, i) => i + 1),
        skipped: [],
        wrapped: false,
        done: false,
        error: 'Checksum mismatch — resetting this transfer. Keep scanning.',
      };
    }
    try {
      const mode = joined[0];
      const compressedBytes = base64UrlDecode(joined.slice(1));
      const rawBytes = await decompressPayload(mode, compressedBytes);
      const payload = JSON.parse(decoder.decode(rawBytes));
      this.transfers.delete(frame.id);
      return {
        ignored: false,
        kind: 'segment',
        index: frame.index,
        duplicate,
        transferId: state.id,
        meta: state.meta,
        received: state.total,
        total: state.total,
        receivedSlots: Array.from({ length: state.total }, (_, i) => i + 1),
        missing: [],
        skipped: [],
        wrapped: state.wrapped,
        done: true,
        bytes: rawBytes.byteLength,
        payload,
      };
    } catch (e) {
      this.transfers.delete(frame.id);
      return {
        ignored: false,
        kind: 'segment',
        index: frame.index,
        duplicate: false,
        transferId: state.id,
        meta: state.meta,
        received: 0,
        total: state.total,
        receivedSlots: [],
        missing: Array.from({ length: state.total }, (_, i) => i + 1),
        skipped: [],
        wrapped: false,
        done: false,
        error: e?.message || 'Could not decode QR transfer.',
      };
    }
  }
}

export function describeQrEnvelope(envelope) {
  if (envelope?.kind === 'note') return envelope.name ? `Note “${envelope.name}”` : 'note file';
  if (envelope?.kind === 'file') return envelope.name ? `“${envelope.name}”` : 'file';
  if (envelope?.kind === 'anki') return `Anki deck “${envelope.name || 'Study'}”`;
  if (envelope?.kind === 'study' && envelope.pack) {
    const { decks = [], quizzes = [], notes = '' } = envelope.pack;
    const bits = [];
    if (decks.length) bits.push(`${decks.length} deck${decks.length === 1 ? '' : 's'}`);
    if (quizzes.length) bits.push(`${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}`);
    if (notes) bits.push('notes');
    return bits.join(', ') || envelope.pack.title || 'study material';
  }
  return 'study transfer';
}

function makeEl(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k in node) node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids);
  return node;
}

export function formatEtaSeconds(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (sec < 60) return `~${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `~${mins}m ${rem}s` : `~${mins}m`;
}

export function estimateQrRemainingSeconds(currentIndex, totalSegments, intervalMs = 260) {
  const total = Math.max(0, Number(totalSegments) || 0);
  const ms = Math.max(40, Number(intervalMs) || 260);
  if (total <= 1) return 0;
  const idx = Math.max(0, Number(currentIndex) || 0);
  const remainingFrames = idx === 0 ? total : Math.max(0, total - idx);
  return remainingFrames === 0 ? 0 : Math.max(1, Math.ceil((remainingFrames * ms) / 1000));
}

/**
 * Displays a modal QR transfer: single static QR when compact, or for multi-segment
 * transfers shows the Info QR (`0/N`) first with a Start button before cycling strictly
 * ordered segment QRs (`1/N` .. `N/N`).
 */
export async function showQrTransfer({ title, subtitle, payload, onDownloadFallback, fallbackLabel = 'Save as file instead', status }) {
  const encoded = await encodeQrFrames(payload);
  const frames = encoded.streamFrames;
  const multi = encoded.total > 1;
  let index = 0;
  let playing = false;
  let started = false;
  let intervalMs = 260;
  let timer = null;

  const headingId = `qrTxTitle-${encoded.id}`;
  const qrBox = makeEl('div', { className: 'collab-qr qr-stream-box' });
  const frameText = makeEl('p', { className: 'qr-progress-label' });
  const etaText = makeEl('p', { className: 'qr-eta-label' });
  const progress = makeEl('progress', { className: 'qr-progress-bar', max: encoded.total, value: 0 });
  const sizeNote = makeEl('p', {
    className: 'muted',
    textContent: `${describeQrEnvelope(payload)} · ${(encoded.rawBytes / 1024).toFixed(1)} KB JSON → ${encoded.total} segment${encoded.total === 1 ? '' : 's'}${encoded.compressed ? ' (compressed)' : ''} · works completely offline`,
  });

  const updateEta = () => {
    if (!multi) {
      etaText.hidden = true;
      return;
    }
    etaText.hidden = false;
    const rate = Math.max(1, Math.round(1000 / intervalMs));
    const cycleSec = Math.max(1, Math.ceil((frames.length * intervalMs) / 1000));
    const remSec = estimateQrRemainingSeconds(index, encoded.total, intervalMs);
    if (!started) {
      etaText.textContent = `Expected pass time: ${formatEtaSeconds(cycleSec)} at ${rate} QR/s (${frames.length} frames)`;
    } else if (index === 0) {
      etaText.textContent = `Cycle time: ${formatEtaSeconds(cycleSec)} · ${encoded.total} segments in pass`;
    } else if (remSec === 0) {
      etaText.textContent = `End of pass · restarting Info QR (${formatEtaSeconds(cycleSec)}/cycle)`;
    } else {
      etaText.textContent = `${formatEtaSeconds(remSec)} left in pass (${formatEtaSeconds(cycleSec)}/cycle · ${rate} QR/s)`;
    }
  };

  const svgs = new Array(frames.length).fill(null);
  const showFrame = async (next) => {
    index = ((next % frames.length) + frames.length) % frames.length;
    progress.value = multi ? (index === 0 ? 0 : index) : 1;
    if (!multi) {
      frameText.textContent = 'Single QR code · point the other NoteComplete’s camera here';
    } else if (index === 0) {
      frameText.textContent = started
        ? `Info QR (0/${encoded.total}) · Note info & segment count`
        : `Info QR (0/${encoded.total}) · Let receiver scan this first, then press Start`;
    } else {
      const pct = Math.round((index / encoded.total) * 100);
      frameText.textContent = `Segment ${index} of ${encoded.total} (${pct}%)`;
    }
    updateEta();
    if (!svgs[index]) svgs[index] = await renderQrSvg(frames[index]);
    if (qrBox.isConnected || index === 0) qrBox.innerHTML = svgs[index];
  };

  const restartTimer = () => {
    clearInterval(timer);
    timer = null;
    if (playing && multi) timer = setInterval(() => { void showFrame(index + 1); }, intervalMs);
  };

  const controls = [];
  if (multi) {
    const playBtn = makeEl('button', {
      type: 'button',
      className: 'icon-button primary',
      title: 'Start cycling segment QR codes',
      'aria-label': 'Start',
      onclick: () => {
        playing = !playing;
        if (playing) {
          const firstStart = !started;
          started = true;
          playBtn.className = 'icon-button';
          playBtn.title = 'Pause';
          playBtn.setAttribute('aria-label', 'Pause');
          playBtn.replaceChildren(icon('pause'));
          if (firstStart && index === 0) void showFrame(1);
          else updateEta();
        } else {
          playBtn.className = 'icon-button primary';
          playBtn.title = 'Resume';
          playBtn.setAttribute('aria-label', 'Resume');
          playBtn.replaceChildren(icon('play'));
        }
        restartTimer();
      },
    }, icon('play'));
    const infoBtn = makeEl('button', { type: 'button', title: 'Jump back to the info QR', onclick: () => { void showFrame(0); } }, icon('note'), makeEl('span', { textContent: 'Info (0)' }));
    const prevBtn = makeEl('button', { type: 'button', className: 'icon-button', title: 'Previous QR frame', 'aria-label': 'Previous', onclick: () => { void showFrame(index - 1); } }, icon('arrowLeft'));
    const nextBtn = makeEl('button', { type: 'button', className: 'icon-button', title: 'Next QR frame', 'aria-label': 'Next', onclick: () => { void showFrame(index + 1); } }, icon('arrowRight'));
    const speedSel = makeEl('select', { 'aria-label': 'QR frame speed', className: 'qr-speed-select' },
      makeEl('option', { value: '500', textContent: 'Slow (2/s)' }),
      makeEl('option', { value: '260', textContent: 'Normal (4/s)', selected: true }),
      makeEl('option', { value: '160', textContent: 'Fast (6/s)' }));
    speedSel.onchange = () => { intervalMs = Number(speedSel.value) || 260; updateEta(); restartTimer(); };
    controls.push(playBtn, infoBtn, prevBtn, nextBtn, speedSel);
  }

  const actions = makeEl('div', { className: 'dialog-actions' });
  if (onDownloadFallback) {
    actions.append(makeEl('button', {
      type: 'button',
      onclick: async () => { dialog.close(); await onDownloadFallback(); },
    }, icon('save'), makeEl('span', { textContent: fallbackLabel })));
  }
  actions.append(makeEl('button', { type: 'button', className: multi ? '' : 'primary', onclick: () => dialog.close() }, icon('check'), makeEl('span', { textContent: 'Done' })));

  const dialog = makeEl('dialog', { className: 'ocr-dialog collab-dialog', 'aria-labelledby': headingId },
    makeEl('h2', { id: headingId, textContent: title || 'Share via QR' }),
    subtitle ? makeEl('p', { className: 'muted', textContent: subtitle }) : '',
    makeEl('div', { className: 'qr-transfer-stage' },
      qrBox,
      makeEl('div', { className: 'qr-transfer-meta' },
        frameText,
        multi ? etaText : '',
        multi ? progress : '',
        sizeNote,
        controls.length ? makeEl('div', { className: 'qr-stream-controls' }, ...controls) : '')),
    actions);

  await showFrame(0);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    clearInterval(timer);
    timer = null;
    dialog.remove();
  }, { once: true });
  dialog.showModal();
  if (multi) {
    // Pre-render the first batch quietly while waiting for the user to press Start.
    for (let i = 1; i < Math.min(frames.length, 16); i++) svgs[i] = await renderQrSvg(frames[i]);
  }
  status?.(multi
    ? `Ready: Info QR + ${encoded.total} segments for ${describeQrEnvelope(payload)}. Press Start when the receiver is aimed.`
    : `Ready: 1 QR frame for ${describeQrEnvelope(payload)}.`);
  return encoded;
}
