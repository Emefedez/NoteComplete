import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evalMathExpr,
  sanitizeSvg,
  normalizeVisualSpec,
  renderVisualSvg,
  renderVisualHtml,
  renderVisualMcpMarkdown,
  examPrompt,
  cleanExamData,
  buildPaginatedExamHtml,
  solveSplitPrompt,
  cleanSplitExercises,
  solveChunkPrompt,
  cleanSolvedExercise,
  buildSolvedExamHtml,
  buildSolvedExamMcpMarkdown,
} from './exam-html.js';
import {
  clampNormalizedBbox,
  bytesToDataUrl,
  dataUrlToBytes,
  cropCanvasRegion,
  cropImageBytes,
  extractPdfText,
  collectVisualCandidates,
  resolveVisualCutout,
  resolveExamVisualCutouts,
} from './source-extract.js';

test('evalMathExpr evaluates arithmetic, trig, implicit multiplication, and rejects code injection', () => {
  assert.equal(evalMathExpr('2x + 3', { x: 4 }), 11);
  assert.equal(evalMathExpr('-x^2 + 1', { x: 3 }), -8);
  assert.equal(evalMathExpr('(-x)^2', { x: 3 }), 9);
  assert.ok(Math.abs(evalMathExpr('2sin(pi/2) + cos(0)') - 3) < 1e-9);
  assert.ok(Math.abs(evalMathExpr('3(x+1)(x-1)', { x: 2 }) - 9) < 1e-9);
  assert.ok(Math.abs(evalMathExpr('ln(e^2)') - 2) < 1e-9);
  assert.ok(Number.isNaN(evalMathExpr('process.exit(1)')));
  assert.ok(Number.isNaN(evalMathExpr('constructor.constructor("return 1")()')));
  assert.ok(Number.isNaN(evalMathExpr('1 / 0')));
});

test('renderVisualSvg & renderVisualHtml generate filled plots and blank graphs-to-fill', () => {
  const filled = renderVisualSvg({
    type: 'plot',
    title: 'Quadratic & Integral',
    xMin: -3,
    xMax: 3,
    yMin: -2,
    yMax: 5,
    functions: [{ expr: 'x^2 - 1', label: 'f(x)=x^2-1', color: '#2563eb' }],
    areas: [{ expr: 'x^2 - 1', from: 1, to: 2 }],
    points: [{ x: 0, y: -1, label: '(0,-1)' }, { x: 2, y: 3, open: true }],
  });
  assert.ok(filled);
  assert.match(filled.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(filled.svg, /<path d="M/);
  assert.match(filled.svg, /<polygon points="/); // shaded area + axis arrowheads
  assert.match(filled.svg, /<circle /);
  assert.match(filled.svg, /Quadratic &amp; Integral/);

  const blank = renderVisualSvg({
    type: 'graph',
    xMin: -4,
    xMax: 4,
    yMin: -4,
    yMax: 4,
    blank: true,
    functions: [{ expr: '2*x + 1', label: 'hidden answer curve' }],
    points: [{ x: 0, y: 1, label: 'P0' }],
  });
  assert.ok(blank);
  assert.doesNotMatch(blank.svg, /<path d="M/); // curves omitted on blank graph-to-fill
  assert.doesNotMatch(blank.svg, /hidden answer curve/);
  assert.match(blank.svg, /P0/); // given anchor point preserved
  assert.match(blank.svg, /<line /); // axes & gridlines present
});

test('renderVisualSvg renders filled histograms and empty histograms-to-fill', () => {
  const filled = renderVisualSvg({
    type: 'histogram',
    title: 'Cache Miss Latency',
    xLabel: 'Cycles',
    yLabel: 'Count',
    bins: [
      { label: '0-10', value: 5 },
      { label: '10-20', value: 14 },
      { label: '20-30', value: 6 },
    ],
  });
  assert.ok(filled);
  assert.match(filled.svg, /Cache Miss Latency/);
  assert.match(filled.svg, /0-10/);
  assert.match(filled.svg, />14</);

  const blank = renderVisualSvg({
    type: 'histogram',
    yMax: 20,
    blank: true,
    bins: ['0-10', '10-20', '20-30'],
  });
  assert.ok(blank);
  assert.match(blank.svg, /0-10/);
  assert.match(blank.svg, /20-30/);
  assert.match(blank.svg, /fill-opacity="0.45"/); // empty slot guides
});

test('renderVisualSvg renders CPU scheduling Gantt timelines and blank scheduling grids', () => {
  const cpuFilled = renderVisualSvg({
    type: 'cpu',
    title: 'Round-Robin (q=2)',
    tStart: 0,
    tEnd: 10,
    tStep: 2,
    unit: 'ms',
    markers: [{ t: 3, label: 'P3 arrives' }],
    rows: [
      {
        label: 'CPU 0',
        intervals: [
          ['P1', 0, 2],
          ['P2', 2, 4],
          ['IDLE', 4, 5],
          ['P3', 5, 9],
        ],
      },
    ],
  });
  assert.ok(cpuFilled);
  assert.match(cpuFilled.svg, /Round-Robin \(q=2\)/);
  assert.match(cpuFilled.svg, /CPU 0/);
  assert.match(cpuFilled.svg, />P1</);
  assert.match(cpuFilled.svg, />IDLE</);
  assert.match(cpuFilled.svg, /P3 arrives/);
  assert.match(cpuFilled.svg, /Time \(ms\)/);

  const cpuBlank = renderVisualSvg({
    type: 'timeline',
    tStart: 0,
    tEnd: 8,
    tStep: 1,
    blank: true,
    rows: ['P1', 'P2', 'P3'],
  });
  assert.ok(cpuBlank);
  assert.match(cpuBlank.svg, />P1</);
  assert.match(cpuBlank.svg, />P2</);
  assert.match(cpuBlank.svg, />P3</);
  assert.match(cpuBlank.svg, />8</);
});

test('renderVisualSvg auto-layouts trees & FSM graphs and sanitizeSvg strips XSS payloads', () => {
  const tree = renderVisualSvg({
    type: 'tree',
    nodes: [{ id: 'R', label: '10' }, { id: 'L', label: '5' }, { id: 'Ri', label: '15' }],
    edges: [{ from: 'R', to: 'L', label: '<' }, { from: 'R', to: 'Ri', label: '>' }],
  });
  assert.ok(tree);
  assert.match(tree.svg, />10</);
  assert.match(tree.svg, /&lt;/);
  assert.match(tree.svg, /<polygon points="/); // directed arrowheads

  const fsm = renderVisualSvg({
    type: 'fsm',
    nodes: [
      { id: 'q0', label: 'q0', shape: 'circle' },
      { id: 'q1', label: 'q1', shape: 'doublecircle' },
    ],
    edges: [
      { from: 'q0', to: 'q1', label: 'a' },
      { from: 'q1', to: 'q0', label: 'b' },
      { from: 'q1', to: 'q1', label: '1' },
    ],
  });
  assert.ok(fsm);
  assert.match(fsm.svg, /<path d="/); // curved reverse edge + self loop

  const dirty = `<svg viewBox="0 0 200 100" onload="alert(1)"><script>evil()</script><foreignObject><div>bad</div></foreignObject><image href="https://evil.test/x.png"/><rect x="10" y="10" width="50" height="30" fill="#bae6fd" onclick="hack()" style="fill:red;background:url(javascript:alert(1))"/><text x="35" y="28">OK</text></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /script|foreignObject|image|onload|onclick|javascript:|evil/i);
  assert.match(clean, /<rect /);
  assert.match(clean, /<text /);
  assert.match(clean, />OK</);
});

test('cutout sanitizer rejects remote URLs, accepts data:image base64, and embeds in problem + solution HTML & MCP markdown', () => {
  assert.equal(normalizeVisualSpec({ type: 'cutout', dataUrl: 'https://evil.com/x.png' }), null);
  assert.equal(normalizeVisualSpec({ type: 'cutout', dataUrl: 'javascript:alert(1)' }), null);

  const sampleB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const cleaned = cleanExamData({
    title: 'OS & Calculus Exam',
    sections: [{
      heading: 'Scheduling & Plots',
      problems: [
        {
          number: '1.1',
          kind: 'open',
          prompt: 'Fill in the Round-Robin CPU Gantt chart (q=2).',
          visual: { type: 'timeline', tStart: 0, tEnd: 6, blank: true, rows: [{ label: 'CPU' }] },
          answerBox: {
            summary: 'P1(0-2), P2(2-4), P1(4-6)',
            visual: { type: 'timeline', tStart: 0, tEnd: 6, rows: [{ label: 'CPU', intervals: [['P1', 0, 2], ['P2', 2, 4], ['P1', 4, 6]] }] },
          },
        },
        {
          number: '1.2',
          kind: 'calculation',
          prompt: 'Analyze the cropped circuit diagram.',
          figure: { type: 'cutout', dataUrl: sampleB64, caption: 'Source Figure 1' },
          answerBox: { summary: 'R_eq = 4 ohm' },
        },
      ],
    }],
  });

  const html = buildPaginatedExamHtml(cleaned, { showTheory: false });
  assert.match(html, /class="prob-visual"/);
  assert.match(html, /class="prob-visual prob-visual-cutout"/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Source Figure 1/);
  // Solution visual sits inside [data-tape-answer="solution"]
  const solIdx = html.indexOf('data-tape-answer="solution"');
  assert.ok(solIdx > 0);
  assert.ok(html.indexOf('P1(0-2)') > solIdx);

  const split = cleanSplitExercises({
    title: 'Fed Exam',
    exercises: [{
      number: '1',
      title: 'CPU Schedule',
      statement: 'Draw the Gantt chart.',
      visual: { type: 'timeline', tStart: 0, tEnd: 4, blank: true, rows: ['CPU'] },
    }],
  });
  const solved = cleanSolvedExercise({
    number: '1',
    partSteps: [{ label: 'a)', hint: 'Track ready queue.' }],
    partSolutions: [{ label: 'a)', answer: 'P1 then P2', work: 'FIFO order.' }],
    solutionVisual: { type: 'timeline', tStart: 0, tEnd: 4, rows: [{ label: 'CPU', intervals: [['P1', 0, 2], ['P2', 2, 4]] }] },
  }, split.exercises[0], 0);

  const solvedHtml = buildSolvedExamHtml({ title: 'Solved', exercises: [solved] }, { tapeSolutions: true });
  assert.match(solvedHtml, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  const mcpMd = buildSolvedExamMcpMarkdown({ title: 'Solved', exercises: [solved] }, { tapeSolutions: true });
  assert.match(mcpMd, /!draw 540\n<svg /);
  assert.match(mcpMd, /!end/);

  const mcpCutout = renderVisualMcpMarkdown({ type: 'cutout', dataUrl: sampleB64, caption: 'Fig 2' });
  assert.match(mcpCutout, /\[Figure: Fig 2\]/);
});

test('prompts advertise visual schemas and visualCatalogText when provided', () => {
  const ep = examPrompt({
    sourcesText: 'CPU scheduling',
    visualCatalogText: '- Source [0] "Exam.pdf" (attached pages: 2)',
  });
  assert.match(ep, /"visual": null/);
  assert.match(ep, /"type":"timeline"/);
  assert.match(ep, /"type":"plot"/);
  assert.match(ep, /AVAILABLE VISUAL SOURCES FOR CUTOUTS/);

  const sp = solveSplitPrompt({ sourcesText: 'Ex 1', visualCatalogText: '- Source [0]' });
  assert.match(sp, /"type":"cutout"/);

  const cp = solveChunkPrompt({
    exercise: { number: '1', statement: 'Solve', visual: { type: 'cutout', dataUrl: 'data:image/png;base64,AAAA', page: 1 } },
  });
  assert.match(cp, /"solutionVisual": null/);
  assert.match(cp, /\[attached image\]/);
  assert.doesNotMatch(cp, /AAAA/);
});

test('source-extract bbox clamping, headless crop fallbacks, PDF figure page detection, and cutout resolution work cleanly', async () => {
  assert.deepEqual(clampNormalizedBbox([-0.2, 0.5, 1.5, 0.8]), [0, 0.5, 1, 0.5]);
  assert.equal(clampNormalizedBbox([0.5, 0.5, 0.001, 0.5]), null);
  assert.equal(clampNormalizedBbox('bad'), null);

  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const url = bytesToDataUrl(bytes, 'image/png');
  assert.match(url, /^data:image\/png;base64,/);
  const decoded = dataUrlToBytes(url);
  assert.deepEqual(decoded.bytes, bytes);
  assert.equal(decoded.type, 'image/png');

  // Headless cropCanvasRegion returns null gracefully when document is unavailable
  assert.equal(await cropCanvasRegion({ width: 100, height: 100 }, [0.1, 0.1, 0.5, 0.5]), null);

  // Full-image cropImageBytes succeeds even in headless Node
  const fullImg = await cropImageBytes(bytes, 'image/png', [0, 0, 1, 1]);
  assert.equal(fullImg.dataUrl, url);

  // Sub-bbox cropCanvasRegion with a mocked canvas & ownerDocument succeeds and clamps pixel bounds
  const drawCalls = [];
  const fakeOutCanvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect: () => {},
      drawImage: (...args) => drawCalls.push(args),
    }),
    toDataURL: () => url,
  };
  const fakeSrcCanvas = {
    width: 1000,
    height: 500,
    ownerDocument: { createElement: () => fakeOutCanvas },
  };
  const cropped = await cropCanvasRegion(fakeSrcCanvas, [0.2, 0.1, 0.5, 0.4], { maxWidth: 400, padding: 0 });
  assert.ok(cropped);
  assert.equal(cropped.width, 400);
  assert.equal(cropped.height, 160);
  assert.equal(drawCalls[0][1], 200); // sx
  assert.equal(drawCalls[0][2], 50);  // sy
  assert.equal(drawCalls[0][3], 500); // sw
  assert.equal(drawCalls[0][4], 200); // sh

  // extractPdfText flags figurePages via operator list + low-text pages
  const fakePdf = {
    numPages: 2,
    getPage: async (p) => ({
      getTextContent: async () => ({ items: p === 1 ? [{ str: 'Long lecture paragraph '.repeat(5) }] : [{ str: 'Fig 1' }] }),
      getOperatorList: async () => ({ fnArray: p === 1 ? [85] : [] }),
    }),
  };
  const pdfRes = await extractPdfText(new Uint8Array([1, 2, 3]), async () => fakePdf);
  assert.deepEqual(pdfRes.figurePages, [1, 2]);

  // collectVisualCandidates & resolveExamVisualCutouts work with preloaded images and renderPage mocks
  const docs = [
    {
      title: 'Slides',
      pageCount: 2,
      figurePages: [2],
      images: [],
      renderPage: async (pageNum) => (pageNum === 2 ? fakeSrcCanvas : null),
    },
    {
      title: 'Diagram',
      images: [{ bytes, type: 'image/png', label: 'diag.png' }],
    },
  ];
  const cands = await collectVisualCandidates(docs, { maxImages: 4, renderMissing: false });
  assert.equal(cands.images.length, 1);
  assert.match(cands.manifest, /Image #0/);
  assert.match(cands.manifest, /Source \[0\]/);

  const resolvedCutout = await resolveVisualCutout(
    { type: 'cutout', sourceIndex: 0, page: 2, bbox: [0.1, 0.2, 0.5, 0.5], caption: 'Cropped Fig' },
    docs,
  );
  assert.ok(resolvedCutout);
  assert.equal(resolvedCutout.dataUrl, url);

  const resolvedExam = await resolveExamVisualCutouts({
    title: 'Test',
    sections: [{
      heading: 'S1',
      problems: [{
        number: '1.1',
        kind: 'open',
        prompt: 'See figure.',
        visual: { type: 'cutout', imageIndex: 0, caption: 'Attached diag' },
        answerBox: { summary: 'Done', visual: null },
      }],
    }],
  }, docs);
  assert.equal(resolvedExam.sections[0].problems[0].visual.dataUrl, url);
});

test('process-state diagrams: states type, and timelines of states drawn that way', async () => {
  const { renderExamParagraphs } = await import('./exam-html.js');
  const spec = normalizeVisualSpec({ type: 'states', title: 'FIFO', tStart: 0, tEnd: 20, processes: [
    { label: 'A', arrival: 0, segments: [{ state: 'cpu', start: 0, end: 5 }, { state: 'E/S', start: 5, end: 10 }] },
    { label: 'B', segments: [{ state: 'listo', start: 2, end: 5 }, { state: 'activo', start: 5, end: 9 }] } ] });
  assert.equal(spec.type, 'states');
  assert.deepEqual(spec.processes[0].segments.map((s) => s.state), ['run', 'blocked']);
  assert.equal(spec.processes[1].arrival, 2);
  const svg = renderVisualSvg(spec).svg;
  assert.match(svg, /stroke-dasharray="6 4"/, 'ready is dashed');
  assert.ok(svg.indexOf('>B<') < svg.indexOf('>A<'), 'the last process is drawn on top');
  // A timeline with one row per process and state-named intervals becomes a state diagram.
  const tl = normalizeVisualSpec({ type: 'timeline', rows: [{ label: 'A', intervals: [{ label: 'CPU', start: 0, end: 4 }, { label: 'Espera', start: 4, end: 6 }] }] });
  assert.equal(tl.type, 'states');
  // Resource rows (CPU, E/S) stay a bar timeline, overlapping bars on separate sub-lanes.
  const res = renderVisualSvg({ type: 'timeline', tEnd: 12, rows: [{ label: 'CPU', intervals: [{ label: 'A', start: 0, end: 4 }] }, { label: 'E/S', intervals: [{ label: 'A', start: 4, end: 10 }, { label: 'B', start: 7, end: 11 }] }] });
  const ys = [...res.svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+" rx="3"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ys).size, 3, 'two sub-lanes in the E/S row plus the CPU row');
  // Steps bold, their parts indented, headings bold.
  const html = renderExamParagraphs('1. Ejecución secuencial:\n  A ocupa 12\nMonolítico — ventaja');
  assert.match(html, /<strong class="step-n">1\.<\/strong> <strong class="sp-head">Ejecución secuencial:<\/strong>/);
  assert.match(html, /class="ln in1">A ocupa 12/);
  assert.doesNotMatch(renderExamParagraphs('t = 0–4: CPU'), /sp-head/);
});
