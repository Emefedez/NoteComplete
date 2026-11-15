// AI Exam prompt, sanitizer, and A4 HTML builder styled after Examen_Extenso_Temario_1_ACII.html,
// using visible answer/theory blocks tagged with [data-tape-answer] instead of <details> dropdowns
// so generated PDF pages receive exact-fit Noteful Tape overlays.

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

  return [
    'You are an expert professor designing a rich, printable A4 written examination from the student’s study sources.',
    title.trim() ? `Requested exam title: ${title.trim()}` : '',
    langLine,
    `Difficulty: ${diffMap[difficulty] || diffMap.exam}`,
    `Coverage focus: ${focusText}`,
    countLine,
    `Include ONLY these problem kinds (distribute them naturally based on what each topic suits best): ${pickedTypes.join(', ')}.`,
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
  parts.push(`<p class="prob-prompt">${escapeHtml(p.prompt)}</p>`);

  if (p.code) {
    parts.push(`<pre class="exam-code"><code>${escapeHtml(p.code)}</code></pre>`);
  }
  if (p.options?.length) {
    parts.push(
      `<div class="mc-grid">`
        + p.options.map((opt, idx) => `<div class="mc-opt"><strong>${letters[idx] || idx + 1})</strong> ${escapeHtml(opt)}</div>`).join('')
        + `</div>`,
    );
  }
  if (p.expressions?.length) {
    for (const ex of p.expressions) {
      parts.push(`<div class="expr-row"><span>${escapeHtml(ex.label)}</span><span class="fill-line"></span></div>`);
    }
  }
  if (p.table?.headers?.length) {
    const ths = p.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const rows = (p.table.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
    parts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (p.writingLines > 0) {
    parts.push(`<div class="writing-lines">${'<div class="wline"></div>'.repeat(p.writingLines)}</div>`);
  }

  parts.push(
    `<div class="key" data-tape-answer="solution">`
      + `<strong class="lbl">Solution</strong> · ${escapeHtml(p.answerBox.summary)}`
      + (p.answerBox.steps ? `<div class="key-steps">${escapeHtml(p.answerBox.steps)}</div>` : '')
      + (p.answerBox.trap ? `<div class="bad"><strong>Watch out:</strong> ${escapeHtml(p.answerBox.trap)}</div>` : '')
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
        + `<h2><span class="badge ${escapeHtml(sec.badgeKind)}">${escapeHtml(sec.badge)}</span> ${escapeHtml(sec.heading)}</h2>`
        + (sec.intro ? `<p class="sec-intro">${escapeHtml(sec.intro)}</p>` : '')
        + (showTheory && sec.theory
          ? `<div class="theory-box" data-tape-answer="theory"><strong class="lbl">Theory Foundation</strong>${escapeHtml(sec.theory)}</div>`
          : '')
        + `</div>`,
    );
    for (const p of sec.problems) {
      blocks.push(renderProblemHtml(p));
    }
  }

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
  <title>${escapeHtml(exam.title)}</title>
  <style>${EXAM_PRINT_CSS}${interactiveCss}</style>
</head>
<body>
  <div class="exam-flow">${blocks.join('\n')}</div>
  <div class="exam-pages"></div>
  ${interactiveScript}
</body>
</html>`;
}
