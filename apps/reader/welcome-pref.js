// The website opens its welcome notebook in a tab at start (tabs-main.js, site.json).
// Help → "Open the welcome note at start" turns that off; this browser remembers it.
export const WELCOME_KEY = 'notecomplete-welcome';

export function welcomeWanted(storage = globalThis.localStorage) {
  try { return storage?.getItem(WELCOME_KEY) !== 'off'; } catch { return true; }
}

export function setWelcomeWanted(wanted, storage = globalThis.localStorage) {
  try {
    if (wanted) storage?.removeItem(WELCOME_KEY);
    else storage?.setItem(WELCOME_KEY, 'off');
  } catch { /* Private browsing: the welcome note keeps opening. */ }
}
