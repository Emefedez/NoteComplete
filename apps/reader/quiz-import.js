// A quiz from the Markdown that Quiz Toolkit exports ("Save for NoteComplete"): one quiz per
// "## N. Title" section, one question per "### Qn · kind — badge" heading, the stem in bold,
// options as "- A. text" with ✅ on the right one, and ![](image) lines (data URLs) that become the
// question's `images`. Only single-answer multiple choice (2–9 options) can be a quiz question;
// matching, blanks and the like are counted as skipped.
import { PACK_FORMAT, PACK_VERSION } from './study-pack.js';

const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const OPTION = /^-\s+([A-Z0-9]{1,2})\.\s+(✅\s+|❌\s+)?(.*)$/;
const unbold = (s) => s.replace(/^\*\*(.*)\*\*$/s, '$1');

export function parseQuestion(block) {
  const lines = block.split('\n');
  const stem = [], images = [], options = [], notes = [];
  let right = [], inStem = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const opt = OPTION.exec(line);
    if (opt) {
      inStem = false;
      let text = opt[3].replace(/\s*\*\(picked\)\*$/, '').trim();
      if (opt[2]?.startsWith('✅')) { right.push(options.length); text = unbold(text); }
      options.push(text);
      continue;
    }
    for (const m of line.matchAll(IMAGE)) images.push(m[1]);
    if (/^\s*!\[/.test(line)) continue;
    if (line.startsWith('>')) { notes.push(line.replace(/^>\s?/, '')); continue; }
    if (inStem && line.trim()) stem.push(line.replace(/\s{2}$/, ''));
    else if (!inStem) inStem = false;
  }
  const question = unbold(stem.join('\n').trim());
  if (!question || options.length < 2 || options.length > 9 || right.length !== 1) return null;
  const out = { question, options, answer: right[0] };
  if (images.length) out.images = images;
  if (notes.join('').trim()) out.explanation = { text: notes.join('\n').trim() };
  return out;
}

// Returns { quizzes, skipped }.
export function quizzesFromMarkdown(md, { now = Date.now() } = {}) {
  const quizzes = [];
  let skipped = 0;
  for (const [i, section] of String(md).split(/^## (?=\d+\.\s)/m).slice(1).entries()) {
    const title = section.split('\n', 1)[0].replace(/^\d+\.\s*/, '').trim() || 'Quiz';
    const questions = [];
    for (const block of section.split(/^### /m).slice(1)) {
      const q = parseQuestion(block.slice(block.indexOf('\n') + 1));
      if (q) questions.push(q); else skipped++;
    }
    if (questions.length) quizzes.push({ id: `md-${now.toString(36)}-${i}`, title, created: now, questions, answers: {}, at: 0 });
  }
  return { quizzes, skipped };
}

// A study pack of those quizzes, to go through the same import as a .ncstudy file.
export function packFromMarkdown(md, title = 'Imported quizzes') {
  const { quizzes, skipped } = quizzesFromMarkdown(md);
  if (!quizzes.length) throw Error('No multiple-choice questions with a marked answer were found in this Markdown.');
  return { pack: { format: PACK_FORMAT, version: PACK_VERSION, title, created: Date.now(), quizzes }, skipped };
}
