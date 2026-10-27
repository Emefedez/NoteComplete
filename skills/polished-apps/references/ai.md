# AI features

## Where AI fits

AI acts on what the user is looking at: the selection, the visible range, the current clip or document, with that source attached (data excerpt, image of the view, metadata). Examples: explain this burst in the signal; suggest filter settings; find silences/scene cuts and propose markers; describe or summarize a selection; generate study material from a document; check a result against the source.

## Providers

| Option | When | Notes |
|---|---|---|
| User's own CLI agents (Claude Code, Codex, Antigravity) | desktop apps for technical users | their logins, no keys in the app; run read-only with a temp dir and the app's MCP server |
| API with the user's key | general users, web apps | key in the OS keychain (keytar/Tauri stronghold/keyring crate), never in project files or logs |
| Local models (llama.cpp, Ollama, whisper.cpp) | offline, private, cheap | download on first use, show size; run in a worker/process |

CLI calls (prompt on stdin unless noted):

| Tool | Call | Result |
|---|---|---|
| Claude Code | `claude -p --output-format json --add-dir <tmp> --strict-mcp-config --allowedTools Read [--mcp-config '{"mcpServers":{"app":{"command":"<bin>","args":["mcp"]}}}' --allowedTools mcp__app] [--model M]` | `JSON.parse(out).result` |
| Codex | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -o <file> [-i image]… [-m M] -` | contents of `<file>` |
| Antigravity | `agy -p "<prompt>" --output-format json --add-dir <tmp> --print-timeout 600s [--model M]` | `JSON.parse(out).response` |

- Streaming: Claude `--output-format stream-json --verbose --include-partial-messages`; forward deltas per request id.
- Launchers lack the shell PATH: resolve binaries once via the login shell (`$SHELL -lic 'command -v claude'`).
- Attachments in a private temp dir per request, deleted after.
- Expose the project through an MCP server built on the core, so agents query real data instead of screenshots only.
- Every request has a tag; cancel kills it; one owner per window/tab.

## What to send

- The minimum by default: the item's own source (its page/region image and text). Larger material is opt-in, as toggles in the request UI: the source document (e.g. the page's original PDF), the user's own notes, the whole project through MCP. Agents given the whole project explore it before answering, which turns seconds into minutes.
- Don't tell the model that emphasised parts (highlights, taped answers) matter more; ask it to cover the material evenly. Show covered parts (tape lifted) only so they're readable.
- Let the user pick the tool and model next to the request, remembered.
- While waiting: elapsed seconds and Stop; stream when the tool can.
- Store the last answer with the item (an explanation on a flashcard, a correction on a question), editable and marked "edited by you", and reuse it instead of asking again; "Ask again" replaces it. Don't let a stored answer spoil an exercise: one that reveals the solution stays hidden until the user has answered.
- Item boxes answer one thing; a follow-up moves the conversation to the main assistant panel with its thread and the item as pinned context (kept until "New"), instead of growing a second chat inside the item window.

## Prompts

- One line of role, the material and how it was captured, units and conventions, the language rule, then the exact output: `Reply with ONLY this JSON: {...}`.
- Prefer references the UI can show (time range, sample index, frame, region box) over prose; the UI renders the reference (highlight, jump, crop).
- Parse leniently (first `{` to last `}`, strip fences), validate each item against the model (ranges inside the data, enums known), keep the valid ones.
- Editable instructions with "Restore default"; pass what the user rejected before ("avoid these").

## Jobs

- Split large inputs into batches, a few in flight, preparation overlapping requests.
- Job chip: title · phase · elapsed, progress that creeps by time and jumps per result, Stop. Finish: toast + action button (Open results).
- One failure stops the job but keeps finished results; say it stopped early.

## Human in charge

Every AI output is questionable in place:

| Action | Key | Effect |
|---|---|---|
| Explain / ask | C | streamed explanation with the source attached; follow-ups keep the thread |
| Double check | V | AI re-reads the source and proposes a fix + reason in an editable box; saving stores the user's version |
| Edit | E | change it by hand |
| Discard / dispute | X twice | remove or stop counting it; future runs avoid it |
| Apply | Enter | AI suggestions (markers, settings) are applied as one undoable step |

User corrections win over the original and are stored with the project.

## Testing

Inject a fake bridge (canned JSON, streamed deltas, errors); assert payloads (attachments, prompt contents), partial rendering while streaming, cancel on close, and that invalid items are dropped.
