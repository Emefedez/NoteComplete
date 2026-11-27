import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MOODLE_PRESETS,
  normalizeBaseUrl,
  buildMobileLaunchUrl,
  parseMobileTokenUrl,
  appendTokenIfSameOrigin,
  parseIcsEvents,
  parseCoursesFromHtml,
  parseCourseStateJson,
  extractSubSectionUrls,
  parseCourseSectionsFromHtml,
  parseFolderFilesFromHtml,
  inferMoodleFileFormat,
  extractModuleFormatsFromHtml,
  extractFilenameFromResponse,
  createMoodleService,
} from './moodle-service.js';

test('MOODLE_PRESETS includes UVIGO Moovi with SAML2 SSO URL', () => {
  const uvigo = MOODLE_PRESETS.find((p) => p.id === 'moovi-uvigo');
  assert.ok(uvigo);
  assert.equal(uvigo.baseUrl, 'https://moovi.uvigo.gal');
  assert.match(uvigo.ssoUrl, /\/auth\/saml2\/login\.php\?wants&idp=4392f08b6ac39007b320261f51af7b22&passive=off/);
  assert.equal(normalizeBaseUrl('moovi.uvigo.gal/'), 'https://moovi.uvigo.gal');
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), '');
});

test('HTML parsers extract courses, sections, resources, and folder files', () => {
  const base = 'https://moovi.uvigo.gal';
  const courses = parseCoursesFromHtml(
    `<a href="https://moovi.uvigo.gal/course/view.php?id=101"><span>Algoritmos y Estructuras de Datos II</span></a>
     <a href="/course/view.php?id=202">Sistemas Operativos</a>`,
    base,
  );
  assert.equal(courses.length, 2);
  assert.equal(courses[0].id, 101);
  assert.equal(courses[0].fullname, 'Algoritmos y Estructuras de Datos II');

  const sections = parseCourseSectionsFromHtml(
    `<li id="section-1">
       <h3 class="sectionname">Tema 1: Grafos</h3>
       <a href="/mod/resource/view.php?id=55">Apuntes Grafos.pdf File</a>
       <a href="/mod/folder/view.php?id=56">Prácticas Folder</a>
       <a href="/mod/assign/view.php?id=57">Entrega 1 Assignment</a>
     </li>`,
    base,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'Tema 1: Grafos');
  assert.equal(sections[0].items.length, 3);
  assert.equal(sections[0].items[0].isDownloadable, true);
  assert.match(sections[0].items[0].downloadUrl, /redirect=1/);
  assert.equal(sections[0].items[1].isFolder, true);
  assert.equal(sections[0].items[2].modname, 'assign');

  const files = parseFolderFilesFromHtml(
    `<a href="https://moovi.uvigo.gal/pluginfile.php/123/mod_folder/content/0/Lab1.pdf">Lab1.pdf</a>`,
    base,
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'Lab1.pdf');
  assert.equal(files[0].isDownloadable, true);

  const fromState = parseCourseStateJson(JSON.stringify({
    section: [
      { id: 10, number: 1, title: 'Tema 1: Requisitos', cmlist: [501, 502] },
    ],
    cm: [
      { id: 501, name: 'Transparencias T1', module: 'resource', url: 'https://moovi.uvigo.gal/mod/resource/view.php?id=501' },
      { id: 502, name: 'Boletines', module: 'folder', url: 'https://moovi.uvigo.gal/mod/folder/view.php?id=502' },
    ],
  }), base);
  assert.equal(fromState.length, 1);
  assert.equal(fromState[0].name, 'Tema 1: Requisitos');
  assert.equal(fromState[0].items.length, 2);
  assert.equal(fromState[0].items[0].isDownloadable, true);
  assert.equal(fromState[0].items[1].isFolder, true);

  const subUrls = extractSubSectionUrls(
    `<a href="/course/view.php?id=99&amp;section=1">Tema 1</a><a href="/course/section.php?id=444">Tema 2</a>`,
    base,
    99,
  );
  assert.equal(subUrls.length, 2);
});

test('inferMoodleFileFormat & extractModuleFormatsFromHtml detect PDF, R, video, web, and Moodle icons', () => {
  assert.equal(inferMoodleFileFormat({ name: 'Script1.R', modname: 'resource' }), 'R');
  assert.equal(inferMoodleFileFormat({ name: 'Tema 1', iconUrl: 'https://moovi.uvigo.gal/theme/image.php/moove/core/1/f/pdf-24' }), 'PDF');
  assert.equal(inferMoodleFileFormat({ name: 'Clase grabada', url: 'https://tv.uvigo.es/video/1234', modname: 'url' }), 'VIDEO');
  assert.equal(inferMoodleFileFormat({ name: 'Documentación oficial', url: 'https://cran.r-project.org', modname: 'url' }), 'WEB');
  assert.equal(inferMoodleFileFormat({ name: 'Demo', fileName: 'demo.mp4', modname: 'file' }), 'MP4');

  const html = `
    <li id="module-701"><img src="/theme/image.php/boost/core/1/f/pdf-24" /><a href="/mod/resource/view.php?id=701">Tema 1</a></li>
    <li id="module-702"><img src="/theme/image.php/boost/core/1/f/powerpoint" /><a href="/mod/resource/view.php?id=702">Diapositivas</a></li>
    <li id="module-703"><span class="resourcelinkdetails">14 MB Vídeo MP4</span><a href="/mod/resource/view.php?id=703">Grabación</a></li>
  `;
  const map = extractModuleFormatsFromHtml(html);
  assert.equal(map.get(701), 'PDF');
  assert.equal(map.get(702), 'PPT');
  assert.equal(map.get(703), 'VIDEO');
});

test('extractFilenameFromResponse decodes Content-Disposition and URL fallback', () => {
  const fakeRes = {
    url: 'https://moovi.uvigo.gal/pluginfile.php/1/mod_resource/content/1/Tema%201.pdf',
    headers: { get: () => "attachment; filename*=UTF-8''Tema%201%20Grafos.pdf" },
  };
  assert.equal(extractFilenameFromResponse(fakeRes), 'Tema 1 Grafos.pdf');
});

test('createMoodleService persists SSO session, lists courses, downloads files, and disconnects', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-moodle-'));
  try {
    const service = createMoodleService({
      sessionFile: path.join(dir, 'moodle-session.json'),
      openSsoWindow: async ({ baseUrl, ssoUrl }) => {
        assert.equal(baseUrl, 'https://moovi.uvigo.gal');
        assert.match(ssoUrl, /saml2/);
        return { cookies: 'MoodleSession=abc123', sesskey: 'sk999', userName: 'Student UVIGO', userId: 42 };
      },
      fetcher: async (url) => {
        const s = String(url);
        if (s.includes('/lib/ajax/service.php')) {
          return new Response(JSON.stringify([{
            error: false,
            data: { courses: [{ id: 101, fullname: 'AED II', shortname: 'AED2', viewurl: 'https://moovi.uvigo.gal/course/view.php?id=101' }] },
          }]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (s.includes('/pluginfile.php/')) {
          return new Response(new Uint8Array([37, 80, 68, 70]), {
            status: 200,
            headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Tema1.pdf"' },
          });
        }
        return new Response('', { status: 404 });
      },
    });

    const session = await service.signIn({ presetId: 'moovi-uvigo' });
    assert.equal(session.connected, true);
    assert.equal(session.userName, 'Student UVIGO');

    const courses = await service.listCourses();
    assert.equal(courses.length, 1);
    assert.equal(courses[0].fullname, 'AED II');

    const dl = await service.downloadFile('https://moovi.uvigo.gal/pluginfile.php/1/Tema1.pdf');
    assert.equal(dl.name, 'Tema1.pdf');
    assert.equal(dl.mimeType, 'application/pdf');
    assert.deepEqual([...dl.bytes], [37, 80, 68, 70]);

    const mcp = await service.getMcpConfig();
    assert.equal(mcp.baseUrl, 'https://moovi.uvigo.gal');
    assert.equal(mcp.openMoodle.name, 'open-moodle');
    assert.equal(mcp.studentBridge.name, 'moodle-student-bridge');

    await service.disconnect();
    assert.equal(await service.getSession(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listCourses retries AJAX after refreshing rotated sesskey and flags logged-out HTML as expired', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-moodle-retry-'));
  try {
    let ajaxCalls = 0;
    const service = createMoodleService({
      sessionFile: path.join(dir, 'moodle-session.json'),
      openSsoWindow: async () => ({ cookies: 'MoodleSession=valid', sesskey: 'stale', userName: 'Student', userId: 7 }),
      fetcher: async (url) => {
        const s = String(url);
        if (s.includes('/lib/ajax/service.php')) {
          ajaxCalls++;
          if (s.includes('sesskey=stale')) {
            return new Response(JSON.stringify([{ error: true, exception: { errorcode: 'invalidsesskey', message: 'Invalid sesskey' } }]), { status: 200 });
          }
          if (s.includes('sesskey=fresh')) {
            return new Response(JSON.stringify([{ error: false, data: { courses: [{ id: 55, fullname: 'Estadística', shortname: 'EST' }] } }]), { status: 200 });
          }
        }
        if (s.includes('/my/courses.php')) {
          return new Response('<body class="pagelayout-mycourses"><script>M.cfg={"sesskey":"fresh","userId":7};</script></body>', { status: 200 });
        }
        return new Response('', { status: 404 });
      },
    });
    await service.signIn({ presetId: 'moovi-uvigo' });
    const courses = await service.listCourses();
    assert.equal(ajaxCalls, 2);
    assert.equal(courses.length, 1);
    assert.equal(courses[0].fullname, 'Estadística');

    // Logged-out HTML page with guest sesskey must report expired session, not empty courses.
    const expiredService = createMoodleService({
      sessionFile: path.join(dir, 'moodle-expired.json'),
      openSsoWindow: async () => ({ cookies: 'MoodleSession=old', sesskey: 'old', userName: 'Student', userId: 7 }),
      fetcher: async (url) => {
        const s = String(url);
        if (s.includes('/lib/ajax/service.php')) {
          return new Response(JSON.stringify([{ error: true, exception: { errorcode: 'servicerequireslogin', message: 'Login required' } }]), { status: 200 });
        }
        return new Response('<body class="notloggedin"><script>M.cfg={"sesskey":"guest123","userId":0};</script></body>', { status: 200 });
      },
    });
    await expiredService.signIn({ presetId: 'moovi-uvigo' });
    await assert.rejects(() => expiredService.listCourses(), /SSO session expired/i);

    // Force sign-in clears SSO cookies before opening the login window.
    const events = [];
    const forceService = createMoodleService({
      sessionFile: path.join(dir, 'moodle-force.json'),
      clearSsoCookies: async () => { events.push('clear'); },
      openSsoWindow: async () => { events.push('open'); return { cookies: 'MoodleSession=new', sesskey: 'sk2', userName: 'Student', userId: 7 }; },
    });
    await forceService.signIn({ presetId: 'moovi-uvigo', force: true });
    assert.deepEqual(events, ['clear', 'open']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mobile token URL, same-origin token guard, ICS parser, submission status, and REST forums', async () => {
  const launch = buildMobileLaunchUrl('https://moovi.uvigo.gal', 'abc123');
  assert.equal(launch, 'https://moovi.uvigo.gal/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=abc123&urlscheme=moodlemobile');

  const payload = Buffer.from('sig999:::tok_secret_42:::priv_7').toString('base64');
  assert.deepEqual(parseMobileTokenUrl(`moodlemobile://token=${payload}`), {
    signature: 'sig999',
    token: 'tok_secret_42',
    privateToken: 'priv_7',
  });
  assert.equal(parseMobileTokenUrl('https://moovi.uvigo.gal/my/'), null);

  // Token only appended on https + same origin
  assert.match(appendTokenIfSameOrigin('https://moovi.uvigo.gal/pluginfile.php/1/a.pdf', 'https://moovi.uvigo.gal', 'tok1'), /token=tok1/);
  assert.doesNotMatch(appendTokenIfSameOrigin('https://evil.example.com/a.pdf', 'https://moovi.uvigo.gal', 'tok1'), /token=/);
  assert.doesNotMatch(appendTokenIfSameOrigin('http://moovi.uvigo.gal/pluginfile.php/1/a.pdf', 'https://moovi.uvigo.gal', 'tok1'), /token=/);

  // ICS parser with Galician suffixes
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ev1@moovi',
    'SUMMARY:Práctica 2 está pendente de entrega',
    'CATEGORIES:2627-AEDII',
    'DTSTART:20261201T225900Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ev2@moovi',
    'SUMMARY:Cuestionario T3 pecha',
    'DTSTART:20261202T180000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const icsEvents = parseIcsEvents(ics, 'https://moovi.uvigo.gal');
  assert.equal(icsEvents.length, 2);
  assert.equal(icsEvents[0].eventKind, 'due');
  assert.equal(icsEvents[0].modname, 'assign');
  assert.equal(icsEvents[0].course, '2627-AEDII');
  assert.equal(icsEvents[1].eventKind, 'closes');
  assert.equal(icsEvents[1].modname, 'quiz');

  // REST deadlines submission status + REST forum announcements + invalidtoken error
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-moodle-rest-'));
  try {
    let invalidMode = false;
    const svc = createMoodleService({
      sessionFile: path.join(dir, 'moodle-rest.json'),
      openSsoWindow: async ({ mobileLaunchUrl }) => {
        assert.match(mobileLaunchUrl, /\/admin\/tool\/mobile\/launch\.php/);
        return { token: 'mobtok_1', cookies: '', sesskey: '', userName: '', userId: 0 };
      },
      fetcher: async (url, opts) => {
        const s = String(url);
        if (s.includes('/webservice/rest/server.php')) {
          const params = new URLSearchParams(opts?.body?.toString() || '');
          const fn = params.get('wsfunction');
          if (invalidMode) {
            return new Response(JSON.stringify({ errorcode: 'invalidtoken', message: 'Invalid token' }), { status: 200 });
          }
          if (fn === 'core_webservice_get_site_info') return new Response(JSON.stringify({ userid: 99, fullname: 'Ana UVigo' }), { status: 200 });
          if (fn === 'core_calendar_get_action_events_by_timesort') {
            return new Response(JSON.stringify({
              events: [
                { id: 1, instance: 10, modulename: 'assign', name: 'Entrega 1', timesort: Math.floor(Date.now() / 1000) + 3600, course: { id: 5, fullname: 'SO' } },
                { id: 2, instance: 20, modulename: 'quiz', name: 'Test 1', timesort: Math.floor(Date.now() / 1000) + 7200, course: { id: 5, fullname: 'SO' } },
              ],
            }), { status: 200 });
          }
          if (fn === 'mod_assign_get_submission_status') return new Response(JSON.stringify({ lastattempt: { submission: { status: 'submitted' } } }), { status: 200 });
          if (fn === 'mod_quiz_get_user_attempts') return new Response(JSON.stringify({ attempts: [] }), { status: 200 });
          if (fn === 'mod_forum_get_forums_by_courses') return new Response(JSON.stringify([{ id: 300, course: 5, type: 'news', name: 'Avisos' }]), { status: 200 });
          if (fn === 'mod_forum_get_forum_discussions') return new Response(JSON.stringify({ discussions: [{ id: 1, discussion: 77, subject: 'Cambio de aula', userfullname: 'Prof. X', created: 1700000000, message: '<p>Mañana en el aula 4.</p>' }] }), { status: 200 });
        }
        return new Response('', { status: 404 });
      },
    });
    const sess = await svc.signIn({ presetId: 'moovi-uvigo' });
    assert.equal(sess.authMode, 'token');
    assert.equal(sess.userName, 'Ana UVigo');
    assert.equal(sess.userId, 99);

    const deadlines = await svc.getUpcomingDeadlines({ days: 7 });
    assert.equal(deadlines.length, 2);
    assert.equal(deadlines[0].submitted, true);
    assert.equal(deadlines[0].statusLabel, 'Submitted');
    assert.equal(deadlines[1].submitted, false);
    assert.equal(deadlines[1].statusLabel, 'Pending');

    const ann = await svc.getAnnouncements(5);
    assert.equal(ann.items.length, 1);
    assert.equal(ann.items[0].name, 'Cambio de aula');
    assert.equal(ann.items[0].snippet, 'Mañana en el aula 4.');
    assert.match(ann.items[0].url, /discuss\.php\?d=77/);

    invalidMode = true;
    await assert.rejects(() => svc.listCourses(), /Sign in again/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
