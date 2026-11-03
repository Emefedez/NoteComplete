// Fact check (Study → Fact check…): the AI reads pages of the note and reports, per page,
// what is wrong, inconsistent (on the page, or with another page of the check), unclear or
// missing, each with a correction. The findings go into the Markdown notes under a heading,
// one `<!-- page N -->` marker (a page badge that jumps to the page) per page.

export const KINDS = {
  error: { mark: '❌', label: 'Error' },
  inconsistency: { mark: '⚠️', label: 'Inconsistency' },
  unclear: { mark: '❓', label: 'Unclear' },
  missing: { mark: '➕', label: 'Missing' },
};

// The request for one batch of pages; `reference` is the text of the other pages checked,
// so inconsistencies across the whole selection can be found.
export function factCheckPrompt({ title, language, unit = 'page', pages = [], reference = '' }) {
  const lang = language ? `Write in ${language}.` : "Write in the note's own language.";
  const nums = pages.map(p => p + 1);
  const what = unit === 'section' ? `the numbered sections of the text document "${title}"` : `pages of the student's notes "${title}" (images with any tape lifted, plus their extracted text)`;
  return `You are fact-checking ${what}: ${nums.join(', ')}. Check the content as a careful teacher would:
- factual errors (wrong dates, names, definitions, formulas, numbers, calculations, units, worked steps);
- inconsistencies: within a ${unit}, or between this ${unit} and another ${unit} of the note (for those, name the other ${unit} in "related");
- statements that are unclear, ambiguous or misleading as written;
- something important that is missing for the content to be right (a missing condition, exception, sign or step).
Read handwriting and printed text alike. Do not report style, spelling of names you cannot verify, handwriting legibility or formatting. Report only what you are reasonably sure of; when unsure, say so with "confidence":"low". Quote the exact words of the note in "quote" (short), say what is wrong in "problem", and give the corrected statement in "correction".
Every ${unit} in the list must appear once in "pages", with an empty "issues" list when nothing needs correcting. ${lang}
Reply with ONLY this JSON, no prose: {"pages":[{"page":${nums[0] ?? 1},"issues":[{"kind":"error|inconsistency|unclear|missing","quote":"…","problem":"…","correction":"…","related":null,"confidence":"high|medium|low"}]}]}${reference ? `\n\nFor consistency, the text of the other ${unit}s being checked (do not report issues on them, only use them to compare):\n${reference}` : ''}`;
}

const text = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
// The findings of one batch, only for its pages: [{ page (1-based), issues: […] }].
export function cleanFindings(value, pages) {
  const asked = new Set(pages.map(p => p + 1)), out = new Map();
  for (const p of asked) out.set(p, []);
  for (const entry of Array.isArray(value?.pages) ? value.pages : []) {
    const page = Number(entry?.page);
    if (!asked.has(page)) continue;
    for (const issue of Array.isArray(entry?.issues) ? entry.issues : []) {
      const kind = KINDS[issue?.kind] ? issue.kind : 'error';
      const problem = text(issue?.problem), correction = text(issue?.correction);
      if (!problem && !correction) continue;
      const related = Number(issue?.related);
      out.get(page).push({
        kind, quote: text(issue?.quote), problem, correction,
        related: Number.isInteger(related) && related > 0 && related !== page ? related : null,
        confidence: ['high', 'medium', 'low'].includes(issue?.confidence) ? issue.confidence : 'medium',
      });
    }
  }
  return [...out].map(([page, issues]) => ({ page, issues }));
}

// Markdown for the notes: a heading, then each page with findings under its page badge,
// and the pages found correct in one line.
export function findingsMarkdown(findings, { title = 'AI fact check', provider = '', date = new Date(), unit = 'page' } = {}) {
  const sorted = [...findings].sort((a, b) => a.page - b.page);
  const pages = sorted.map(f => f.page), word = unit === 'section' ? '§' : 'p.';
  const span = pages.length ? `${word} ${pages[0]}${pages.length > 1 ? `–${pages.at(-1)}` : ''}` : '';
  const when = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [`## ${title} · ${when}${span ? ` · ${span}` : ''}`, `_Suggestions${provider ? ` by ${provider}` : ''}: check them against your sources before changing your notes._`, ''];
  const clean = [];
  for (const { page, issues } of sorted) {
    if (!issues.length) { clean.push(page); continue; }
    if (unit === 'page') lines.push(`<!-- page ${page} -->`);
    else lines.push(`**§ ${page}**`);
    for (const issue of issues) {
      const { mark, label } = KINDS[issue.kind];
      const head = issue.kind === 'inconsistency' && issue.related ? `${label} with ${word} ${issue.related}` : label;
      const quote = issue.quote ? ` “${issue.quote}”` : '';
      const unsure = issue.confidence === 'low' ? ' _(unsure)_' : '';
      lines.push(`- ${mark} **${head}:**${quote}${issue.problem ? ` — ${issue.problem}` : ''}${unsure}`);
      if (issue.correction) lines.push(`  - **Correction:** ${issue.correction}`);
    }
    lines.push('');
  }
  if (clean.length) lines.push(`✅ Nothing to correct on ${word} ${clean.join(', ')}.`, '');
  return lines.join('\n').trim();
}

// The text of the pages checked, short, for comparing across batches.
export function referenceText(texts, limit = 30000) {
  const per = Math.max(400, Math.floor(limit / Math.max(1, texts.length)));
  return texts.filter(t => t.text.trim()).map(t => `[${t.label}]\n${t.text.trim().slice(0, per)}`).join('\n\n').slice(0, limit);
}
