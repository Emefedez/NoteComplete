import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minifyDataChannelSdp,
  encodeWebRtcSignal,
  decodeWebRtcSignal,
  isWebRtcSignal,
  createWebRtcNoteSender,
  createWebRtcNoteReceiver,
} from './p2p-share.js';

const SAMPLE_SDP = [
  'v=0',
  'o=- 123456 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:1234567890abcdef12345678',
  'a=fingerprint:sha-256 00:11:22:33',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host',
].join('\r\n');

function createMockPeerPair() {
  const peers = [];
  class MockDataChannel {
    constructor(label) {
      this.label = label;
      this.readyState = 'connecting';
      this.bufferedAmount = 0;
      this.binaryType = 'arraybuffer';
      this.peer = null;
    }
    send(payload) {
      queueMicrotask(() => {
        this.peer?.onmessage?.({ data: payload instanceof Uint8Array ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : payload });
      });
    }
    close() { this.readyState = 'closed'; }
  }
  class MockPeerConnection {
    constructor() {
      this.iceGatheringState = 'complete';
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.channel = null;
      peers.push(this);
    }
    createDataChannel(label) {
      this.channel = new MockDataChannel(label);
      return this.channel;
    }
    async createOffer() { return { type: 'offer', sdp: SAMPLE_SDP }; }
    async createAnswer() { return { type: 'answer', sdp: SAMPLE_SDP.replace('a=setup:actpass', 'a=setup:active') }; }
    async setLocalDescription(desc) { this.localDescription = desc; }
    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      if (desc.type === 'answer' && peers.length >= 2) {
        const sender = peers[0];
        const receiver = peers[1];
        const rxChannel = new MockDataChannel('notecomplete-file');
        sender.channel.peer = rxChannel;
        rxChannel.peer = sender.channel;
        sender.channel.readyState = 'open';
        rxChannel.readyState = 'open';
        receiver.ondatachannel?.({ channel: rxChannel });
        queueMicrotask(() => sender.channel.onopen?.());
      }
    }
    close() {}
  }
  return MockPeerConnection;
}

test('minifyDataChannelSdp and signal codec shrink and round-trip compact WebRTC offers/answers', async () => {
  const min = minifyDataChannelSdp(SAMPLE_SDP);
  assert.ok(!min.includes('a=extmap:'));
  const sig = await encodeWebRtcSignal({ type: 'offer', sdp: SAMPLE_SDP });
  assert.equal(isWebRtcSignal(sig), true);
  assert.ok(sig.startsWith('NCW1|o|'));
  const decoded = await decodeWebRtcSignal(sig);
  assert.equal(decoded.type, 'offer');
  assert.ok(decoded.sdp.includes('a=sctp-port:5000'));
  await assert.rejects(() => decodeWebRtcSignal('not-a-signal'), /NoteComplete WebRTC/);
});

test('createWebRtcNoteSender and createWebRtcNoteReceiver transfer multi-chunk binary notes with SHA-256 check', async () => {
  const MockPeerConnection = createMockPeerPair();
  const bytes = new Uint8Array(50000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + 7) & 0xff;

  const sender = await createWebRtcNoteSender({
    name: 'Cell Biology.nfedit',
    mime: 'application/json',
    bytes,
    PeerCtor: MockPeerConnection,
  });
  assert.equal(isWebRtcSignal(sender.offerSignal), true);

  const receiver = await createWebRtcNoteReceiver(sender.offerSignal, { PeerCtor: MockPeerConnection });
  assert.equal(isWebRtcSignal(receiver.answerSignal), true);

  let rxProgress = 0;
  let txProgress = 0;
  const rxPromise = receiver.receive(({ received }) => { rxProgress = received; });
  const txResult = await sender.acceptAnswer(receiver.answerSignal, ({ sent }) => { txProgress = sent; });
  const rxResult = await rxPromise;

  assert.equal(txResult.bytes, bytes.length);
  assert.equal(txProgress, bytes.length);
  assert.equal(rxProgress, bytes.length);
  assert.equal(rxResult.name, 'Cell Biology.nfedit');
  assert.equal(rxResult.mime, 'application/json');
  assert.deepEqual(rxResult.bytes, bytes);
});
