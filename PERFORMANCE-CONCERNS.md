# Performance Concerns and Memory Audit

This document details the memory footprint, scaling characteristics, and identified memory leaks in **NoteComplete** across the desktop Electron shell, the browser reader, and the Rust WebAssembly core (`noteful-wasm` / `noteful-core`).

---

## 1. Executive Summary

| Layer | Component | Baseline Footprint | Peak / Large Document Footprint | Primary Concern |
| :--- | :--- | :--- | :--- | :--- |
| **Electron Main** | `apps/desktop/` | ~55 MB Anon RSS | ~350 MB Anon RSS (during large IPC transfers) | Orphaned child processes (`claude`, `agy`, `ffmpeg`) & `running` Map leaks on tab close |
| **Renderer / DOM** | `apps/reader/` | ~71 MB Anon RSS | ~180 MB Anon RSS | `$("pageList")` and `thumbQueue` uncleaned on `reset()` |
| **Web Worker / WASM**| `worker.js`, `pkg/` | ~62 MB RSS | **871 MB – 1,079 MB RSS** | WASM linear memory cannot shrink; `EditorSession` not freed on document close |
| **Rust Core** | `crates/noteful-core/` | In-memory archive | $2\times$ input size in WASM heap | Unbounded `Editor.history` edit undo stack; double byte buffering |

---

## Status

| # | Concern | Status |
| :--- | :--- | :--- |
| 1 | Worker session retained on reset | **Fixed**: new `close` op in `worker.js`, called from `reset()` |
| 2 | WASM linear memory high-water mark | **Mitigated**: the worker is replaced when a note of 32 MB or more closes |
| 3 | `pageList` / `thumbQueue` retention | **Fixed** in `reset()` |
| 4 | Orphaned child processes, `running` Map | **Fixed**: tab destruction cancels AI and transcription work; empty owners are dropped |
| 5 | "Unbounded undo history" | **Not a bug, no change** (see below) |
| 6 | Buffer duplication on open | Open (needs a streaming or transferable open path) |

Peak memory while a *new* large note opens (old and new session coexist until the new one validates) is unchanged.

## 2. Live Runtime Telemetry

Telemetry collected on Linux (Wayland / Hyprland) with NoteComplete running an active document (`GUIA_COMANDOS.md`):

```
Process Hierarchy & Memory Usage:
├── PID 2604616 (Electron Main)     : RSS 242.6 MB (Anon:  55.6 MB, File: 172.2 MB, Shmem: 14.8 MB)
├── PID 2604740 (Reader Renderer)   : RSS 183.3 MB (Anon:  71.5 MB, File: 106.8 MB, Shmem:  4.9 MB)
├── PID 2604698 (GPU Process)       : RSS 148.1 MB (Anon:  48.6 MB, File:  98.5 MB, Shmem:  0.9 MB)
├── PID 2605255 (Secondary Utility) : RSS  92.6 MB (Anon:  22.3 MB, File:  69.8 MB, Shmem:  0.5 MB)
├── PID 2604704 (Network Service)   : RSS  81.6 MB (Anon:  15.0 MB, File:  66.3 MB, Shmem:  0.1 MB)
└── PID 2604621 (AppImage Wrapper)  : RSS  60.0 MB (Anon:  60.0 MB, File:   0.0 MB, Shmem:  0.0 MB)

Total Resident Memory (VmRSS)       : ~748 MB (across all processes)
Total Unshared Private RAM (Anon)   : ~211 MB (real active application memory)
```

> **Note on Virtual Memory (`VmSize`):** The ~1.5 TB `VmSize` per process is Chromium's standard 64-bit caged heap / pointer-compression reservation and does not represent physical memory consumption.

---

## 3. Empirical Scaling Benchmarks

Tests conducted using the production WASM build with representative user notebooks from `~/Documents/NoteComplete`:

| Notebook | File Size | Pages | Embedded Audio | WASM Heap / RSS | ArrayBuffers | Observations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline Runtime** | — | — | — | **62 MB** | 0 MB | Bare engine initialized |
| `ACII Examen.noteful` | 4.2 MB | 13 | 0 | **114 MB** | 4 MB | Fast decode, minimal footprint |
| `Tema 3.noteful` | 98.0 MB | 27 | 4 | **400 MB** | 98 MB | +175 MB WASM allocation; RSS does not drop after `session.free()` |
| `Memoria 1.noteful` | 247.0 MB | 206 | 6 | **871 MB** | 247 MB | File buffer + parsed SQLite/strokes drives peak allocation |
| **Sequential Load** (`Memoria 1` $\to$ `Temas1+2` 214 MB) | 461.0 MB | 300+ | 8 | **1,079 MB** | 451 MB | WASM linear memory expands monotonically to high-water mark |

---

## 4. Specific Issues and Potential Leaks

### 1. Worker Session Retained on Document Reset (High Severity)
- **Location:** `apps/reader/app.js:194` (`reset()`) and `apps/reader/worker.js:10-52`.
- **Cause:** When closing a document (returning to Home, switching tabs, or loading an HTML/Markdown file), `app.js` runs `reset()`. It never informs `worker.js` that the document is closed. In `worker.js`, `session?.free()` is only executed when `op === "open"` is called with another `.noteful` file.
- **Consequence:** After closing a 250 MB notebook to view a 2 KB Markdown file or Home cards, the previous 250 MB raw archive and its entire parsed `EditorSession` remain in WASM heap memory indefinitely.

### 2. WASM Linear Memory High-Water Mark (High Severity)
- **Location:** `apps/reader/app.js:70` (`const worker = new Worker("./worker.js", ...)`) and `apps/reader/worker.js`.
- **Cause:** WebAssembly linear memory (`WebAssembly.Memory`) is grow-only (`memory.grow`). Once expanded to 800+ MB during large note decoding, memory cannot be reclaimed by the OS while that worker thread exists. Unlike `find.js` (which recycles Tesseract workers every 12 pages) and `transcript.js` (which terminates Whisper workers when complete), the editor worker is never recycled.
- **Consequence:** Opening a large note permanently inflates the tab's memory footprint until the entire Electron tab is destroyed.

### 3. DOM & Closure Retention in `pageList` and `thumbQueue` (Medium Severity)
- **Location:** `apps/reader/app.js:194-231` (`reset()`) vs `apps/reader/app.js:467-508` (`buildPageList()`) & line 746 (`thumbQueue`).
- **Cause:** `reset()` empties the sheet container (`$("pages").replaceChildren()`), but fails to clear `$("pageList")` and does not call `thumbQueue.clear()`.
- **Consequence:** If a user closes a note or switches to a text document, all thumbnail DOM nodes (`<button class="page-link">`), PNG data URL images, and event closures remain attached to `pageList`. Unprocessed panels in `thumbQueue` retain references to the previous note's `panel` objects (`p = { index, size, el, view, ... }`).

### 4. Orphaned Background Subprocesses in Electron Main (Medium Severity)
- **Location:** `apps/desktop/main.js:146-158` (`closeTab`), lines 176-184 (`win.on('closed')`), `apps/desktop/ai-runner.js:114-142`, and `apps/desktop/transcriber.js:50-59`.
- **Cause:** `ai-runner` and `transcriber` index running child processes by `owner` (`event.sender.id`). When a tab or window is closed, `ai.cancel(id)` and `asr.cancel(id)` are not called, nor are the keys deleted from the `running` Maps.
- **Consequence:** If a tab is closed while generating quizzes/flashcards or transcribing audio, the spawned child processes (`claude`, `agy`, `codex`, `ffmpeg`, `voxtype`) keep running in the background for up to 10–15 minutes, leaking CPU and memory.

### 5. Edit History Growth (Not a bug; do not cap)
- **Location:** `crates/noteful-core/src/editor.rs` (`commit`).
- **Finding:** `Editor.history` is not only an undo stack. The archive is immutable and the document *is* the original plus the applied edits replayed over it (`.nfedit` saves the history and cursor; native export flattens `history[..cursor]`). Dropping old entries would silently revert those edits, so capping it would corrupt documents.
- **Consequence:** Memory grows with the amount of editing, which is inherent. Reducing it would need checkpointing (flattening old edits into a new base), a larger change that is not attempted here.

### 6. Multi-Copy Buffer Duplication over IPC (Low/Medium Severity)
- **Location:** `apps/desktop/main.js:253` (`files:open`), `apps/desktop/library-files.js:93`, `apps/reader/media-import.js:86-91`, and `crates/noteful-core/src/editor.rs:86`.
- **Cause:** Opening a 250 MB note reads the file into a Node.js `Buffer`, transfers it over IPC via V8 structured clone (temporarily allocating serialized copies in Main and Renderer), copies it into the WASM heap (`passArray8ToWasm0`), and clones it again in Rust (`self.source = data.to_vec()`).
- **Consequence:** Peak memory spikes by $3\times\text{--}4\times$ the file size during opening before settling.

---

## 5. Existing Mitigations and Good Practices

The codebase already employs several sound memory patterns that should be preserved:

- **Virtualized Sheet Rendering (`app.js:446-464`):** An `IntersectionObserver` with a 600px margin unmounts offscreen pages (`p.el.replaceChildren(span)` and sets `p.view = p.render = p.ink = null`).
- **Bounded PDF Raster Cache (`pdf-background.js:125`):** The raster image cache is explicitly capped at 3 entries (`if (this.images.size > 3) this.images.delete(...)`).
- **Canvas Dimension Zeroing (`pdf-background.js:130`, `find.js:330`):** Canvases are explicitly cleared with `canvas.width = canvas.height = 0` to release underlying GPU/backing store surfaces.
- **Worker Teardown for Speech (`transcript.js:306`):** Dedicated workers for Whisper transcription are terminated immediately in `.finally()`.
- **OCR Engine Recycling (`find.js:310`):** Tesseract engines are recycled every 12 pages (`const RECYCLE = 12`) to counter known engine-level heap growth.
- **Blob URL Lifecycle (`audio.js:40`, `drive-thumbs.js:110`):** Object URLs are explicitly tracked and revoked via `URL.revokeObjectURL()`.

---

## 6. Remediation

1. **Session close (done):** `worker.js` handles `op === "close"`; `reset()` in `app.js` calls `releaseSession()` unless a note is being opened.
2. **Worker recycling (done):** `releaseSession()` terminates and respawns the worker when the closed note was at least `RECYCLE_BYTES` (32 MB), returning its WebAssembly memory to the system.
3. **DOM teardown (done):** `reset()` clears `thumbQueue` and `#pageList`.
4. **Process teardown (done):** `main.js` calls `ai.cancel(id)` and `asr.cancel(id)` when a tab's page is destroyed (closing a tab or window); `ai-runner.js` removes an owner's entry when its last request ends.
5. **Remaining:** IPC and WASM copy count when opening large notes (item 6); history checkpointing (item 5) if long sessions prove a problem.
