import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUCCESSION_KEY,
  readSuccession,
  writeSuccession,
  buildSuccessionQueue,
  isFailoverError,
  buildOrchestratorHandoffPrompt,
  createDocOrchestrator,
} from './ai-failover.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('succession priority list persists order, disabled flags, and resolves available queue', () => {
  const store = memoryStorage();
  writeSuccession({ order: ['codex', 'claude', 't3code', 'antigravity'], disabled: ['opencode'] }, store);
  const saved = readSuccession(store);
  assert.deepEqual(saved.order.slice(0, 4), ['codex', 'claude', 't3code', 'antigravity']);
  assert.deepEqual(saved.disabled, ['opencode']);
  assert.ok(store.getItem(SUCCESSION_KEY));

  const queue = buildSuccessionQueue(
    'claude',
    [
      { id: 'claude', available: true },
      { id: 'codex', available: true },
      { id: 'opencode', available: true },
      { id: 't3code', available: true },
      { id: 'antigravity', available: false },
    ],
    { store },
  );
  // Primary first, then enabled & available in saved priority order (skipping disabled opencode & unavailable antigravity)
  assert.deepEqual(queue, ['claude', 'codex', 't3code']);
});

test('isFailoverError distinguishes harness/usage failures from user cancellation', () => {
  assert.equal(isFailoverError(new Error('Claude Code failed: usage limit reached (429)')), true);
  assert.equal(isFailoverError(new Error('Timed out after 10 minutes')), true);
  assert.equal(isFailoverError(new Error('Cancelled.')), false);
  assert.equal(isFailoverError(new Error('The AI request was stopped.')), false);
  const ac = new AbortController();
  ac.abort();
  assert.equal(isFailoverError(new Error('Rate limit'), ac.signal), false);
});

test('orchestrator stage hands off chat and preserves partial output on harness failure', async () => {
  const store = memoryStorage();
  writeSuccession({ order: ['claude', 'antigravity', 't3code'] }, store);
  const calls = [];
  const switches = [];

  const fakeAI = {
    providers: async () => [
      { id: 'claude', label: 'Claude Code', available: true },
      { id: 'antigravity', label: 'Antigravity', available: true },
      { id: 't3code', label: 'T3 Code', available: true },
    ],
    capabilities: () => ({ vision: true, contextTokens: 0 }),
    run: async (req, onDelta) => {
      calls.push(req);
      if (req.provider === 'claude') {
        onDelta?.('## Section 1\nPartial work already written');
        throw new Error('Claude Code failed: usage limit exceeded');
      }
      onDelta?.('## Section 2\nContinued cleanly');
      return { text: '## Section 2\nContinued cleanly' };
    },
  };

  const orch = await createDocOrchestrator({
    ai: fakeAI,
    primaryProvider: 'claude',
    primaryModel: 'sonnet',
    store,
    onSwitch: (info) => switches.push(info),
  });

  const res = await orch.runStage({
    prompt: 'Write a full study note on Thermodynamics.',
    tag: 'handwriting',
    label: 'New note with AI',
    kind: 'note',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].provider, 'claude');
  assert.equal(calls[0].docGen, true);
  assert.equal(calls[1].provider, 'antigravity');
  assert.equal(calls[1].docGen, true);
  assert.match(calls[1].prompt, /ORCHESTRATOR HANDOFF/);
  assert.match(calls[1].prompt, /Partial work already written/);
  assert.equal(res.handedOff, true);
  assert.equal(res.provider, 'antigravity');
  assert.match(res.partialText, /Partial work already written/);
  assert.equal(res.text, '## Section 2\nContinued cleanly');
  assert.equal(switches.length, 1);
  assert.equal(switches[0].from, 'claude');
  assert.equal(switches[0].to, 'antigravity');
});

test('orchestrator subagents preserve completed work and regenerate remaining subagents on next harness', async () => {
  const store = memoryStorage();
  writeSuccession({ order: ['claude', 'codex', 't3code'] }, store);
  const attempts = [];
  const switches = [];

  const fakeAI = {
    providers: async () => [
      { id: 'claude', label: 'Claude Code', available: true },
      { id: 'codex', label: 'Codex', available: true },
      { id: 't3code', label: 'T3 Code', available: true },
    ],
    capabilities: () => ({ vision: true, contextTokens: 0 }),
    run: async (req) => {
      attempts.push({ provider: req.provider, label: req.label, docGen: req.docGen });
      // Item 1 succeeds on Claude; Item 2 hits Claude usage limit; Codex takes over Items 2 and 3!
      if (req.provider === 'claude' && req.label.includes('Ex 1')) {
        return { text: '{"solved":1}' };
      }
      if (req.provider === 'claude') {
        throw new Error('Claude Code failed: 429 rate limit');
      }
      const m = req.label.match(/Ex (\d+)/);
      return { text: `{"solved":${m ? m[1] : 0},"by":"${req.provider}"}` };
    },
  };

  const orch = await createDocOrchestrator({
    ai: fakeAI,
    primaryProvider: 'claude',
    store,
    onSwitch: (info) => switches.push(info),
  });

  const doneEvents = [];
  const results = await orch.runSubagents({
    items: [{ n: 1 }, { n: 2 }, { n: 3 }],
    concurrency: 1,
    buildRequest: (item) => ({
      prompt: `Solve exercise ${item.n}`,
      tag: 'solve-chunk',
      label: `Solver · Ex ${item.n}`,
    }),
    parseResult: (text) => JSON.parse(text),
    onItemDone: (idx, parsed, meta) => doneEvents.push({ idx, parsed, meta }),
  });

  // Ex 1 was NOT re-run after failover; Ex 2 & Ex 3 were completed by Codex
  assert.deepEqual(results, [
    { solved: 1 },
    { solved: 2, by: 'codex' },
    { solved: 3, by: 'codex' },
  ]);
  assert.equal(switches.length, 1);
  assert.equal(switches[0].preservedCount, 1);
  assert.equal(orch.provider, 'codex');
  assert.ok(attempts.every((a) => a.docGen === true));
  assert.equal(attempts.filter((a) => a.label.includes('Ex 1')).length, 1);
});

test('buildOrchestratorHandoffPrompt includes completed summaries and partial text', () => {
  const prompt = buildOrchestratorHandoffPrompt({
    basePrompt: 'Generate exam JSON',
    partialText: '{"sections":[{"heading":"Part 1"}]}',
    fromProvider: 'Claude Code',
    toProvider: 'Codex',
    reason: 'usage limit',
    completedSummaries: ['Block 1 (via Claude Code)'],
  });
  assert.match(prompt, /ORCHESTRATOR HANDOFF: Claude Code stopped \(usage limit\)/);
  assert.match(prompt, /Block 1 \(via Claude Code\)/);
  assert.match(prompt, /Part 1/);
});
