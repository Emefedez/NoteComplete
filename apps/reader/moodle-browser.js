// Moodle Cloud Browser & Student Sidebar for NoteComplete:
//  - Lets you pick your Moodle (Moovi — UVIGO pre-configured with SAML2 SSO, or any custom Moodle).
//  - Navigate Courses → Sections / Folders → Resources directly inside NoteComplete.
//  - Normal download (click to open & save to library) AND bulk download (Queue / Select / Queue all).
//  - "Open in browser" button opens the EXACT page you are viewing (dashboard, course, folder, or item).
//  - Moodle Student Sidebar (floating panel): Upcoming deadlines, Grades, Announcements,
//    Ask AI about your Moodle context, and MCP setup snippets (`open-moodle` / `moodle-student-bridge`).
import { icon } from './icons.js';
import { floatingWindow } from './floating.js';
import { queueButton, selectionCheck, updateQueueControls as queueControls } from './queue-controls.js';

const CONFIG_KEY = 'notecomplete-moodle-config-v1';

const FALLBACK_PRESETS = [
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
];

export function moodleBrowser({
  api = globalThis.notecompleteMoodle,
  open,
  library = null,
  queue = null,
  ai = null,
  status = () => {},
  onCards = () => {},
  store = globalThis.localStorage,
} = {}) {
  const $ = (id) => document.getElementById(id);
  const readCfg = () => { try { return JSON.parse(store?.getItem(CONFIG_KEY) || '{}') || {}; } catch { return {}; } };
  const saveCfg = (c) => { try { store?.setItem(CONFIG_KEY, JSON.stringify(c)); } catch { /* Optional. */ } };

  const cfg = readCfg();
  let presets = FALLBACK_PRESETS;
  let session = null;
  let visible = false;
  let loading = false;
  let view = 'courses'; // 'courses' | 'course' | 'folder'
  let courses = [];
  let currentCourse = null;
  let currentCourseUrl = '';
  let currentSections = [];
  let currentFolder = null;
  let currentFolderFiles = [];
  let search = '';
  let selectingQueue = false;
  const selectedIds = new Set();
  let showImages = cfg.showImages === true;
  const imageCache = new Map();
  let sidebarDialog = null;
  let sidebarTab = 'deadlines';

  const msg = (text) => { const el = $('moodleStatus'); if (el) el.textContent = text; };

  function currentBrowserUrl() {
    if (view === 'folder' && currentFolder?.url) return currentFolder.url;
    if (view === 'course' && (currentCourseUrl || currentCourse?.viewurl)) return currentCourseUrl || currentCourse.viewurl;
    if (session?.baseUrl) return new URL('/my/', session.baseUrl).href;
    const preset = presets.find((p) => p.id === ($('moodlePreset')?.value || cfg.presetId || 'moovi-uvigo'));
    return ($('moodleUrl')?.value || preset?.baseUrl || 'https://moovi.uvigo.gal').trim();
  }

  function openExternalUrl(url) {
    const target = url || currentBrowserUrl();
    if (!target) return;
    if (api?.openExternal) api.openExternal(target).catch((e) => msg(e.message));
    else window.open(target, '_blank', 'noopener,noreferrer');
  }

  // Adapter matching download-queue.js client contract: download(doc, signal, onProgress) -> Blob/File
  const moodleQueueClient = {
    async download(doc, _signal, onProgress) {
      onProgress?.(1, 3);
      const res = await api.download(doc.downloadUrl || doc.url, doc.fileName || doc.name);
      onProgress?.(3, 3);
      const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
      return new File([bytes], res.name || doc.name || 'moodle-file', { type: res.mimeType || 'application/octet-stream' });
    },
  };

  function allDownloadableInView() {
    if (view === 'folder') return currentFolderFiles.filter((f) => f.isDownloadable);
    if (view === 'course') {
      return currentSections.flatMap((s) => s.items.filter((it) => it.isDownloadable));
    }
    return [];
  }

  function queueItemOf(item) {
    const cleanName = item.fileName || item.name || 'resource';
    return {
      source: 'moodle',
      id: `moodle:${item.id}`,
      name: cleanName,
      size: Number(item.size || 0),
      doc: { ...item, name: cleanName, source: 'moodle' },
      client: moodleQueueClient,
    };
  }

  function updateQueueControls() {
    const items = allDownloadableInView();
    queueControls(
      {
        mode: $('moodleQueueMode'),
        download: $('moodleQueueDownload'),
        cancel: $('moodleQueueCancel'),
        all: $('moodleQueueAll'),
        list: $('moodleList'),
      },
      { available: !!queue && view !== 'courses', count: items.length, selecting: selectingQueue, selected: selectedIds.size },
    );
  }

  function endSelection() {
    selectingQueue = false;
    selectedIds.clear();
    updateQueueControls();
    for (const card of $('moodleList')?.querySelectorAll('button') || []) card.classList?.remove('is-selected');
  }

  function syncPresetInputs() {
    const sel = $('moodlePreset');
    const urlInput = $('moodleUrl');
    const ssoInput = $('moodleSsoUrl');
    if (!sel) return;
    const preset = presets.find((p) => p.id === sel.value);
    if (preset && preset.id !== 'custom') {
      if (urlInput) urlInput.value = preset.baseUrl;
      if (ssoInput) ssoInput.value = preset.ssoUrl;
    }
  }

  function controls() {
    const connected = !!session?.connected;
    if ($('moodleSignin')) $('moodleSignin').hidden = connected;
    if ($('moodleBrowse')) $('moodleBrowse').hidden = !connected;
    if ($('moodleBack')) {
      $('moodleBack').hidden = !connected;
      $('moodleBack').disabled = loading || view === 'courses';
    }
    if ($('moodleRefresh')) {
      $('moodleRefresh').hidden = !connected;
      $('moodleRefresh').disabled = loading;
    }
    if ($('moodleImagesToggle')) {
      $('moodleImagesToggle').hidden = !connected;
      $('moodleImagesToggle').setAttribute('aria-pressed', String(showImages));
      $('moodleImagesToggle').classList.toggle('active', showImages);
    }
    if ($('moodleOpenBrowser')) {
      $('moodleOpenBrowser').hidden = !connected;
      $('moodleOpenBrowser').disabled = loading;
    }
    if ($('moodleSidebarBtn')) {
      $('moodleSidebarBtn').hidden = !connected;
    }
    if ($('moodleDisconnect')) {
      $('moodleDisconnect').hidden = !connected;
      $('moodleDisconnect').disabled = loading;
    }
    if ($('moodleConnect')) $('moodleConnect').disabled = loading || !api;
    if ($('moodlePath')) {
      const rootLabel = session?.label || 'Moodle';
      if (view === 'folder' && currentFolder) $('moodlePath').textContent = `${rootLabel} / ${currentCourse?.fullname || 'Course'} / ${currentFolder.name}`;
      else if (view === 'course' && currentCourse) $('moodlePath').textContent = `${rootLabel} / ${currentCourse.fullname}`;
      else $('moodlePath').textContent = session?.userName ? `${rootLabel} · ${session.userName}` : rootLabel;
    }
    updateQueueControls();
  }

  async function downloadAndOpen(item) {
    if (!api) return;
    msg(`Downloading ${item.name}…`);
    loading = true;
    controls();
    try {
      const res = await api.download(item.downloadUrl || item.url, item.fileName || item.name);
      const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
      const file = new File([bytes], res.name || item.name || 'moodle-file', { type: res.mimeType || 'application/octet-stream' });
      let entry = null;
      if (library?.rememberImported) {
        entry = await library.rememberImported(file, { origin: `Moodle · ${currentCourse?.fullname || session?.label || 'Moodle'}` }).catch(() => null);
      }
      msg('');
      await open?.(file, { ...item, name: file.name, entry });
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
  const MOD_META = {
    folder: { glyph: 'folder', label: 'Folder', tone: 'folder' },
    resource: { glyph: 'note', label: 'File', tone: 'file' },
    file: { glyph: 'note', label: 'File', tone: 'file' },
    assign: { glyph: 'edit', label: 'Assignment', tone: 'assign' },
    quiz: { glyph: 'exam', label: 'Quiz', tone: 'quiz' },
    forum: { glyph: 'chat', label: 'Forum', tone: 'forum' },
    url: { glyph: 'open', label: 'Link', tone: 'link' },
    page: { glyph: 'text', label: 'Page', tone: 'page' },
  };

  function bindTitleMarquee(cardBtn, titleEl) {
    cardBtn.addEventListener('pointerenter', () => {
      const overflow = titleEl.scrollWidth - titleEl.clientWidth;
      if (overflow > 2) {
        titleEl.style.setProperty('--marquee-shift', `-${overflow + 12}px`);
        titleEl.style.setProperty('--marquee-dur', `${Math.max(2.6, Math.min(12, overflow / 34)).toFixed(2)}s`);
        titleEl.classList.add('is-marquee');
      }
    });
    cardBtn.addEventListener('pointerleave', () => {
      titleEl.classList.remove('is-marquee');
      titleEl.style.removeProperty('--marquee-shift');
    });
  }

  function attachCoverImage(holder, url) {
    if (!showImages || !url) return;
    const apply = (dataUrl) => {
      if (!dataUrl) return;
      const img = document.createElement('img');
      img.className = 'moodle-card-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.src = dataUrl;
      holder.replaceChildren(img);
      holder.classList.add('has-thumb');
    };
    if (String(url).startsWith('data:image/')) {
      apply(url);
      return;
    }
    if (!api?.image) return;
    const cached = imageCache.get(url);
    if (cached) {
      apply(cached);
      return;
    }
    api.image(url).then((dataUrl) => {
      if (dataUrl) {
        imageCache.set(url, dataUrl);
        if (holder.isConnected) apply(dataUrl);
      }
    }, () => {});
  }

  function renderList() {
    const list = $('moodleList');
    if (!list) return;
    list.replaceChildren();
    const q = search.trim().toLowerCase();

    if (view === 'courses') {
      const shown = courses.filter((c) => !q || `${c.fullname} ${c.shortname}`.toLowerCase().includes(q));
      if (!shown.length) {
        msg(courses.length ? 'No courses match your search.' : 'No enrolled courses found.');
        return;
      }
      msg(`${shown.length} course${shown.length === 1 ? '' : 's'}`);
      for (const course of shown) {
        const li = document.createElement('li');
        li.className = 'note-card moodle-card';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'moodle-card-open';

        const badge = document.createElement('span');
        badge.className = 'moodle-card-icon tone-course';
        badge.append(icon('folder'));
        if (showImages && course.courseimage) attachCoverImage(badge, course.courseimage);

        const body = document.createElement('span');
        body.className = 'moodle-card-text';
        const title = document.createElement('strong');
        title.textContent = course.fullname;
        const meta = document.createElement('span');
        meta.className = 'moodle-card-meta';
        meta.textContent = course.shortname || 'Moodle course';
        body.append(title, meta);

        btn.append(badge, body);
        bindTitleMarquee(btn, title);
        btn.onclick = () => openCourse(course);

        const ext = document.createElement('button');
        ext.type = 'button';
        ext.className = 'icon-button moodle-ext-btn';
        ext.title = 'Open this course in your browser';
        ext.setAttribute('aria-label', `Open ${course.fullname} in browser`);
        ext.append(icon('open'));
        ext.onclick = (e) => { e.stopPropagation(); openExternalUrl(course.viewurl); };

        li.append(btn, ext);
        list.append(li);
      }
      onCards();
      return;
    }

    const flatItems = view === 'folder'
      ? [{ sectionName: currentFolder?.name || 'Folder', items: currentFolderFiles }]
      : currentSections.map((s) => ({ sectionName: s.name, items: s.items }));

    let shownCount = 0;
    for (const group of flatItems) {
      const filtered = group.items.filter((it) => !q || `${it.name} ${it.modname} ${group.sectionName}`.toLowerCase().includes(q));
      if (!filtered.length) continue;

      if (view === 'course') {
        const header = document.createElement('li');
        header.className = 'moodle-section-head';
        header.textContent = group.sectionName;
        list.append(header);
      }

      for (const item of filtered) {
        shownCount += 1;
        const li = document.createElement('li');
        li.className = 'note-card moodle-card';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'moodle-card-open';
        if (selectedIds.has(item.id)) btn.classList.add('is-selected');

        const kindInfo = MOD_META[item.modname] || (item.isFolder ? MOD_META.folder : item.isDownloadable ? MOD_META.resource : MOD_META.url);
        const badge = document.createElement('span');
        badge.className = `moodle-card-icon tone-${kindInfo.tone}`;
        badge.append(icon(kindInfo.glyph));
        if (showImages && item.isDownloadable && IMAGE_NAME_RE.test(item.fileName || item.name || '')) {
          attachCoverImage(badge, item.downloadUrl || item.url);
        }

        const body = document.createElement('span');
        body.className = 'moodle-card-text';
        const title = document.createElement('strong');
        title.textContent = item.name;
        const meta = document.createElement('span');
        meta.className = 'moodle-card-meta';
        meta.textContent = item.isFolder
          ? 'Folder · click to browse'
          : item.isDownloadable
            ? `${kindInfo.label} · click to open`
            : `${kindInfo.label} · opens in browser`;
        body.append(title, meta);

        if (selectingQueue && item.isDownloadable) {
          btn.append(selectionCheck(selectedIds.has(item.id)));
        }
        btn.append(badge, body);
        bindTitleMarquee(btn, title);

        btn.onclick = () => {
          if (selectingQueue && item.isDownloadable) {
            if (selectedIds.has(item.id)) selectedIds.delete(item.id);
            else selectedIds.add(item.id);
            updateQueueControls();
            renderList();
            return;
          }
          if (item.isFolder) openFolder(item);
          else if (item.isDownloadable) downloadAndOpen(item);
          else openExternalUrl(item.url);
        };

        const actions = document.createElement('span');
        actions.className = 'moodle-card-actions';
        if (queue && item.isDownloadable && !selectingQueue) {
          const qItem = queueItemOf(item);
          actions.append(queueButton({ queue, id: qItem.id, item: qItem }));
        }
        const ext = document.createElement('button');
        ext.type = 'button';
        ext.className = 'icon-button moodle-ext-btn';
        ext.title = 'Open in browser';
        ext.setAttribute('aria-label', `Open ${item.name} in browser`);
        ext.append(icon('open'));
        ext.onclick = (e) => { e.stopPropagation(); openExternalUrl(item.url); };
        actions.append(ext);

        li.append(btn, actions);
        list.append(li);
      }
    }

    if (!shownCount) msg('No resources match your filter.');
    else msg(`${shownCount} item${shownCount === 1 ? '' : 's'}`);
    updateQueueControls();
    onCards();
  }

  async function loadCourses() {
    if (!api) return;
    loading = true;
    view = 'courses';
    currentCourse = null;
    currentFolder = null;
    endSelection();
    controls();
    msg('Loading Moodle courses…');
    try {
      courses = await api.courses();
      renderList();
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  async function openCourse(course) {
    if (!api || loading) return;
    loading = true;
    currentCourse = course;
    currentCourseUrl = course.viewurl || '';
    currentFolder = null;
    view = 'course';
    endSelection();
    controls();
    msg(`Loading ${course.fullname}…`);
    try {
      const res = await api.courseContents(course.id);
      currentCourseUrl = res?.courseUrl || currentCourseUrl;
      currentSections = res?.sections || [];
      renderList();
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  async function openFolder(folderItem) {
    if (!api || loading) return;
    loading = true;
    currentFolder = folderItem;
    view = 'folder';
    endSelection();
    controls();
    msg(`Opening folder ${folderItem.name}…`);
    try {
      currentFolderFiles = Array.isArray(folderItem.folderFiles)
        ? folderItem.folderFiles
        : await api.folderFiles(folderItem.url);
      renderList();
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  async function connect() {
    if (!api || loading) return;
    const presetId = $('moodlePreset')?.value || 'moovi-uvigo';
    const baseUrl = $('moodleUrl')?.value?.trim() || '';
    const ssoUrl = $('moodleSsoUrl')?.value?.trim() || '';
    const token = $('moodleToken')?.value?.trim() || '';
    const preset = presets.find((p) => p.id === presetId);
    saveCfg({ presetId, baseUrl, ssoUrl });
    loading = true;
    controls();
    msg(token ? 'Verifying Moodle token…' : 'Opening Moodle SSO login window…');
    try {
      session = await api.signIn({ presetId, baseUrl, ssoUrl, token, label: preset?.label || '' });
      msg(`Connected to ${session.label}`);
      await loadCourses();
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  async function disconnect() {
    if (!api || loading) return;
    loading = true;
    controls();
    try {
      await api.disconnect();
      session = null;
      courses = [];
      currentCourse = null;
      currentSections = [];
      currentFolder = null;
      currentFolderFiles = [];
      view = 'courses';
      $('moodleList')?.replaceChildren();
      msg('Disconnected from Moodle.');
    } finally {
      loading = false;
      controls();
    }
  }

  // ---- Moodle Student Sidebar (Deadlines, Grades, Announcements, Ask AI, MCP) ----

  function ensureSidebar() {
    if (sidebarDialog) return sidebarDialog;
    sidebarDialog = document.createElement('dialog');
    sidebarDialog.id = 'moodleSidebarDialog';
    sidebarDialog.className = 'moodle-sidebar-dialog';
    sidebarDialog.innerHTML = `
      <div class="float-head moodle-sb-head">
        <h2>Moodle Assistant</h2>
        <div class="moodle-sb-head-actions">
          <button id="moodleSbOpenBrowser" type="button" class="icon-button" aria-label="Open in browser" title="Open current Moodle page in browser"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg></button>
          <button id="moodleSbClose" type="button" class="icon-button" aria-label="Close" title="Close"></button>
        </div>
      </div>
      <div class="moodle-sb-tabs" role="tablist">
        <button type="button" role="tab" data-sb-tab="deadlines" aria-selected="true">Deadlines</button>
        <button type="button" role="tab" data-sb-tab="grades" aria-selected="false">Grades</button>
        <button type="button" role="tab" data-sb-tab="announcements" aria-selected="false">Forums</button>
        <button type="button" role="tab" data-sb-tab="ask" aria-selected="false">Ask AI</button>
        <button type="button" role="tab" data-sb-tab="mcp" aria-selected="false">MCP</button>
      </div>
      <div id="moodleSbBody" class="moodle-sb-body"></div>
    `;
    sidebarDialog.querySelector('#moodleSbClose').append(icon('close'));
    sidebarDialog.querySelector('#moodleSbClose').onclick = () => sidebarDialog.close();
    sidebarDialog.querySelector('#moodleSbOpenBrowser').onclick = () => openExternalUrl(currentBrowserUrl());
    for (const tabBtn of sidebarDialog.querySelectorAll('[data-sb-tab]')) {
      tabBtn.onclick = () => {
        sidebarTab = tabBtn.dataset.sbTab;
        for (const b of sidebarDialog.querySelectorAll('[data-sb-tab]')) {
          b.setAttribute('aria-selected', String(b === tabBtn));
        }
        renderSidebarTab();
      };
    }
    document.body.append(sidebarDialog);
    floatingWindow(sidebarDialog, {
      key: 'notecomplete-moodle-sidebar',
      head: sidebarDialog.querySelector('.moodle-sb-head'),
      close: sidebarDialog.querySelector('#moodleSbClose'),
      label: 'Moodle Assistant',
      minWidth: 340,
      minHeight: 320,
      scroll: true,
    });
    return sidebarDialog;
  }

  async function renderSidebarTab() {
    const body = sidebarDialog?.querySelector('#moodleSbBody');
    if (!body) return;
    body.replaceChildren();
    if (!session?.connected && sidebarTab !== 'mcp') {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Connect your Moodle account in the Cloud → Moodle panel first.';
      body.append(p);
      return;
    }

    if (sidebarTab === 'deadlines') {
      body.innerHTML = '<p class="muted">Loading upcoming deadlines…</p>';
      try {
        const events = await api.deadlines({ days: 30 });
        body.replaceChildren();
        if (!events.length) {
          body.innerHTML = '<p class="muted">No upcoming deadlines in the next 30 days.</p>';
          return;
        }
        const ul = document.createElement('ul');
        ul.className = 'moodle-sb-list';
        for (const ev of events) {
          const li = document.createElement('li');
          const due = ev.dueAt ? new Date(ev.dueAt).toLocaleString() : (ev.dueLabel || '');
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'moodle-sb-item';
          link.innerHTML = `<strong></strong><span class="muted"></span>`;
          link.querySelector('strong').textContent = ev.name;
          link.querySelector('span').textContent = [ev.course, due].filter(Boolean).join(' · ');
          link.onclick = () => openExternalUrl(ev.url);
          li.append(link);
          ul.append(li);
        }
        body.append(ul);
      } catch (e) {
        body.innerHTML = `<p class="muted">${e.message}</p>`;
      }
      return;
    }

    if (sidebarTab === 'grades') {
      body.innerHTML = '<p class="muted">Loading grades…</p>';
      try {
        const res = await api.grades(currentCourse?.id || 0);
        body.replaceChildren();
        const hdr = document.createElement('p');
        hdr.className = 'muted';
        hdr.textContent = currentCourse ? `Grades for ${currentCourse.fullname}` : 'Course grades overview';
        body.append(hdr);
        if (!res?.items?.length) {
          body.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No grade rows returned.' }));
          return;
        }
        const ul = document.createElement('ul');
        ul.className = 'moodle-sb-list';
        for (const g of res.items) {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'moodle-sb-item';
          btn.innerHTML = `<strong></strong><span class="muted"></span>`;
          btn.querySelector('strong').textContent = g.name;
          btn.querySelector('span').textContent = [g.grade, g.percentage, g.feedback].filter(Boolean).join(' · ');
          btn.onclick = () => openExternalUrl(g.url || res.url);
          li.append(btn);
          ul.append(li);
        }
        body.append(ul);
      } catch (e) {
        body.innerHTML = `<p class="muted">${e.message}</p>`;
      }
      return;
    }

    if (sidebarTab === 'announcements') {
      body.innerHTML = '<p class="muted">Loading announcements &amp; forums…</p>';
      try {
        const res = await api.announcements(currentCourse?.id || 0);
        body.replaceChildren();
        if (!res?.items?.length) {
          body.innerHTML = '<p class="muted">No forum announcements found here.</p>';
          return;
        }
        const ul = document.createElement('ul');
        ul.className = 'moodle-sb-list';
        for (const a of res.items) {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'moodle-sb-item';
          btn.textContent = a.name;
          btn.onclick = () => openExternalUrl(a.url);
          li.append(btn);
          ul.append(li);
        }
        body.append(ul);
      } catch (e) {
        body.innerHTML = `<p class="muted">${e.message}</p>`;
      }
      return;
    }

    if (sidebarTab === 'ask') {
      const form = document.createElement('div');
      form.className = 'moodle-sb-ask';
      const input = Object.assign(document.createElement('textarea'), {
        rows: 3,
        placeholder: 'Ask about your upcoming deadlines, courses, grades, or what to study next…',
      });
      const askBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Ask AI about my Moodle' });
      const out = Object.assign(document.createElement('pre'), { className: 'moodle-sb-answer', textContent: '' });
      askBtn.onclick = async () => {
        const q = input.value.trim();
        if (!q) return;
        if (!ai) { out.textContent = 'Connect an AI tool first.'; return; }
        askBtn.disabled = true;
        out.textContent = 'Gathering your Moodle courses & deadlines…';
        try {
          const [deadlines, gradesRes, provs] = await Promise.all([
            api.deadlines({ days: 30 }).catch(() => []),
            api.grades(currentCourse?.id || 0).catch(() => ({ items: [] })),
            ai.providers().catch(() => []),
          ]);
          let prov = '';
          try { prov = store?.getItem('notecomplete-ai-provider') || ''; } catch { /* ignore */ }
          if (!prov || !provs.some((p) => p.id === prov && p.available)) {
            prov = provs.find((p) => p.available)?.id || '';
          }
          if (!prov) throw Error('No AI harness is available.');
          const ctx = [
            `Moodle server: ${session?.label || session?.baseUrl}`,
            courses.length ? `Courses:\n${courses.map((c) => `- ${c.fullname}`).join('\n')}` : '',
            currentCourse ? `Currently viewing course: ${currentCourse.fullname}\nResources:\n${currentSections.flatMap((s) => s.items.map((i) => `- [${s.name}] ${i.name} (${i.modname})`)).slice(0, 60).join('\n')}` : '',
            deadlines.length ? `Upcoming deadlines:\n${deadlines.map((d) => `- ${d.name} (${d.course || 'course'}) due ${d.dueAt ? new Date(d.dueAt).toLocaleString() : d.dueLabel || 'soon'}`).join('\n')}` : 'No upcoming deadlines.',
            gradesRes?.items?.length ? `Grades:\n${gradesRes.items.slice(0, 30).map((g) => `- ${g.name}: ${g.grade} ${g.percentage}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n');
          out.textContent = '';
          const res = await ai.run({
            provider: prov,
            prompt: `You are NoteComplete's Moodle Student Assistant. Answer clearly and concisely using the student's live Moodle data below.\n\n${ctx}\n\nStudent question:\n${q}`,
            images: [],
            tag: 'chat',
          }, (delta) => { out.textContent += delta; });
          if (!out.textContent.trim() && res?.text) out.textContent = res.text;
        } catch (e) {
          out.textContent = e?.message || String(e);
        } finally {
          askBtn.disabled = false;
        }
      };
      form.append(input, askBtn, out);
      body.append(form);
      return;
    }

    if (sidebarTab === 'mcp') {
      const cfgData = await api?.mcpConfig?.().catch(() => null);
      const baseUrl = cfgData?.baseUrl || session?.baseUrl || 'https://moovi.uvigo.gal';
      const openMoodleSnippet = JSON.stringify({
        mcpServers: {
          'open-moodle': { command: 'uvx', args: ['open-moodle'], env: { MOODLE_URL: baseUrl } },
        },
      }, null, 2);
      const bridgeSnippet = JSON.stringify({
        mcpServers: {
          'moodle-student-bridge': { command: 'npx', args: ['-y', 'moodle-student-bridge'], env: { MOODLE_BASE_URL: baseUrl, MOODLE_TOKEN: '<your-moodle-mobile-token>' } },
        },
      }, null, 2);
      const mkBlock = (title, hint, snippet) => {
        const box = document.createElement('div');
        box.className = 'moodle-mcp-card';
        const h = document.createElement('strong');
        h.textContent = title;
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = hint;
        const pre = document.createElement('pre');
        pre.textContent = snippet;
        const copy = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy MCP JSON' });
        copy.onclick = () => navigator.clipboard?.writeText(snippet).then(() => { copy.textContent = 'Copied'; }, () => {});
        box.append(h, p, pre, copy);
        return box;
      };
      body.append(
        mkBlock('open-moodle (SSO / SAML2 ready)', 'Great for UVIGO Moovi and universities that disable manual tokens.', openMoodleSnippet),
        mkBlock('moodle-student-bridge (read-only student tools)', 'Courses, deadlines, quizzes, grades, feedback, announcements & files via mobile token.', bridgeSnippet),
      );
    }
  }

  function openSidebar(tab = 'deadlines') {
    sidebarTab = tab;
    const dlg = ensureSidebar();
    for (const b of dlg.querySelectorAll('[data-sb-tab]')) {
      b.setAttribute('aria-selected', String(b.dataset.sbTab === tab));
    }
    if (!dlg.open) dlg.show();
    void renderSidebarTab();
  }

  // ---- Wire DOM controls ----
  function wire() {
    const presetSel = $('moodlePreset');
    if (presetSel && !presetSel.options.length) {
      for (const p of presets) presetSel.add(new Option(p.label, p.id));
      presetSel.value = cfg.presetId && presets.some((p) => p.id === cfg.presetId) ? cfg.presetId : 'moovi-uvigo';
      presetSel.onchange = syncPresetInputs;
      syncPresetInputs();
      if (cfg.baseUrl && presetSel.value === 'custom' && $('moodleUrl')) $('moodleUrl').value = cfg.baseUrl;
      if (cfg.ssoUrl && presetSel.value === 'custom' && $('moodleSsoUrl')) $('moodleSsoUrl').value = cfg.ssoUrl;
    }
    if ($('moodleConnect')) $('moodleConnect').onclick = connect;
    if ($('moodleOpenSystemBrowser')) {
      $('moodleOpenSystemBrowser').onclick = () => {
        const sso = $('moodleSsoUrl')?.value?.trim() || currentBrowserUrl();
        openExternalUrl(sso);
      };
    }
    if ($('moodleImagesToggle')) {
      $('moodleImagesToggle').onclick = () => {
        showImages = !showImages;
        saveCfg({ ...readCfg(), showImages });
        controls();
        renderList();
      };
    }
    if ($('moodleDisconnect')) $('moodleDisconnect').onclick = disconnect;
    if ($('moodleOpenBrowser')) $('moodleOpenBrowser').onclick = () => openExternalUrl(currentBrowserUrl());
    if ($('moodleSidebarBtn')) $('moodleSidebarBtn').onclick = () => openSidebar('deadlines');
    if ($('moodleBack')) {
      $('moodleBack').onclick = () => {
        if (view === 'folder') { view = 'course'; currentFolder = null; endSelection(); renderList(); controls(); }
        else if (view === 'course') { view = 'courses'; currentCourse = null; endSelection(); renderList(); controls(); }
      };
    }
    if ($('moodleRefresh')) {
      $('moodleRefresh').onclick = () => {
        if (view === 'folder' && currentFolder) openFolder(currentFolder);
        else if (view === 'course' && currentCourse) openCourse(currentCourse);
        else loadCourses();
      };
    }
    if ($('moodleFind')) {
      $('moodleFind').onclick = () => { search = $('moodleSearch')?.value || ''; renderList(); };
    }
    if ($('moodleSearch')) {
      $('moodleSearch').oninput = () => { search = $('moodleSearch').value; renderList(); };
    }
    if ($('moodleQueueMode')) $('moodleQueueMode').onclick = () => { endSelection(); selectingQueue = true; updateQueueControls(); renderList(); };
    if ($('moodleQueueCancel')) $('moodleQueueCancel').onclick = () => { endSelection(); renderList(); };
    if ($('moodleQueueDownload')) {
      $('moodleQueueDownload').onclick = () => {
        const chosen = allDownloadableInView().filter((it) => selectedIds.has(it.id));
        if (chosen.length) {
          queue?.enqueue(chosen.map(queueItemOf));
          status(`Queued ${chosen.length} Moodle file${chosen.length === 1 ? '' : 's'} for download.`);
        }
        endSelection();
        renderList();
      };
    }
    if ($('moodleQueueAll')) {
      $('moodleQueueAll').onclick = () => {
        const all = allDownloadableInView();
        if (all.length) {
          queue?.enqueue(all.map(queueItemOf));
          status(`Queued ${all.length} Moodle file${all.length === 1 ? '' : 's'} for download.`);
        }
      };
    }
  }

  return {
    async show() {
      visible = true;
      if (api?.presets) {
        presets = await api.presets().catch(() => FALLBACK_PRESETS);
      }
      wire();
      if (!api) {
        msg('Moodle SAML2 / SSO browsing is available in the NoteComplete desktop app.');
        controls();
        return;
      }
      session = await api.session().catch(() => null);
      controls();
      if (session?.connected && !courses.length) {
        await loadCourses();
      }
    },
    hide() { visible = false; },
    openSidebar,
    search(q) {
      search = String(q || '');
      if ($('moodleSearch')) $('moodleSearch').value = search;
      renderList();
    },
    /**
     * Searches documents in the currently chosen Moodle course (or folder / course list)
     * for the Global Search Bar, returning structured matches with open & browser actions.
     */
    searchDocs(rawQuery) {
      const q = String(rawQuery || '').trim().toLowerCase();
      if (!q || !session?.connected) return [];
      const terms = q.split(/\s+/).filter(Boolean);
      const hit = (text) => {
        const hay = String(text || '').toLowerCase();
        return terms.every((t) => hay.includes(t));
      };
      const results = [];
      if (view === 'folder' && currentFolderFiles.length) {
        for (const item of currentFolderFiles) {
          if (hit(`${item.name} ${currentFolder?.name || ''} ${currentCourse?.fullname || ''}`)) {
            results.push({
              source: 'Moodle',
              sub: `${currentCourse?.fullname || session.label} / ${currentFolder?.name || 'Folder'}`,
              name: item.name,
              url: item.url,
              open: () => (item.isDownloadable ? downloadAndOpen(item) : openExternalUrl(item.url)),
              openBrowser: () => openExternalUrl(item.url),
            });
          }
        }
      } else if (currentCourse && currentSections.length) {
        for (const sec of currentSections) {
          for (const item of sec.items || []) {
            if (hit(`${item.name} ${sec.name} ${item.modname} ${currentCourse.fullname}`)) {
              results.push({
                source: 'Moodle',
                sub: `${currentCourse.fullname} · ${sec.name}`,
                name: item.name,
                url: item.url,
                open: () => (item.isFolder ? openFolder(item) : item.isDownloadable ? downloadAndOpen(item) : openExternalUrl(item.url)),
                openBrowser: () => openExternalUrl(item.url),
              });
            }
          }
        }
      }
      for (const c of courses) {
        if (hit(`${c.fullname} ${c.shortname}`)) {
          results.push({
            source: 'Moodle course',
            sub: session.label || 'Moodle',
            name: c.fullname,
            url: c.viewurl,
            open: () => openCourse(c),
            openBrowser: () => openExternalUrl(c.viewurl),
          });
        }
      }
      return results;
    },
    get connected() { return !!session?.connected; },
    get activeCourseName() { return currentCourse?.fullname || ''; },
  };
}
