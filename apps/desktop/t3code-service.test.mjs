import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { T3CodeService } from './t3code-service.js';
import { aiRunner, DOC_GEN_TAGS } from './ai-runner.js';

test('T3CodeService acquires, serves chat completion, and stops owned backend when idle', async () => {
  let chatCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/.well-known/t3/environment') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: 'test' }));
      return;
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 't3-default' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      chatCalls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Hello from T3 Code' } }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const t3 = new T3CodeService({ host: '127.0.0.1', port, idleCloseMs: 0 });
    const runner = aiRunner({
      tools: async () => ({ claude: null, antigravity: null, codex: null, opencode: null, t3code: null }),
      t3,
    });

    const providers = await runner.providers();
    const t3Prov = providers.find((p) => p.id === 't3code');
    assert.equal(t3Prov?.available, true);

    const models = await runner.models('t3code');
    assert.ok(models.some((m) => m.id === 't3-default'));

    const deltas = [];
    const out = await runner.run(1, { provider: 't3code', prompt: 'Summarize chapter 1', tag: 'exam' }, (d) => deltas.push(d));
    assert.equal(out.text, 'Hello from T3 Code');
    assert.equal(chatCalls, 1);
    assert.equal(t3.activeUsers, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('T3CodeService only stops backend when NoteComplete owns it and releases after docGen', async () => {
  const t3 = new T3CodeService({ idleCloseMs: 0 });
  let stopCount = 0;
  t3.startBackend = async () => {
    t3._startedBy = 'spawn';
    return { ok: true, startedVia: 'managed' };
  };
  const origStop = t3.stopBackendIfOwned.bind(t3);
  t3.stopBackendIfOwned = async () => {
    if (t3._startedBy) stopCount += 1;
    t3._daemonProc = null;
    return origStop();
  };

  assert.equal(DOC_GEN_TAGS.has('exam'), true);
  assert.equal(DOC_GEN_TAGS.has('solve-chunk'), true);
  assert.equal(DOC_GEN_TAGS.has('handwriting'), true);

  await t3.acquire();
  assert.equal(t3.activeUsers, 1);
  assert.equal(t3.owned, true);
  assert.equal(stopCount, 0);

  t3.release({ immediate: true });
  assert.equal(t3.activeUsers, 0);
  assert.equal(stopCount, 1);
  assert.equal(t3.owned, false);
});
