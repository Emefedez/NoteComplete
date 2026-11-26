// Harness succession priority & orchestrator/subagent failover for AI document generation.
//
// When generating AI documents (exams, solved exams, handwritten notes, expansions,
// batch notes), if the active AI harness errors out, hits a usage/rate limit, or times out:
//  1. The current orchestrator chat + completed work is preserved in full.
//  2. Control hands off automatically to the next harness in the user's succession
//     priority list (configured in the Setup Wizard or Connect AI tools).
//  3. Remaining/interrupted subagents are regenerated under the new harness with
//     zero loss of already-completed work.
//  4. Every document-generation request carries `docGen: true` so the desktop runner
//     routes it through T3 Code and closes T3 automatically when idle.
import { runAI } from './small-model.js';
import { buildContinuationPrompt } from './ai-context.js';

export const SUCCESSION_KEY = 'notecomplete-ai-succession';
export const DEFAULT_SUCCESSION_ORDER = Object.freeze([
  'claude',
  'antigravity',
  'codex',
  'opencode',
  't3code',
  'local',
]);

const PROVIDER_LABELS = {
  claude: 'Claude Code',
  antigravity: 'Antigravity',
  codex: 'Codex',
  opencode: 'OpenCode',
  t3code: 'T3 Code',
  local: 'Model in this app',
};

export function providerLabel(id, providers = []) {
  const match = (providers || []).find((p) => p.id === id);
  return match?.label || PROVIDER_LABELS[id] || id || 'AI';
}

export function readSuccession(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(SUCCESSION_KEY);
    if (!raw) return { order: [...DEFAULT_SUCCESSION_ORDER], disabled: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const order = [...new Set([...parsed.filter((x) => typeof x === 'string' && x), ...DEFAULT_SUCCESSION_ORDER])];
      return { order, disabled: [] };
    }
    const order = Array.isArray(parsed?.order)
      ? [...new Set([...parsed.order.filter((x) => typeof x === 'string' && x), ...DEFAULT_SUCCESSION_ORDER])]
      : [...DEFAULT_SUCCESSION_ORDER];
    const disabled = Array.isArray(parsed?.disabled)
      ? [...new Set(parsed.disabled.filter((x) => typeof x === 'string' && x))]
      : [];
    return { order, disabled };
  } catch {
    return { order: [...DEFAULT_SUCCESSION_ORDER], disabled: [] };
  }
}

export function writeSuccession({ order, disabled = [] }, store = globalThis.localStorage) {
  const cleanOrder = [...new Set((Array.isArray(order) ? order : DEFAULT_SUCCESSION_ORDER).filter((x) => typeof x === 'string' && x && x !== 'none'))];
  for (const id of DEFAULT_SUCCESSION_ORDER) {
    if (!cleanOrder.includes(id)) cleanOrder.push(id);
  }
  const cleanDisabled = [...new Set((Array.isArray(disabled) ? disabled : []).filter((x) => typeof x === 'string' && x))];
  const payload = { order: cleanOrder, disabled: cleanDisabled };
  try { store?.setItem(SUCCESSION_KEY, JSON.stringify(payload)); } catch { /* Optional. */ }
  return payload;
}

/**
 * Builds the ordered list of provider IDs to try for a generation run:
 * starts with `primaryProvider`, then follows the user's enabled succession
 * priority list (filtered to currently available providers).
 */
export function buildSuccessionQueue(primaryProvider, availableProviders = [], { store = globalThis.localStorage } = {}) {
  const availSet = new Set(
    (availableProviders || [])
      .filter((p) => p && p.id && p.id !== 'none' && p.available !== false)
      .map((p) => p.id),
  );
  const { order, disabled } = readSuccession(store);
  const disabledSet = new Set(disabled);
  const queue = [];
  const push = (id) => {
    if (!id || id === 'none' || queue.includes(id)) return;
    if (availSet.size && !availSet.has(id)) return;
    queue.push(id);
  };
  if (primaryProvider) push(primaryProvider);
  for (const id of order) {
    if (!disabledSet.has(id)) push(id);
  }
  return queue.length ? queue : (primaryProvider ? [primaryProvider] : []);
}

export function savedModelFor(provider, store = globalThis.localStorage) {
  if (!provider) return '';
  try { return store?.getItem(`notecomplete-ai-model:${provider}`) || ''; } catch { return ''; }
}

/**
 * True when an error represents a harness failure (usage/quota/rate limit, timeout,
 * crash, non-zero exit, empty answer, network/HTTP error) that should hand off to
 * the next harness in the succession priority list. False for user cancellations.
 */
export function isFailoverError(error, signal = null) {
  if (signal?.aborted) return false;
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  const msg = String(error?.message || error).toLowerCase();
  if (msg === 'cancelled.' || msg === 'cancelled' || msg.includes('request was stopped') || msg.includes('aborted by user')) {
    return false;
  }
  return true;
}

/**
 * Builds an orchestrator handoff prompt transferring the current orchestrator chat
 * and any completed/partial work to the next harness in the succession priority list.
 */
export function buildOrchestratorHandoffPrompt({
  basePrompt = '',
  partialText = '',
  kind = 'exam',
  fromProvider = '',
  toProvider = '',
  reason = '',
  completedSummaries = [],
} = {}) {
  const header = [
    `[ORCHESTRATOR HANDOFF: ${fromProvider || 'previous harness'} stopped (${reason || 'harness error / usage limit'}). You (${toProvider || 'next harness'}) are now taking over orchestration and controlling the remaining work.]`,
  ];
  if (completedSummaries.length) {
    header.push(
      'Work ALREADY completed and preserved by earlier subagents (do NOT redo or lose this work):\n'
      + completedSummaries.map((s) => `- ${s}`).join('\n'),
    );
  }
  const core = partialText && String(partialText).trim()
    ? buildContinuationPrompt({ basePrompt, partialText, kind })
    : String(basePrompt || '').trim();
  return `${header.join('\n\n')}\n\n${core}`;
}

/**
 * Creates a resilient document-generation orchestrator that:
 *  - Routes every document-generation call with `docGen: true` (through T3 Code).
 *  - Automatically hands off the orchestrator chat and regenerates remaining/failed
 *    subagents on the next harness in the user's succession priority list whenever
 *    a harness errors out or hits usage limits, without losing completed work.
 */
export async function createDocOrchestrator({
  ai,
  primaryProvider,
  primaryModel = '',
  store = globalThis.localStorage,
  signal = null,
  onSwitch = null,
  onStatus = null,
} = {}) {
  const providers = (await ai?.providers?.().catch(() => [])) || [];
  const queue = buildSuccessionQueue(primaryProvider, providers, { store });
  let idx = 0;
  let currentProvider = queue[0] || primaryProvider;
  let currentModel = currentProvider === primaryProvider ? primaryModel : savedModelFor(currentProvider, store);
  const switches = [];
  const completedLog = [];
  let failoverPromise = null;

  const currentCaps = () => ai?.capabilities?.(currentProvider, currentModel) || { vision: true, contextTokens: 0 };

  function labelOf(id) {
    return providerLabel(id, providers);
  }

  /**
   * Advances to the next harness in the succession priority list if `failedProvider`
   * is still the active harness (coalesces concurrent subagent failures into one switch).
   */
  async function advanceOnFailure(failedProvider, error, { stage = '', preservedCount = 0, preservedChars = 0 } = {}) {
    if (failoverPromise) return failoverPromise;
    if (failedProvider !== currentProvider) {
      // Another subagent already switched us to a newer harness; retry on the new one!
      return { switched: true, provider: currentProvider, model: currentModel };
    }
    failoverPromise = (async () => {
      const nextIdx = idx + 1;
      if (nextIdx >= queue.length) {
        return { switched: false, provider: currentProvider, model: currentModel };
      }
      const prev = currentProvider;
      idx = nextIdx;
      currentProvider = queue[idx];
      currentModel = savedModelFor(currentProvider, store);
      const reason = String(error?.message || error || 'harness error').slice(0, 180);
      const info = {
        from: prev,
        fromLabel: labelOf(prev),
        to: currentProvider,
        toLabel: labelOf(currentProvider),
        model: currentModel,
        reason,
        stage,
        preservedCount,
        preservedChars,
      };
      switches.push(info);
      onSwitch?.(info);
      const keptNote = preservedCount
        ? ` (${preservedCount} completed item${preservedCount === 1 ? '' : 's'} preserved)`
        : preservedChars
          ? ` (${preservedChars.toLocaleString()} chars preserved)`
          : '';
      onStatus?.(`${info.fromLabel} failed — handing off to ${info.toLabel}${keptNote}…`);
      return { switched: true, provider: currentProvider, model: currentModel, info };
    })();
    try {
      return await failoverPromise;
    } finally {
      failoverPromise = null;
    }
  }

  /**
   * Runs a single orchestrator or document stage with automatic harness handoff
   * and partial-output preservation.
   */
  async function runStage({
    prompt,
    images = [],
    tag = 'exam',
    label = 'AI document',
    kind = 'exam',
    initialPartialText = '',
    onDelta = null,
    small = false,
    vision = true,
  }) {
    let preservedPartial = String(initialPartialText || '');
    let handoffMeta = null;

    while (true) {
      if (signal?.aborted) throw Error('Cancelled.');
      const prov = currentProvider;
      const mod = currentModel;
      const caps = currentCaps();
      const useVision = vision && caps.vision !== false;
      const stagePrompt = handoffMeta
        ? buildOrchestratorHandoffPrompt({
            basePrompt: prompt,
            partialText: preservedPartial,
            kind,
            fromProvider: handoffMeta.fromLabel,
            toProvider: handoffMeta.toLabel,
            reason: handoffMeta.reason,
            completedSummaries: completedLog.slice(-12),
          })
        : prompt;

      let streamed = '';
      try {
        const res = await runAI(
          ai,
          {
            provider: prov,
            model: mod,
            prompt: stagePrompt,
            images: useVision ? images : [],
            tag,
            label: switches.length ? `${label} (${labelOf(prov)})` : label,
            peek: () => streamed,
            signal,
            docGen: true,
          },
          (chunk) => {
            streamed += chunk;
            onDelta?.(chunk, { provider: prov, model: mod, totalStreamed: preservedPartial.length + streamed.length });
          },
          { small: small || !!caps.small, vision: useVision },
        );
        if (signal?.aborted) throw Error('Cancelled.');
        completedLog.push(`${label} (via ${labelOf(prov)})`);
        return {
          text: res.text,
          partialText: preservedPartial,
          handedOff: !!handoffMeta,
          provider: prov,
          model: mod,
        };
      } catch (err) {
        if (!isFailoverError(err, signal)) throw err;
        if (streamed.trim()) {
          preservedPartial = preservedPartial ? `${preservedPartial}\n${streamed}` : streamed;
        }
        const next = await advanceOnFailure(prov, err, {
          stage: label,
          preservedChars: preservedPartial.length,
        });
        if (!next.switched) {
          const tried = switches.length
            ? ` (tried: ${[...switches.map((s) => s.fromLabel), labelOf(prov)].join(' → ')})`
            : '';
          throw Error(`${err?.message || String(err)}${tried}`);
        }
        handoffMeta = next.info || {
          fromLabel: labelOf(prov),
          toLabel: labelOf(currentProvider),
          reason: err?.message || String(err),
        };
      }
    }
  }

  /**
   * Runs parallel subagents controlled by the orchestrator. If any subagent's
   * harness fails or hits usage limits, all completed subagent results are kept,
   * the orchestrator switches to the next harness in the succession priority list,
   * and remaining/failed subagents are regenerated under the new harness.
   */
  async function runSubagents({
    items,
    concurrency = 4,
    initialResults = null,
    buildRequest,
    parseResult,
    onItemDone = null,
    small = false,
  }) {
    const results = Array.isArray(initialResults)
      ? [...initialResults]
      : Array(items.length).fill(null);
    const pendingQueue = items.map((_, i) => i).filter((i) => !results[i]);
    let doneCount = items.length - pendingQueue.length;
    let fatalError = null;

    const worker = async () => {
      while (!signal?.aborted && !fatalError) {
        const itemIdx = pendingQueue.shift();
        if (itemIdx === undefined) return;
        if (results[itemIdx]) continue;

        const prov = currentProvider;
        const mod = currentModel;
        const caps = currentCaps();
        const reqSpec = buildRequest(items[itemIdx], itemIdx, {
          provider: prov,
          model: mod,
          caps,
          completedSummaries: completedLog.slice(-12),
          switched: switches.length > 0,
        });
        let workerStream = '';
        let promptText = reqSpec.prompt;
        if (switches.length > 0 && completedLog.length > 0) {
          promptText = `[Orchestrator active on ${labelOf(prov)}; ${doneCount}/${items.length} sibling subagents already finished and preserved.]\n\n${promptText}`;
        }
        try {
          const res = await runAI(
            ai,
            {
              provider: prov,
              model: mod,
              prompt: promptText,
              images: caps.vision === false ? [] : (reqSpec.images || []),
              tag: reqSpec.tag || 'exam',
              label: switches.length ? `${reqSpec.label} (${labelOf(prov)})` : reqSpec.label,
              peek: () => workerStream,
              signal,
              docGen: true,
            },
            (chunk) => {
              workerStream += chunk;
              reqSpec.onDelta?.(chunk);
            },
            { small: small || !!caps.small, vision: (reqSpec.images?.length || 0) > 0 && caps.vision !== false },
          );
          if (signal?.aborted) return;
          const parsed = await parseResult(res.text, items[itemIdx], itemIdx);
          results[itemIdx] = parsed;
          doneCount += 1;
          completedLog.push(`${reqSpec.label || `Item ${itemIdx + 1}`} (via ${labelOf(prov)})`);
          await onItemDone?.(itemIdx, parsed, { done: doneCount, total: items.length, provider: prov, providerLabel: labelOf(prov) });
        } catch (err) {
          if (!isFailoverError(err, signal)) {
            fatalError = err;
            return;
          }
          const next = await advanceOnFailure(prov, err, {
            stage: reqSpec.label || `Subagent ${itemIdx + 1}`,
            preservedCount: doneCount,
          });
          if (!next.switched) {
            const tried = switches.length
              ? ` (tried: ${[...switches.map((s) => s.fromLabel), labelOf(prov)].join(' → ')})`
              : '';
            fatalError = Error(`${err?.message || String(err)}${tried}`);
            return;
          }
          // Re-queue this unfinished item so a regenerated subagent runs it on the new harness.
          pendingQueue.unshift(itemIdx);
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(1, pendingQueue.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    if (signal?.aborted) throw Error('Cancelled.');
    if (fatalError) throw fatalError;
    return results;
  }

  return {
    get provider() { return currentProvider; },
    get model() { return currentModel; },
    get providerLabel() { return labelOf(currentProvider); },
    get queue() { return [...queue]; },
    get switches() { return [...switches]; },
    capabilities: currentCaps,
    runStage,
    runSubagents,
  };
}

// ---- Shared UI widgets for Setup Wizard & Connect AI tools ----

/**
 * Renders an interactive Harness Failover Priority list with Move Up / Move Down
 * buttons and enable/disable checkboxes.
 */
export function renderSuccessionEditor(container, { providers = [], store = globalThis.localStorage, onChange = null } = {}) {
  const byId = new Map((providers || []).map((p) => [p.id, p]));
  let state = readSuccession(store);

  const draw = () => {
    container.replaceChildren();
    const list = document.createElement('div');
    list.className = 'wizard-succession-list';
    const order = state.order.filter((id) => id !== 'none');
    order.forEach((id, i) => {
      const info = byId.get(id);
      const available = info ? info.available !== false : false;
      const enabled = !state.disabled.includes(id);

      const row = document.createElement('div');
      row.className = `wizard-provider wizard-succession-row${available ? '' : ' unavailable'}${enabled ? '' : ' is-off'}`;
      row.dataset.provider = id;

      const rank = document.createElement('span');
      rank.className = 'wizard-succession-rank';
      rank.textContent = String(i + 1);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = enabled;
      check.title = enabled ? 'Included in failover succession' : 'Skipped during failover';
      check.setAttribute('aria-label', `Include ${providerLabel(id, providers)} in failover priority`);
      check.onchange = () => {
        const disabled = new Set(state.disabled);
        if (check.checked) disabled.delete(id);
        else disabled.add(id);
        state = writeSuccession({ order: state.order, disabled: [...disabled] }, store);
        onChange?.(state);
        draw();
      };

      const name = document.createElement('span');
      name.className = 'wizard-provider-name';
      name.textContent = providerLabel(id, providers);

      const tag = document.createElement('span');
      tag.className = 'wizard-provider-tag';
      tag.textContent = !enabled ? 'skipped' : available ? (id === 't3code' ? 'doc-gen hub' : 'ready') : 'not installed';

      const controls = document.createElement('span');
      controls.className = 'wizard-succession-controls';

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'wizard-succession-move';
      up.textContent = '↑';
      up.title = 'Move higher in priority';
      up.setAttribute('aria-label', `Move ${providerLabel(id, providers)} up`);
      up.disabled = i === 0;
      up.onclick = () => {
        const next = [...state.order];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        state = writeSuccession({ order: next, disabled: state.disabled }, store);
        onChange?.(state);
        draw();
      };

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'wizard-succession-move';
      down.textContent = '↓';
      down.title = 'Move lower in priority';
      down.setAttribute('aria-label', `Move ${providerLabel(id, providers)} down`);
      down.disabled = i === order.length - 1;
      down.onclick = () => {
        const next = [...state.order];
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        state = writeSuccession({ order: next, disabled: state.disabled }, store);
        onChange?.(state);
        draw();
      };

      controls.append(up, down);
      row.append(rank, check, name, tag, controls);
      list.append(row);
    });
    container.append(list);
  };

  draw();
  return { refresh: draw };
}

/**
 * Renders a T3 Code status & 1-click installer card (like R Commander Studio)
 * for the Setup Wizard and Connect AI tools dialog.
 */
export function renderT3StatusCard(container, { ai = null, onInstalled = null } = {}) {
  const api = ai?.t3Status ? ai : globalThis.notecompleteAI;
  if (!api?.t3Status) {
    container.replaceChildren();
    return null;
  }

  let busy = false;
  let progressText = '';
  let statusObj = null;

  const draw = () => {
    container.replaceChildren();
    const card = document.createElement('div');
    const ok = Boolean(statusObj?.t3Installed || statusObj?.t3Running);
    card.className = `wizard-status-card ${busy ? '' : ok ? 'ok' : 'warn'}`;

    const head = document.createElement('div');
    head.className = 'wizard-module-head';

    const text = document.createElement('div');
    text.className = 'wizard-module-text';
    const title = document.createElement('strong');
    title.className = 'wizard-module-name';
    title.textContent = 'T3 Code (AI document generation & harness)';
    const summary = document.createElement('span');
    summary.className = 'wizard-module-summary';
    summary.textContent = 'Starts automatically when generating AI documents and closes when idle.';

    const line = document.createElement('span');
    line.className = 'wizard-status-line';
    if (busy) {
      line.textContent = progressText || 'Working…';
    } else if (!statusObj) {
      line.textContent = 'Checking T3 Code…';
    } else if (statusObj.t3Running) {
      line.textContent = `Running (${statusObj.t3Url || '127.0.0.1:3773'})${statusObj.ownedByApp ? ' · closes when idle' : ' · external session'}`;
    } else if (statusObj.t3Installed) {
      line.textContent = `Installed (${statusObj.t3InstallInfo?.source || 'local'}) · ready on demand`;
    } else {
      line.textContent = statusObj.platform === 'win32'
        ? 'Not installed (installs via WSL2 / native)'
        : 'Not installed · optional 1-click install from GitHub';
    }
    text.append(title, summary, line);

    const actions = document.createElement('span');
    actions.className = 'wizard-module-actions';
    if (!busy && statusObj && !statusObj.t3Installed && !statusObj.t3Running && typeof api.t3Install === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary';
      btn.textContent = 'Install T3 Code';
      btn.onclick = async () => {
        busy = true;
        progressText = 'Downloading T3 Code…';
        draw();
        try {
          const res = await api.t3Install({ preferWsl: true }, (p) => {
            progressText = `${p?.detail || 'Installing T3 Code…'}${p?.pct ? ` (${p.pct}%)` : ''}`;
            draw();
          });
          if (!res?.ok && res?.error) progressText = res.error;
          else await onInstalled?.(res);
        } catch (e) {
          progressText = e?.message || 'T3 Code install failed.';
        } finally {
          busy = false;
          await refresh();
        }
      };
      actions.append(btn);
    }

    head.append(text, actions);
    card.append(head);
    container.append(card);
  };

  const refresh = async () => {
    try { statusObj = await api.t3Status(); } catch { statusObj = { t3Installed: false, t3Running: false }; }
    draw();
  };

  draw();
  void refresh();
  return { refresh };
}
