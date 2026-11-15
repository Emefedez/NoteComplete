// AI Exam prompt, sanitizer, and A4 HTML builder styled after Examen_Extenso_Temario_1_ACII.html,
// using visible answer/theory blocks tagged with [data-tape-answer] instead of <details> dropdowns
// so generated PDF pages receive exact-fit Noteful Tape overlays.

let katexMod = null;
export async function ensureExamMathRenderer() {
  if (!katexMod) {
    try {
      const m = await import('./vendor/katex/katex.mjs');
      katexMod = m?.default || m;
    } catch {
      katexMod = null;
    }
  }
  return katexMod;
}

export const PROBLEM_TYPES = [
  ['mcq', 'Multiple choice'],
  ['fill', 'Fill-in / conversions'],
  ['calculation', 'Calculations / derivations'],
  ['open', 'Open-ended / essays'],
  ['table', 'Complete tables'],
  ['code', 'Code / trace / debug'],
];

export const FOCUS_MODES = [
  ['important', 'Most important / frequent'],
  ['everything', 'Literally everything (all details)'],
  ['random', 'Random mix'],
];

const FOCUS_RULES = {
  important: 'Focus on the highest-yield, most repeated, and core exam-likely concepts across the sources. Spend more depth and points on foundational mechanisms and recurring themes.',
  everything: 'Comprehensive coverage: systematically cover EVERY distinct topic, subtopic, definition, formula, edge case, diagram/table, and concrete detail present across all provided sources without omitting minor sections.',
  random: 'Random sampling: pick an unpredictable, varied assortment of concepts from anywhere in the sources — mixing headline theorems with subtle details, edge cases, and atypical combinations.',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Splits exam prose into plain text and $...$ / $$...$$ LaTeX segments without misreading prices like "$5 and $10".
export function splitExamMath(text) {
  const source = String(text ?? '');
  const parts = [];
  let plainStart = 0;
  let i = 0;
  const pushText = (end) => {
    if (end > plainStart) parts.push({ text: source.slice(plainStart, end).replaceAll('\\$', '$') });
  };
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$') { i += 2; continue; }
    if (source[i] !== '$') { i += 1; continue; }
    if (source[i + 1] === '$') {
      const close = source.indexOf('$$', i + 2);
      if (close !== -1) {
        pushText(i);
        parts.push({ tex: source.slice(i + 2, close).trim(), display: true });
        i = close + 2;
        plainStart = i;
        continue;
      }
      i += 2;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < source.length && source[j] !== '\n'; j++) {
      if (source[j] === '\\') { j += 1; continue; }
      if (source[j] === '$') {
        if (source[j + 1] === '$') break;
        close = j;
        break;
      }
    }
    if (close !== -1) {
      const inner = source.slice(i + 1, close);
      const nextCh = source[close + 1] || '';
      if (inner.trim() && !/^\s|\s$/.test(inner) && !/\d/.test(nextCh)) {
        pushText(i);
        parts.push({ tex: inner.trim(), display: false });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i += 1;
  }
  pushText(source.length);
  return parts;
}

function formatInlinePlain(s) {
  return escapeHtml(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

// Renders LaTeX ($...$, $$...$$) using bundled KaTeX MathML so formulas print natively in offline A4 PDFs.
export function renderRichExamHtml(value, katex = katexMod) {
  const source = String(value ?? '');
  if (!source) return '';
  return splitExamMath(source).map((part) => {
    if (part.tex == null) return formatInlinePlain(part.text);
    if (!katex?.renderToString) {
      return `<code>${escapeHtml(part.tex)}</code>`;
    }
    try {
      const html = katex.renderToString(part.tex, {
        displayMode: part.display,
        output: 'mathml',
        throwOnError: false,
      });
      return part.display ? `<span class="math-block">${html}</span>` : html;
    } catch {
      return `<code>${escapeHtml(part.tex)}</code>`;
    }
  }).join('');
}

export function examPrompt({
  title = '',
  sourcesText = '',
  types = ['mcq', 'fill', 'calculation', 'open', 'table', 'code'],
  countMode = 'auto',
  count = 12,
  difficulty = 'exam',
  focus = 'important',
  language = 'auto',
  includeTheory = true,
  instructions = '',
} = {}) {
  const pickedTypes = types?.length ? types : ['mcq', 'fill', 'open'];
  const focusText = FOCUS_RULES[focus] || FOCUS_RULES.important;
  const countLine = countMode === 'exact'
    ? `Create exactly ${Math.max(1, Math.min(60, Number(count) || 12))} distinct problems across logical sections.`
    : 'Choose the optimal number of problems yourself (as many as needed to match the requested focus without padding or cutting off important sections; for comprehensive requests, be thorough).';
  const langLine = language && language !== 'auto'
    ? `Write every heading, question, option, table, theory box, and answer strictly in ${language}.`
    : 'Write in the primary language of the provided sources.';
  const diffMap = {
    easy: 'Introductory / foundation check: clear conceptual checks and straightforward exercises.',
    exam: 'Authentic university/certification exam rigor: realistic edge cases, multi-step reasoning, and common pitfalls.',
    hard: 'Challenging advanced problems: synthesis across topics, tricky edge cases, proofs/derivations, and subtle traps.',
  };

  const hasRichKinds = pickedTypes.some((t) => ['open', 'calculation', 'code', 'table'].includes(t));
  const balanceRule = hasRichKinds
    ? 'CRITICAL EXERCISE MIX RULE: Whenever the sources contain algorithms, systems/architectural mechanisms, formulas, scheduling, memory management, proofs, or design tradeoffs, you MUST include genuine multi-step development, calculation, table, or code-trace exercises (`open`, `calculation`, `table`, `code` with clear sub-parts and `writingLines` / `expressions`). Do NOT default mostly to True/False or shallow one-line MCQs when real developable exercises can be crafted; keep True/False or short MCQs only as a minor share (or only when a source truly contains nothing deeper than factual T/F statements).'
    : '';

  return [
    'You are an expert professor designing a rich, printable A4 written examination from the student’s study sources.',
    title.trim() ? `Requested exam title: ${title.trim()}` : '',
    langLine,
    `Difficulty: ${diffMap[difficulty] || diffMap.exam}`,
    `Coverage focus: ${focusText}`,
    countLine,
    `Include ONLY these problem kinds (distribute them naturally based on what each topic suits best): ${pickedTypes.join(', ')}.`,
    balanceRule,
    includeTheory
      ? 'For sections or tricky questions where background intuition helps, include a concise `theory` field explaining the underlying rule.'
      : 'Omit standalone theory boxes (`"theory": ""`).',
    instructions?.trim() ? `Extra teacher instructions: ${instructions.trim()}` : '',
    '',
    'Reply with ONLY valid JSON (no markdown fences, no commentary outside JSON) with this exact schema:',
    '{',
    '  "title": "Exam title",',
    '  "subtitle": "Short scope & estimated time summary",',
    '  "sections": [',
    '    {',
    '      "heading": "Topic / Block title",',
    '      "badge": "BLOCK 1",',
    '      "badgeKind": "exam | src | prj",',
    '      "intro": "Optional 1-2 line context",',
    '      "theory": "Optional concise theory foundation for this section (2-4 sentences)",',
    '      "problems": [',
    '        {',
    '          "number": "1.1",',
    '          "kind": "mcq | fill | calculation | open | table | code",',
    '          "sourceRef": "Short source attribution if helpful",',
    '          "points": 1.5,',
    '          "prompt": "Complete problem statement or sub-question instructions",',
    '          "options": ["Option A text", "Option B text", "Option C text", "Option D text"],',
    '          "expressions": [{"label": "a) Convert 0x3F to binary:", "answerWidth": "medium"}],',
    '          "writingLines": 4,',
    '          "table": {"headers": ["Col A", "Col B", "Col C"], "rows": [["given", "", ""], ["", "given", ""]]},',
    '          "code": "Optional code/assembly/pseudocode snippet for code/trace questions",',
    '          "answerBox": {',
    '            "summary": "Clear direct final answer (visible under tape!)",',
    '            "steps": "Step-by-step justification / calculation / explanation",',
    '            "trap": "Optional common mistake or exam trap to avoid"',
    '          }',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules per problem kind:',
    '- `mcq`: include 4 plausible `options`. Put the winning option letter + brief justification in `answerBox`.',
    '- `fill`: include `expressions` (1-5 short prompts/conversions/identities that students fill on a blank line). Put exact filled results in `answerBox`.',
    '- `calculation`: state given values clearly, optionally set `writingLines` (4-8), and put complete worked formulas + numeric result in `answerBox.steps` + `answerBox.summary`.',
    '- `open`: set `writingLines` (3-7) for ruled workspace and put model grading key + expected points in `answerBox`.',
    '- `table`: include `table` with `headers` and partially blank `rows`, plus the completed values/explanation in `answerBox`.',
    '- `code`: include `code` snippet (and optional `writingLines`), plus execution output / bug fix / complexity in `answerBox`.',
    '',
    'IMPORTANT: Answers are NOT inside dropdowns — they render inside printable solution boxes that get covered by removable Noteful Tape. Keep every `answerBox` concise, crisp, self-contained, and scannable!',
    '',
    'STUDY SOURCES:',
    sourcesText,
  ].filter(Boolean).join('\n');
}

const VALID_KINDS = new Set(['mcq', 'fill', 'calculation', 'open', 'table', 'code']);

export function cleanExamData(raw) {
  if (!raw || typeof raw !== 'object') throw Error('The AI did not return structured exam JSON.');
  const rawSections = Array.isArray(raw.sections) && raw.sections.length
    ? raw.sections
    : Array.isArray(raw.problems)
      ? [{ heading: 'Exam Problems', badge: 'EXAM', badgeKind: 'exam', problems: raw.problems }]
      : [];
  let seq = 1;
  const sections = rawSections.map((sec, si) => {
    const problems = (Array.isArray(sec?.problems) ? sec.problems : [])
      .filter((p) => p && typeof p.prompt === 'string' && p.prompt.trim())
      .map((p, pi) => {
        const kind = VALID_KINDS.has(String(p.kind || '').toLowerCase())
          ? String(p.kind).toLowerCase()
          : Array.isArray(p.options) && p.options.length >= 2
            ? 'mcq'
            : p.table?.headers?.length
              ? 'table'
              : typeof p.code === 'string' && p.code.trim()
                ? 'code'
                : Array.isArray(p.expressions) && p.expressions.length
                  ? 'fill'
                  : 'open';
        const ans = p.answerBox && typeof p.answerBox === 'object'
          ? p.answerBox
          : { summary: String(p.answer || p.solution || ''), steps: String(p.explanation || ''), trap: '' };
        const summary = String(ans.summary ?? ans.final ?? '').trim();
        const steps = String(ans.steps ?? ans.explanation ?? '').trim();
        const trap = String(ans.trap ?? ans.warning ?? '').trim();
        return {
          number: String(p.number || `${si + 1}.${pi + 1 || seq++}`),
          kind,
          sourceRef: String(p.sourceRef || '').trim(),
          points: Number.isFinite(Number(p.points)) && Number(p.points) > 0 ? Number(p.points) : null,
          prompt: p.prompt.trim(),
          options: Array.isArray(p.options) ? p.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [],
          expressions: Array.isArray(p.expressions)
            ? p.expressions
                .map((ex) => (typeof ex === 'string' ? { label: ex, answerWidth: 'medium' } : ex))
                .filter((ex) => ex && String(ex.label || '').trim())
            : [],
          writingLines: Math.max(0, Math.min(10, Number(p.writingLines) || (kind === 'open' ? 4 : kind === 'calculation' ? 5 : 0))),
          table: p.table && Array.isArray(p.table.headers) && Array.isArray(p.table.rows) ? p.table : null,
          code: typeof p.code === 'string' ? p.code.trim() : '',
          answerBox: {
            summary: summary || steps || 'See worked solution.',
            steps: summary && steps && steps !== summary ? steps : (summary ? steps : ''),
            trap,
          },
        };
      });
    return {
      heading: String(sec?.heading || `Section ${si + 1}`).trim(),
      badge: String(sec?.badge || `PART ${si + 1}`).trim(),
      badgeKind: ['exam', 'src', 'prj'].includes(sec?.badgeKind) ? sec.badgeKind : 'exam',
      intro: String(sec?.intro || '').trim(),
      theory: String(sec?.theory || '').trim(),
      problems,
    };
  }).filter((s) => s.problems.length > 0);

  if (!sections.length) throw Error('The exam response contained no valid problems.');
  return {
    title: String(raw.title || 'Practice Examination').trim(),
    subtitle: String(raw.subtitle || '').trim(),
    sections,
  };
}

export const EXAM_PRINT_CSS = `
  @page { size: 210mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 9.2pt;
    line-height: 1.42;
    color: #1a202c;
    background: #ffffff;
  }
  .exam-page {
    width: 210mm;
    height: 297mm;
    padding: 9mm 11mm;
    background: #ffffff;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .exam-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .exam-hdr {
    border-bottom: 2.2px solid #0f172a;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  .exam-hdr h1 {
    font-size: 14.5pt;
    color: #0f172a;
    margin: 0 0 3px 0;
    letter-spacing: -0.2px;
  }
  .exam-meta {
    font-size: 8.3pt;
    color: #475569;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }
  .student-strip {
    margin-top: 6px;
    padding: 5px 8px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 8.3pt;
    color: #334155;
    display: flex;
    gap: 14px;
  }
  .student-strip span { flex: 1; border-bottom: 1px dashed #94a3b8; padding-bottom: 1px; }
  .sec-hdr {
    margin-top: 6px;
    margin-bottom: 6px;
  }
  h2 {
    font-size: 10.6pt;
    background: #0f172a;
    color: #ffffff;
    padding: 4px 8px;
    margin: 0 0 5px 0;
    border-radius: 3px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .sec-intro {
    margin: 0 0 6px 0;
    color: #334155;
    font-size: 8.7pt;
  }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    vertical-align: middle;
  }
  .badge.exam { background: #dc2626; color: #ffffff; }
  .badge.src  { background: #2563eb; color: #ffffff; }
  .badge.prj  { background: #059669; color: #ffffff; }
  .theory-box {
    background: #eff6ff;
    border: 1px solid #93c5fd;
    border-left: 4px solid #2563eb;
    padding: 6px 9px;
    border-radius: 4px;
    margin: 4px 0 8px 0;
    font-size: 8.5pt;
    color: #1e3a8a;
  }
  .theory-box strong.lbl {
    color: #1d4ed8;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    display: block;
    margin-bottom: 2px;
  }
  .prob-card {
    border: 1px solid #e2e8f0;
    border-radius: 5px;
    padding: 7px 9px;
    margin-bottom: 8px;
    background: #ffffff;
    break-inside: avoid;
  }
  .prob-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }
  .prob-num {
    font-weight: 800;
    color: #0f172a;
    font-size: 9.4pt;
  }
  .prob-kind {
    font-size: 7.2pt;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 3px;
    background: #e2e8f0;
    color: #334155;
  }
  .prob-pts {
    margin-left: auto;
    font-size: 7.8pt;
    color: #475569;
    font-weight: 600;
  }
  .prob-prompt {
    margin: 0 0 5px 0;
    white-space: pre-wrap;
  }
  .mc-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
    margin: 5px 0;
  }
  .mc-opt {
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 4px 7px;
    font-size: 8.5pt;
    background: #f8fafc;
  }
  .expr-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin: 5px 0;
    font-size: 8.8pt;
  }
  .fill-line {
    flex: 1;
    min-width: 75px;
    border-bottom: 1.5px solid #475569;
    height: 15px;
  }
  .writing-lines { margin: 5px 0; }
  .wline { border-bottom: 1px solid #cbd5e1; height: 17px; }
  table.exam-tbl {
    width: 100%;
    border-collapse: collapse;
    margin: 5px 0;
    font-size: 8.3pt;
  }
  table.exam-tbl th {
    background: #1e293b;
    color: #ffffff;
    text-align: left;
    padding: 4px 6px;
    border: 1px solid #334155;
  }
  table.exam-tbl td {
    border: 1px solid #cbd5e1;
    padding: 4px 6px;
    min-height: 18px;
  }
  pre.exam-code {
    background: #0f172a;
    color: #e2e8f0;
    padding: 6px 8px;
    border-radius: 4px;
    font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
    font-size: 7.8pt;
    line-height: 1.38;
    margin: 5px 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .key {
    background: #ecfdf5;
    border: 1px solid #6ee7b7;
    border-left: 4px solid #10b981;
    padding: 5px 8px;
    border-radius: 4px;
    margin-top: 6px;
    font-size: 8.3pt;
    color: #064e3b;
  }
  .key strong.lbl {
    color: #047857;
    font-size: 7.7pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .key-steps { margin-top: 2px; white-space: pre-wrap; }
  .bad {
    background: #fef2f2;
    border-left: 3px solid #ef4444;
    padding: 3px 6px;
    margin-top: 4px;
    font-size: 8pt;
    color: #7f1d1d;
    border-radius: 2px;
  }
  math { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", "Noto Serif", Georgia, serif; font-size: 1.03em; }
  .math-block { display: block; margin: 5px 0; text-align: center; }
  .solve-steps-box {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 4px solid #475569;
    padding: 7px 9px;
    border-radius: 4px;
    margin: 7px 0;
  }
  .solve-steps-box strong.lbl {
    display: block;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.35px;
    color: #334155;
    margin-bottom: 4px;
  }
  .solve-step-item { margin: 4px 0 6px 0; }
  .solve-step-work { border-bottom: 1px dashed #cbd5e1; height: 22px; margin-top: 3px; }
  .solve-sol-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0f172a;
    color: #ffffff;
    padding: 5px 9px;
    border-radius: 4px;
    margin-bottom: 8px;
    font-size: 10.4pt;
    font-weight: 700;
  }
  .solve-part-ans { margin: 5px 0; padding: 4px 7px; background: rgba(255,255,255,0.65); border-radius: 4px; border: 1px solid #a7f3d0; }
  .solve-part-ans .ans-final { font-weight: 700; color: #064e3b; }
  .solve-part-ans .ans-work { margin-top: 3px; white-space: pre-wrap; }
  .solve-card-free { break-inside: auto; }
  @media screen {
    body { background: #e2e8f0; padding: 14px 0; }
    .exam-page { margin: 0 auto 14px auto; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
  }
`;

function renderProblemHtml(p) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const parts = [];
  parts.push(`<article class="prob-card">`);
  parts.push(
    `<div class="prob-head">`
      + `<span class="prob-num">${escapeHtml(p.number)}</span>`
      + `<span class="prob-kind">${escapeHtml(p.kind)}</span>`
      + (p.sourceRef ? `<span class="badge src">${escapeHtml(p.sourceRef)}</span>` : '')
      + (p.points != null ? `<span class="prob-pts">${escapeHtml(p.points)} pts</span>` : '')
      + `</div>`,
  );
  parts.push(`<p class="prob-prompt">${renderRichExamHtml(p.prompt)}</p>`);

  if (p.code) {
    parts.push(`<pre class="exam-code"><code>${escapeHtml(p.code)}</code></pre>`);
  }
  if (p.options?.length) {
    parts.push(
      `<div class="mc-grid">`
        + p.options.map((opt, idx) => `<div class="mc-opt"><strong>${letters[idx] || idx + 1})</strong> ${renderRichExamHtml(opt)}</div>`).join('')
        + `</div>`,
    );
  }
  if (p.expressions?.length) {
    for (const ex of p.expressions) {
      parts.push(`<div class="expr-row"><span>${renderRichExamHtml(ex.label)}</span><span class="fill-line"></span></div>`);
    }
  }
  if (p.table?.headers?.length) {
    const ths = p.table.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
    const rows = (p.table.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
    parts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (p.writingLines > 0) {
    parts.push(`<div class="writing-lines">${'<div class="wline"></div>'.repeat(p.writingLines)}</div>`);
  }

  parts.push(
    `<div class="key" data-tape-answer="solution">`
      + `<strong class="lbl">Solution</strong> · ${renderRichExamHtml(p.answerBox.summary)}`
      + (p.answerBox.steps ? `<div class="key-steps">${renderRichExamHtml(p.answerBox.steps)}</div>` : '')
      + (p.answerBox.trap ? `<div class="bad"><strong>Watch out:</strong> ${renderRichExamHtml(p.answerBox.trap)}</div>` : '')
      + `</div>`,
  );
  parts.push(`</article>`);
  return parts.join('\n');
}

export function buildPaginatedExamHtml(exam, { showTheory = true, interactiveFallback = false } = {}) {
  const totalProblems = exam.sections.reduce((acc, s) => acc + s.problems.length, 0);
  const totalPts = exam.sections.reduce((acc, s) => acc + s.problems.reduce((a, p) => a + (p.points || 0), 0), 0);
  const blocks = [];

  blocks.push(
    `<header class="exam-hdr">`
      + `<h1>${escapeHtml(exam.title)}</h1>`
      + `<div class="exam-meta">`
      + `<span>${escapeHtml(exam.subtitle || 'AI-generated practice exam with pre-applied Noteful tape answers')}</span>`
      + `<span>${totalProblems} problem${totalProblems === 1 ? '' : 's'}${totalPts > 0 ? ` · ${totalPts.toFixed(1).replace(/\.0$/, '')} pts` : ''}</span>`
      + `</div>`
      + `<div class="student-strip"><span>Name:</span><span>Date:</span><span>Score: ____ / ${totalPts > 0 ? totalPts.toFixed(1).replace(/\.0$/, '') : totalProblems}</span></div>`
      + `</header>`,
  );

  for (const sec of exam.sections) {
    blocks.push(
      `<div class="sec-hdr">`
        + `<h2><span class="badge ${escapeHtml(sec.badgeKind)}">${escapeHtml(sec.badge)}</span> ${renderRichExamHtml(sec.heading)}</h2>`
        + (sec.intro ? `<p class="sec-intro">${renderRichExamHtml(sec.intro)}</p>` : '')
        + (showTheory && sec.theory
          ? `<div class="theory-box" data-tape-answer="theory"><strong class="lbl">Theory Foundation</strong>${renderRichExamHtml(sec.theory)}</div>`
          : '')
        + `</div>`,
    );
    for (const p of sec.problems) {
      blocks.push(renderProblemHtml(p));
    }
  }

  return wrapExamHtmlDocument(exam.title, blocks, { interactiveFallback });
}

function wrapExamHtmlDocument(title, blocks, { interactiveFallback = false } = {}) {
  const interactiveCss = interactiveFallback
    ? `.key[data-tape-answer],.theory-box[data-tape-answer]{cursor:pointer;position:relative;}
       .key[data-tape-answer]:not(.revealed)::after,.theory-box[data-tape-answer]:not(.revealed)::after{
         content:"Click to peel Noteful answer tape";position:absolute;inset:0;display:grid;place-items:center;
         font-weight:700;font-size:8.5pt;color:#422006;background:repeating-linear-gradient(-45deg,#facc15,#facc15 10px,#eab308 10px,#eab308 20px);border-radius:4px;
       }
       .theory-box[data-tape-answer]:not(.revealed)::after{color:#0c4a6e;background:repeating-linear-gradient(-45deg,#7dd3fc,#7dd3fc 10px,#38bdf8 10px,#38bdf8 20px);}`
    : '';
  const interactiveScript = interactiveFallback
    ? `<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-tape-answer]');if(b)b.classList.toggle('revealed');});</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';${interactiveFallback ? " script-src 'unsafe-inline';" : ''} img-src data:; font-src data:;" />
  <title>${escapeHtml(title)}</title>
  <style>${EXAM_PRINT_CSS}${interactiveCss}</style>
</head>
<body>
  <div class="exam-flow">${blocks.join('\n')}</div>
  <div class="exam-pages"></div>
  ${interactiveScript}
</body>
</html>`;
}

// ---- Stage 1 / Stage 2 / Stage 3 parallel exam planning & solving ----

export function buildSourceCatalog(docs = [], maxExcerptChars = 360) {
  return (docs || []).map((d, idx) => {
    const clean = String(d?.text || '').replace(/\s+/g, ' ').trim();
    const snippet = clean.length > maxExcerptChars ? `${clean.slice(0, maxExcerptChars)}…` : clean;
    const folder = d?.folderName ? ` [${d.folderName}]` : '';
    return `[${idx}] "${d?.title || `Source ${idx + 1}`}"${folder} (${String(d?.text || '').length} chars): ${snippet || '(scanned/image content)'}`;
  }).join('\n');
}

export function buildFallbackExamPlan(docs = [], { countMode = 'auto', count = 12, maxChunks = 4, targetChars = 15000 } = {}) {
  const nDocs = docs?.length || 0;
  if (!nDocs) return [];
  const totalChars = docs.reduce((s, d) => s + String(d?.text || '').length, 0);
  const desiredChunks = nDocs === 1
    ? 1
    : Math.max(1, Math.min(maxChunks, nDocs, Math.max(2, Math.ceil(totalChars / targetChars))));

  const buckets = Array.from({ length: desiredChunks }, () => ({ docIndices: [], chars: 0 }));
  docs.forEach((d, idx) => {
    // Place each doc into the lightest bucket so parallel subagents finish at similar times.
    let best = 0;
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].chars < buckets[best].chars) best = i;
    }
    buckets[best].docIndices.push(idx);
    buckets[best].chars += String(d?.text || '').length || 1200;
  });

  const nonEmpty = buckets.filter((b) => b.docIndices.length > 0);
  const exactTotal = countMode === 'exact' ? Math.max(1, Math.min(60, Number(count) || 12)) : 0;
  return nonEmpty.map((b, i) => {
    const share = exactTotal
      ? Math.max(1, Math.floor(exactTotal / nonEmpty.length) + (i < exactTotal % nonEmpty.length ? 1 : 0))
      : 0;
    const firstTitle = docs[b.docIndices[0]]?.title || `Block ${i + 1}`;
    const heading = b.docIndices.length === 1 ? firstTitle : `${firstTitle} & related (${b.docIndices.length} sources)`;
    return {
      heading,
      badge: `BLOCK ${i + 1}`,
      badgeKind: i === 0 ? 'exam' : i % 2 === 1 ? 'src' : 'prj',
      docIndices: b.docIndices,
      count: share,
      focusNote: '',
    };
  });
}

export function examPlanPrompt({
  title = '',
  catalogText = '',
  docCount = 1,
  countMode = 'auto',
  count = 12,
  focus = 'important',
  language = 'auto',
} = {}) {
  const langLine = language && language !== 'auto'
    ? `Use ${language} for headings and subtitles.`
    : 'Match the primary language of the catalog sources.';
  const countRule = countMode === 'exact'
    ? `Distribute exactly ${Math.max(1, Math.min(60, Number(count) || 12))} total questions across the chunks (sum of all \`count\` fields MUST equal ${Math.max(1, Math.min(60, Number(count) || 12))}).`
    : 'Set each chunk `count` to 3-6 questions depending on content density (or 0 to let the worker decide).';
  return [
    'You are the orchestrator separating study sources into 2 to 4 balanced, cohesive topic blocks so parallel subagents can write questions simultaneously.',
    title ? `Exam title: "${title}"` : '',
    langLine,
    `Coverage focus: ${focus}.`,
    countRule,
    `Every source index 0..${Math.max(0, docCount - 1)} must appear in at least one chunk.`,
    'CRITICAL: Organize blocks by SUBJECT TOPIC — NEVER create blocks dedicated solely to "True/False" or shallow trivia when sources cover developable concepts, formulas, algorithms, or system exercises. In `focusNote`, tell each block worker to include genuine multi-step development, calculation, derivation, or trace exercises whenever the assigned sources support them.',
    '',
    'Reply with ONLY valid JSON:',
    '{',
    '  "title": "Suggested exam title",',
    '  "subtitle": "Short exam scope summary",',
    '  "chunks": [',
    '    {',
    '      "heading": "Cohesive block topic name",',
    '      "badge": "BLOCK 1",',
    '      "badgeKind": "exam | src | prj",',
    '      "docIndices": [0, 1],',
    '      "count": 4,',
    '      "focusNote": "Key concepts to emphasize in this block"',
    '    }',
    '  ]',
    '}',
    '',
    'SOURCE CATALOG:',
    catalogText,
  ].filter(Boolean).join('\n');
}

export function cleanExamPlan(raw, docs = [], { countMode = 'auto', count = 12 } = {}) {
  const maxIdx = Math.max(0, (docs?.length || 1) - 1);
  const rawChunks = Array.isArray(raw?.chunks) ? raw.chunks : [];
  const valid = rawChunks
    .map((c, i) => ({
      heading: String(c?.heading || `Block ${i + 1}`).trim(),
      badge: String(c?.badge || `BLOCK ${i + 1}`).trim().slice(0, 16),
      badgeKind: ['exam', 'src', 'prj'].includes(c?.badgeKind) ? c.badgeKind : 'exam',
      docIndices: [...new Set((Array.isArray(c?.docIndices) ? c.docIndices : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIdx))],
      count: Math.max(0, Math.min(30, Number(c?.count) || 0)),
      focusNote: String(c?.focusNote || '').trim(),
    }))
    .filter((c) => c.docIndices.length > 0)
    .slice(0, 6);

  if (!valid.length) return { title: '', subtitle: '', chunks: buildFallbackExamPlan(docs, { countMode, count }) };

  // Ensure every document was assigned somewhere.
  const covered = new Set(valid.flatMap((c) => c.docIndices));
  for (let i = 0; i < (docs?.length || 0); i++) {
    if (!covered.has(i)) valid[i % valid.length].docIndices.push(i);
  }
  if (countMode === 'exact') {
    const want = Math.max(1, Math.min(60, Number(count) || 12));
    let sum = valid.reduce((a, c) => a + c.count, 0);
    if (sum <= 0) {
      valid.forEach((c, i) => { c.count = Math.max(1, Math.floor(want / valid.length) + (i < want % valid.length ? 1 : 0)); });
    } else if (sum !== want) {
      valid[valid.length - 1].count = Math.max(1, valid[valid.length - 1].count + (want - sum));
    }
  }
  return {
    title: String(raw?.title || '').trim(),
    subtitle: String(raw?.subtitle || '').trim(),
    chunks: valid,
  };
}

// Deterministic Stage-3 Composer: stitches ordered parallel worker JSON results without extra LLM calls.
export function mergeExamSections(chunkExams = [], { title = '', subtitle = '' } = {}) {
  const sections = [];
  const seenPrompts = new Set();
  for (let ci = 0; ci < (chunkExams || []).length; ci++) {
    const ex = chunkExams[ci];
    if (!ex?.sections?.length) continue;
    for (const sec of ex.sections) {
      const secIndex = sections.length + 1;
      const problems = [];
      for (const p of sec.problems || []) {
        const key = String(p.prompt || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!key || seenPrompts.has(key)) continue;
        seenPrompts.add(key);
        problems.push({ ...p, number: `${secIndex}.${problems.length + 1}` });
      }
      if (problems.length) {
        sections.push({
          ...sec,
          badge: sec.badge || `BLOCK ${secIndex}`,
          problems,
        });
      }
    }
  }
  if (!sections.length) throw Error('Parallel workers produced no valid exam problems.');
  return {
    title: String(title || chunkExams[0]?.title || 'Practice Examination').trim(),
    subtitle: String(subtitle || chunkExams[0]?.subtitle || '').trim(),
    sections,
  };
}

// ---- Solve Fed Exam: Stage 1 Splitter -> Stage 2 Parallel Solvers -> Stage 3 Alternating Composer ----

export function splitExamHeuristically(sourcesText = '', title = 'Solved Exam') {
  const text = String(sourcesText || '').trim();
  if (!text) return [];
  const rawParts = text
    .split(/(?=(?:^|\n)\s*(?:Ejercicio|Exercise|Problema|Problem|Cuesti[oó]n|Pregunta|Question|Parte|Part)\s*\d+[\s.:)-])/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const chunks = rawParts.length ? rawParts : [text];
  return chunks.slice(0, 20).map((statement, i) => ({
    number: String(i + 1),
    title: statement.split('\n')[0].trim().slice(0, 90) || `${title} — ${i + 1}`,
    kind: 'open',
    points: null,
    statement,
    parts: [],
    options: [],
    code: '',
    table: null,
  }));
}

export function solveSplitPrompt({ title = '', sourcesText = '', language = 'auto', instructions = '' } = {}) {
  const langLine = language && language !== 'auto'
    ? `Detected/target language hint: ${language}. Keep the exact problem wording in its original language.`
    : 'Preserve the original language and verbatim wording of every question.';
  return [
    'You are the Exam Splitter agent. Cut the provided exam into clean, ordered, self-contained exercises/questions so separate solver subagents can solve each one independently in parallel.',
    title ? `Exam label: "${title}"` : '',
    langLine,
    instructions?.trim() ? `User notes: ${instructions.trim()}` : '',
    '',
    'Rules:',
    '- Preserve EVERY exercise/problem/question and all sub-parts (a), b), c)...) accurately; keep formulas in $...$ or $$...$$ LaTeX.',
    '- Keep tables, code snippets, numeric values, and MCQ options intact inside their exercise object.',
    '- Do NOT solve the questions yet — ONLY split and transcribe each exercise cleanly.',
    '',
    'Reply with ONLY valid JSON:',
    '{',
    '  "title": "Exam title",',
    '  "language": "Spanish | English | French | German | ...",',
    '  "exercises": [',
    '    {',
    '      "number": "1",',
    '      "title": "Short descriptive topic",',
    '      "kind": "mcq | fill | calculation | open | table | code",',
    '      "points": 2.5,',
    '      "statement": "Complete problem statement (preserve formulas in $...$ and sub-parts)",',
    '      "parts": ["a) First sub-question...", "b) Second sub-question..."],',
    '      "options": [],',
    '      "code": "",',
    '      "table": null',
    '    }',
    '  ]',
    '}',
    '',
    'EXAM CONTENT TO SPLIT:',
    sourcesText,
  ].filter(Boolean).join('\n');
}

export function cleanSplitExercises(raw, fallbackText = '', title = 'Solved Exam') {
  const rawList = Array.isArray(raw?.exercises) ? raw.exercises : [];
  const exercises = rawList
    .filter((ex) => ex && String(ex.statement || ex.prompt || '').trim())
    .map((ex, i) => ({
      number: String(ex.number || i + 1).trim(),
      title: String(ex.title || `Exercise ${i + 1}`).trim(),
      kind: VALID_KINDS.has(String(ex.kind || '').toLowerCase()) ? String(ex.kind).toLowerCase() : 'open',
      points: Number.isFinite(Number(ex.points)) && Number(ex.points) > 0 ? Number(ex.points) : null,
      statement: String(ex.statement || ex.prompt || '').trim(),
      parts: Array.isArray(ex.parts) ? ex.parts.map((p) => String(p || '').trim()).filter(Boolean) : [],
      options: Array.isArray(ex.options) ? ex.options.map((o) => String(o || '').trim()).filter(Boolean) : [],
      code: typeof ex.code === 'string' ? ex.code.trim() : '',
      table: ex.table && Array.isArray(ex.table.headers) && Array.isArray(ex.table.rows) ? ex.table : null,
    }));
  if (!exercises.length) {
    return {
      title,
      language: '',
      exercises: splitExamHeuristically(fallbackText, title),
    };
  }
  return {
    title: String(raw?.title || title).trim(),
    language: String(raw?.language || '').trim(),
    exercises,
  };
}

export function solveChunkPrompt({
  exercise,
  examTitle = '',
  referenceText = '',
  language = 'auto',
  instructions = '',
} = {}) {
  const langTarget = language && language !== 'auto'
    ? language
    : '';
  const langRule = langTarget
    ? `Write ALL headings ("Pasos" / "Steps", "Solución (Ejercicio N)" / "Solution (Exercise N)"), hints, and worked explanations strictly in ${langTarget}.`
    : 'Write ALL headings ("Steps"/"Pasos", "Solution (Exercise N)"/"Solución (Ejercicio N)"), hints, and worked explanations in the SAME language as the exercise.';
  return [
    `You are an expert Solver subagent solving ONE exercise from "${examTitle || 'Exam'}".`,
    langRule,
    'Use clear mathematical LaTeX (`$...$` inline, `$$...$$` display) for every formula, equation, vector, matrix, or derivation.',
    instructions?.trim() ? `Extra instructions: ${instructions.trim()}` : '',
    '',
    'Produce TWO clearly separated pieces for an alternating Study-then-Solution layout:',
    '1) `partSteps`: For the QUESTION page, break each sub-part a), b), c)... down into a short guiding step / approach hint (NO final answers revealed — leave room for the student to solve it).',
    '2) `partSolutions`: For the NEW PAGE right after it, provide the complete, rigorous worked solution for each sub-part a), b), c)... showing every intermediate formula, substitution, unit, completed table row, or code trace.',
    '',
    'Reply with ONLY valid JSON matching this schema:',
    '{',
    `  "number": ${JSON.stringify(String(exercise?.number || '1'))},`,
    `  "title": ${JSON.stringify(String(exercise?.title || ''))},`,
    '  "exerciseHeading": "Exercise 1: Title (or localized: Ejercicio 1: Título)",',
    '  "stepsHeading": "Steps (or localized: Pasos / Étapes / Schritte)",',
    '  "solutionHeading": "Solution (Exercise 1) (or localized: Solución (Ejercicio 1))",',
    '  "statement": "Clean problem statement with $LaTeX$ formulas",',
    '  "theory": "Concise key formula / theorem used (1-3 sentences)",',
    '  "partSteps": [',
    '    { "label": "a)", "hint": "Sub-part statement + brief method step hint (without giving away the final answer)" }',
    '  ],',
    '  "partSolutions": [',
    '    { "label": "a)", "answer": "Direct final answer / chosen option", "work": "Full step-by-step derivation with $...$ / $$...$$ math" }',
    '  ],',
    '  "solvedTable": null,',
    '  "trap": "Common mistake or exam trap to double-check"',
    '}',
    '',
    'EXERCISE TO SOLVE:',
    JSON.stringify(exercise, null, 2),
    referenceText ? `\nREFERENCE NOTES:\n${referenceText}` : '',
  ].filter(Boolean).join('\n');
}

export function cleanSolvedExercise(raw, fallbackEx = {}, index = 0) {
  const num = String(raw?.number || fallbackEx.number || index + 1).trim();
  const title = String(raw?.title || fallbackEx.title || '').trim();
  const partSteps = Array.isArray(raw?.partSteps) && raw.partSteps.length
    ? raw.partSteps.map((s, idx) => ({
        label: String(s?.label || `${String.fromCharCode(97 + idx)})`).trim(),
        hint: String(s?.hint || s?.step || s || '').trim(),
      })).filter((s) => s.hint)
    : (fallbackEx.parts || []).map((p, idx) => ({
        label: `${String.fromCharCode(97 + idx)})`,
        hint: String(p).trim(),
      }));
  const partSolutions = Array.isArray(raw?.partSolutions) && raw.partSolutions.length
    ? raw.partSolutions.map((s, idx) => ({
        label: String(s?.label || partSteps[idx]?.label || `${String.fromCharCode(97 + idx)})`).trim(),
        answer: String(s?.answer || s?.final || '').trim(),
        work: String(s?.work || s?.steps || s?.explanation || '').trim(),
      })).filter((s) => s.answer || s.work)
    : [{
        label: 'a)',
        answer: String(raw?.answer || raw?.summary || 'See solution below.').trim(),
        work: String(raw?.work || raw?.solution || raw?.steps || '').trim(),
      }];

  return {
    number: num,
    title,
    kind: fallbackEx.kind || 'open',
    points: fallbackEx.points ?? null,
    exerciseHeading: String(raw?.exerciseHeading || `Exercise ${num}${title ? `: ${title}` : ''}`).trim(),
    stepsHeading: String(raw?.stepsHeading || 'Steps').trim(),
    solutionHeading: String(raw?.solutionHeading || `Solution (Exercise ${num})`).trim(),
    statement: String(raw?.statement || fallbackEx.statement || '').trim(),
    options: Array.isArray(fallbackEx.options) ? fallbackEx.options : [],
    code: fallbackEx.code || '',
    table: fallbackEx.table || null,
    solvedTable: raw?.solvedTable && Array.isArray(raw.solvedTable.headers) ? raw.solvedTable : null,
    theory: String(raw?.theory || '').trim(),
    partSteps,
    partSolutions,
    trap: String(raw?.trap || '').trim(),
  };
}

// Deterministic Stage-3 Composer (A4 PDF): Exercise N (Steps a, b, c) -> NEW PAGE -> Solution (Exercise N) (a, b, c) -> NEW PAGE ...
export function buildSolvedExamHtml(solvedExam, { showTheory = true, tapeSolutions = false, interactiveFallback = false } = {}) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const exercises = Array.isArray(solvedExam?.exercises) ? solvedExam.exercises : [];
  if (!exercises.length) throw Error('No solved exercises to compose.');
  const blocks = [];

  blocks.push(
    `<header class="exam-hdr">`
      + `<h1>${escapeHtml(solvedExam.title || 'Solved Examination')}</h1>`
      + `<div class="exam-meta">`
      + `<span>Exercise-by-exercise workspace followed by worked step-by-step solutions</span>`
      + `<span>${exercises.length} exercise${exercises.length === 1 ? '' : 's'}</span>`
      + `</div>`
      + `</header>`,
  );

  exercises.forEach((ex, idx) => {
    // 1. Exercise Question + Steps page
    const qParts = [];
    qParts.push(`<article class="prob-card solve-card-free">`);
    qParts.push(
      `<div class="sec-hdr" style="margin-top:0"><h2>`
        + `<span class="badge exam">EXERCISE ${escapeHtml(ex.number)}</span> `
        + `${renderRichExamHtml(ex.exerciseHeading)}`
        + (ex.points != null ? `<span class="prob-pts" style="color:#e2e8f0;margin-left:auto">${escapeHtml(ex.points)} pts</span>` : '')
        + `</h2></div>`,
    );
    qParts.push(`<p class="prob-prompt">${renderRichExamHtml(ex.statement)}</p>`);
    if (ex.code) qParts.push(`<pre class="exam-code"><code>${escapeHtml(ex.code)}</code></pre>`);
    if (ex.options?.length) {
      qParts.push(
        `<div class="mc-grid">`
          + ex.options.map((opt, oi) => `<div class="mc-opt"><strong>${letters[oi] || oi + 1})</strong> ${renderRichExamHtml(opt)}</div>`).join('')
          + `</div>`,
      );
    }
    if (ex.table?.headers?.length) {
      const ths = ex.table.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
      const rows = (ex.table.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
      qParts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (ex.partSteps?.length) {
      qParts.push(`<div class="solve-steps-box"><strong class="lbl">${escapeHtml(ex.stepsHeading)}:</strong>`);
      for (const st of ex.partSteps) {
        qParts.push(
          `<div class="solve-step-item">`
            + `<div><strong>${escapeHtml(st.label)}</strong> ${renderRichExamHtml(st.hint)}</div>`
            + `<div class="solve-step-work"></div><div class="solve-step-work"></div>`
            + `</div>`,
        );
      }
      qParts.push(`</div>`);
    } else {
      qParts.push(`<div class="writing-lines">${'<div class="wline"></div>'.repeat(8)}</div>`);
    }
    qParts.push(`</article>`);
    blocks.push(qParts.join('\n'));

    // 2. NEW PAGE -> Worked Solution (Exercise N)
    blocks.push(`<div class="page-break"></div>`);

    const sParts = [];
    sParts.push(`<article class="prob-card solve-card-free">`);
    sParts.push(
      `<div class="solve-sol-banner">`
        + `<span class="badge prj">SOLUTION</span> `
        + `<span>${renderRichExamHtml(ex.solutionHeading)}:</span>`
        + `</div>`,
    );
    if (showTheory && ex.theory) {
      const tapeAttr = tapeSolutions ? ' data-tape-answer="theory"' : '';
      sParts.push(`<div class="theory-box"${tapeAttr}><strong class="lbl">Formula / Key Concept</strong>${renderRichExamHtml(ex.theory)}</div>`);
    }
    const solTapeAttr = tapeSolutions ? ' data-tape-answer="solution"' : '';
    sParts.push(`<div class="key"${solTapeAttr}>`);
    for (const sol of ex.partSolutions || []) {
      sParts.push(
        `<div class="solve-part-ans">`
          + `<div><strong>${escapeHtml(sol.label)}</strong> `
          + (sol.answer ? `<span class="ans-final">${renderRichExamHtml(sol.answer)}</span>` : '')
          + `</div>`
          + (sol.work ? `<div class="ans-work">${renderRichExamHtml(sol.work)}</div>` : '')
          + `</div>`,
      );
    }
    if (ex.solvedTable?.headers?.length) {
      const ths = ex.solvedTable.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
      const rows = (ex.solvedTable.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
      sParts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (ex.trap) {
      sParts.push(`<div class="bad"><strong>Watch out:</strong> ${renderRichExamHtml(ex.trap)}</div>`);
    }
    sParts.push(`</div></article>`);
    blocks.push(sParts.join('\n'));

    if (idx < exercises.length - 1) {
      blocks.push(`<div class="page-break"></div>`);
    }
  });

  return wrapExamHtmlDocument(solvedExam.title || 'Solved Exam', blocks, { interactiveFallback: interactiveFallback && tapeSolutions });
}

// Deterministic Stage-3 Composer (MCP Ink Engine): emits NoteComplete dialect Markdown with \pagebreak, !tape, and $...$/$$...$$ native math boxes.
export function buildSolvedExamMcpMarkdown(solvedExam, { tapeSolutions = false, showTheory = true } = {}) {
  const exercises = Array.isArray(solvedExam?.exercises) ? solvedExam.exercises : [];
  if (!exercises.length) throw Error('No solved exercises to compose.');
  const out = [`# ${solvedExam.title || 'Solved Exam'}`, ''];

  exercises.forEach((ex, idx) => {
    if (idx > 0) out.push('\\pagebreak', '');
    out.push(`## ${ex.exerciseHeading}`, '');
    out.push(ex.statement, '');
    if (ex.code) {
      out.push('```', ex.code, '```', '');
    }
    if (ex.options?.length) {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      ex.options.forEach((opt, oi) => out.push(`- **${letters[oi] || oi + 1})** ${opt}`));
      out.push('');
    }
    if (ex.partSteps?.length) {
      out.push(`### ${ex.stepsHeading}:`, '');
      for (const st of ex.partSteps) {
        out.push(`- **${st.label}** ${st.hint}`, '', '');
      }
    }
    out.push('\\pagebreak', '');
    out.push(`## ${ex.solutionHeading}:`, '');
    if (showTheory && ex.theory) {
      if (tapeSolutions) out.push('!tape sky');
      out.push(`=={sky}${ex.theory}==`, '');
    }
    for (const sol of ex.partSolutions || []) {
      if (tapeSolutions) out.push('!tape yellow');
      const line = sol.answer ? `**${sol.label}** ${sol.answer}` : `**${sol.label}**`;
      out.push(line);
      if (sol.work) {
        if (tapeSolutions) out.push('!tape yellow');
        out.push(sol.work);
      }
      out.push('');
    }
    if (ex.trap) {
      out.push(`> **Watch out:** ${ex.trap}`, '');
    }
  });

  return out.join('\n').trim();
}
