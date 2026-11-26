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
      items.push({
        id: cmid ? `cm:${cmid}` : `url:${absUrl}`,
        cmid,
        name,
        modname,
        url: absUrl,
        downloadUrl,
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
    if (!name) {
      try { name = decodeURIComponent(path.basename(new URL(absUrl).pathname)); } catch { name = 'file'; }
    }
    files.push({
      id: `url:${absUrl}`,
      name,
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
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const res = await fetcher(url.href, { method: 'POST', body });
    if (!res.ok) throw Error(`Moodle API error (HTTP ${res.status}).`);
    const data = await res.json();
    if (data?.exception) throw Error(data.message || data.exception);
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

    async signIn({ presetId = 'moovi-uvigo', baseUrl = '', ssoUrl = '', token = '', label = '' } = {}) {
      const preset = MOODLE_PRESETS.find((p) => p.id === presetId);
      const normBase = normalizeBaseUrl(baseUrl || preset?.baseUrl || '');
      if (!normBase) throw Error('Enter a valid Moodle server URL (e.g. https://moovi.uvigo.gal).');
      const normSso = String(ssoUrl || preset?.ssoUrl || '').trim() || new URL('/login/index.php', normBase).href;
      const cleanLabel = String(label || preset?.label || new URL(normBase).hostname).trim();
      const cleanToken = String(token || '').trim();

      if (cleanToken) {
        const url = new URL('/webservice/rest/server.php', normBase);
        const body = new URLSearchParams({
          wstoken: cleanToken,
          wsfunction: 'core_webservice_get_site_info',
          moodlewsrestformat: 'json',
        });
        const res = await fetcher(url.href, { method: 'POST', body });
        if (!res.ok) throw Error(`Could not reach Moodle at ${normBase} (HTTP ${res.status}).`);
        const info = await res.json();
        if (info?.exception) throw Error(info.message || 'Invalid Moodle token.');
        const next = {
          presetId,
          label: cleanLabel,
          baseUrl: normBase,
          ssoUrl: normSso,
          token: cleanToken,
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
      const ssoResult = await openSsoWindow({ baseUrl: normBase, ssoUrl: normSso, label: cleanLabel });
      if (!ssoResult?.cookies) throw Error('Moodle SSO sign-in did not complete.');
      const next = {
        presetId,
        label: cleanLabel,
        baseUrl: normBase,
        ssoUrl: normSso,
        token: ssoResult.token || '',
        cookies: ssoResult.cookies,
        sesskey: ssoResult.sesskey || '',
        userName: ssoResult.userName || '',
        userId: Number(ssoResult.userId) || 0,
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
        const list = await restCall('core_enrol_get_users_courses', { userid: s.userId });
        return (Array.isArray(list) ? list : []).map((c) => ({
          id: Number(c.id),
          fullname: c.fullname || c.displayname || `Course ${c.id}`,
          shortname: c.shortname || '',
          viewurl: new URL(`/course/view.php?id=${c.id}`, s.baseUrl).href,
        }));
      }

      // Try Moodle AJAX enrolled courses first (fast & clean JSON)
      if (s.sesskey) {
        try {
          const data = await ajaxCall('core_course_get_enrolled_courses_by_timeline_classification', {
            offset: 0,
            limit: 100,
            classification: 'all',
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
            }));
          }
        } catch { /* Fall back to HTML parsing below. */ }
      }

      // Fallback: parse /my/courses.php and /my/ with authenticated session cookies
      for (const rel of ['/my/courses.php', '/my/']) {
        const res = await authedFetch(new URL(rel, s.baseUrl).href);
        if (!res.ok) continue;
        const html = await res.text();
        if (/\/login\/index\.php|SAMLRequest/i.test(res.url || '')) {
          throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
        }
        const sessMatch = html.match(/"sesskey"\s*:\s*"([^"]+)"/);
        if (sessMatch && sessMatch[1] && sessMatch[1] !== s.sesskey) {
          s.sesskey = sessMatch[1];
          await saveSession(s);
        }
        const parsed = parseCoursesFromHtml(html, s.baseUrl);
        if (parsed.length) return parsed;
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
            return {
              id: `cm:${mod.id}`,
              cmid: Number(mod.id),
              name: decodeHtmlEntities(mod.name || firstFile?.filename || 'Resource'),
              modname: mod.modname || 'resource',
              url: mod.url || courseUrl,
              downloadUrl: firstFile?.fileurl || '',
              fileName: firstFile?.filename || '',
              size: Number(firstFile?.filesize || 0),
              isFolder,
              isDownloadable,
              folderFiles: isFolder ? files.map((f) => ({
                id: `url:${f.fileurl}`,
                name: f.filename || 'file',
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

      const res = await authedFetch(courseUrl);
      if (!res.ok) throw Error(`Could not load course (HTTP ${res.status}).`);
      if (/\/login\/index\.php|SAMLRequest/i.test(res.url || '')) {
        throw Error('Your Moodle SSO session expired. Click Reconnect to sign in again.');
      }
      const html = await res.text();
      return { courseUrl, sections: parseCourseSectionsFromHtml(html, s.baseUrl) };
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
        const u = new URL(target);
        u.searchParams.set('token', s.token);
        target = u.href;
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
      if (s.token && /\/pluginfile\.php\//i.test(target) && !target.includes('token=')) {
        const u = new URL(target);
        u.searchParams.set('token', s.token);
        target = u.href;
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

      if (s.token) {
        try {
          const data = await restCall('core_calendar_get_action_events_by_timesort', {
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
        } catch { /* fall through */ }
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
      return events;
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
