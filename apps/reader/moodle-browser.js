// Moodle Cloud Browser & Student Sidebar for NoteComplete:
//  - Lets you pick your Moodle (Moovi — UVIGO pre-configured with SAML2 SSO, or any custom Moodle).
//  - Navigate Courses → Sections / Folders → Resources directly inside NoteComplete.
//  - Normal download (click to open & save to library) AND bulk download (Queue / Select / Queue all).
//  - "Open in browser" button opens the EXACT page you are viewing (dashboard, course, folder, or item).
//  - Moodle Student Sidebar (floating panel): Upcoming deadlines, Grades, Announcements,
//    Ask AI about your Moodle context, and MCP setup snippets (`open-moodle` / `moodle-student-bridge`).
import { icon } from './icons.js';
import { floatingWindow } from './floating.js';
import { queueButton, markQueueDone, setQueueButton, selectionCheck, updateQueueControls as queueControls } from './queue-controls.js';

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
  let activeTypeFilter = 'all';
  let selectingQueue = false;
  const selectedIds = new Set();
  let showImages = cfg.showImages !== false;
  let showHiddenCourses = false;
  const hiddenCourses = new Set(Array.isArray(cfg.hiddenCourses) ? cfg.hiddenCourses.map(Number) : []);
  const unhiddenCourses = new Set(Array.isArray(cfg.unhiddenCourses) ? cfg.unhiddenCourses.map(Number) : []);
  const isCourseHidden = (c) => !unhiddenCourses.has(Number(c.id)) && (Boolean(c.hidden) || hiddenCourses.has(Number(c.id)));
  const toggleCourseHidden = (course) => {
    const id = Number(course.id);
    if (isCourseHidden(course)) {
      hiddenCourses.delete(id);
      if (course.hidden) unhiddenCourses.add(id);
    } else {
      unhiddenCourses.delete(id);
      hiddenCourses.add(id);
    }
    saveCfg({ ...readCfg(), hiddenCourses: [...hiddenCourses], unhiddenCourses: [...unhiddenCourses] });
    controls();
    renderList();
  };
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
      doc: { ...item, name: cleanName, source: 'moodle', courseName: currentCourse?.fullname || session?.label || 'Moodle' },
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
      const canBack = connected && view !== 'courses';
      $('moodleBack').hidden = !canBack;
      $('moodleBack').disabled = loading || !canBack;
      $('moodleBack').title = view === 'folder' ? `Back to ${currentCourse?.fullname || 'course'}` : 'Back to Moodle courses';
    }
    if ($('moodleRefresh')) {
      $('moodleRefresh').hidden = !connected;
      $('moodleRefresh').disabled = loading;
    }
    if ($('moodleReconnect')) {
      $('moodleReconnect').hidden = !connected;
      $('moodleReconnect').disabled = loading || !api;
    }
    if ($('moodleHiddenToggle')) {
      const hiddenCount = courses.filter(isCourseHidden).length;
      $('moodleHiddenToggle').hidden = !connected || view !== 'courses' || (!hiddenCount && !showHiddenCourses);
      $('moodleHiddenToggle').setAttribute('aria-pressed', String(showHiddenCourses));
      $('moodleHiddenToggle').classList.toggle('active', showHiddenCourses);
      $('moodleHiddenToggle').textContent = showHiddenCourses ? `Showing hidden (${hiddenCount})` : `Hidden (${hiddenCount})`;
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
      $('moodlePath').title = session?.authMode === 'token' ? 'Connected via Moodle Mobile Web Service token' : 'Connected via Moodle SSO session';
    }
    updateQueueControls();
  }

  const queueButtons = new Map();

  async function downloadAndOpen(item, { newTab = false } = {}) {
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
      if (newTab && entry && library?.pathOf && window.notecompleteTabs?.open) {
        const diskPath = await library.pathOf(entry).catch(() => '');
        if (diskPath) {
          await window.notecompleteTabs.open(diskPath);
          status(`Opened ${file.name} in a new tab.`);
          return;
        }
      }
      await open?.(file, { ...item, name: file.name, entry });
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
  const SERVER_SCRIPT_EXTS = new Set(['php', 'asp', 'aspx', 'jsp', 'cgi', 'cfm', 'do']);
  const VIDEO_HOST_RE = /\b(?:youtube\.com|youtu\.be|vimeo\.com|tv\.uvigo\.es|campusremotouvigo|panopto|kaltura|mediasite|loom\.com|dailymotion\.com|twitch\.tv|stream\.microsoft\.com)\b/i;
  const VIDEO_MOD_RE = /(?:video|kalvid|kaltura|panopto|vimeo|youtube|stream|ubicast|mediasite|mediagallery)/i;
  const TYPE_CATEGORIES = [
    { id: 'pdf', label: 'PDF (.pdf)', glyph: 'pages', tone: 'pdf' },
    { id: 'r', label: 'R (.R / .Rmd)', glyph: 'rstudio', tone: 'r' },
    { id: 'office', label: 'Office (.docx / .pptx / .odt)', glyph: 'text', tone: 'office' },
    { id: 'code', label: 'Code & Notes', glyph: 'code', tone: 'code' },
    { id: 'videos', label: 'Videos & Audio', glyph: 'play', tone: 'video' },
    { id: 'images', label: 'Images', glyph: 'image', tone: 'image' },
    { id: 'archives', label: 'Archives (.zip)', glyph: 'archive', tone: 'archive' },
    { id: 'folders', label: 'Folders', glyph: 'folder', tone: 'folder' },
    { id: 'other-files', label: 'Files', glyph: 'note', tone: 'file' },
    { id: 'webs', label: 'Webs & Links', glyph: 'window', tone: 'web' },
    { id: 'activities', label: 'Activities', glyph: 'link', tone: 'link' },
  ];
  const TYPE_RANK = Object.fromEntries(TYPE_CATEGORIES.map((c, i) => [c.id, i]));
  const TYPE_INFO = Object.fromEntries(TYPE_CATEGORIES.map((c) => [c.id, c]));

  function extractExtLabel(str) {
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

  function formatBadgeOf(item) {
    if (item.fileFormat) return String(item.fileFormat).toUpperCase();
    for (const candidate of [item.fileName, item.downloadUrl, item.url, item.name]) {
      const ext = extractExtLabel(candidate);
      if (ext) return ext;
    }
    const mod = String(item.modname || '').toLowerCase();
    const probe = `${item.url || ''} ${item.downloadUrl || ''} ${item.name || ''}`;
    if (VIDEO_MOD_RE.test(mod) || VIDEO_HOST_RE.test(probe)) return 'VIDEO';
    if (item.isFolder || mod === 'folder') return 'FOLDER';
    if (mod === 'url') return 'WEB';
    if (mod === 'page') return 'WEB';
    if (mod === 'assign') return 'ASSIGN';
    if (mod === 'quiz') return 'QUIZ';
    if (mod === 'forum') return 'FORUM';
    if (mod === 'book') return 'BOOK';
    if (mod === 'lti') return 'LTI';
    if (mod === 'h5pactivity') return 'H5P';
    if (mod === 'scorm') return 'SCORM';
    if (item.isDownloadable || mod === 'resource' || mod === 'file') return 'FILE';
    return (mod || 'ITEM').toUpperCase();
  }

  function classifyMoodleItem(item) {
    if (item.isFolder || item.modname === 'folder') return 'folders';
    const fmt = String(item.fileFormat || '').toLowerCase();
    const probe = `${item.fileName || ''} ${item.name || ''} ${item.downloadUrl || ''} ${item.url || ''}`.toLowerCase();
    if (fmt === 'pdf' || /\.pdf\b/i.test(probe)) return 'pdf';
    if (/^(?:r|rmd|qmd)$/.test(fmt) || /\.(?:r|rmd|qmd)\b/i.test(probe)) return 'r';
    if (/^(?:docx?|odt|pptx?|odp|xlsx?|ods|csv|rtf)$/.test(fmt) || /\.(?:docx?|odt|pptx?|odp|xlsx?|ods|csv|rtf)\b/i.test(probe)) return 'office';
    if (/^(?:video|mp4|webm|mkv|mov|avi|m4v|audio|mp3|wav|ogg|m4a)$/.test(fmt)
      || /\.(?:mp4|webm|mkv|mov|avi|m4v|mp3|wav|ogg|m4a)\b/i.test(probe)
      || VIDEO_MOD_RE.test(String(item.modname || ''))
      || VIDEO_HOST_RE.test(probe)) return 'videos';
    if (/^(?:md|markdown|txt|py|java|c|cpp|h|hpp|js|mjs|ts|tsx|jsx|css|json|sql|sh|noteful|nfedit|code)$/.test(fmt)
      || /\.(?:md|markdown|txt|py|java|c|cpp|h|hpp|js|mjs|ts|tsx|jsx|css|json|sql|sh|noteful|nfedit)\b/i.test(probe)) return 'code';
    if (/^(?:img|png|jpe?g|webp|gif|avif|bmp|svg|eps|psd)$/.test(fmt) || /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)\b/i.test(probe)) return 'images';
    if (/^(?:zip|tar|gz|tgz|7z|rar)$/.test(fmt) || /\.(?:zip|tar|gz|tgz|7z|rar)\b/i.test(probe)) return 'archives';
    if (fmt === 'web' || fmt === 'html' || /\.html?\b/i.test(probe) || item.modname === 'url' || item.modname === 'page') return 'webs';
    if (item.isDownloadable || item.modname === 'resource' || item.modname === 'file') return 'other-files';
    return 'activities';
  }

  function renderTypeFilters(allItems) {
    const bar = $('moodleTypeFilters');
    if (!bar) return;
    if (view === 'courses' || !allItems.length) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    const counts = new Map();
    for (const item of allItems) {
      const cat = classifyMoodleItem(item);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    if (activeTypeFilter !== 'all' && !counts.has(activeTypeFilter)) activeTypeFilter = 'all';
    const buttons = [];
    const mkPill = (id, text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip moodle-type-pill${activeTypeFilter === id ? ' active' : ''}`;
      b.setAttribute('aria-pressed', String(activeTypeFilter === id));
      b.textContent = text;
      b.onclick = () => {
        activeTypeFilter = activeTypeFilter === id && id !== 'all' ? 'all' : id;
        renderList();
      };
      return b;
    };
    buttons.push(mkPill('all', `All (${allItems.length})`));
    for (const cat of TYPE_CATEGORIES) {
      const n = counts.get(cat.id) || 0;
      if (n > 0) buttons.push(mkPill(cat.id, `${cat.label} (${n})`));
    }
    bar.replaceChildren(...buttons);
    bar.hidden = buttons.length <= 2;
  }

  const MOD_META = {
    folder: { glyph: 'folder', label: 'Folder', tone: 'folder' },
    resource: { glyph: 'note', label: 'File', tone: 'file' },
    file: { glyph: 'note', label: 'File', tone: 'file' },
    assign: { glyph: 'draw', label: 'Assignment', tone: 'assign' },
    quiz: { glyph: 'exam', label: 'Quiz', tone: 'quiz' },
    forum: { glyph: 'chat', label: 'Forum', tone: 'forum' },
    url: { glyph: 'link', label: 'Link', tone: 'link' },
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
    queueButtons.clear();
    list.replaceChildren();
    const q = search.trim().toLowerCase();

    if (view === 'courses') {
      renderTypeFilters([]);
      const hiddenCount = courses.filter(isCourseHidden).length;
      const pool = showHiddenCourses ? courses : courses.filter((c) => !isCourseHidden(c));
      const shown = pool.filter((c) => !q || `${c.fullname} ${c.shortname}`.toLowerCase().includes(q));
      if (!shown.length) {
        if (!q && courses.length && hiddenCount === courses.length && !showHiddenCourses) {
          msg(`All ${hiddenCount} courses are hidden. Click "Hidden (${hiddenCount})" to view or restore them.`);
        } else {
          msg(courses.length ? 'No courses match your search.' : 'No enrolled courses found.');
        }
        return;
      }
      msg(`${shown.length} course${shown.length === 1 ? '' : 's'}${hiddenCount && !showHiddenCourses ? ` (${hiddenCount} hidden)` : ''}`);
      for (const course of shown) {
        const courseHidden = isCourseHidden(course);
        const li = document.createElement('li');
        li.className = `note-card moodle-card${courseHidden ? ' is-archived' : ''}`;
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

        const actions = document.createElement('span');
        actions.className = 'moodle-card-actions';

        const eyeBtn = document.createElement('button');
        eyeBtn.type = 'button';
        eyeBtn.className = 'icon-button moodle-ext-btn';
        eyeBtn.title = courseHidden ? 'Restore course to main list' : 'Hide / archive this course';
        eyeBtn.setAttribute('aria-label', `${courseHidden ? 'Restore' : 'Hide'} ${course.fullname}`);
        eyeBtn.append(icon(courseHidden ? 'eye' : 'eyeOff'));
        eyeBtn.onclick = (e) => { e.stopPropagation(); toggleCourseHidden(course); };

        const ext = document.createElement('button');
        ext.type = 'button';
        ext.className = 'icon-button moodle-ext-btn';
        ext.title = 'Open this course in your browser';
        ext.setAttribute('aria-label', `Open ${course.fullname} in browser`);
        ext.append(icon('open'));
        ext.onclick = (e) => { e.stopPropagation(); openExternalUrl(course.viewurl); };

        actions.append(eyeBtn, ext);
        li.append(btn, actions);
        list.append(li);
      }
      onCards();
      return;
    }

    const flatItems = view === 'folder'
      ? [{ sectionName: currentFolder?.name || 'Folder', items: currentFolderFiles }]
      : currentSections.map((s) => ({ sectionName: s.name, items: s.items }));

    const allViewItems = flatItems.flatMap((g) => g.items);
    renderTypeFilters(allViewItems);

    const buildItemCard = (item) => {
      const li = document.createElement('li');
      li.className = 'note-card moodle-card';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'moodle-card-open';
      if (selectedIds.has(item.id)) btn.classList.add('is-selected');

      const catId = classifyMoodleItem(item);
      const catInfo = TYPE_INFO[catId];
      const modInfo = MOD_META[item.modname];
      const useFileTypeIcon = ['pdf', 'r', 'office', 'code', 'videos', 'images', 'archives', 'webs'].includes(catId);
      const kindInfo = useFileTypeIcon
        ? { glyph: catInfo.glyph, label: catInfo.label.split(' ')[0], tone: catInfo.tone }
        : (modInfo || (item.isFolder ? MOD_META.folder : item.isDownloadable ? MOD_META.resource : MOD_META.url));
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
      const metaRow = document.createElement('span');
      metaRow.className = 'moodle-card-meta-row';
      const fmtBadge = document.createElement('span');
      fmtBadge.className = `moodle-format-badge tone-${kindInfo.tone}`;
      fmtBadge.textContent = formatBadgeOf(item);
      const meta = document.createElement('span');
      meta.className = 'moodle-card-meta';
      meta.textContent = item.isFolder
        ? 'click to browse'
        : item.isDownloadable
          ? 'click to open'
          : 'opens in browser';
      metaRow.append(fmtBadge, meta);
      body.append(title, metaRow);

      if (selectingQueue && item.isDownloadable) {
        btn.append(selectionCheck(selectedIds.has(item.id)));
      }
      btn.append(badge, body);
      bindTitleMarquee(btn, title);

      btn.onclick = (e) => {
        if (selectingQueue && item.isDownloadable) {
          if (selectedIds.has(item.id)) selectedIds.delete(item.id);
          else selectedIds.add(item.id);
          updateQueueControls();
          renderList();
          return;
        }
        const wantNewTab = Boolean(e?.ctrlKey || e?.metaKey);
        if (item.isFolder) openFolder(item);
        else if (item.isDownloadable) downloadAndOpen(item, { newTab: wantNewTab });
        else openExternalUrl(item.url);
      };
      btn.onauxclick = (e) => {
        if (e.button === 1 && item.isDownloadable && !item.isFolder) {
          e.preventDefault();
          downloadAndOpen(item, { newTab: true });
        }
      };

      const actions = document.createElement('span');
      actions.className = 'moodle-card-actions';
      if (queue && item.isDownloadable && !selectingQueue) {
        const qid = `moodle:${item.id}`;
        const qb = queueButton({ queue, id: qid, item: () => queueItemOf(item) });
        queueButtons.set(qid, qb);
        actions.append(qb);
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
      return li;
    };

    let shownCount = 0;
    for (const group of flatItems) {
      const filtered = group.items.filter((it) => {
        if (activeTypeFilter !== 'all' && classifyMoodleItem(it) !== activeTypeFilter) return false;
        return !q || `${it.name} ${it.modname} ${group.sectionName}`.toLowerCase().includes(q);
      });
      if (!filtered.length) continue;

      if (view === 'course') {
        const header = document.createElement('li');
        header.className = 'moodle-section-head';
        header.textContent = group.sectionName;
        list.append(header);
      }

      // Group items by file type in priority order (PDF first, then R, Office, Code, Images, Archives, Folders, Files, Activities).
      const byType = new Map();
      for (const item of filtered) {
        const cat = classifyMoodleItem(item);
        if (!byType.has(cat)) byType.set(cat, []);
        byType.get(cat).push(item);
      }
      const orderedTypes = [...byType.keys()].sort((a, b) => (TYPE_RANK[a] ?? 99) - (TYPE_RANK[b] ?? 99));

      const subList = document.createElement('li');
      subList.className = 'moodle-subcat-list';
      for (const cat of orderedTypes) {
        const catItems = byType.get(cat);
        const catMeta = TYPE_INFO[cat] || { label: cat, glyph: 'note', tone: 'file' };
        shownCount += catItems.length;
        const row = document.createElement('div');
        row.className = 'moodle-subcat-row';
        const subHead = document.createElement('div');
        subHead.className = 'moodle-type-subhead';
        const subIco = document.createElement('span');
        subIco.className = `moodle-type-subhead-ico tone-${catMeta.tone}`;
        subIco.append(icon(catMeta.glyph));
        const subLbl = document.createElement('span');
        subLbl.className = 'moodle-type-subhead-label';
        subLbl.textContent = catMeta.label;
        const subCnt = document.createElement('span');
        subCnt.className = 'moodle-type-subhead-count';
        subCnt.textContent = String(catItems.length);
        subHead.append(subIco, subLbl, subCnt);
        const grid = document.createElement('ul');
        grid.className = 'note-grid moodle-subgrid';
        for (const item of catItems) grid.append(buildItemCard(item));
        row.append(subHead, grid);
        subList.append(row);
      }
      list.append(subList);
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
    const icsUrl = $('moodleIcsUrl')?.value?.trim() || '';
    const preset = presets.find((p) => p.id === presetId);
    saveCfg({ presetId, baseUrl, ssoUrl });
    loading = true;
    controls();
    msg(token ? 'Verifying Moodle token…' : 'Opening Moodle SSO login window…');
    try {
      session = await api.signIn({ presetId, baseUrl, ssoUrl, token, icsUrl, label: preset?.label || '' });
      msg(`Connected to ${session.label}`);
      await loadCourses();
    } catch (e) {
      msg(e?.message || String(e));
    } finally {
      loading = false;
      controls();
    }
  }

  async function reconnect() {
    if (!api || loading) return;
    const presetId = session?.presetId || $('moodlePreset')?.value || 'moovi-uvigo';
    const baseUrl = session?.baseUrl || $('moodleUrl')?.value?.trim() || '';
    const ssoUrl = session?.ssoUrl || $('moodleSsoUrl')?.value?.trim() || '';
    const label = session?.label || presets.find((p) => p.id === presetId)?.label || '';
    loading = true;
    controls();
    msg('Opening fresh Moodle SSO login window…');
    try {
      session = await api.signIn({ presetId, baseUrl, ssoUrl, token: '', label, force: true });
      msg(`Reconnected to ${session.label}`);
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
        const relDue = (ts) => {
          if (!ts) return '';
          const diff = ts - Date.now();
          if (diff < 0) return 'Overdue';
          const mins = Math.round(diff / 60000);
          if (mins < 60) return `in ${mins}m`;
          const hrs = Math.round(diff / 3600000);
          if (hrs < 48) return `in ${hrs}h`;
          return `in ${Math.round(diff / 86400000)}d`;
        };
        const ul = document.createElement('ul');
        ul.className = 'moodle-sb-list';
        for (const ev of events) {
          const li = document.createElement('li');
          const due = ev.dueAt ? new Date(ev.dueAt).toLocaleString() : (ev.dueLabel || '');
          const rel = relDue(ev.dueAt);
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'moodle-sb-item';
          const top = document.createElement('div');
          top.className = 'moodle-sb-row';
          const titleEl = document.createElement('strong');
          titleEl.textContent = ev.name;
          top.append(titleEl);
          if (ev.statusLabel) {
            const badge = document.createElement('span');
            badge.className = `moodle-sb-badge ${ev.submitted ? 'is-done' : 'is-pending'}`;
            badge.textContent = ev.submitted ? `✓ ${ev.statusLabel}` : ev.statusLabel;
            top.append(badge);
          } else if (ev.eventKind && ev.eventKind !== 'event') {
            const badge = document.createElement('span');
            badge.className = 'moodle-sb-badge is-kind';
            badge.textContent = ev.eventKind === 'due' ? 'Due' : ev.eventKind === 'closes' ? 'Closes' : 'Opens';
            top.append(badge);
          }
          const metaEl = document.createElement('span');
          metaEl.className = 'muted';
          metaEl.textContent = [ev.course, rel, due].filter(Boolean).join(' · ');
          link.append(top, metaEl);
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
          const titleEl = document.createElement('strong');
          titleEl.textContent = a.name;
          btn.append(titleEl);
          const metaParts = [a.course, a.author, a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ''].filter(Boolean);
          if (metaParts.length) {
            const metaEl = document.createElement('span');
            metaEl.className = 'muted';
            metaEl.textContent = metaParts.join(' · ');
            btn.append(metaEl);
          }
          if (a.snippet) {
            const snip = document.createElement('span');
            snip.className = 'moodle-sb-snippet';
            snip.textContent = a.snippet;
            btn.append(snip);
          }
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
          const [deadlines, gradesRes, annRes, provs] = await Promise.all([
            api.deadlines({ days: 30 }).catch(() => []),
            api.grades(currentCourse?.id || 0).catch(() => ({ items: [] })),
            api.announcements(currentCourse?.id || 0).catch(() => ({ items: [] })),
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
            deadlines.length ? `Upcoming deadlines:\n${deadlines.map((d) => `- ${d.statusLabel ? `[${d.statusLabel}] ` : ''}${d.name} (${d.course || 'course'}) due ${d.dueAt ? new Date(d.dueAt).toLocaleString() : d.dueLabel || 'soon'}`).join('\n')}` : 'No upcoming deadlines.',
            annRes?.items?.length ? `Recent announcements:\n${annRes.items.slice(0, 15).map((a) => `- [${a.course || 'Forum'}] ${a.name}${a.snippet ? `: ${a.snippet}` : ''}`).join('\n')}` : '',
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
      const statusBox = document.createElement('div');
      statusBox.className = 'moodle-mcp-card';
      const stTitle = document.createElement('strong');
      stTitle.textContent = 'Live Moodle Connection & Context';
      const stInfo = document.createElement('p');
      stInfo.className = 'muted';
      const modeLabel = cfgData?.hasToken
        ? 'Mobile API token (encrypted on device)'
        : (session?.connected ? 'SSO browser session' : 'Not connected');
      stInfo.textContent = `${baseUrl} · ${modeLabel}${cfgData?.userName ? ` · ${cfgData.userName}` : ''}`;
      const stOut = document.createElement('div');
      stOut.className = 'muted';
      stOut.style.fontSize = '12px';
      const stRow = document.createElement('div');
      stRow.style.display = 'flex';
      stRow.style.flexWrap = 'wrap';
      stRow.style.gap = '6px';

      const testBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Test Moodle API' });
      testBtn.disabled = !session?.connected;
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        stOut.textContent = 'Checking courses, deadlines, grades & forums…';
        const t0 = performance.now();
        try {
          const [cs, dl, gr, an] = await Promise.all([
            api.courses().catch(() => []),
            api.deadlines({ days: 30 }).catch(() => []),
            api.grades(currentCourse?.id || 0).catch(() => ({ items: [] })),
            api.announcements(currentCourse?.id || 0).catch(() => ({ items: [] })),
          ]);
          const ms = Math.round(performance.now() - t0);
          stOut.textContent = `OK (${ms} ms): ${cs.length} courses · ${dl.length} deadlines · ${gr?.items?.length || 0} grades · ${an?.items?.length || 0} forum posts.`;
        } catch (e) {
          stOut.textContent = `Check failed: ${e?.message || e}`;
        } finally {
          testBtn.disabled = false;
        }
      };

      const copyCtxBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy live Moodle context (MD)' });
      copyCtxBtn.disabled = !session?.connected;
      copyCtxBtn.onclick = async () => {
        copyCtxBtn.disabled = true;
        copyCtxBtn.textContent = 'Gathering…';
        try {
          const [dl, gr, an] = await Promise.all([
            api.deadlines({ days: 30 }).catch(() => []),
            api.grades(currentCourse?.id || 0).catch(() => ({ items: [] })),
            api.announcements(currentCourse?.id || 0).catch(() => ({ items: [] })),
          ]);
          const md = [
            `# Moodle Context (${session?.label || baseUrl})`,
            courses.length ? `## Courses\n${courses.map((c) => `- ${c.fullname}`).join('\n')}` : '',
            dl.length ? `## Upcoming Deadlines\n${dl.map((d) => `- ${d.statusLabel ? `[${d.statusLabel}] ` : ''}${d.name} (${d.course || 'course'}) — ${d.dueAt ? new Date(d.dueAt).toLocaleString() : d.dueLabel || 'soon'}`).join('\n')}` : '',
            gr?.items?.length ? `## Grades\n${gr.items.slice(0, 40).map((g) => `- ${g.name}: ${g.grade}${g.percentage ? ` (${g.percentage})` : ''}`).join('\n')}` : '',
            an?.items?.length ? `## Recent Forums\n${an.items.slice(0, 15).map((a) => `- [${a.course || 'Forum'}] ${a.name}${a.snippet ? `: ${a.snippet}` : ''}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n');
          await navigator.clipboard?.writeText(md);
          copyCtxBtn.textContent = 'Copied!';
          setTimeout(() => { copyCtxBtn.textContent = 'Copy live Moodle context (MD)'; }, 1800);
        } catch (e) {
          stOut.textContent = `Could not copy: ${e?.message || e}`;
          copyCtxBtn.textContent = 'Copy live Moodle context (MD)';
        } finally {
          copyCtxBtn.disabled = false;
        }
      };

      stRow.append(testBtn, copyCtxBtn);
      statusBox.append(stTitle, stInfo, stRow, stOut);

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
      const mkBlock = (title, hint, snippet, docsUrl) => {
        const box = document.createElement('div');
        box.className = 'moodle-mcp-card';
        const h = document.createElement('strong');
        h.textContent = title;
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = hint;
        const pre = document.createElement('pre');
        pre.textContent = snippet;
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        const copy = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy MCP JSON' });
        copy.onclick = () => navigator.clipboard?.writeText(snippet).then(() => {
          copy.textContent = 'Copied!';
          setTimeout(() => { copy.textContent = 'Copy MCP JSON'; }, 1500);
        }, () => {});
        row.append(copy);
        if (docsUrl) {
          const docs = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Docs' });
          docs.onclick = () => openExternalUrl(docsUrl);
          row.append(docs);
        }
        box.append(h, p, pre, row);
        return box;
      };
      body.append(
        statusBox,
        mkBlock('open-moodle (SSO / SAML2 ready)', 'Great for UVIGO Moovi and universities that disable manual tokens.', openMoodleSnippet, cfgData?.openMoodle?.docsUrl),
        mkBlock('moodle-student-bridge (read-only student tools)', 'Courses, deadlines, quizzes, grades, feedback, announcements & files via mobile token.', bridgeSnippet, cfgData?.studentBridge?.docsUrl),
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
    if ($('moodleHiddenToggle')) {
      $('moodleHiddenToggle').onclick = () => {
        showHiddenCourses = !showHiddenCourses;
        controls();
        renderList();
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
    if ($('moodleReconnect')) $('moodleReconnect').onclick = reconnect;
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
    onQueueItemDone(item) {
      if (!item || item.source !== 'moodle') return;
      const btn = queueButtons.get(item.id);
      if (btn) markQueueDone(btn);
      status(`Downloaded ${item.name} from Moodle to Recent.`);
    },
    onQueueUpdate(stats) {
      for (const it of stats?.items || []) {
        if (it.source !== 'moodle') continue;
        const btn = queueButtons.get(it.id);
        if (btn) setQueueButton(btn, it.status === 'error' ? null : it.status);
        if (it.status === 'error' && it.error) {
          msg(`Download failed (${it.name}): ${it.error}`);
        }
      }
    },
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
