// What the reader's browser checks (tools/*_e2e.mjs) all start with: Playwright's Chromium,
// the static server on a loopback port, the reader page once it is ready, and sample paths.
// Each script keeps its own viewport, server options, sample and exit code.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const READER_ROOT = fileURLToPath(new URL('../apps/reader/', import.meta.url));
export const samplePath = (name) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));

// The built reader (apps/reader after a web build) on 127.0.0.1. `options` are the server's:
// `notes` ('edit' or 'view' to share the notes; none by default), `port`.
export const startReader = (options = {}) =>
  startServer({ root: READER_ROOT, host: '127.0.0.1', address: '127.0.0.1', notes: null, ...options });

// Open the reader in `page` and wait until it can open files.
export async function openReader(page, origin) {
  await page.goto(origin + '/');
  await page.waitForFunction(() => !document.getElementById('open').disabled);
}
