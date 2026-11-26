#!/usr/bin/env node
// Extracts ONLY the current version's "What's new in X.Y.Z" section from docs/RELEASE_NOTES.md
// and appends the link to docs/CHANGELOG.md for the detailed change history.
// Usage: node tools/release_notes_for_tag.mjs <tag-or-version> [notes-file]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FOOTER = 'Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.';

export function extractReleaseNotes(markdown, tagOrVersion = '') {
  const version = String(tagOrVersion || '').replace(/^v/i, '').trim();
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.trim(), body: [] };
      continue;
    }
    if (/^(Earlier versions:|Detailed change history:)/i.test(line.trim())) {
      if (current) { sections.push(current); current = null; }
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);

  const exact = version
    ? sections.find((s) => new RegExp(`\\b${version.replace(/\./g, '\\.')}\\b`).test(s.heading))
    : null;
  const chosen = exact || sections[0];
  if (!chosen) return `${FOOTER}\n`;

  const body = chosen.body.join('\n').trim();
  return `${chosen.heading}\n\n${body}\n\n${FOOTER}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] || '';
  const file = process.argv[3] || 'docs/RELEASE_NOTES.md';
  const md = readFileSync(file, 'utf8');
  process.stdout.write(extractReleaseNotes(md, tag));
}
