// The tabs page (tabs.html). In a file of its own: the page's Content-Security-Policy
// (tools/reader-csp.mjs) is meant to refuse inline script.
import { tabHost } from './tab-host.js';
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
host.open();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Optional. */ });
