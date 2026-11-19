# Plan: R Math & Statistics Prefabs via `r-commander-in-vscode` Bridge

**Status:** Planning document only (not yet implemented).

## 1. Goal & Motivation

Add interactive, publication-quality **R-powered math and statistics prefabs** (probability distribution curves with shaded tails, Q-Q/diagnostic plots, histograms/boxplots, regression fits, summary tables, and custom R figures) to NoteComplete without reimplementing R Commander dialogs, R code generation, or session management from scratch.

Instead, NoteComplete will bridge to **[`r-commander-in-vscode`](https://github.com/Emefedez/r-commander-in-vscode)** (`r-commander-play`) and ship a dedicated **Setup & Diagnostics Utility** so desktop users can connect either a running VS Code session or a local `Rscript` fallback in minutes, while mobile/browser/offline readers continue rendering cached vector snapshots cleanly.

---

## 2. What Already Exists to Reuse

### 2.1 In `r-commander-in-vscode` (`r-commander-play`)
- **Declarative dialog catalogs (`catalog/*.js`):**
  - `catalog/distributions.js` (`DISTRIBUTIONS`, quantile/probability/mass/density/plot builders with automatic quantile range lookup)
  - `catalog/graphs.js` (histograms, boxplots, scatterplots, Q-Q plots, strip charts, etc.)
  - `catalog/models.js` & `catalog/stats.js` (linear models, GLMs, hypothesis tests, ANOVA)
  - `catalog/data.js`, `catalog/teachstat.js`, `catalog/teachstat_dist.js`
- **Form schema & dataset binding (`lib/formmodel.js`):** Field descriptors (`text`, `number`, `choice`, dataset/variable pickers), validation patterns, and defaults.
- **Session & execution core (`runner.R`, `lib/rsession.js`, `lib/commander.js`):**
  - `run_code(code, skip_help, skip_commands, limit_output, max_output_items, require, ...)` in `runner.R` handles package dependency checks (`requireNamespace`), bounded preview output (`max.print`), source parsing, and log capture (`output_log_file()`).

### 2.2 In NoteComplete (`apps/reader/prefabs/`)
- **Prefab module contract (`apps/reader/prefab-registry.js`, `apps/reader/prefab-host.js`, `docs/PREFAB-MODULES.md`):**
  - Self-contained module folders (`module.json`, `render.js`, optional `editor.js`) with `"kind": "custom"`, `"output": "picture"`.
  - Prefab state lives inside the compound item's `spec` stored in the `.notecomplete` archive, so notes stay portable across Desktop, Web, and Mobile.

---

## 3. Target Architecture

```
+-------------------------------------------------------------------+
| NoteComplete Reader (apps/reader/prefabs/r-math/)                 |
|  - Offline / portable: renders cached `svg` + LaTeX/text snapshot |
|  - Interactive editor: renders form from `catalog` schema         |
|  - On "Run / Update": sends `{ op, params }` to Bridge Client     |
+----------------------------------+--------------------------------+
                                   | (Desktop IPC / Browser RPC)
                                   v
+-------------------------------------------------------------------+
| Desktop R Bridge Coordinator (apps/desktop/main.js + r-bridge.js) |
|  1. Primary: Localhost WS/HTTP to running `r-commander-play`      |
|     extension inside VS Code (`127.0.0.1` + session token)        |
|  2. Fallback: Headless warm `Rscript` worker sourcing `runner.R`  |
|  3. Captures `svg` (via `svglite`/`grDevices::svg`), text output, |
|     and errors -> returns `{ svg, stdout, latex?, warnings }`     |
+----------------------------------+--------------------------------+
                                   ^
                                   | writes / validates config
+----------------------------------+--------------------------------+
| R Bridge Setup Utility (`tools/r-bridge-setup` + Settings UI)     |
|  - Detects `Rscript`, `code` CLI, `r-commander-play`, R packages  |
|  - Installs / pairs bridge token & tests sample SVG render        |
+-------------------------------------------------------------------+
```

### 3.1 Decoupling the `r-commander-play` Catalog & Execution Bridge
1. **Shared pure-JS catalog export (upstream or vendored subpackage):**
   - Keep `catalog/*.js` and `lib/formmodel.js` free of `vscode` API imports (pure ES/CJS metadata -> R code generator + query expressions).
   - Expose a small manifest endpoint/helper listing `{ id, category, title, fields, defaults, requiredPackages, buildR(values, helpers) }` so NoteComplete never duplicates dialog schemas.
2. **VS Code Extension Bridge (`r-commander-play`):**
   - Optional setting/command in `r-commander-play`: `rCommanderPlay.enableNoteCompleteBridge` (off by default or started on demand).
   - Listens on `127.0.0.1:<ephemeral-port>` only and writes `{ port, token, pid, workspace }` with mode `0600` to `~/.config/notecomplete/r-bridge.json` (or OS app-config equivalent).
   - Accepts authenticated requests:
     - `health` / `capabilities`: R version, installed packages, loaded datasets in the active VS Code R workspace (`ui.query` equivalent).
     - `catalog`: available dialog specs from the active extension version.
     - `evalFigure`: wraps generated R code with an SVG graphic device (`svglite::stringSVG(...)` if available, else temp-file `grDevices::svg(..., width, height)` with base R fallback), runs via `runner.R::run_code()`, and returns `{ svg, textOutput, datasets, warnings }`.
3. **Headless `Rscript` Fallback (NoteComplete Desktop):**
   - If VS Code is not open, Electron main process (`apps/desktop/main.js`) can spawn a user-approved local `Rscript` process sourcing a small wrapper around `runner.R`.
   - Uses the exact same request/response shape as the VS Code bridge, so `editor.js` in `r-math` does not care which backend answered.

### 3.2 Portable Spec Contract (`prefabs/r-math`)
Every inserted R figure stores both **reproducible inputs** and a **cached visual output** in its item `spec`:

```json
{
  "type": "r_figure",
  "schemaVersion": 1,
  "opId": "normalPlot",
  "params": { "mean": 0, "sd": 1, "from": -1.96, "to": 1.96, "region": "between" },
  "rCode": "local({ ... })",
  "title": "Normal(0, 1) — 95% Interval",
  "caption": "",
  "width": 480,
  "height": 320,
  "cache": {
    "svg": "<svg ...>...</svg>",
    "stdout": "",
    "generatedAt": "2026-11-19T12:00:00Z",
    "rVersion": "4.4.1"
  }
}
```

- **Why store `cache.svg` inside the spec?**
  - `render.js` sanitizes `cache.svg` (reusing NoteComplete's SVG sanitizer rules in `prefabs/charts/render.js`) and renders immediately on Web, iOS/Android, or machines without R installed.
  - Only clicking **Edit -> Run / Update in R** invokes the bridge to regenerate `rCode` and refresh `cache.svg`.

---

## 4. Planned Prefab Families

Mapped incrementally from `r-commander-play`'s catalog:

1. **Distributions & Inference Regions (`catalog/distributions.js`):**
   - Continuous & discrete distributions (`normal`, `t`, `chisq`, `F`, `binomial`, `Poisson`, etc.) with shaded lower/upper/between tail areas, critical values, and quantile/probability readout cards.
2. **Statistical Graphs (`catalog/graphs.js`):**
   - Histogram (bins, density overlay), Boxplot, Scatterplot (least-squares/loess trend + CI band), Q-Q normality comparison plot, Dotplot / Bar chart.
3. **Model Diagnostics & Summaries (`catalog/models.js`, `catalog/stats.js`):**
   - Residual vs. Fitted / Normal Q-Q / Scale-Location plots and compact summary cards rendered cleanly as crisp vector SVG / KaTeX tables.
4. **Custom Parameterized R Plot:**
   - Advanced mode allowing inline R plotting code (`ggplot2` or base graphics) plus quick numeric sliders/parameters evaluated safely through `runner.R::run_code()`.

---

## 5. Companion Setup & Diagnostics Utility

Instead of forcing users to configure paths, ports, and CRAN packages manually, provide both a CLI entry (`tools/r-bridge-setup.mjs`) and a Desktop GUI panel (**Settings -> Tools & Prefabs -> R Bridge**):

### 5.1 Environment Discovery
- Locate **`Rscript`** / **`R`** across standard locations (`PATH`, macOS `/Library/Frameworks/R.framework/Resources/bin/Rscript`, Linux `/usr/bin/Rscript`, Windows Registry `HKLM\SOFTWARE\R-core\R`).
- Locate **VS Code** (`code` CLI / desktop app) and check whether `Emefedez/r-commander-in-vscode` (`local-tools.r-commander-play`) is installed and at or above the minimum bridge protocol version.
- Probe required/optional **R packages**:
  - Core SVG rendering: built-in `grDevices::svg` (or `svglite` for cleaner vector text).
  - Recommended Rcmdr/math stack: `RcmdrMisc`, `ggplot2`, `car`, `jsonlite`.

### 5.2 Guided Setup & Self-Test Actions
1. **Install / Update Extension:** Opens `r-commander-play` VSIX/Marketplace page or installs locally via `code --install-extension ...` with explicit user confirmation.
2. **Package Installer:** Generates exact `install.packages(c(...), repos = "https://cloud.r-project.org")` command and (on user click) executes it in an interactive terminal with live log output.
3. **Bridge Handshake Test:** Runs a harmless smoke check (`curve(dnorm(x), -3, 3)`) through the active backend (VS Code bridge or headless `Rscript`), confirms valid SVG bytes return within timeout, and marks status green (`VS Code R Session Connected` / `Local Rscript Ready` / `Offline Preview Only`).

---

## 6. Security & Sandbox Boundaries

Because evaluating R code runs arbitrary local processes if unconstrained, strict boundaries apply:

1. **No Auto-Execution on Note Open:** Opening a shared `.notecomplete` or `.noteful` file renders `cache.svg` strictly through NoteComplete's static SVG sanitizer (`render.js`). Embedded `rCode` or `opId` is **never** executed automatically.
2. **Explicit User Action + Diff Preview:** Opening the R prefab editor shows the structured parameters and generated `rCode`; execution happens only when the user clicks **Run / Update**, and imported custom R scripts show an explicit **"Run untrusted R snippet?"** prompt the first time.
3. **Loopback-Only Tokenized Bridge:**
   - VS Code extension bridge binds solely to `127.0.0.1`, checks `Authorization: Bearer <token>` on every request, and refuses wildcard CORS headers.
   - Browser/Web reader cannot spawn processes directly; Desktop Electron renderer communicates via typed `preload.js` IPC channels (`nc:rBridge...`) validated in `apps/desktop/main.js`.
4. **Execution Guards:** Per-run timeout (default 10s, cancellable), temp working directory per evaluation (when in headless fallback), and bounded stdout/stderr size matching `runner.R`'s `max_output_items`.

---

## 7. Phased Implementation Plan

### Phase 1 — Catalog & Bridge Interface in `r-commander-in-vscode`
- Keep `catalog/*.js` and `lib/formmodel.js` importable without `vscode` globals.
- Add `bridge.js` + `rCommanderPlay.enableNoteCompleteBridge` command in `r-commander-in-vscode` wrapping `lib/rsession.js` + `runner.R` with SVG capture (`grDevices::svg` / `svglite`).

### Phase 2 — Desktop IPC, Local `Rscript` Fallback & Setup Utility
- Add `apps/desktop/r-bridge.js` (reads `r-bridge.json` token, health-checks VS Code bridge, falls back cleanly to managed `Rscript` + `runner.R` worker).
- Expose narrow IPC channels in `apps/desktop/main.js` and `apps/desktop/preload.js`.
- Build `tools/r-bridge-setup.mjs` + **Settings -> R Bridge** status & one-click self-test UI.

### Phase 3 — `apps/reader/prefabs/r-math/` Module
- Add `module.json` (`type: "r_figure"`, presets for Normal/t/Chi-Squared/Binomial distributions, Scatter+Fit, Boxplot, Custom R).
- Implement `render.js` (strict SVG sanitization + cached snapshot rendering with zero R dependency at view time).
- Implement `editor.js` (dynamic form builder driven by `catalog` schemas, live R code preview toggle, Run button with spinner/errors, offline read-only banner when bridge unavailable).

### Phase 4 — Verification
- Unit tests (`node --test`) covering `r-math/render.js` SVG sanitization, offline cache rendering, schema-to-form mapping, and untrusted-note non-execution guarantees.
- Integration test against a mock bridge server verifying auth token rejection, timeout handling, and SVG round-trip.
- Optional live smoke test gated on `which Rscript` / VS Code bridge availability.
