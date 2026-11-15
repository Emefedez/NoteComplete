// Zero-server peer-to-peer note transfer over WebRTC DataChannel with QR/copyable signaling.
// Works across Web browsers, iOS Safari, Android, and Desktop with no account or backend server.
import { base64UrlDecode, base64UrlEncode, deflateRaw, inflateRaw } from './qr-transfer.js';

const SIGNAL_PREFIX = 'NCW1';
const CHUNK_SIZE = 16384;
const HIGH_WATER_MARK = 262144;
const ICE_GATHER_TIMEOUT_MS = 3500;
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Strips media/extmap bloat so DataChannel SDPs fit comfortably into one QR code. */
export function minifyDataChannelSdp(sdp) {
  const dropPrefixes = ['a=extmap', 'a=rtcp', 'a=rtpmap', 'a=fmtp', 'a=max-message-size:'];
  return String(sdp || '')
    .split(/\r?\n/)
    .filter((line) => line && !dropPrefixes.some((p) => line.startsWith(p)))
    .join('\r\n') + '\r\n';
}

/** Encodes an SDP offer or answer into a compact QR-safe string (`NCW1|<o|a>|<z|r><b64url>`). */
export async function encodeWebRtcSignal({ type, sdp }) {
  if (type !== 'offer' && type !== 'answer') throw Error('Signal type must be offer or answer.');
  const cleanSdp = minifyDataChannelSdp(sdp);
  const raw = encoder.encode(cleanSdp);
  let mode = 'r';
  let body = raw;
  try {
    const zipped = await deflateRaw(raw);
    if (zipped.byteLength < raw.byteLength) {
      mode = 'z';
      body = zipped;
    }
  } catch { /* Fall back to uncompressed SDP if deflate-raw is unavailable. */ }
  return `${SIGNAL_PREFIX}|${type === 'offer' ? 'o' : 'a'}|${mode}${base64UrlEncode(body)}`;
}

/** Decodes a `NCW1|...` WebRTC signaling string back into `{ type, sdp }`. */
export async function decodeWebRtcSignal(text) {
  const trimmed = String(text || '').trim();
  const parts = trimmed.split('|');
  if (parts.length !== 3 || parts[0] !== SIGNAL_PREFIX) {
    throw Error('That is not a NoteComplete WebRTC transfer code.');
  }
  const kind = parts[1];
  if (kind !== 'o' && kind !== 'a') throw Error('Invalid WebRTC signal role.');
  const mode = parts[2][0];
  const payload = parts[2].slice(1);
  if (!payload) throw Error('Empty WebRTC signal payload.');
  const raw = base64UrlDecode(payload);
  const bytes = mode === 'z' ? await inflateRaw(raw) : mode === 'r' ? raw : (() => { throw Error('Unsupported WebRTC signal encoding.'); })();
  const sdp = decoder.decode(bytes);
  if (!sdp.includes('m=application')) throw Error('Invalid WebRTC DataChannel description.');
  return { type: kind === 'o' ? 'offer' : 'answer', sdp };
}

export function isWebRtcSignal(text) {
  return typeof text === 'string' && text.trim().startsWith(`${SIGNAL_PREFIX}|`);
}

async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function waitForIceGathering(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener?.('icegatheringstatechange', onState);
      pc.removeEventListener?.('icecandidate', onCand);
      resolve();
    };
    const onState = () => { if (pc.iceGatheringState === 'complete') done(); };
    const onCand = (e) => { if (!e?.candidate) done(); };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener?.('icegatheringstatechange', onState);
    pc.addEventListener?.('icecandidate', onCand);
  });
}

function createPeerConnection(iceServers = DEFAULT_ICE_SERVERS, PeerCtor = globalThis.RTCPeerConnection) {
  if (typeof PeerCtor !== 'function') {
    throw Error('Peer-to-peer WebRTC sharing is not supported in this browser.');
  }
  return new PeerCtor({ iceServers });
}

/**
 * Starts a P2P WebRTC sender session for one exported note `{ name, mime, bytes }`.
 * Returns `{ offerSignal, acceptAnswer(answerSignal, onProgress), close() }`.
 */
export async function createWebRtcNoteSender({ name, mime, bytes, iceServers = DEFAULT_ICE_SERVERS, PeerCtor = globalThis.RTCPeerConnection } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const hash = await sha256Hex(data);
  const pc = createPeerConnection(iceServers, PeerCtor);
  const channel = pc.createDataChannel('notecomplete-file', { ordered: true });
  channel.binaryType = 'arraybuffer';

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  const offerSignal = await encodeWebRtcSignal({
    type: 'offer',
    sdp: pc.localDescription?.sdp || offer.sdp,
  });

  const close = () => {
    try { channel.close?.(); } catch { /* Ignore. */ }
    try { pc.close?.(); } catch { /* Ignore. */ }
  };

  async function acceptAnswer(answerText, onProgress) {
    const desc = await decodeWebRtcSignal(answerText);
    if (desc.type !== 'answer') throw Error('Scan or paste the receiver’s reply code (answer), not an offer.');
    await pc.setRemoteDescription(desc);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, res) => {
        if (settled) return;
        settled = true;
        if (err) {
          close();
          reject(err);
        } else {
          resolve(res);
        }
      };

      channel.onerror = () => finish(Error('Peer-to-peer transfer failed. Keep both devices online/on Wi-Fi and try again.'));
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          finish(Error('Could not connect peer-to-peer (network/NAT blocked direct connection).'));
        }
      };

      const sendAll = async () => {
        try {
          channel.send(JSON.stringify({ type: 'meta', name, mime, size: data.byteLength, sha256: hash }));
          let offset = 0;
          onProgress?.({ sent: 0, total: data.byteLength });
          while (offset < data.byteLength) {
            if (channel.readyState !== 'open') throw Error('Connection closed before transfer finished.');
            if ((channel.bufferedAmount || 0) > HIGH_WATER_MARK) {
              await new Promise((r) => {
                if (typeof channel.addEventListener === 'function') {
                  channel.bufferedAmountLowThreshold = HIGH_WATER_MARK / 2;
                  const onLow = () => { channel.removeEventListener('bufferedamountlow', onLow); r(); };
                  channel.addEventListener('bufferedamountlow', onLow);
                  setTimeout(() => { channel.removeEventListener('bufferedamountlow', onLow); r(); }, 50);
                } else {
                  setTimeout(r, 15);
                }
              });
            }
            const end = Math.min(data.byteLength, offset + CHUNK_SIZE);
            channel.send(data.slice(offset, end));
            offset = end;
            onProgress?.({ sent: offset, total: data.byteLength });
          }
          channel.send(JSON.stringify({ type: 'eof' }));
        } catch (err) {
          finish(err);
        }
      };

      channel.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg?.type === 'ack') finish(null, { name, bytes: data.byteLength });
        else if (msg?.type === 'error') finish(Error(msg.message || 'Receiver rejected the file.'));
      };

      if (channel.readyState === 'open') void sendAll();
      else channel.onopen = () => { void sendAll(); };
    });
  }

  return { offerSignal, acceptAnswer, close, byteLength: data.byteLength };
}

/**
 * Joins a P2P WebRTC transfer from a sender's `NCW1|o|...` signal.
 * Returns `{ answerSignal, receive(onProgress), close() }` where `receive` resolves to `{ name, mime, bytes }`.
 */
export async function createWebRtcNoteReceiver(offerText, { iceServers = DEFAULT_ICE_SERVERS, PeerCtor = globalThis.RTCPeerConnection } = {}) {
  const offerDesc = await decodeWebRtcSignal(offerText);
  if (offerDesc.type !== 'offer') throw Error('Scan or paste the sender’s offer code.');

  const pc = createPeerConnection(iceServers, PeerCtor);
  let settled = false;
  let meta = null;
  const chunks = [];
  let receivedBytes = 0;
  let progressCb = null;
  let resolveFile;
  let rejectFile;
  const filePromise = new Promise((res, rej) => {
    resolveFile = res;
    rejectFile = rej;
  });
  let channelRef = null;

  const close = () => {
    try { channelRef?.close?.(); } catch { /* Ignore. */ }
    try { pc.close?.(); } catch { /* Ignore. */ }
  };

  const fail = (err) => {
    if (settled) return;
    settled = true;
    close();
    rejectFile(err);
  };

  const attachChannel = (channel) => {
    channelRef = channel;
    channel.binaryType = 'arraybuffer';
    channel.onerror = () => fail(Error('Peer-to-peer connection lost during transfer.'));
    channel.onmessage = async (event) => {
      try {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg?.type === 'meta') {
            meta = {
              name: String(msg.name || 'Shared.nfedit'),
              mime: String(msg.mime || 'application/octet-stream'),
              size: Number(msg.size) || 0,
              sha256: String(msg.sha256 || ''),
            };
            progressCb?.({ received: 0, total: meta.size, name: meta.name });
            return;
          }
          if (msg?.type === 'eof') {
            if (!meta) throw Error('Transfer ended without file metadata.');
            const out = new Uint8Array(receivedBytes);
            let at = 0;
            for (const c of chunks) {
              out.set(c, at);
              at += c.byteLength;
            }
            if (out.byteLength !== meta.size) throw Error('Received note size does not match.');
            const actualHash = await sha256Hex(out);
            if (meta.sha256 && actualHash !== meta.sha256) throw Error('Received note checksum mismatch.');
            try { channel.send(JSON.stringify({ type: 'ack' })); } catch { /* Best-effort ack. */ }
            if (!settled) {
              settled = true;
              resolveFile({ name: meta.name, mime: meta.mime, bytes: out });
            }
          }
          return;
        }
        const chunk = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(await event.data.arrayBuffer());
        chunks.push(chunk);
        receivedBytes += chunk.byteLength;
        progressCb?.({ received: receivedBytes, total: meta?.size || receivedBytes, name: meta?.name || '' });
      } catch (err) {
        try { channel.send(JSON.stringify({ type: 'error', message: err.message })); } catch { /* Ignore. */ }
        fail(err);
      }
    };
  };

  pc.ondatachannel = (event) => {
    if (event?.channel) attachChannel(event.channel);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      fail(Error('Could not connect peer-to-peer (network/NAT blocked direct connection).'));
    }
  };

  await pc.setRemoteDescription(offerDesc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  const answerSignal = await encodeWebRtcSignal({
    type: 'answer',
    sdp: pc.localDescription?.sdp || answer.sdp,
  });

  return {
    answerSignal,
    receive(onProgress) {
      progressCb = onProgress;
      return filePromise;
    },
    close,
  };
}
