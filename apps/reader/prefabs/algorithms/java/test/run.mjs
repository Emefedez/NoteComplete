#!/usr/bin/env node
// A tiny harness for the Java simulator:
//   node apps/reader/prefabs/algorithms/java/test/run.mjs File.java [More.java…] [--entry Class.method]
//        [--args '[json, …]'] [--input 'text'] [--steps] [--max-steps N]
// Prints the program's output, the result or error, and (with --steps) one line per step.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { runJava } from '../index.js';

const argv = process.argv.slice(2);
const files = [];
const opts = {};
let showSteps = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--entry') opts.entry = argv[++i];
  else if (a === '--args') opts.args = JSON.parse(argv[++i]);
  else if (a === '--input') opts.input = argv[++i];
  else if (a === '--max-steps') opts.maxSteps = Number(argv[++i]);
  else if (a === '--steps') showSteps = true;
  else files.push({ name: basename(a), text: readFileSync(a, 'utf8') });
}
if (!files.length) { console.error('usage: run.mjs File.java … [--entry C.m] [--args JSON] [--input TEXT] [--steps]'); process.exit(2); }
const t = runJava(files, opts);
if (showSteps) {
  for (const [i, s] of t.steps.entries()) {
    const vars = Object.entries(s.vars).map(([k, v]) => k + '=' + (typeof v === 'string' ? v : JSON.stringify(v))).join(' ');
    console.log(String(i).padStart(4), ('L' + s.line).padEnd(5), s.calls.map((c) => c.fn).join('>').padEnd(24), s.caption, vars ? ' | ' + vars : '');
  }
}
process.stdout.write(t.output);
if (t.error) console.log('error:', JSON.stringify(t.error));
else console.log('result:', JSON.stringify(t.result));
console.log('steps run:', t.stepsRun, '| recorded:', t.steps.length + (t.truncated ? ' (truncated)' : ''), '| structures:', Object.keys(t.structures).join(', '));
