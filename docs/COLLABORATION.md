# Collaborative Markdown notes (plan, not started)

Owner's idea (2026-10-29), polished into a plan. Nothing here is implemented yet.

`[D]` done · `[!]` done, not yet verified against the real app or service · `[ ]` to do

## The idea in one paragraph

One computer **hosts** a document: it runs the normal NoteComplete desktop app and owns the document and its Markdown notes. Other people join as **guests** from an invite link, in a browser or in their own NoteComplete, and write the notes together in real time.

Inside the notes, a new **linked document** element (a chip, like the page markers of notes) lets the host attach files: PDFs, notes, solved exams. A new **Link document…** button in the notes editor's toolbar adds them.

On a device that does not have the file, clicking the chip offers to download it. The download is then bound to the link, like a symlink: later clicks open the local copy. People may change their copies. When a copy and the shared version differ, the page comparison window (the one made for Drive versions) opens again, and each person chooses, page by page, what to keep.

## Where we start from (checked against the code)

- **Rust core (`noteful-core`)**: pure: no filesystem, network or UI. It owns the document model, edits, and Markdown rendering and export (pulldown-cmark, `markdown_html`, page markers in `markdown.rs`).
- **WASM in a Web Worker**: the reader talks to the core only via `postMessage` (`open`, edits, `getMarkdown` / `setMarkdown`, …). The worker holds the live document.
- **Where the notes live**:
  - For a `.noteful` note: in the core session (saved inside projects and `.notecomp`), mirrored in the library's settings as `notes:<fingerprint>` (IndexedDB).
  - For an HTML page (since 3173d94): only in `notes:<fingerprint>`. The worker is never touched.
  - Saving an edited text or HTML file carries notes and study material to the new fingerprint.
- **Notes editor**: TinyMDE, loaded on first use (`notes.js`). Page markers are HTML comments (`<!-- page 3 -->`) shown as chips; clicking one shows that page.
- **Single device everywhere**: there is no network layer, no shared session, no presence and no merging of concurrent edits.

Markdown notes are the right place to start collaborating:
- they are already a separate layer from the binary ink/PDF model;
- the core already parses and renders Markdown;
- text is far easier to merge than ink, layers or timed audio.

## Decisions

Where the original proposal said something else, the change is marked **Changed** with the reason.

1. **Host + guests.** The host is the authority:
   - it decides who may join, keeps the notes, writes them to the document's normal storage, and serves the linked files;
   - guests never receive the host's document state or its files, except linked files they ask for;
   - closing the session on the host ends it for everyone.

2. **Merging with a CRDT (Yjs), not host-serialised edits.** **Changed** from "the host is the single source of truth" with no merge strategy.
   - Two people typing at once need operational transforms or a CRDT. A host that applies edits in arrival order corrupts text as soon as two edits are based on the same version.
   - Yjs is the mature, well-tested CRDT for text, with a standard sync protocol (`y-protocols/sync`) and presence (`y-protocols/awareness`). It handles reconnects and offline edits.
   - Plan:
     - each document's notes become a `Y.Text`;
     - the host keeps the authoritative `Y.Doc`;
     - the existing storage (`setMarkdown`, `notes:<fp>`) receives plain Markdown snapshots, debounced. Everything that reads notes today (export, study prompts, MCP, Ask AI's My notes) keeps working unchanged.
   - Yjs is loaded only while a session is active (lazy load, like TinyMDE).
   - If hosting later moves out of Electron (a `noteful serve` CLI), `yrs` (Yjs in Rust, same wire format) slots in there.

3. **Guests render and edit locally; they are not "thin" in the sense of receiving rendered HTML.** **Changed** from "viewers never load the WASM core and only receive rendered Markdown".
   - Guests edit, so they need the raw text and an editor (TinyMDE).
   - Rendering on the host would cost a network round trip for every preview update.
   - The WASM is about 1.5 MB and the service worker caches it.
   - It also lets a guest open a downloaded linked note (PDF, `.noteful`) in their own reader.
   - Guests are thin where it matters: no host document, no host files, no AI access through the host.

4. **Networking lives in the Electron main process, not the core.**
   - The core stays pure.
   - The host adds an opt-in HTTP + WebSocket server in `main.js` (Node `http` + the `ws` package), bound only while sharing.
   - The renderer talks to it over IPC, like the files bridge.
   - Hosting from the web reader alone is not planned: a browser cannot accept connections.

5. **Linked documents are Markdown links with their own scheme, not HTML comments.** **Changed** from an element "like the page markers".
   - Page markers are invisible comments, which is right for them.
   - A linked file should stay meaningful outside NoteComplete: exported notes, GitHub, other editors.
   - See *Linked documents* below.

6. **A link names a document, and pins a version of it by hash.** Each linked document has:
   - a stable random id (it never changes);
   - the SHA-256 of its current shared version.

   A plain content hash alone would turn every edit into a different link. With the version hash:
   - the host serves only files that were explicitly linked, by id and version: never by path, never a directory;
   - anyone can check what they received;
   - a copy already on the device is recognised by its hash;
   - a changed copy is detected by its hash no longer matching (see *Changed copies*).

7. **Each device binds a link to its own copy, like a symlink.** The link in the shared Markdown is the same for everyone. Which local file it opens is stored per device, outside the notes, so one person's paths never leak into the shared text.

## Linked documents

### In the Markdown

```markdown
[Tema 2 · apuntes.pdf](notecomplete-doc:d-7Kq2xW9fLm3?v=sha256-9f86d081884c7d65…&name=Tema%202%20%C2%B7%20apuntes.pdf&size=3355443&type=application/pdf)
```

- Scheme: `notecomplete-doc:`, then the document id (`d-` + 12 random base62 characters).
- Query:
  - `v`: the shared version, `sha256-<64 hex>`;
  - `name`, `size` (bytes) and `type` (MIME), so the chip can be drawn before anything is downloaded.
- When the shared version changes, the host rewrites `v` (and `size`) in the text. Everyone's chip then knows a newer version exists.
- Outside NoteComplete it reads as a normal link with the file's name.
- The core's `safe_url` gains this scheme (it already allows `#`, http(s), mailto and relative paths). A Rust test shows that other unknown schemes are still blanked.
- `markdown_export` keeps it as written.

### How it shows

- A chip with a type badge (PDF, Noteful, Text…), the name, the size, and a state:
  - **On this device**: opens the bound copy.
  - **Not on this device**: "Download…" (see *Opening a link on a device without the file*).
  - **Newer shared version** or **Your copy changed**: shown on the chip (a dot and a short label); clicking opens the comparison (see *Changed copies*).
- The host also has *Unlink* (removes the registry entry; the text is kept until deleted).
- In the TinyMDE editor the line shows as a chip, like page markers (`markLines` gains a second pattern). In Preview it is a rendered chip.

### Opening a link on a device without the file

Clicking a chip whose document is not bound on this device opens a small prompt: name, size, type, and where it can come from.

- **Download from the host**: when a session with that document is reachable.
- **From Google Drive**: when the link's registry entry has a Drive id and this device is signed in.
- **Locate on this computer…**: pick a file you already have. Its hash is checked:
  - if it matches, it is bound straight away;
  - if not, it is treated as a changed copy (see below) and the comparison opens.
- **Already here**: before asking, the library is searched for a file with the same hash (Recent, kept Drive copies, opened folders). A match is offered as "Use the copy you already have".

After a download:
- the file is kept like a Drive copy (library entry, cover, Recent);
- its SHA-256 is checked;
- the link is **bound** to it on this device, in settings: `bind:<document id>` → `{ entryKey or path, hash at binding, size, modified time }`.

From then on the chip opens that copy, like a symlink to it. If the bound file is moved or deleted, the binding is dropped and the chip returns to "Not on this device" (with "Locate…" to point it at the new place).

### Changed copies and per-page merge

A bound copy can drift from the shared version in two ways. Checks are cheap: size and modification time first, the hash only when those changed.

| Shared version (`v`) | Your copy (vs. hash at binding) | What clicking the chip does |
| --- | --- | --- |
| same | same | Opens your copy. |
| same | **changed** | Opens your copy; the chip says *Your copy changed*. The host can share it as the new version; a guest can *Propose my version* when the host allows it (Phase 7). |
| **newer** | same | Offers *Get the new version* (download, rebind; the old copy is kept as a previous version) or *Compare first*. |
| **newer** | **changed** | Opens the comparison: both changed. |

**The common starting version.** When a copy is bound, the version it was downloaded or located as (the *base*) is kept: as the previous version in the library, or just its page hashes for large files.
- Comparing three ways (base → mine, base → shared) tells what each side did: a page *added* by one side, *removed* by one side, or *changed* by one side.
- A two-way diff cannot tell "you added this page" from "they deleted it".
- Without a base (a file located by hand that never matched), the comparison falls back to two ways, and every difference is a choice.

**Only additions: ask to keep both.** If neither side removed or changed a base page, and one or both only added pages (or, for text, only added lines), there is nothing to choose page by page. A short prompt comes first instead of the full window:
- one side added: "The shared version adds 3 pages and changes nothing in yours. Keep both?";
- both sides added, in different places: "You added 2 pages and the shared version added 3, nothing removed or changed. Keep both?".

The answers:
- **Keep both** (default): the combined copy holds every page in base order, each addition where its side put it. Two additions at the same spot go mine first, then shared; any other order is fixed afterwards with *Reorder pages* (a general reader feature, see below).
- **Compare first**: the full per-page window.
- **Keep mine only**.

**The comparison** is the window made for Drive versions (`versions.js`):
- two side workers, the `pageDiff` page alignment (LCS), side-by-side page images;
- labels become *Your copy* / *Shared version*.

It grows from whole-file choices into **per-page choices**. Pages only one side touched come preselected with that side's change; only pages both sides changed (conflicts) start without a choice:
- **Changed** page (a pair): *Keep mine* / *Take shared* / *Keep both* (both pages, mine first; reorder them afterwards if needed).
- **Only in mine**: *Keep* / *Drop*.
- **Only in shared**: *Add* / *Skip*.
- *Keep all mine* / *Take all shared* buttons for the whole list. The unchanged pages are not listed.
- **Save merged copy** builds the result, saves it as the new local copy (the previous one is kept as a version) and rebinds the link to it.

The binding records which shared version the merge started from. The chip then shows *Your copy changed* rather than asking again for the same shared version.

**What can be merged page by page:**
- **`.noteful` / NoteComplete notes**: pages with their ink, text, images, PDF backgrounds and layers. This needs a new core operation: a document made from chosen pages of two documents, with their resources (PDFs, images) brought along, built on the insert-pages and native-export code that exists.
- **PDF**: pages copied from either file into a new PDF. Needs a page-copying PDF crate (`lopdf`) in the core; `pdf-writer` only writes new content.
- **Text, Markdown and HTML**: the same window shows line hunks instead of pages (a line diff, e.g. the `similar` crate in the core), with the same three choices per hunk.
- **Anything else** (images, unknown files): whole-file choices only (*Keep mine* / *Take shared* / *Keep both*), as today.

Study material, notes and recordings tied to the old copy's fingerprint are carried to the merged copy (`carryStudy`), as when saving an edited file.

**Page order after a merge.** The merge never asks where each page should go. *Keep both* puts mine first, and anything else is fixed in the reader with **Reorder pages**, a general feature for every note, not only merged ones (owner's decision, 2026-10-29; see `REQUESTS.md`, *Future: pages*). Reordering also renumbers the page references held by study material and notes, so a merged copy can be rearranged freely.

### "Link document…" button

- **Where**: a new button in the notes editor's toolbar (TinyMDE command bar, after Link / Image): a paperclip icon titled *Link document…*. Also in the notes panel head next to *+ Page*, and as Edit → Link document… in the menu bar.
- **Picking a file**: the system file picker (`pickFiles` bridge); a document from the side list or Recent; or dragging a file onto the editor.
- **What it does**:
  1. hashes the file (WebCrypto SHA-256, streamed for big files);
  2. gives it a new document id and registers it in the document's link registry;
  3. binds it on this device;
  4. inserts the link at the cursor, on its own line.
- **If it is already linked**: it reuses the existing entry (same hash) and just inserts the link.
- **Without a session**: works too. Links are useful on one device (open the related exam from the notes) and become downloadable as soon as the document is shared.

### Link registry

- Per document (the one whose notes hold the links), in settings as `links:<fingerprint>`: `{ id, hash, name, size, type, source, history }`.
  - `source` is a local path, a library key, or a Drive id (used by *From Google Drive*).
  - `history` lists earlier shared versions (hash, size, date): enough to tell "newer" from "unrelated".
- Bindings (`bind:<document id>`) are per device and never shared, packed or exported.
- Carried with study material (the `STUDY` list in `versions.js`, and on edited-file saves).
- Packed into `.notecomp` as `links.json` (metadata only, never the files).
- **Before serving**, the host re-checks size and modification time, and re-hashes if they changed.
  - A file that changed since it was linked is not served silently as the old version.
  - The host is asked to share the change: *Share as the new version* (new `v`, the text is rewritten, the old hash goes to `history`), or *Compare first* (the per-page comparison against the last shared version).

## Sessions, invites and safety

- **Start**: *Share notes…* in the notes panel head or File → Share notes…
  - The host picks:
    - **Can edit** or **Can view** (view-only guests get read-only updates and presence; edits are rejected by the host, not only hidden);
    - which linked files guests may download (all by default);
    - an optional *Include the note itself* (adds the open document as a linked file, so page markers become usable for guests);
    - *Guests may propose versions* (Phase 7; off by default; the owner is fine either way).
  - The host gets an invite link and a QR code.
- **Invite link**: `http://<host LAN address>:<port>/join#<session id>.<token>`.
  - The token: 128 random bits, one per session (or per guest when *Invite each person separately* is on).
  - It sits in the fragment, so it never reaches proxies or logs. The guest page sends it in the first WebSocket message.
  - It expires when the session ends; the host can revoke a person (their token).
- **Reach**:
  - Local network only by default, on a free port (never 8781, which is taken on the owner's machine).
  - Off-network guests need the host's own tunnel or VPN (Tailscale, a reverse proxy). Documented, not built in.
  - A relay service is out of scope until there is a reason.
- **Transport security**: plain `http`/`ws` on the LAN in the first version, with the token. The UI says it is meant for a trusted network. Tracked for later: TLS with a self-signed certificate whose fingerprint is pinned in the invite link (guests using NoteComplete can check it; browsers would show a warning).
- **Limits**:
  - a maximum number of guests (default 10);
  - message size and update-rate limits;
  - downloads with HTTP range requests, at most a few at a time per guest. There is no file size limit (owner's decision): big notes download in resumable parts, and an interrupted download continues where it stopped;
  - a guest flooding the host is disconnected.
- **What guests can never do**: read any file that was not linked, reach the host's Drive, MCP or AI tools, or change anything but the notes text. A guest's proposed version (Phase 7) is only an upload the host may look at; it never replaces anything without the host choosing pages in the comparison.

## Guest experience

- **In a browser**:
  - the host serves the reader's static files in a **guest mode**: just the notes panel full width, its Preview, the linked documents list, and presence;
  - downloaded files open in the same reader if it can read them (PDF, `.noteful`, HTML, text) or are saved;
  - nothing to install; works on phones.
- **In NoteComplete**:
  - File → Join shared notes… (paste the link) opens the session in a tab;
  - downloaded files go to the library like Drive copies.
- **Your name**:
  - joining shows a name prompt in the middle of the screen: a text field already filled with *Guest N* (the next free number) and selected, so typing replaces it;
  - Enter or the **OK** button (kept, not only Enter) confirms;
  - the name is remembered for the next session and can be changed later from the people list.
- **Presence** (Yjs awareness):
  - each person has a colour;
  - other people's cursors and selections show in the editor, for *Can view* guests too (the owner wants it if it is not hard; it is the same awareness channel, so it costs little);
  - everyone's names sit in the top bar, beside the file name (coloured chips; a few, then "+3");
  - clicking a name scrolls the notes to that person's cursor (and opens the notes panel if it is closed).
- **Leaving**: a guest can keep a copy of the notes (*Save a copy*: a `.md` file, or a note in their library). The host's copy stays the shared one.
- **When the host closes the app**: see *Ending a session*.
- **Disconnects**: edits made while offline merge when the guest reconnects (CRDT). After a long absence the guest is told the session ended, and keeps their unsent text as a copy.

## Ending a session

- **Closing the host's app (or its window or tab) with a session open** asks first:
  - "Notes are shared with 3 people. Closing ends the session for everyone."
  - **Minimize** (default: the session keeps running, the window goes to the taskbar);
  - **End session and close**;
  - **Cancel**.
- **Ending the session** (from that prompt or from *Stop sharing*):
  1. the host sends a *session ending* message to everyone;
  2. each guest saves at once: their editor's text is flushed to the host one last time and also kept as a local copy (*Save a copy*, without asking);
  3. the host waits briefly for those last updates (a couple of seconds at most), writes the final text where notes live, then closes the connections and stops the server.
- **Guests** see "The host ended the session; your copy of the notes was saved" with *Open my copy*.
- A host that disappears without warning (crash, power loss) ends the session too. Guests keep their text as a copy when the connection does not come back.

## Persistence on the host

- The `Y.Doc` is the live state.
- Every couple of seconds while changing, and when the session ends, its plain text is written where notes live today:
  - `setMarkdown` for notes;
  - `notes:<fp>` for every document kind;
  - the save prompt for unsaved projects, as today.
- The Yjs update log is kept as `collab:<fingerprint>` while sessions are planned to resume (same link). It is dropped when the host clears the session.
- **No session**: the notes behave exactly as today. Collaboration code is not loaded.

## Progress plan

Each phase ends with something usable and tested. Tests follow the repo's style:
- unit tests next to the modules;
- headless browser runs over CDP with fake bridges for the UI;
- a Node test that starts the host server and drives two clients.

### Phase 1: linked documents on one device (no network)

- [ ] Core: `notecomplete-doc:` allowed in `safe_url`; Rust tests (allowed, other schemes still blanked, export keeps it).
- [ ] `links.js`:
  - parse and format the link (id, version, name, size, type);
  - the registry (`links:<fp>`) and per-device bindings (`bind:<id>`);
  - hashing (streamed SHA-256);
  - carry with study material and on edited-file saves; `links.json` in `.notecomp`.
- [ ] Notes editor: *Link document…* (toolbar, panel head, Edit menu); drop a file on the editor; chips in the editor and Preview with their state; *Unlink*.
- [ ] A chip without a binding: *Use the copy you already have* (hash search in the library) and *Locate on this computer…* (hash checked).
- [ ] Bound file moved or deleted: back to "Not on this device".
- [ ] Desktop bridge: register linked and bound paths so they may be reopened (same allow-list rules as Recent and folders).
- Done when:
  - a file linked in a note's notes opens from its chip after restarting the app;
  - the link survives export to `.notecomp` and back, and an exported `.md` shows a normal link;
  - on a second profile, *Locate…* binds a copy by hash.

### Phase 2: host server and invites (desktop)

- [ ] `apps/desktop/collab-server.js`:
  - HTTP + WebSocket on a chosen free port, started and stopped from IPC;
  - serves the reader in guest mode;
  - tokens, guest limits and rate limits.
- [ ] *Share notes…* dialog: Can edit / Can view, files allowed, the note itself, link + QR code, list of people with *Remove*.
- [ ] Security tests (Node):
  - no token or a wrong token: refused;
  - path traversal and unlinked hashes: refused;
  - a revoked token is disconnected;
  - a view-only edit is rejected;
  - oversized messages close the connection.
- Done when: a guest in a browser on another LAN device sees the host's notes update live (view-only).

### Phase 3: editing together

- [ ] Yjs (+ `y-protocols`) vendored and lazy-loaded; the host `Y.Doc` per shared document; sync and awareness over the WebSocket.
- [ ] TinyMDE ↔ `Y.Text` binding:
  - local changes become minimal diffs into `Y.Text`;
  - remote updates are applied to the editor keeping the caret and selection;
  - undo stays per person (`Y.UndoManager`).
- [ ] Presence: the name prompt (*Guest N* filled in, Enter or OK), colours, remote cursors (view-only guests too), names in the top bar beside the file name, click a name to scroll to that person's cursor.
- [ ] Ending: the close prompt (Minimize / End session and close / Cancel), the *session ending* message, guests' last flush and local copy, the host's final save.
- [ ] Persistence to `setMarkdown` / `notes:<fp>` (debounced, and when the session ends); `collab:<fp>` update log for resuming.
- [ ] Tests:
  - two headless guests and the host type at the same place at once, and all three end with the same text;
  - a guest offline for a while reconnects and their edits merge;
  - closing the host (End session and close) saves the final text on the host and a copy on every guest;
  - Minimize keeps the session running.
- Done when: three people edit the same notes at once without losing text, and the host's saved notes match.

### Phase 4: downloading linked documents

- [ ] Host serves linked files by document id and version:
  - range requests;
  - re-check before serving; a changed file asks the host to *Share as the new version* or *Compare first*.
- [ ] The *Download from the host* choice in the "Not on this device" prompt; *From Google Drive* when the registry has a Drive id.
- [ ] Guest: download from the chip, progress in the job chip, SHA-256 checked, kept in the library (Recent, cover), bound to the link; later clicks open it.
- [ ] Desktop guests: File → Join shared notes…; downloaded `.noteful` / PDF open in a tab.
- Done when: a guest downloads a 250 MB note (Memoria 1 size) from the host, it verifies, and it opens.

### Phase 5: changed copies, whole-file

- [ ] Change detection on bound copies (size and modification time, then hash) and on the host's linked files; chip states (*Newer shared version*, *Your copy changed*).
- [ ] Host: *Share as the new version* (rewrites `v`, keeps `history`).
- [ ] Guest: *Get the new version* (old copy kept as a previous version, rebind).
- [ ] The comparison window opened from a chip: *Your copy* / *Shared version*, today's whole-file choices (mine / shared / both), study material carried.
- Done when: the table in *Changed copies* behaves as written for a `.noteful` and a PDF, tested with two profiles.

### Phase 6: per-page merge

- [ ] Needs *Reorder pages* (`REQUESTS.md`, *Future: pages*) to be done first or alongside: it is how merged pages are put in order.
- [ ] Core: a document from chosen pages of two `.noteful` documents, resources brought along; Rust tests round-trip it through the native export.
- [ ] Core: PDF page copying (`lopdf`); text line hunks (`similar`).
- [ ] Keep the base version on binding (previous version in the library, or page hashes); three-way page and hunk diff (base → mine, base → shared) with conflicts only where both sides changed the same base page.
- [ ] *Only additions* prompt (Keep both / Compare first / Keep mine only) before the full window.
- [ ] The comparison window gains per-page (or per-hunk) choices, preselected for one-sided changes, *Keep all mine* / *Take all shared*, and *Save merged copy* (old copy kept as a version, rebind, study material carried).
- [ ] Tests:
  - pageDiff-driven choices produce the expected page order for changed, added and removed runs;
  - three-way: additions on both sides in different places give the *Only additions* prompt and a combined copy with every page; a page removed by one side is not offered back as an addition; a page both sides changed is the only open choice;
  - a merged `.noteful` opens in the reader and its native export validates (the `verify_document` check used by the WASM tests);
  - a merged PDF has the chosen pages.
- Done when: two people who changed different pages of the same note each end with a copy holding both sets of changes.

### Phase 7: proposing a version back

- [ ] When the host turned on *Guests may propose versions*, a guest with *Can edit* sends their changed copy to the host (upload by hash, resumable, no size limit).
- [ ] The host sees "Version proposed by Ana" on the chip and decides in the per-page comparison which pages become the next shared version.
- [ ] Security tests: uploads refused unless the host allows proposals and the guest can edit; never applied without the host's choice.

### Phase 8: polish and later

- [ ] Page markers for guests: active when the note itself is linked and downloaded (they jump in the guest's copy).
- [ ] Per-guest invites; resume a session with the same link after a host restart.
- [ ] TLS with a pinned self-signed certificate (desktop guests verify it).
- [ ] Optional: a `noteful serve` CLI host using `yrs`, for an always-on machine without the desktop app.
- [ ] Later, if wanted: collaborative study material (shared decks and quizzes). Out of scope until notes collaboration is proven.

## Answered (owner, 2026-10-29)

- **Proposing versions back (Phase 7)**: either way is fine. It is a session option the host turns on (*Guests may propose versions*, off by default); otherwise only the host changes the shared version.
- **Linked file sizes**: no limit. Downloads (and proposed uploads) are resumable instead.
- **Keep both**: mine first. Any other order is set afterwards with *Reorder pages*, a general reader feature (`REQUESTS.md`, *Future: pages*).
- **Guest names**: *Guest N* is filled in; joining shows a name field in the middle of the screen that can be typed over and confirmed with Enter or **OK** (the button stays). See *Guest experience*.
- **Cursors for view-only guests**: yes, if it is not hard (it is not: same awareness channel). Names appear in the top bar beside the file name; clicking one scrolls to that person's cursor.
- **Ending the session**: closing the host's app asks *Minimize* / *End session and close* / *Cancel*. Ending tells everyone to save first. See *Ending a session*.

No open questions left.
