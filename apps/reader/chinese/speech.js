// Pronunciation on demand (docs/CHINESE-INPUT.md §10): a 🔊 in the character panel, on every
// pinyin syllable there, and "Listen" in the Chinese menus. Nothing is bundled or kept on disk:
// each click streams a short clip (the browser's HTTP cache may keep it a while, nothing else does).
//   1. a single syllable with a tone (nǐ, hǎo, the reading used here): a human recording of that
//      syllable and tone, so the tone is heard exactly, polyphones included;
//   2. words and sentences: online text-to-speech (zh-CN, or zh-TW for traditional script);
//   3. no network, or every online source failed: the system's Chinese voice, when it has one.
// Each source is tried in turn; the first that plays wins.
//   speak('你好')                      word or sentence
//   speak('好', { reading: 'hào' })    a character read a given way (its syllable recording first)
//   speakSyllable('hǎo', { fallback: '好' })
import { marksToNumbers } from './pinyin.js';

// A recording per syllable and tone ("ni3.mp3", ü written v), served from a CDN on demand.
export const SYLLABLE_BASE = 'https://cdn.jsdelivr.net/gh/davinfifield/mp3-chinese-pinyin-sound@master/mp3/';
export const TTS = [
  (text, lang) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`,
  (text) => `https://dict.youdao.com/dictvoice?le=zh&audio=${encodeURIComponent(text)}`,
];
const MAX_TTS = 180;      // characters per request the online voices accept
const TIMEOUT = 6000;     // a source that has not started by then is skipped

// "nǚ" → "nv3", "hǎo" → "hao3", "ma" (neutral) → "" (no recording: the word is spoken instead).
export function syllableFile(syllable) {
  const n = marksToNumbers(String(syllable || '').trim().toLowerCase());
  const m = /^([a-zü]+)([1-4])$/u.exec(n);
  return m ? `${m[1].replace(/ü/g, 'v')}${m[2]}` : '';
}

// The ordered sources for `text`: [{ kind: 'audio', url } | { kind: 'voice', text, lang }].
export function sourcesFor(text, { reading = '', script = 'simplified', online = true } = {}) {
  const t = String(text || '').trim().slice(0, MAX_TTS);
  const lang = script === 'traditional' ? 'zh-TW' : 'zh-CN';
  const han = /\p{Script=Han}/u.test(t); // pinyin alone is not spoken by a Chinese voice
  const out = [];
  if (online) {
    // One character read a known way: its syllable recording says that reading, TTS might not.
    const syl = reading && !/\s/.test(reading.trim()) ? syllableFile(reading) : '';
    if (syl) out.push({ kind: 'audio', url: `${SYLLABLE_BASE}${syl}.mp3` });
    if (han) for (const url of TTS) out.push({ kind: 'audio', url: url(t, lang) });
  }
  if (han) out.push({ kind: 'voice', text: t, lang });
  return out;
}

// The system's Chinese voice, or null.
export function zhVoice(script = 'simplified') {
  const synth = globalThis.speechSynthesis;
  if (!synth) return null;
  const zh = synth.getVoices().filter((v) => /^(zh|cmn)/i.test(v.lang));
  return zh.find((v) => (script === 'traditional' ? /TW|HK|Hant/i : /CN|Hans/i).test(v.lang)) || zh[0] || null;
}

let audio = null, playing = null, seq = 0, cancel = null;
const online = () => globalThis.navigator?.onLine !== false;

// Stops what is playing (audio or the system voice).
export function stopSpeech() {
  seq++;
  cancel?.();
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load?.(); }
  globalThis.speechSynthesis?.cancel();
  playing?.(false);
  playing = null;
}

function playUrl(url, rate) {
  return new Promise((resolve) => {
    if (!audio) audio = new Audio();
    const a = audio;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; cancel = null; clearTimeout(timer); a.onplaying = a.onerror = a.onended = null; resolve(ok); };
    // Stopped by a newer request: "played", so the caller does not go on to the next source.
    cancel = () => finish(true);
    const timer = setTimeout(() => finish(false), TIMEOUT);
    a.onerror = () => finish(false);
    a.onplaying = () => { clearTimeout(timer); };
    a.onended = () => finish(true);
    a.preload = 'auto';
    a.playbackRate = rate;
    a.preservesPitch = true;
    a.src = url;
    a.play().catch(() => finish(false));
  });
}

function playVoice(text, lang, script, rate) {
  const v = zhVoice(script);
  if (!v) return Promise.resolve(false);
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang || lang; u.rate = 0.85 * rate;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// Says `text`; `slow` plays it at 70 %. `onState(playing)` follows it (to light up a button).
// Resolves true when something played, false when no source could (offline, no system voice).
export async function speak(text, { reading = '', script = 'simplified', slow = false, onState = null } = {}) {
  stopSpeech();
  const mine = seq;
  playing = onState;
  onState?.(true);
  const rate = slow ? 0.7 : 1;
  let ok = false;
  for (const s of sourcesFor(text, { reading, script, online: online() })) {
    if (mine !== seq) return true;
    ok = s.kind === 'audio' ? await playUrl(s.url, rate) : await playVoice(s.text, s.lang, script, rate);
    if (ok) break;
  }
  if (mine === seq) { onState?.(false); playing = null; }
  return ok;
}

// One syllable (nǐ, hǎo): its recording, else `fallback` (the character) spoken.
export function speakSyllable(syllable, { fallback = '', ...opts } = {}) {
  return speak(fallback || syllable, { ...opts, reading: syllable });
}

// Whether a 🔊 can do anything here: online, or a system Chinese voice.
export const canSpeak = (script) => online() || !!zhVoice(script);
