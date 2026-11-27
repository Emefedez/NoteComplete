// Moodle LMS integration for NoteComplete (SAML2 SSO + Web Service token):
//  - Built-in presets (including Moovi — Universidade de Vigo with its SAML2 SSO entry)
//    plus any custom Moodle URL.
//  - Interactive Electron BrowserWindow SSO sign-in (`persist:moodle` partition) that
//    captures `MoodleSession` cookies + `sesskey` automatically after university SAML2/MFA,
//    working even on locked-down Moodle servers where `/user/managetoken.php` is disabled.
//  - Course listing, course section/resource/folder browsing, single & bulk file download,
//    and "Open in browser" for the exact course/folder/activity being viewed.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MOODLE_PRESETS = Object.freeze([
  {
    id: 'moovi-uvigo',
    label: 'Moovi — Universidade de Vigo (UVIGO)',
    baseUrl: 'https://moovi.uvigo.gal',
    ssoUrl: 'https://moovi.uvigo.gal/auth/saml2/login.php?wants&idp=4392f08b6ac39007b320261f51af7b22&passive=off',
  },
  {
    id: 'custom',
    label: 'Custom Moodle server…',
    baseUrl: '',
    ssoUrl: '',
  },
]);

export function normalizeBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function buildMobileLaunchUrl(baseUrl, passport = '') {
  const norm = normalizeBaseUrl(baseUrl);
  if (!norm) return '';
  const pass = String(passport || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  const u = new URL('/admin/tool/mobile/launch.php', norm);
  u.searchParams.set('service', 'moodle_mobile_app');
  u.searchParams.set('passport', pass);
  u.searchParams.set('urlscheme', 'moodlemobile');
  return u.href;
}

export function parseMobileTokenUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  const m = /^moodlemobile:\/\/token=([^&#\s]+)/i.exec(s);
  if (!m) return null;
  try {
    const decoded = Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8');
    const parts = decoded.split(':::');
    const token = (parts[1] || '').trim();
    if (!token) return null;
    return {
      signature: (parts[0] || '').trim(),
      token,
      privateToken: (parts[2] || '').trim(),
    };
  } catch {
    return null;
  }
}

export function appendTokenIfSameOrigin(targetUrl, baseUrl, token) {
  if (!token || !targetUrl || !baseUrl) return targetUrl;
  try {
    const u = new URL(targetUrl, baseUrl);
    const base = new URL(baseUrl);
    if (u.protocol !== 'https:' || u.origin !== base.origin) return u.href;
    if (!u.searchParams.has('token')) u.searchParams.set('token', token);
    return u.href;
  } catch {
    return targetUrl;
  }
}

function parseIcsDate(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(s);
  if (!m) return 0;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', z] = m;
  return z
    ? Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
}

export function classifyCalendarEvent(title = '') {
  const t = String(title || '').toLowerCase();
  if (/pendente de entrega|pendiente de entrega|\bis due\b|vencimiento|fecha límite/i.test(t)) return { eventKind: 'due', modname: 'assign' };
  if (/\bpecha\b|\bcierra\b|\bcloses\b/i.test(t)) return { eventKind: 'closes', modname: 'quiz' };
  if (/\babre\b|\bopens\b/i.test(t)) return { eventKind: 'opens', modname: 'event' };
  return { eventKind: 'event', modname: 'event' };
}

export function parseIcsEvents(icsText, baseUrl = '') {
  const unfolded = String(icsText || '').replace(/\r?\n[ \t]/g, '');
  const events = [];
  const blockRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi;
  let m;
  while ((m = blockRe.exec(unfolded))) {
    const block = m[1];
    const field = (name) => {
      const r = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'mi').exec(block);
      return r ? r[1].replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim() : '';
    };
    const summary = field('SUMMARY');
    if (!summary) continue;
    const uid = field('UID') || `${summary}:${field('DTSTART')}`;
    const dueAt = parseIcsDate(field('DTEND') || field('DTSTART'));
    const course = field('CATEGORIES');
    const rawUrl = field('URL');
    const { eventKind, modname } = classifyCalendarEvent(summary);
    events.push({
      id: uid,
      uid,
      name: summary,
      course,
      courseId: 0,
      dueAt,
      modname,
      eventKind,
      url: rawUrl || (baseUrl ? new URL('/calendar/view.php?view=upcoming', baseUrl).href : ''),
      source: 'ics',
    });
  }
  return events;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]*>/g, ' '));
}

const SERVER_SCRIPT_EXTS = new Set(['php', 'asp', 'aspx', 'jsp', 'cgi', 'cfm', 'do']);
const VIDEO_HOST_RE = /\b(?:youtube\.com|youtu\.be|vimeo\.com|tv\.uvigo\.es|campusremotouvigo|panopto|kaltura|mediasite|loom\.com|dailymotion\.com|twitch\.tv|stream\.microsoft\.com)\b/i;
const VIDEO_MOD_RE = /(?:video|kalvid|kaltura|panopto|vimeo|youtube|stream|ubicast|mediasite|mediagallery)/i;
const MOODLE_ICON_FORMAT = {
  pdf: 'PDF',
  document: 'DOC',
  writer: 'ODT',
  powerpoint: 'PPT',
  impress: 'ODP',
  spreadsheet: 'XLS',
  calc: 'ODS',
  archive: 'ZIP',
  sourcecode: 'CODE',
  text: 'TXT',
  html: 'HTML',
  markup: 'HTML',
  mpeg: 'VIDEO',
  video: 'VIDEO',
  quicktime: 'VIDEO',
  avi: 'VIDEO',
  wmv: 'VIDEO',
  flash: 'VIDEO',
  mp3: 'AUDIO',
  audio: 'AUDIO',
  wav: 'AUDIO',
  image: 'IMG',
  jpeg: 'JPG',
  png: 'PNG',
  gif: 'GIF',
  bmp: 'BMP',
  svg: 'SVG',
  eps: 'EPS',
  psd: 'PSD',
};

function extFromString(str) {
  let raw = String(str || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try { raw = new URL(raw).pathname; } catch { return ''; }
  } else {
    raw = raw.split(/[?#]/)[0];
  }
  const base = raw.split('/').pop() || '';
  if (!base) return '';
  let decoded = base;
  try { decoded = decodeURIComponent(base); } catch { /* ignore */ }
  const m = decoded.match(/\.([a-z0-9]{1,7})$/i);
  if (!m) return '';
  const ext = m[1].toLowerCase();
  if (SERVER_SCRIPT_EXTS.has(ext)) return '';
  return ext.toUpperCase();
}

export function inferMoodleFileFormat({
  fileName = '',
  name = '',
  url = '',
  downloadUrl = '',
  mimeType = '',
  iconUrl = '',
  modname = '',
  detailsText = '',
} = {}) {
  for (const candidate of [fileName, downloadUrl, url, name]) {
    const ext = extFromString(candidate);
    if (ext) return ext;
  }

  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime) {
    if (mime === 'application/pdf') return 'PDF';
    if (mime.includes('wordprocessingml')) return 'DOCX';
    if (mime === 'application/msword') return 'DOC';
    if (mime.includes('presentationml')) return 'PPTX';
    if (mime === 'application/vnd.ms-powerpoint') return 'PPT';
    if (mime.includes('spreadsheetml')) return 'XLSX';
    if (mime === 'application/vnd.ms-excel') return 'XLS';
    if (mime.includes('opendocument.text')) return 'ODT';
    if (mime.includes('opendocument.presentation')) return 'ODP';
    if (mime.includes('opendocument.spreadsheet')) return 'ODS';
    if (mime === 'text/html') return 'HTML';
    if (mime === 'text/csv') return 'CSV';
    if (mime === 'text/plain') return 'TXT';
    if (mime === 'application/zip' || mime.includes('compressed') || mime.includes('archive')) return 'ZIP';
    if (mime.startsWith('video/')) return mime.slice(6).toUpperCase().replace(/^X-/, '').slice(0, 6) || 'VIDEO';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('image/')) return mime.slice(6).toUpperCase().replace('JPEG', 'JPG').slice(0, 6) || 'IMG';
  }

  const iconMatch = String(iconUrl || '').match(/\/f\/([a-z0-9]+?)(?:-\d+)?(?:\.[a-z]+)?(?:[?#]|$)/i);
  if (iconMatch) {
    const mapped = MOODLE_ICON_FORMAT[iconMatch[1].toLowerCase()];
    if (mapped) return mapped;
  }

  const details = String(detailsText || '');
  if (details) {
    if (/\bpdf\b/i.test(details)) return 'PDF';
    if (/\bdocx\b/i.test(details)) return 'DOCX';
    if (/\b(?:word|doc)\b/i.test(details)) return 'DOC';
    if (/\bpptx\b/i.test(details)) return 'PPTX';
    if (/\b(?:powerpoint|ppt)\b/i.test(details)) return 'PPT';
    if (/\bxlsx\b/i.test(details)) return 'XLSX';
    if (/\b(?:excel|xls)\b/i.test(details)) return 'XLS';
    if (/\bodt\b/i.test(details)) return 'ODT';
    if (/\bzip\b|\barchive\b|\bcomprimid/i.test(details)) return 'ZIP';
    if (/\b(?:mp4|webm|vídeo|video)\b/i.test(details)) return 'VIDEO';
    if (/\b(?:mp3|audio|wav)\b/i.test(details)) return 'AUDIO';
    if (/\bhtml\b/i.test(details)) return 'HTML';
    if (/\bcsv\b/i.test(details)) return 'CSV';
  }

  const mod = String(modname || '').toLowerCase();
  const probe = `${url} ${downloadUrl} ${name}`;
  if (VIDEO_MOD_RE.test(mod) || VIDEO_HOST_RE.test(probe)) return 'VIDEO';
  if (mod === 'folder') return 'FOLDER';
  if (mod === 'url') return 'WEB';
  if (mod === 'page') return 'WEB';
  return '';
}

export function extractModuleFormatsFromHtml(html) {
  const src = String(html || '');
  const map = new Map();
  const modStarts = [];
  const modRe = /<li\b[^>]*\bid=["']module-(\d+)["'][^>]*>/gi;
  let m;
  while ((m = modRe.exec(src))) {
    modStarts.push({ cmid: Number(m[1]), index: m.index });
  }
  for (let i = 0; i < modStarts.length; i += 1) {
    const cur = modStarts[i];
    const end = i + 1 < modStarts.length ? Math.min(modStarts[i + 1].index, cur.index + 4000) : Math.min(src.length, cur.index + 4000);
    const chunk = src.slice(cur.index, end);
    const iconMatch = chunk.match(/<img\b[^>]*src=["']([^"']*\/f\/[a-z0-9_-]+[^"']*)["']/i);
    const detailsMatch = chunk.match(/<span\b[^>]*class=["'][^"']*resourcelinkdetails[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const fmt = inferMoodleFileFormat({
      iconUrl: iconMatch ? decodeHtmlEntities(iconMatch[1]) : '',
      detailsText: detailsMatch ? stripTags(detailsMatch[1]) : '',
    });
    if (fmt) map.set(cur.cmid, fmt);
  }
  return map;
}

export function parseCoursesFromHtml(html, baseUrl) {
  const seen = new Map();
  const re = /<a\b[^>]*href=["']([^"']*\/course\/view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const id = Number(m[2]);
    const rawName = stripTags(m[3]).replace(/^Course name\s*/i, '').trim();
    if (!id || !rawName || rawName.length < 2) continue;
    if (/^(view|enter|ir|acceder)$/i.test(rawName)) continue;
    if (!seen.has(id) || rawName.length > seen.get(id).fullname.length) {
      seen.set(id, {
        id,
        fullname: rawName,
        shortname: '',
        viewurl: new URL(`/course/view.php?id=${id}`, baseUrl).href,
      });
    }
  }
  return [...seen.values()];
}

export function parseCourseStateJson(rawState, baseUrl) {
  let state = rawState;
  if (typeof state === 'string') {
    try { state = JSON.parse(state); } catch { return []; }
  }
  const rawSections = Array.isArray(state?.section) ? state.section : [];
  const rawCms = Array.isArray(state?.cm) ? state.cm : [];
  if (!rawSections.length || !rawCms.length) return [];

  const cmById = new Map();
  for (const cm of rawCms) {
    if (cm?.id != null) cmById.set(String(cm.id), cm);
  }

  const sections = [];
  for (const sec of rawSections) {
    const cmIds = Array.isArray(sec.cmlist) ? sec.cmlist : [];
    const items = [];
    for (const rawId of cmIds) {
      const cm = cmById.get(String(rawId));
      if (!cm) continue;
      const modname = String(cm.module || cm.modname || 'resource').toLowerCase();
      const absUrl = cm.url
        ? (() => { try { return new URL(decodeHtmlEntities(cm.url), baseUrl).href; } catch { return ''; } })()
        : new URL(`/mod/${modname}/view.php?id=${cm.id}`, baseUrl).href;
      if (!absUrl) continue;
      const isFolder = modname === 'folder';
      const isDownloadable = modname === 'resource' || /\/pluginfile\.php\//i.test(absUrl);
      const downloadUrl = modname === 'resource'
        ? `${absUrl}${absUrl.includes('?') ? '&' : '?'}redirect=1`
        : isDownloadable ? absUrl : '';
      const cleanName = decodeHtmlEntities(cm.name || 'Resource');
      const fileFormat = inferMoodleFileFormat({
        fileName: cm.filename || '',
        name: cleanName,
        url: absUrl,
        downloadUrl,
        mimeType: cm.mimetype || '',
        iconUrl: cm.icon || cm.iconurl || '',
        modname,
      });
      items.push({
        id: `cm:${cm.id}`,
        cmid: Number(cm.id) || 0,
        name: cleanName,
        modname,
        url: absUrl,
        downloadUrl,
        fileFormat,
        isFolder,
        isDownloadable,
      });
    }
    if (items.length) {
      sections.push({
        id: Number(sec.number ?? sec.id ?? sections.length),
        name: decodeHtmlEntities(sec.title || sec.name || `Section ${sec.number ?? sections.length}`),
        items,
      });
    }
  }
  return sections;
}

export function extractSubSectionUrls(html, baseUrl, courseId) {
  const urls = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*(?:\/course\/view\.php\?[^"']*\bsection=\d+|\/course\/section\.php\?id=\d+)[^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let abs;
    try { abs = new URL(decodeHtmlEntities(m[1]), baseUrl).href; } catch { continue; }
    if (abs.includes('/course/view.php') && courseId && !new RegExp(`[?&]id=${courseId}(?:&|$)`).test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    urls.push(abs);
  }
  return urls.slice(0, 24);
}

export function parseCourseSectionsFromHtml(html, baseUrl) {
  const src = String(html || '');
  const sections = [];
  // Match Moodle 3.x/4.x course sections (<li id="section-N" ...> or <section id="section-N" ...>)
  const secStarts = [];
  const secRe = /<(?:li|section)\b[^>]*\bid=["']section-(\d+)["'][^>]*>/gi;
  let m;
  while ((m = secRe.exec(src))) {
    secStarts.push({ num: Number(m[1]), index: m.index });
  }
  const chunks = secStarts.length
    ? secStarts.map((s, i) => ({
        id: s.num,
        html: src.slice(s.index, i + 1 < secStarts.length ? secStarts[i + 1].index : src.length),
      }))
    : [{ id: 0, html: src }];

  for (const chunk of chunks) {
    const headingMatch =
      chunk.html.match(/<h[234]\b[^>]*class=["'][^"']*sectionname[^"']*["'][^>]*>([\s\S]*?)<\/h[234]>/i) ||
      chunk.html.match(/data-for=["']section_title["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ||
      chunk.html.match(/aria-label=["']([^"']+)["']/i);
    const secName = headingMatch ? stripTags(headingMatch[1]) : (chunk.id === 0 ? 'General' : `Section ${chunk.id}`);

    const items = [];
    const seenUrls = new Set();
    const htmlFormats = extractModuleFormatsFromHtml(chunk.html);
    const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = linkRe.exec(chunk.html))) {
      let href = decodeHtmlEntities(lm[1]);
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      let absUrl;
      try { absUrl = new URL(href, baseUrl).href; } catch { continue; }
      const modMatch = absUrl.match(/\/mod\/(resource|folder|assign|url|page|quiz|forum|book|lti|h5pactivity|scorm|data|glossary|workshop|choice|feedback|lesson)\/view\.php\?id=(\d+)/i);
      const isPluginFile = /\/pluginfile\.php\//i.test(absUrl);
      if (!modMatch && !isPluginFile) continue;
      if (seenUrls.has(absUrl)) continue;
      seenUrls.add(absUrl);

      let name = stripTags(lm[2])
        .replace(/\b(?:File|Archivo|Ficheiro|Folder|Carpeta|Cartafol|URL|Page|Página|Páxina|Assignment|Tarea|Tarefa|Quiz|Cuestionario|Forum|Foro)\s*$/i, '')
        .trim();
      if (!name) {
        try { name = decodeURIComponent(path.basename(new URL(absUrl).pathname)) || 'Resource'; } catch { name = 'Resource'; }
      }
      const modname = modMatch ? modMatch[1].toLowerCase() : 'file';
      const cmid = modMatch ? Number(modMatch[2]) : 0;
      const isFolder = modname === 'folder';
      const isDownloadable = modname === 'resource' || isPluginFile;
      const downloadUrl = modname === 'resource'
        ? `${absUrl}${absUrl.includes('?') ? '&' : '?'}redirect=1`
        : isPluginFile ? absUrl : '';
      const fileFormat = (cmid && htmlFormats.get(cmid)) || inferMoodleFileFormat({
        name,
        url: absUrl,
        downloadUrl,
        modname,
      });
      items.push({
        id: cmid ? `cm:${cmid}` : `url:${absUrl}`,
        cmid,
        name,
        modname,
        url: absUrl,
        downloadUrl,
        fileFormat,
        isFolder,
        isDownloadable,
      });
    }
    if (items.length) {
      sections.push({ id: chunk.id, name: secName || `Section ${chunk.id}`, items });
    }
  }
  return sections;
}

export function parseFolderFilesFromHtml(html, baseUrl) {
  const files = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*\/pluginfile\.php\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let absUrl;
    try { absUrl = new URL(decodeHtmlEntities(m[1]), baseUrl).href; } catch { continue; }
    if (seen.has(absUrl)) continue;
    seen.add(absUrl);
    let name = stripTags(m[2]).trim();
    let urlBase = '';
    try { urlBase = decodeURIComponent(path.basename(new URL(absUrl).pathname)); } catch { /* ignore */ }
    if (!name) name = urlBase || 'file';
    const fileFormat = inferMoodleFileFormat({ fileName: urlBase, name, url: absUrl, downloadUrl: absUrl, modname: 'file' });
    files.push({
      id: `url:${absUrl}`,
      name,
      fileName: urlBase || name,
      fileFormat,
      modname: 'file',
      url: absUrl,
      downloadUrl: absUrl,
      isFolder: false,
      isDownloadable: true,
    });
  }
  return files;
}

export function extractFilenameFromResponse(response, fallbackUrl = '', fallbackName = 'document') {
  const cd = response?.headers?.get?.('content-disposition') || '';
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')); } catch { /* fall through */ }
  }
  const plain = cd.match(/filename\s*=\s*["']?([^"';\r\n]+)["']?/i);
  if (plain) return plain[1].trim();
  const finalUrl = response?.url || fallbackUrl;
  if (finalUrl) {
    try {
      const base = decodeURIComponent(path.basename(new URL(finalUrl).pathname));
      if (base && base !== 'view.php' && base !== 'pluginfile.php') return base;
    } catch { /* ignore */ }
  }
  return fallbackName || 'document';
}

export function createMoodleService({
  sessionFile,
  safeStorage = null,
  openSsoWindow = null,
  clearSsoCookies = null,
  fetcher = fetch,
} = {}) {
  let state = null; // { presetId, label, baseUrl, ssoUrl, token, cookies, sesskey, userName, userId, connectedAt }

  async function loadSession() {
    if (state) return state;
    if (!sessionFile) return null;
    try {
      const raw = await readFile(sessionFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.encrypted && safeStorage?.isEncryptionAvailable?.()) {
        const plain = safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64'));
        state = JSON.parse(plain);
      } else if (parsed?.baseUrl) {
        state = parsed;
      }
    } catch {
      state = null;
    }
    return state;
  }

  async function saveSession(next) {
    state = next;
    if (!sessionFile) return;
    if (!next) {
      await rm(sessionFile, { force: true }).catch(() => {});
      return;
    }
    await mkdir(path.dirname(sessionFile), { recursive: true });
    const serialized = JSON.stringify(next);
    const payload = safeStorage?.isEncryptionAvailable?.()
      ? JSON.stringify({ encrypted: safeStorage.encryptString(serialized).toString('base64') })
      : serialized;
    await writeFile(sessionFile, payload, { mode: 0o600 });
  }

  function publicSession(s) {
    if (!s || !s.baseUrl) return null;
    return {
      connected: true,
      presetId: s.presetId || 'custom',
      label: s.label || new URL(s.baseUrl).hostname,
      baseUrl: s.baseUrl,
      ssoUrl: s.ssoUrl || '',
      authMode: s.token ? 'token' : 'sso',
      userName: s.userName || '',
      userId: s.userId || 0,
      connectedAt: s.connectedAt || 0,
    };
  }

  function cookieHeader(s) {
    return String(s?.cookies || '').trim();
  }

  async function authedFetch(url, options = {}) {
    const s = await loadSession();
    if (!s?.baseUrl) throw Error('Not connected to Moodle. Sign in first.');
    const headers = {
      'User-Agent': 'NoteComplete-Moodle/1.0',
      ...(options.headers || {}),
    };
    const ck = cookieHeader(s);
    if (ck) headers.Cookie = ck;
    return fetcher(url, { ...options, headers, redirect: 'follow' });
  }

  async function restCall(wsfunction, params = {}) {
    const s = await loadSession();
    if (!s?.token) throw Error('No Moodle web service token.');
    const url = new URL('/webservice/rest/server.php', s.baseUrl);
    const body = new URLSearchParams({
      wstoken: s.token,
      wsfunction,
      moodlewsrestformat: 'json',
    });
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        v.forEach((item, idx) => body.set(`${k}[${idx}]`, String(item)));
      } else if (v !== undefined && v !== null) {
        body.set(k, String(v));
      }
    }
    const res = await fetcher(url.href, { method: 'POST', body });
    if (!res.ok) throw Error(`Moodle API error (HTTP ${res.status}).`);
    const data = await res.json();
    if (data?.exception || data?.errorcode) {
      if (data.errorcode === 'invalidtoken' || /invalidtoken|invalid token/i.test(String(data.message || ''))) {
        throw Error('Your Moodle token expired or is invalid. Click "Sign in again" to reconnect.');
      }
      throw Error(data.message || data.exception || data.errorcode);
    }
    return data;
  }

  async function ajaxCall(methodname, args = {}) {
    const s = await loadSession();
    if (!s?.sesskey) throw Error('No Moodle sesskey.');
    const url = new URL(`/lib/ajax/service.php?sesskey=${encodeURIComponent(s.sesskey)}&info=${encodeURIComponent(methodname)}`, s.baseUrl);
    const res = await authedFetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });
    if (!res.ok) throw Error(`Moodle AJAX error (HTTP ${res.status}).`);
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : data;
    if (first?.error) {
      const msg = first?.exception?.message || first?.exception?.errorcode || 'Moodle session expired. Please sign in again.';
      throw Error(msg);
    }
    return first?.data;
  }

  return {
    presets: () => MOODLE_PRESETS,

    async getSession() {
      return publicSession(await loadSession());
    },

    async signIn({ presetId = 'moovi-uvigo', baseUrl = '', ssoUrl = '', token = '', icsUrl = '', label = '', force = false } = {}) {
      const preset = MOODLE_PRESETS.find((p) => p.id === presetId);
      const normBase = normalizeBaseUrl(baseUrl || preset?.baseUrl || '');
      if (!normBase) throw Error('Enter a valid Moodle server URL (e.g. https://moovi.uvigo.gal).');
      const normSso = String(ssoUrl || preset?.ssoUrl || '').trim() || new URL('/login/index.php', normBase).href;
      const cleanLabel = String(label || preset?.label || new URL(normBase).hostname).trim();
      const cleanToken = String(token || '').trim();
      const cleanIcs = String(icsUrl || '').trim();
      const prev = await loadSession().catch(() => null);
      const effectiveIcs = cleanIcs || (prev?.baseUrl === normBase ? (prev.icsUrl || '') : '');

      const verifyTokenInfo = async (tok) => {
        const url = new URL('/webservice/rest/server.php', normBase);
        const body = new URLSearchParams({
          wstoken: tok,
          wsfunction: 'core_webservice_get_site_info',
          moodlewsrestformat: 'json',
        });
        const res = await fetcher(url.href, { method: 'POST', body });
        if (!res.ok) throw Error(`Could not reach Moodle at ${normBase} (HTTP ${res.status}).`);
        const info = await res.json();
        if (info?.exception) throw Error(info.message || 'Invalid Moodle token.');
        return info;
      };

      if (cleanToken) {
        const info = await verifyTokenInfo(cleanToken);
        const next = {
          presetId,
          label: cleanLabel,
          baseUrl: normBase,
          ssoUrl: normSso,
          token: cleanToken,
          icsUrl: effectiveIcs,
          icsCache: prev?.icsCache || [],
          cookies: '',
          sesskey: '',
          userName: info.fullname || info.username || '',
          userId: Number(info.userid) || 0,
          connectedAt: Date.now(),
        };
        await saveSession(next);
        return publicSession(next);
      }

      if (typeof openSsoWindow !== 'function') {
        throw Error('Interactive SAML2 / SSO login requires the NoteComplete desktop app, or paste a Moodle Web Service token.');
      }
      if (force) await clearSsoCookies?.().catch(() => {});
      const mobileLaunchUrl = buildMobileLaunchUrl(normBase);
      const ssoResult = await openSsoWindow({ baseUrl: normBase, ssoUrl: normSso, mobileLaunchUrl, label: cleanLabel });
      if (!ssoResult?.cookies && !ssoResult?.token) throw Error('Moodle SSO sign-in did not complete.');
      let userName = ssoResult.userName || '';
      let userId = Number(ssoResult.userId) || 0;
      if (ssoResult.token) {
        try {
          const info = await verifyTokenInfo(ssoResult.token);
          userName = info.fullname || info.username || userName;
          userId = Number(info.userid) || userId;
        } catch { /* Keep token even if site info lookup fails */ }
      }
      const next = {
        presetId,
        label: cleanLabel,
        baseUrl: normBase,
        ssoUrl: normSso,
        token: ssoResult.token || '',
        icsUrl: effectiveIcs,
        icsCache: prev?.icsCache || [],
        cookies: ssoResult.cookies || '',
        sesskey: ssoResult.sesskey || '',
        userName,
        userId,
        connectedAt: Date.now(),
      };
      await saveSession(next);
      return publicSession(next);
    },

    async disconnect() {
      await saveSession(null);
      await clearSsoCookies?.().catch(() => {});
      return { ok: true };
    },

    async listCourses() {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');

      if (s.token && s.userId) {
        // Prefer timeline classification REST API because it includes `courseimage` and `hidden`.
        try {
          const data = await restCall('core_course_get_enrolled_courses_by_timeline_classification', {
            offset: 0,
            limit: 100,
            classification: 'allincludinghidden',
            sort: 'fullname',
          });
          const courses = Array.isArray(data?.courses) ? data.courses : [];
          if (courses.length) {
            return courses.map((c) => ({
              id: Number(c.id),
              fullname: decodeHtmlEntities(c.fullname || c.fullnamedisplay || `Course ${c.id}`),
              shortname: decodeHtmlEntities(c.shortname || ''),
              viewurl: c.viewurl || new URL(`/course/view.php?id=${c.id}`, s.baseUrl).href,
              courseimage: c.courseimage || '',
              hidden: Boolean(c.hidden),
            }));
          }
        } catch { /* Fall back to core_enrol_get_users_courses below. */ }
        const list = await restCall('core_enrol_get_users_courses', { userid: s.userId });
        return (Array.isArray(list) ? list : []).map((c) => ({
          id: Number(c.id),
          fullname: decodeHtmlEntities(c.fullname || c.displayname || `Course ${c.id}`),
          shortname: decodeHtmlEntities(c.shortname || ''),
          viewurl: new URL(`/course/view.php?id=${c.id}`, s.baseUrl).href,
          courseimage: c.courseimage || c.overviewfiles?.[0]?.fileurl || '',
          hidden: Boolean(c.hidden),
        }));
      }

      const fetchAjaxCourses = async () => {
        const data = await ajaxCall('core_course_get_enrolled_courses_by_timeline_classification', {
          offset: 0,
          limit: 100,
          classification: 'all',
          sort: 'fullname',
        });
        const courses = Array.isArray(data?.courses) ? data.courses : [];
        if (!courses.length) return null;
        return courses.map((c) => ({
          id: Number(c.id),
          fullname: decodeHtmlEntities(c.fullname || c.fullnamedisplay || `Course ${c.id}`),
          shortname: decodeHtmlEntities(c.shortname || ''),
          viewurl: c.viewurl || new URL(`/course/view.php?id=${c.id}`, s.baseUrl).href,
          courseimage: c.courseimage || '',
          hidden: Boolean(c.hidden),
        }));
      };

      // Try Moodle AJAX enrolled courses first (fast & clean JSON)
      let ajaxError = null;
      if (s.sesskey) {
        try {
          const found = await fetchAjaxCourses();
          if (found) return found;
        } catch (err) {
          ajaxError = err;
        }
      }

      // Fallback: parse /my/courses.php and /my/ with authenticated session cookies
      let refreshedSesskey = false;
      for (const rel of ['/my/courses.php', '/my/']) {
        const res = await authedFetch(new URL(rel, s.baseUrl).href);
        if (!res.ok) continue;
        const html = await res.text();
        const loggedOut = /\/login\/index\.php|SAMLRequest|\/auth\/saml2\//i.test(res.url || '')
          || /\bclass="[^"]*\bnotloggedin\b/i.test(html)
          || /"userId"\s*:\s*0\b/i.test(html);
        if (loggedOut) {
          throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
        }
        const sessMatch = html.match(/"sesskey"\s*:\s*"([^"]+)"/);
        if (sessMatch && sessMatch[1] && sessMatch[1] !== s.sesskey) {
          s.sesskey = sessMatch[1];
          await saveSession(s);
          refreshedSesskey = true;
        }
        const parsed = parseCoursesFromHtml(html, s.baseUrl);
        if (parsed.length) return parsed;
      }

      // Moodle 4.x renders /my/courses.php via AJAX: if we refreshed sesskey above, retry AJAX once.
      if (refreshedSesskey && s.sesskey) {
        try {
          const found = await fetchAjaxCourses();
          if (found) return found;
        } catch (err) {
          ajaxError = err;
        }
      }

      if (ajaxError && /login|session|sesskey|expired/i.test(String(ajaxError.message || ''))) {
        throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
      }
      return [];
    },

    async getCourseContents(courseId) {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      const cid = Number(courseId);
      if (!Number.isFinite(cid) || cid <= 0) throw Error('Invalid course ID.');
      const courseUrl = new URL(`/course/view.php?id=${cid}`, s.baseUrl).href;

      if (s.token) {
        const raw = await restCall('core_course_get_contents', { courseid: cid });
        const sections = (Array.isArray(raw) ? raw : []).map((sec) => ({
          id: Number(sec.id || sec.section || 0),
          name: decodeHtmlEntities(sec.name || `Section ${sec.section || 0}`),
          items: (Array.isArray(sec.modules) ? sec.modules : []).map((mod) => {
            const files = (Array.isArray(mod.contents) ? mod.contents : []).filter((c) => c.type === 'file' && c.fileurl);
            const firstFile = files[0];
            const isFolder = mod.modname === 'folder';
            const isDownloadable = Boolean(firstFile) && !isFolder;
            const cleanName = decodeHtmlEntities(mod.name || firstFile?.filename || 'Resource');
            const fileFormat = inferMoodleFileFormat({
              fileName: firstFile?.filename || '',
              name: cleanName,
              url: mod.url || courseUrl,
              downloadUrl: firstFile?.fileurl || '',
              mimeType: firstFile?.mimetype || '',
              iconUrl: mod.modicon || '',
              modname: mod.modname || 'resource',
            });
            return {
              id: `cm:${mod.id}`,
              cmid: Number(mod.id),
              name: cleanName,
              modname: mod.modname || 'resource',
              url: mod.url || courseUrl,
              downloadUrl: firstFile?.fileurl || '',
              fileName: firstFile?.filename || '',
              fileFormat,
              size: Number(firstFile?.filesize || 0),
              isFolder,
              isDownloadable,
              folderFiles: isFolder ? files.map((f) => ({
                id: `url:${f.fileurl}`,
                name: f.filename || 'file',
                fileName: f.filename || 'file',
                fileFormat: inferMoodleFileFormat({ fileName: f.filename || '', url: f.fileurl, mimeType: f.mimetype || '', modname: 'file' }),
                modname: 'file',
                url: f.fileurl,
                downloadUrl: f.fileurl,
                size: Number(f.filesize || 0),
                isFolder: false,
                isDownloadable: true,
              })) : undefined,
            };
          }),
        })).filter((sec) => sec.items.length > 0);
        return { courseUrl, sections };
      }

      // Helper: enrich resource items lacking a fileFormat using Moodle's /f/<type> icons in course HTML.
      const enrichFormats = async (secs, existingHtml = '') => {
        const missing = secs.flatMap((sec) => sec.items).filter((it) => it.isDownloadable && !it.fileFormat && it.cmid);
        if (!missing.length) return secs;
        try {
          let htmlText = existingHtml;
          if (!htmlText) {
            const r = await authedFetch(courseUrl);
            if (r.ok) htmlText = await r.text();
          }
          if (htmlText) {
            const map = extractModuleFormatsFromHtml(htmlText);
            for (const it of missing) {
              const found = map.get(it.cmid);
              if (found) it.fileFormat = found;
            }
          }
        } catch { /* best-effort enrichment */ }
        return secs;
      };

      // 1. Try Moodle 4.x AJAX course state (returns ALL Temas/sections & resources even in Tiles/Tabs/One-section-per-page courses!)
      if (s.sesskey) {
        try {
          const stateData = await ajaxCall('core_courseformat_get_state', { courseid: cid });
          const parsedState = parseCourseStateJson(stateData, s.baseUrl);
          if (parsedState.length) {
            return { courseUrl, sections: await enrichFormats(parsedState) };
          }
        } catch { /* Fall back to HTML parsing below. */ }
      }

      // 2. HTML fallback: fetch course page + any multi-page/topic sub-section links (?section=N or /course/section.php?id=N)
      const res = await authedFetch(courseUrl);
      if (!res.ok) throw Error(`Could not load course (HTTP ${res.status}).`);
      if (/\/login\/index\.php|SAMLRequest/i.test(res.url || '')) {
        throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
      }
      const html = await res.text();
      const sessMatch = html.match(/"sesskey"\s*:\s*"([^"]+)"/);
      if (sessMatch && sessMatch[1] && sessMatch[1] !== s.sesskey) {
        s.sesskey = sessMatch[1];
        await saveSession(s);
        // Retry Moodle 4.x AJAX state now that we have a fresh sesskey!
        try {
          const stateData = await ajaxCall('core_courseformat_get_state', { courseid: cid });
          const parsedState = parseCourseStateJson(stateData, s.baseUrl);
          if (parsedState.length) {
            return { courseUrl, sections: await enrichFormats(parsedState, html) };
          }
        } catch { /* continue with HTML */ }
      }

      const sections = parseCourseSectionsFromHtml(html, s.baseUrl);
      const subUrls = extractSubSectionUrls(html, s.baseUrl, cid);
      if (subUrls.length) {
        const seenItemUrls = new Set(sections.flatMap((sec) => sec.items.map((it) => it.url)));
        for (let i = 0; i < subUrls.length; i += 4) {
          const batch = subUrls.slice(i, i + 4);
          const pages = await Promise.all(batch.map((u) => authedFetch(u).then((r) => (r.ok ? r.text() : '')).catch(() => '')));
          for (const subHtml of pages) {
            if (!subHtml) continue;
            for (const subSec of parseCourseSectionsFromHtml(subHtml, s.baseUrl)) {
              const freshItems = subSec.items.filter((it) => !seenItemUrls.has(it.url));
              if (!freshItems.length) continue;
              for (const it of freshItems) seenItemUrls.add(it.url);
              const existing = sections.find((sec) => sec.name === subSec.name);
              if (existing) existing.items.push(...freshItems);
              else sections.push({ ...subSec, items: freshItems });
            }
          }
        }
      }
      return { courseUrl, sections };
    },

    async getFolderFiles(folderUrl) {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      const res = await authedFetch(folderUrl);
      if (!res.ok) throw Error(`Could not open folder (HTTP ${res.status}).`);
      if (/\/login\/index\.php|SAMLRequest/i.test(res.url || '')) {
        throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
      }
      const html = await res.text();
      return parseFolderFilesFromHtml(html, s.baseUrl);
    },

    async downloadFile(fileUrl, fallbackName = 'document') {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      let target = String(fileUrl || '').trim();
      if (!target) throw Error('Missing Moodle file URL.');
      if (s.token && /\/pluginfile\.php\//i.test(target) && !target.includes('token=')) {
        target = appendTokenIfSameOrigin(target, s.baseUrl, s.token);
      }
      const res = await authedFetch(target);
      if (!res.ok) throw Error(`Download failed (HTTP ${res.status}).`);
      if (/\/login\/index\.php|SAMLRequest/i.test(res.url || '')) {
        throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
      }
      const ct = String(res.headers.get('content-type') || '');
      // If /mod/resource/view.php returned an HTML wrapper instead of redirecting directly, follow its pluginfile link.
      if (ct.includes('text/html') && /\/mod\/resource\/view\.php/i.test(target)) {
        const html = await res.text();
        const inner = html.match(/href=["']([^"']*\/pluginfile\.php\/[^"']+)["']/i)
          || html.match(/src=["']([^"']*\/pluginfile\.php\/[^"']+)["']/i);
        if (inner) {
          return this.downloadFile(new URL(decodeHtmlEntities(inner[1]), s.baseUrl).href, fallbackName);
        }
        throw Error('This Moodle resource is a web page rather than a downloadable file. Use "Open in browser" to view it.');
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const name = extractFilenameFromResponse(res, target, fallbackName);
      return { bytes: buf, name, mimeType: ct.split(';')[0].trim() || 'application/octet-stream' };
    },

    async fetchImageDataUrl(imageUrl) {
      const s = await loadSession();
      if (!s?.baseUrl) return '';
      const raw = String(imageUrl || '').trim();
      if (!raw) return '';
      if (raw.startsWith('data:image/')) return raw;
      let target = raw;
      try { target = new URL(raw, s.baseUrl).href; } catch { return ''; }
      if (s.token && !target.includes('token=')) {
        // Moodle's /pluginfile.php/ requires /webservice/pluginfile.php/ when authenticating via wstoken.
        const wsTarget = /\/pluginfile\.php\//i.test(target) && !/\/webservice\/pluginfile\.php\//i.test(target)
          ? target.replace(/\/pluginfile\.php\//i, '/webservice/pluginfile.php/')
          : target;
        target = appendTokenIfSameOrigin(wsTarget, s.baseUrl, s.token);
      }
      const res = await authedFetch(target);
      if (!res.ok) return '';
      const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ct.startsWith('image/')) return '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 6 * 1024 * 1024) return '';
      return `data:${ct};base64,${buf.toString('base64')}`;
    },

    // ---- Student Bridge tools (deadlines, grades, announcements, assignments, MCP config) ----

    async getUpcomingDeadlines({ days = 30 } = {}) {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      const now = Math.floor(Date.now() / 1000);
      const limit = now + Math.max(1, Number(days) || 30) * 86400;

      const mergeIcsDeadlines = async (baseEvents) => {
        if (!s.icsUrl) return baseEvents;
        let fresh = [];
        try {
          const res = await fetcher(s.icsUrl);
          if (res.ok) fresh = parseIcsEvents(await res.text(), s.baseUrl);
        } catch { /* Keep cached ICS events if offline */ }
        const byUid = new Map();
        for (const ev of Array.isArray(s.icsCache) ? s.icsCache : []) if (ev?.uid) byUid.set(ev.uid, ev);
        for (const ev of fresh) if (ev?.uid) byUid.set(ev.uid, ev);
        if (fresh.length) {
          s.icsCache = [...byUid.values()].sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0)).slice(-200);
          await saveSession(s).catch(() => {});
        }
        const seen = new Set(baseEvents.map((e) => `${String(e.name || '').toLowerCase()}@${Math.floor((e.dueAt || 0) / 60000)}`));
        const nowMs = Date.now(), limitMs = limit * 1000;
        const extras = [...byUid.values()].filter((ev) => {
          if (ev.dueAt && (ev.dueAt < nowMs - 86400000 || ev.dueAt > limitMs)) return false;
          const k = `${String(ev.name || '').toLowerCase()}@${Math.floor((ev.dueAt || 0) / 60000)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return [...baseEvents, ...extras].sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity));
      };

      const enrichSubmissionStatus = async (events) => {
        if (!s.token || !events.length) return events;
        const targets = events.slice(0, 20);
        await mapLimit(targets, 4, async (ev) => {
          if (!ev.instance) return;
          if (ev.modname === 'assign') {
            try {
              const st = await restCall('mod_assign_get_submission_status', { assignid: ev.instance });
              const subStatus = st?.lastattempt?.submission?.status || '';
              if (subStatus === 'submitted') {
                ev.submitted = true;
                ev.statusLabel = 'Submitted';
              } else {
                ev.submitted = false;
                ev.statusLabel = 'Pending';
              }
            } catch { /* Optional */ }
          } else if (ev.modname === 'quiz') {
            try {
              const res = await restCall('mod_quiz_get_user_attempts', { quizid: ev.instance, status: 'finished' });
              const attempts = Array.isArray(res?.attempts) ? res.attempts : [];
              ev.submitted = attempts.length > 0;
              ev.statusLabel = ev.submitted ? 'Completed' : 'Pending';
            } catch { /* Optional */ }
          }
        });
        return events;
      };

      if (s.token) {
        try {
          const data = await restCall('core_calendar_get_action_events_by_timesort', {
            timesortfrom: now,
            timesortto: limit,
            limitnum: 40,
          });
          let list = (data?.events || []).map((ev) => ({
            id: Number(ev.id),
            instance: Number(ev.instance || 0),
            name: decodeHtmlEntities(ev.name || 'Deadline'),
            course: decodeHtmlEntities(ev.course?.fullname || ''),
            courseId: Number(ev.course?.id || 0),
            dueAt: Number(ev.timesort || ev.timestart || 0) * 1000,
            modname: ev.modulename || 'event',
            url: ev.url || new URL('/calendar/view.php?view=upcoming', s.baseUrl).href,
          }));
          if (!list.length) {
            const cal = await restCall('core_calendar_get_calendar_events', {
              'options[timestart]': now,
              'options[timeend]': limit,
              'options[userevents]': 1,
              'options[siteevents]': 1,
            }).catch(() => null);
            list = (cal?.events || []).map((ev) => ({
              id: Number(ev.id),
              instance: Number(ev.instance || 0),
              name: decodeHtmlEntities(ev.name || 'Deadline'),
              course: '',
              courseId: Number(ev.courseid || 0),
              dueAt: Number(ev.timestart || 0) * 1000,
              modname: ev.modulename || 'event',
              url: new URL('/calendar/view.php?view=upcoming', s.baseUrl).href,
            }));
          }
          await enrichSubmissionStatus(list);
          return mergeIcsDeadlines(list);
        } catch (err) {
          if (/invalid|expired/i.test(String(err?.message || ''))) throw err;
          /* fall through */
        }
      }

      if (s.sesskey) {
        try {
          const data = await ajaxCall('core_calendar_get_action_events_by_timesort', {
            timesortfrom: now,
            timesortto: limit,
            limitnum: 40,
          });
          return (data?.events || []).map((ev) => ({
            id: Number(ev.id),
            name: decodeHtmlEntities(ev.name || 'Deadline'),
            course: decodeHtmlEntities(ev.course?.fullname || ''),
            courseId: Number(ev.course?.id || 0),
            dueAt: Number(ev.timesort || ev.timestart || 0) * 1000,
            modname: ev.modulename || 'event',
            url: ev.url || new URL('/calendar/view.php?view=upcoming', s.baseUrl).href,
          }));
        } catch { /* fall through to HTML */ }
      }

      const calUrl = new URL('/calendar/view.php?view=upcoming', s.baseUrl).href;
      const res = await authedFetch(calUrl);
      if (!res.ok) return [];
      const html = await res.text();
      const events = [];
      const cardRe = /<div\b[^>]*class=["'][^"']*event\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
      let m;
      while ((m = cardRe.exec(html))) {
        const block = m[1];
        const title = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
        const link = block.match(/href=["']([^"']*\/mod\/[^"']+)["']/i);
        const dateText = block.match(/class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
        if (title) {
          events.push({
            id: events.length + 1,
            name: stripTags(title[1]),
            course: '',
            courseId: 0,
            dueLabel: dateText ? stripTags(dateText[1]) : '',
            dueAt: 0,
            modname: 'event',
            url: link ? new URL(decodeHtmlEntities(link[1]), s.baseUrl).href : calUrl,
          });
        }
      }
      return mergeIcsDeadlines(events);
    },

    async getGrades(courseId = 0) {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      const cid = Number(courseId) || 0;
      const pageUrl = cid
        ? new URL(`/grade/report/user/index.php?id=${cid}`, s.baseUrl).href
        : new URL('/grade/report/overview/index.php', s.baseUrl).href;

      if (s.token && s.userId && cid) {
        try {
          const data = await restCall('gradereport_user_get_grade_items', { courseid: cid, userid: s.userId });
          const items = (data?.usergrades?.[0]?.gradeitems || []).map((g) => ({
            name: decodeHtmlEntities(g.itemname || g.itemtype || 'Course total'),
            grade: decodeHtmlEntities(g.gradeformatted || (g.graderaw != null ? String(g.graderaw) : '—')),
            range: g.grademax != null ? `${g.grademin ?? 0}–${g.grademax}` : '',
            percentage: decodeHtmlEntities(g.percentageformatted || ''),
            feedback: stripTags(g.feedback || ''),
            url: pageUrl,
          }));
          if (items.length) return { url: pageUrl, items };
        } catch { /* fall through */ }
      }

      const res = await authedFetch(pageUrl);
      if (!res.ok) return { url: pageUrl, items: [] };
      const html = await res.text();
      const items = [];
      const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let m;
      while ((m = rowRe.exec(html))) {
        const row = m[1];
        const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]));
        if (cells.length >= 2 && cells[0] && !/^(course name|grade item|elemento de calificación|curso)$/i.test(cells[0])) {
          const linkMatch = row.match(/href=["']([^"']*\/grade\/report\/user\/index\.php[^"']+)["']/i);
          items.push({
            name: cells[0],
            grade: cells[1] || '—',
            range: cells[2] || '',
            percentage: cells[3] || '',
            feedback: cells[4] || '',
            url: linkMatch ? new URL(decodeHtmlEntities(linkMatch[1]), s.baseUrl).href : pageUrl,
          });
        }
      }
      return { url: pageUrl, items: items.slice(0, 80) };
    },

    async getAnnouncements(courseId = 0) {
      const s = await loadSession();
      if (!s?.baseUrl) throw Error('Not connected to Moodle.');
      const cid = Number(courseId) || 0;
      const listUrl = cid
        ? new URL(`/mod/forum/index.php?id=${cid}`, s.baseUrl).href
        : new URL('/my/', s.baseUrl).href;

      if (s.token) {
        try {
          let courseIds = cid ? [cid] : [];
          const courseNames = new Map();
          if (!courseIds.length) {
            const enrolled = await this.listCourses().catch(() => []);
            for (const c of enrolled.slice(0, 12)) {
              courseIds.push(c.id);
              courseNames.set(c.id, c.fullname);
            }
          }
          if (courseIds.length) {
            const forums = await restCall('mod_forum_get_forums_by_courses', { courseids: courseIds });
            const list = Array.isArray(forums) ? forums : [];
            const news = list.filter((f) => f.type === 'news');
            const chosen = (news.length ? news : list).slice(0, 12);
            const buckets = await mapLimit(chosen, 4, async (f) => {
              try {
                const res = await restCall('mod_forum_get_forum_discussions', { forumid: f.id, perpage: 5 });
                return (res?.discussions || []).map((d) => ({
                  name: decodeHtmlEntities(d.subject || d.name || f.name || 'Announcement'),
                  course: courseNames.get(Number(f.course)) || decodeHtmlEntities(f.name || ''),
                  author: decodeHtmlEntities(d.userfullname || ''),
                  createdAt: Number(d.created || d.timemodified || 0) * 1000,
                  snippet: stripTags(d.message || '').slice(0, 180),
                  url: new URL(`/mod/forum/discuss.php?d=${d.discussion || d.id}`, s.baseUrl).href,
                }));
              } catch {
                return [];
              }
            });
            const items = buckets.flat().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 40);
            if (items.length) return { url: listUrl, items };
          }
        } catch (err) {
          if (/invalid|expired/i.test(String(err?.message || ''))) throw err;
          /* fall through to HTML */
        }
      }

      const res = await authedFetch(listUrl);
      if (!res.ok) return { url: listUrl, items: [] };
      const html = await res.text();
      const items = [];
      const seen = new Set();
      const linkRe = /<a\b[^>]*href=["']([^"']*\/mod\/forum\/(?:view|discuss)\.php\?[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRe.exec(html))) {
        const abs = new URL(decodeHtmlEntities(m[1]), s.baseUrl).href;
        const name = stripTags(m[2]);
        if (!name || seen.has(abs)) continue;
        seen.add(abs);
        items.push({ name, url: abs });
      }
      return { url: listUrl, items: items.slice(0, 40) };
    },

    async getMcpConfig() {
      const s = await loadSession();
      const baseUrl = s?.baseUrl || MOODLE_PRESETS[0].baseUrl;
      return {
        baseUrl,
        openMoodle: {
          name: 'open-moodle',
          command: 'uvx',
          args: ['open-moodle'],
          env: { MOODLE_URL: baseUrl },
          docsUrl: 'https://glama.ai/mcp/servers/sonstellar969/open-moodle',
        },
        studentBridge: {
          name: 'moodle-student-bridge',
          command: 'npx',
          args: ['-y', 'moodle-student-bridge'],
          env: { MOODLE_BASE_URL: baseUrl, MOODLE_TOKEN: s?.token ? '<saved-in-notecomplete>' : '<your-moodle-mobile-token>' },
          docsUrl: 'https://www.npmjs.com/package/moodle-student-bridge',
        },
      };
    },
  };
}
