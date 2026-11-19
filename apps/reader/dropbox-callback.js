// Dropbox sends the sign-in popup back here (dropbox-auth.js). The code and state go to the
// reader over a same-origin BroadcastChannel (window.opener can be cut off by the trip to
// dropbox.com), and are removed from the address bar before the window closes.
(() => {
  const search = location.search;
  history.replaceState(null, '', location.pathname);
  try {
    const channel = new BroadcastChannel('notecomplete-dropbox-auth');
    channel.postMessage({ type: 'notecomplete-dropbox-auth', search });
    channel.close();
  } catch { /* Very old browsers: the reader times out and asks to try again. */ }
  document.getElementById('message').textContent = new URLSearchParams(search).get('error')
    ? 'Dropbox sign-in was cancelled. You can close this window.'
    : 'Signed in. You can return to NoteComplete and close this window.';
  setTimeout(() => window.close(), 300);
})();
