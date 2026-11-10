// File → Import…: one picker for everything. What a chosen file is, decided from its name and,
// for Markdown and JSON, its content: study material from another NoteComplete (.ncstudy), a
// quiz from Quiz Toolkit (Markdown with marked answers), a flashcard deck (JSON), or else a
// document to open like File → Open.
import { PACK_FORMAT } from './study-pack.js';
import { quizzesFromMarkdown } from './quiz-import.js';

export async function classifyImport(file) {
  const name = String(file?.name || '');
  if (/\.ncstudy$/i.test(name)) return 'study-pack';
  if (/\.json$/i.test(name)) {
    if (file.size > 24 * 1024 * 1024) return 'document';
    try {
      const value = JSON.parse(await file.text());
      if (value?.format === PACK_FORMAT) return 'study-pack';
      if ((Array.isArray(value) ? value : [value]).some((d) => Array.isArray(d?.cards))) return 'deck';
    } catch { /* Not JSON the app knows: let Open decide. */ }
    return 'document';
  }
  if (/\.(md|markdown)$/i.test(name) && file.size < 24 * 1024 * 1024 && quizzesFromMarkdown(await file.text()).quizzes.length) return 'quiz-markdown';
  return 'document';
}
