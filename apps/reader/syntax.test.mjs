import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['vendor', 'node_modules', 'pkg', 'dist']);

function collectJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(full, out);
    else if (/\.(m?js)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

test('every reader JS module parses cleanly with node --check', () => {
  const files = collectJs(ROOT);
  assert.ok(files.length > 20, `expected >20 reader modules, found ${files.length}`);
  const failures = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failures.push(`${path.relative(ROOT, file)}: ${err.stderr?.toString('utf8').trim() || err.message}`);
    }
  }
  assert.deepEqual(failures, []);
});
