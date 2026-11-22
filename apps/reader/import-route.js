// File → Import…: one picker for everything. What a chosen file is, decided from its name and,
// for Markdown and JSON, its content: study material from another NoteComplete (.ncstudy), a
// quiz from Quiz Toolkit (Markdown with marked answers), a flashcard deck (JSON), or else a
// document to open like File → Open.
import { PACK_FORMAT } from './study-pack.js';
import { quizzesFromMarkdown } from './quiz-import.js';

export async function classifyImport(file) {
  const name = String(file?.name || '');
  if (/\.ncstudy$/i.test(name)) return 'study-pack';
  const mayPeek = file?.size < 24 * 1024 * 1024 && !/\.(nfedit|noteful|notecomp(lete)?|notepart|pdf|png|jpe?g|webp|gif|bmp|svg|avif|ico|mp3|m4a|wav|ogg|oga|opus|flac|aac|weba|mp4|m4v|webm|mkv|mov|avi|ogv|docx|docm|dotx|doc|rtf|odt|fodt|xlsx|xlsm|xlsb|xls|ods|fods|pptx|pptm|ppt|odp|epub|ipynb|html?|tar|zip|gz)$/i.test(name);
  if (/\.json$/i.test(name) || mayPeek) {
    if (file.size > 24 * 1024 * 1024) return 'document';
    const text = await file.text();
    const trimmed = text.trimStart();
    if (/\.json$/i.test(name) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const value = JSON.parse(trimmed);
        if (value?.format === PACK_FORMAT) return 'study-pack';
        if ((Array.isArray(value) ? value : [value]).some((d) => Array.isArray(d?.cards))) return 'deck';
      } catch { /* Not JSON the app knows: let Open decide. */ }
      if (/\.json$/i.test(name)) return 'document';
    }
    if ((/\.(md|markdown)$/i.test(name) || !/\.[a-z0-9]{1,8}$/i.test(name)) && quizzesFromMarkdown(text).quizzes.length) return 'quiz-markdown';
    return 'document';
  }
  return 'document';
}
