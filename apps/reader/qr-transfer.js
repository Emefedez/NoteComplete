// Offline progressive QR code transfer for small payloads (quizzes, flashcard decks,
// study packs, Anki exports). Splits compressed JSON into self-verified chunks (`NCQR1|...`)
// so two devices can transfer without Internet, local servers, or files.

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
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
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
}

async function compressPayload(rawBytes) {
  if (typeof CompressionStream === 'function') {
    try {
      const zipped = await runStream(rawBytes, CompressionStream, 'deflate-raw');
      if (zipped.byteLength < rawBytes.byteLength) return { mode: 'z', bytes: zipped };
    } catch { /* Fall back to uncompressed when deflate-raw is unsupported. */ }
  }
  return { mode: 'r', bytes: rawBytes };
}

async function decompressPayload(mode, bytes) {
  if (mode === 'r') return bytes;
  if (mode !== 'z') throw Error('Unsupported QR encoding.');
  if (typeof DecompressionStream !== 'function') throw Error('This device cannot open compressed QR transfers.');
  return runStream(bytes, DecompressionStream, 'deflate-raw');
}

function randomId() {
  const buf = new Uint8Array(3);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < 3; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encodes any JSON-serializable envelope into 1 or more `NCQR1` QR frame strings.
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
  return {
    id,
    frames,
    total,
    crc,
    rawBytes: rawBytes.byteLength,
    encodedBytes: encoded.length,
    compressed: mode === 'z',
  };
}

/** Parses one `NCQR1|<id>|<index>/<total>|<crc32>|<data>` frame or returns null. */
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
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) return null;
  return { id, index, total, crc, data };
}

/** Reassembles multi-frame `NCQR1` QR scans in arbitrary order with CRC verification. */
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
      state = { id: frame.id, total: frame.total, crc: frame.crc, parts: new Array(frame.total).fill(null), received: 0 };
      this.transfers.set(frame.id, state);
    }
    this.activeId = frame.id;
    const duplicate = state.parts[frame.index - 1] !== null;
    if (!duplicate) {
      state.parts[frame.index - 1] = frame.data;
      state.received++;
    }
    if (state.received < state.total) {
      return {
        ignored: false,
        duplicate,
        transferId: state.id,
        received: state.received,
        total: state.total,
        done: false,
      };
    }
    const joined = state.parts.join('');
    if (crc32(encoder.encode(joined)) !== state.crc) {
      this.transfers.delete(frame.id);
      return {
        ignored: false,
        duplicate: false,
        transferId: state.id,
        received: 0,
        total: state.total,
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
        duplicate,
        transferId: state.id,
        received: state.total,
        total: state.total,
        done: true,
        bytes: rawBytes.byteLength,
        payload,
      };
    } catch (e) {
      this.transfers.delete(frame.id);
      return {
        ignored: false,
        duplicate: false,
        transferId: state.id,
        received: 0,
        total: state.total,
        done: false,
        error: e?.message || 'Could not decode QR transfer.',
      };
    }
  }
}

export function describeQrEnvelope(envelope) {
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

/**
 * Displays a modal QR stream (single static QR when compact, animated progressive QR
 * carousel with play/pause, speed, and manual stepping when multi-frame).
 */
export async function showQrTransfer({ title, subtitle, payload, onDownloadFallback, fallbackLabel = 'Save as file instead', status }) {
  const encoded = await encodeQrFrames(payload);
  let index = 0;
  let playing = encoded.total > 1;
  let intervalMs = 260;
  let timer = null;

  const headingId = `qrTxTitle-${encoded.id}`;
  const qrBox = makeEl('div', { className: 'collab-qr qr-stream-box' });
  const frameText = makeEl('p', { className: 'qr-progress-label' });
  const progress = makeEl('progress', { className: 'qr-progress-bar', max: encoded.total, value: 1 });
  const sizeNote = makeEl('p', {
    className: 'muted',
    textContent: `${describeQrEnvelope(payload)} · ${(encoded.rawBytes / 1024).toFixed(1)} KB JSON → ${encoded.total} QR frame${encoded.total === 1 ? '' : 's'}${encoded.compressed ? ' (compressed)' : ''} · works completely offline`,
  });

  const svgs = new Array(encoded.total).fill(null);
  const showFrame = async (next) => {
    index = ((next % encoded.total) + encoded.total) % encoded.total;
    progress.value = index + 1;
    const pct = Math.round(((index + 1) / encoded.total) * 100);
    frameText.textContent = encoded.total === 1
      ? 'Single QR code · point the other NoteComplete’s camera here'
      : `Frame ${index + 1} of ${encoded.total} (${pct}%)`;
    if (!svgs[index]) svgs[index] = await renderQrSvg(encoded.frames[index]);
    if (qrBox.isConnected || index === 0) qrBox.innerHTML = svgs[index];
  };

  const restartTimer = () => {
    clearInterval(timer);
    timer = null;
    if (playing && encoded.total > 1) timer = setInterval(() => { void showFrame(index + 1); }, intervalMs);
  };

  const controls = [];
  if (encoded.total > 1) {
    const playBtn = makeEl('button', {
      type: 'button',
      textContent: 'Pause',
      onclick: () => {
        playing = !playing;
        playBtn.textContent = playing ? 'Pause' : 'Play';
        restartTimer();
      },
    });
    const prevBtn = makeEl('button', { type: 'button', textContent: 'Prev', onclick: () => { void showFrame(index - 1); } });
    const nextBtn = makeEl('button', { type: 'button', textContent: 'Next', onclick: () => { void showFrame(index + 1); } });
    const speedSel = makeEl('select', { 'aria-label': 'QR frame speed', className: 'qr-speed-select' },
      makeEl('option', { value: '500', textContent: 'Slow (2/s)' }),
      makeEl('option', { value: '260', textContent: 'Normal (4/s)', selected: true }),
      makeEl('option', { value: '160', textContent: 'Fast (6/s)' }));
    speedSel.onchange = () => { intervalMs = Number(speedSel.value) || 260; restartTimer(); };
    controls.push(playBtn, prevBtn, nextBtn, speedSel);
  }

  const actions = makeEl('div', { className: 'dialog-actions' });
  if (onDownloadFallback) {
    actions.append(makeEl('button', {
      type: 'button',
      textContent: fallbackLabel,
      onclick: async () => { dialog.close(); await onDownloadFallback(); },
    }));
  }
  actions.append(makeEl('button', { type: 'button', className: 'primary', textContent: 'Done', onclick: () => dialog.close() }));

  const dialog = makeEl('dialog', { className: 'ocr-dialog collab-dialog', 'aria-labelledby': headingId },
    makeEl('h2', { id: headingId, textContent: title || 'Share via QR' }),
    subtitle ? makeEl('p', { className: 'muted', textContent: subtitle }) : '',
    makeEl('div', { className: 'qr-transfer-stage' },
      qrBox,
      makeEl('div', { className: 'qr-transfer-meta' },
        frameText,
        encoded.total > 1 ? progress : '',
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
  if (encoded.total > 1) {
    // Pre-render the first batch quietly so playback never stalls mid-loop.
    for (let i = 1; i < Math.min(encoded.total, 12); i++) svgs[i] = await renderQrSvg(encoded.frames[i]);
    restartTimer();
  }
  status?.(`Ready: ${encoded.total} QR frame${encoded.total === 1 ? '' : 's'} for ${describeQrEnvelope(payload)}.`);
  return encoded;
}
