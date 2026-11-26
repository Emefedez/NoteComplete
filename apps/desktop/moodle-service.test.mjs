import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MOODLE_PRESETS,
  normalizeBaseUrl,
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
