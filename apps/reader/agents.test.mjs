import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, shouldAsk, agentConnector } from './agents.js';

test('each tool says what it is now and what the button does', () => {
  assert.deepEqual(describe({ id: 'claude', installed: true, connected: true }), { text: 'Connected', action: 'Reconnect' });
  assert.deepEqual(describe({ id: 'codex', installed: false, connected: false }), { text: 'Not installed', action: null });
  assert.equal(describe({ id: 'opencode', installed: false, connected: false }).action, 'Connect');
  assert.equal(describe({ id: 'claude', installed: true, connected: false, elsewhere: true }).action, 'Update');
});

test('the dialog opens by itself once, only when a tool waits', () => {
  const tools = [{ installed: true, connected: true }, { installed: false, connected: false }];
  assert.equal(shouldAsk(tools, false), false);
  assert.equal(shouldAsk([...tools, { installed: true, connected: false }], false), true);
  assert.equal(shouldAsk([{ installed: true, connected: false }], true), false);
  assert.equal(agentConnector({ api: undefined }), null, 'nothing in the web reader');
});
