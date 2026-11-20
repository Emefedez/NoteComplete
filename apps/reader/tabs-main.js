// The tabs page (tabs.html). In a file of its own: the page's Content-Security-Policy
// (tools/reader-csp.mjs) is meant to refuse inline script.
import { tabHost } from './tab-host.js';
import { welcomeWanted } from './welcome-pref.js';
const reader = document.querySelector('meta[name="notecomplete-reader"]').content;
const host = tabHost({ container: document.getElementById('tabs'), reader });
// Each reader frame finds its bridge here (app.js, before its tab strip starts).
window.notecompleteTabHost = host;
// The browser's install prompt comes to this page (the top one); a tab asks for it.
let deferred = null;
addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event; });
host.install = async () => {
  if (!deferred) return null;
  const event = deferred; deferred = null;
  await event.prompt();
  return (await event.userChoice).outcome;
};
// The website opens with its welcome notebook in front and Home beside it (site.json),
// unless Help → "Open the welcome note at start" was turned off in this browser.
const site = welcomeWanted() ? await fetch('./site.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
if (site?.welcome) {
  const showNotes = site.notes && window.innerWidth > 700;
  host.open({ title: site.title || 'Welcome', open: site.welcome, notes: showNotes ? 1 : null });
  host.open({}, { activate: false });
} else host.open();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Optional. */ });
