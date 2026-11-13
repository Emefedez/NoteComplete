# Collaborative Markdown notes and drawing tablets

Owner's idea (2026-10-29), polished into a plan. **Status 2026-11-01:** the session layer (Phases 2 and 3: host server, invites, editing together, presence, ending) and **drawing tablet mode** (below) are built and tested in Node and in headless Chromium. Linked documents (Phases 1, 4–7) are not started. Nothing has been tried yet on real phones, tablets or a second computer on a real network; see *Not yet verified*.

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
- **Single device everywhere** (before this work): there was no network layer, no shared session, no presence and no merging of concurrent edits.

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
   - **Built as planned for the notes.** For **ink**, see decision 8: one sync layer (one connection, one hub), but not a CRDT.

8. **Ink is an ordered edit log on the same connection, not a Yjs CRDT.** **Changed** (2026-11-01), because the code shows a better fit:
   - The core's edit history is linear, and new items are named by their place in it (`new:<index>`, `editor.rs`). Erase, adjust, lock and undo all point at those names.
   - A Yjs array of edits orders concurrent inserts deterministically but can still put a late edit *before* ones a copy already applied; every later name would shift and erase/undo would hit the wrong items.
   - Instead the hub numbers every ink edit (`seq`) and sends it to every copy that holds the note, the sender included; each applies them in that order to its own core. Same snapshot + same edits in the same order = the same document, item names and undo. An edit the core refuses is refused by every copy, so they still agree.
   - Undo is the note's shared history, as in the reader today: a tablet's undo undoes the last edit, whoever made it.
   - A copy that drifted anyway is caught: every 100 edits the hub puts a *check* in the edit stream; the host and each tablet answer with the core's `history_digest` (MD5 of the history and undo position) at exactly that point, and a tablet that differs from the host reloads from a snapshot.
   - Edits go through the hub only while a tablet is connected. Without one, the host edits exactly as without a session (no extra round trip).

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

## Drawing tablet mode (built)

A phone or tablet joins a desktop NoteComplete as a drawing surface for the note open in the sharing tab.

- **Pairing**: File → Export and share… → *Share live, or draw on a tablet…* shows a QR code (the tablet link, `http://<LAN address>:<port>/tablet#<session>.<token>`) and a 6-digit code with the address. The device scans the QR with its camera (opens the reader in its browser, served by the computer), or in NoteComplete (app or browser) uses File → *Join as drawing tablet…* and types the address and code.
  - The code lasts 10 minutes and is used up after 5 wrong tries (*New code* makes another). A device that paired with the code receives the tablet token and reconnects with it.
  - Removing a tablet replaces the tablet link and code, so it cannot come back with the old ones.
- **On the device**: the note and a tool dock, nothing else. The dock: pen, highlighter, shapes (their kinds and fill while chosen), tape, text, eraser, move, five colours, three widths, pen pressure on/off, undo, redo, fit width, *new page*, *move the bar to the other side* (remembered), disconnect, and a status dot.
  - **Tape**: while chosen, the pen's colours, widths and pressure give way to the tape's own: strip or rectangle, the tape's colours (its quick-menu palette) and its widths from the tool bar. A drag lays tape on the computer's note; a tap lifts or covers it on the tablet only (a view choice, as on the computer), and the live line drawn meanwhile is dropped on the other screens.
  - **Text**: a tap opens a text box with its format bar. With a finger or stylus the box opens when the tap lifts: phones open the on-screen keyboard only for a focus made during a tap, so a hidden field takes the focus then and hands it to the box. While typing, the box scrolls above the keyboard (the visual viewport), with room added below the pages; tablet mode stops the browser zooming into small text. Tapping elsewhere commits the text to the computer, as on the computer.
  - **New page**: a blank page after the one in view, the same size (the *+* below the last page does the same). The computer and the tablet both rebuild their pages and show the new one. Not on an infinite canvas. Held sideways the dock is a column at the left or right; held upright it is a row at the top or bottom. Until the note is on screen, a loading screen says what it is waiting for (connecting, loading the note) and can cancel.
  - The device zooms and scrolls its own view. Once a stylus has drawn, fingers move the page and two fingers zoom; before that (a phone without a stylus) a finger draws.
  - The device's copy is never kept in its Recent and never marked unsaved: the computer saves the note.
- **On the computer**: the strokes appear while they are drawn (live preview, one message per animation frame with only the new points), then as ordinary edits in its history: saved, exported and undone like its own. Its own view and tools are unchanged; its strokes appear on the tablet.
- **Pen pressure**: a stylus's pressure (0–1) becomes the core's per-point radius (`Line.pressure`, about 0.3–1.7 × half the width). This applies to any stylus in the reader, not only tablets. The Pen's settings can turn it off (*Even width*, remembered per device); strokes are then saved without pressure.
- **Opening another note** on the computer reloads the tablet with it; closing it shows *Waiting for the computer's note*.
- **Auto-save** follows the host: the host's switch travels as a `settings` message (and in `welcome`), only the host can send it, and guests and tablets show it locked. A guest or tablet keeps an automatic save of the shared note when the session ends or the connection is lost (key `shared:<title>`).
- **Disconnecting** (dock button, closing the page, or *Remove* on the computer) leaves the computer's note as it is; the tablet goes back to Home.
- **Online later**: the client connects to any `ws(s)://…/sync`; a link with `https` becomes `wss`. Running the hub behind a relay or tunnel needs no protocol change.

## Sessions, invites and safety

- **Start**: *Share notes…* in the notes panel head or File → Share notes…
  - The host picks:
    - **Can edit** or **Can view** (view-only guests get read-only updates and presence; edits are rejected by the host, not only hidden);
    - which linked files guests may download (all by default);
    - an optional *Include the note itself* (adds the open document as a linked file, so page markers become usable for guests);
    - *Guests may propose versions* (Phase 7; off by default; the owner is fine either way).
  - The host gets an invite link and a QR code.
- **Built**: one *Share and draw on a tablet…* dialog (desktop app only) with *Guests can edit* / *Guests can view* / *Not shared*, the tablet QR and code, the notes invite link with its QR and *Copy link*, and the people list with *Remove*. Not built yet: choosing linked files and *Include the note itself* (Phase 4), *Guests may propose versions* (Phase 7).
- **Invite link**: `http://<host LAN address>:<port>/join#<session id>.<token>`.
  - The token: 128 random bits, one per session (or per guest when *Invite each person separately* is on).
  - It sits in the fragment, so it never reaches proxies or logs. The guest page sends it in the first WebSocket message.
  - It expires when the session ends; the host can revoke a person (their token).
- **Reach**:
  - Local network only by default, on a free port (never 8781, which is taken on the owner's machine).
  - Off-network guests need the host's own tunnel or VPN (Tailscale, a reverse proxy). Documented, not built in.
  - A relay service is out of scope until there is a reason.
- **Transport security**: plain `http`/`ws` on the LAN in the first version, with the token. The UI says it is meant for a trusted network. Tracked for later: TLS with a self-signed certificate whose fingerprint is pinned in the invite link (guests using NoteComplete can check it; browsers would show a warning).
- **Limits** (built: guest/tablet limit, 2 MB per message from guests and tablets, a token-bucket rate limit, a 10-second hello timeout; downloads are Phase 4):
  - a maximum number of guests (default 10);
  - message size and update-rate limits;
  - downloads with HTTP range requests, at most a few at a time per guest. There is no file size limit (owner's decision): big notes download in resumable parts, and an interrupted download continues where it stopped;
  - a guest flooding the host is disconnected.
- **Edits from tablets and guests who draw** (`TABLET_OPS` in `collab-hub.js`): draw (pen, highlighter, shapes, tape), erase, undo, redo, typed text (`image` holding text only, `editText`, `remove`) and blank pages (`insertPages` without a PDF). Pictures, PDFs, handwritten Markdown, page sizes, layers and locks stay the host's; the hub refuses them with *Not allowed*.
- **What guests can never do**: read any file that was not linked, reach the host's Drive, MCP or AI tools, or change anything but the notes text. A guest's proposed version (Phase 7) is only an upload the host may look at; it never replaces anything without the host choosing pages in the comparison.

## Online access (built)

For notes guests on other networks, the host can turn on **online access** in the sharing dialog. It works like VS Code's port forwarding:
- The desktop app starts a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`). No account is needed.
- Cloudflare gives a temporary `https://….trycloudflare.com` address. Guests use `wss://` through it, so the traffic is encrypted between them and Cloudflare.

How it is limited (`apps/desktop/tunnel.js`, `collab-server.js`, `collab-hub.js`):
- **Separate invite.** The online link carries its own guest token. It is renewed each time online access starts. Turning it off revokes it and disconnects everyone who joined that way. Stopping the session stops the tunnel.
- **Guests and tablets, each with their own link.** A connection counts as remote unless it names this computer by its loopback or LAN address and carries no Cloudflare headers. Remote connections may only join with an online token: the guest link (when the session has notes) or the online drawing-tablet link, so a tablet can skip the local network. The host token, the local tablet tokens and the 6-digit code are refused over the tunnel. A remote tablet that is removed renews the online tablet token. While online access is off, remote connections are closed before any message. Guests keep the session's edit or view-only setting: they follow the whole note live (pages, ink and notes), and draw on it only when the session is *Guests can edit*.
- **Pinned binary.** `cloudflared` is downloaded once into the app's data folder. It is pinned to one release (2026.9.1), checked against SHA-256 hashes written in the code, and re-checked before every start.
- **No uptime promise.** Quick tunnels are Cloudflare's free testing service, with no uptime guarantee. If the tunnel stops, the dialog says so and the link stops working.

Tested with a stand-in `cloudflared` and simulated Cloudflare requests (`collab-server.test.mjs`, `tunnel.test.mjs`). Not yet verified with a real tunnel: the development container cannot reach Cloudflare.

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

## How it is built

- `apps/desktop/collab-hub.js`: the session (tokens, pairing code, roles, peers, the notes `Y.Doc` and awareness, the ink order and its log, snapshots, ending). Pure: no sockets, so a relay can run it later.
- `apps/desktop/collab-server.js`: HTTP for the reader's own files (`/join`, `/tablet`) and the `/sync` WebSocket (`ws`), on a free port, started from `main.js` over IPC (`notecompleteCollab` in `preload.cjs`). Loaded only with the first session.
- `apps/reader/sync.js`: the client (reconnects with back-off, ordered ink queue, snapshots, notes CRDT, digest check). `apps/reader/collab.js`: dialogs, presence, guest mode, tablet mode, live strokes. Both load only when a session starts; Yjs (vendored by `tools/build_web.py`) only for notes, never on tablets.
- `app.js`: every edit goes through `mutate()` (the engine directly, or the shared order while a tablet is connected); `applyShared` applies others' edits and redraws only the page they touch.
- Core: `Editor::history_digest` (`history_digest` in WASM, `digest` in the worker).
- Wire: JSON text frames `{t: …}`; binary frames `0` y-sync, `1` awareness, `2` snapshot (header length, JSON header, project). A joiner that can unzip (`DecompressionStream`) says `accept: ['gzip']` in its hello and gets the project gzipped (`enc: 'gzip'` in the header); others get it plain. A joiner back after a dropped connection sends `have: {session, gen, seq}`; when the hub's log still holds every edit since, the welcome says `resumed` and only those edits follow, not the whole note.

## Joining speed

A device joining from the QR code, the code or a link loads the whole app from the computer, then the note. On a busy Wi-Fi this took from 15 to 30 seconds per join, and a minute or more of downloading in the background. The causes, all measured with `node tools/join_bench.mjs`:

- **The app was downloaded again on every join.** The sharing server sent `Cache-Control: no-store`, and the service worker fetched every file from the network first: about 8 MB for each visit (the 2.6 MB engine, 3 MB of pdf.js, the app).
- **Nothing was compressed**, though the engine, pdf.js, the app and the note's snapshot (JSON, with its PDF in base64) shrink to a quarter or a third.
- **The service worker downloaded 52 MB at install** (speech and text recognition engines, Office readers, PDF fonts and character maps) on secure origins (the online link, the website), while the note was loading.
- Not causes: the snapshot was asked for once, the host answered in about 0.1 s, there were no resync loops and no waits from `RETRIES`; `ws` turns Nagle off. The port was already the same in every session (41237) unless it was taken.

What changed:

- `collab-server.js` sends the reader's files with an `ETag`, `Last-Modified` and `Cache-Control: no-cache`: the browser keeps them and asks each time (a 304, no bytes), so a rebuilt app still arrives. Text and WebAssembly go gzipped (brotli where the browser offers it, which Chromium does only over https), compressed once and kept in memory; the app shell is compressed when sharing starts. When 41237 is taken, one of the next nine ports, so the address (and the browser's cache for it) usually stays the same.
- `sw.js`: `precache.json` (`tools/build_web.py`) lists every file with a hash of its contents and the *shell* to cache at install (the app, the engine, pdf.js, the sharing and notes libraries: 7.6 MB). A cached file is used while its hash is current; the manifest is read again on each page load. Engines a feature loads when used (speech, text recognition, Word and spreadsheet readers, math, Dark Reader, PDF fonts, character maps and decoders) are cached the first time. On `/join` and `/tablet` the service worker registers once the note is open. `tools/serve_web.mjs` rewrites the hashes as files change, so edits show without a rebuild.
- The hub gzips the snapshot once for every joiner that can unzip it; a reconnecting joiner gets only the edits it missed.

Measured with Playwright and Chromium: a host with the note open, a tablet joining in a fresh browser (cold) and again in the same browser (warm), through a throttled link in the bench (both directions, 20 ms round trip, flow control like TCP; it slows the page's files and the WebSocket alike). Chromium's own throttling (`Network.emulateNetworkConditions`, `--cdp`) also slows WebSocket frames in this version. *LAN* is `http://<address>:<port>` (not a secure context: no service worker), as a phone that scans the QR code sees it; *secure* is a loopback alias, so the service worker runs as behind the online link. Time until the first page is drawn, and MB downloaded until the device is idle (the service worker's install included):

| Link | Note | Origin | Cold: drawn | Cold: MB | Warm: drawn | Warm: MB |
|---|---|---|---|---|---|---|
| 20 Mbit/s | Practice book (3.5 MB) | LAN (http) | 5.0 s → 3.0 s | 10.5 → 4.1 | 5.1 s → 2.6 s | 10.5 → 2.2 |
| 20 Mbit/s | Practice book (3.5 MB) | secure | 6.4 s → 3.2 s | 62.7 → 4.2 | 5.2 s → 2.2 s | 10.5 → 2.2 |
| 20 Mbit/s | Examen (1.1 MB) | LAN (http) | 4.3 s → 2.1 s | 8.2 → 2.6 | 4.3 s → 1.6 s | 8.2 → 0.8 |
| 20 Mbit/s | Examen (1.1 MB) | secure | 5.0 s → 2.7 s | 60.4 → 2.8 | 4.2 s → 1.4 s | 8.2 → 0.7 |
| 5 Mbit/s | Practice book (3.5 MB) | LAN (http) | 17.6 s → 7.3 s | 10.5 → 4.1 | 17.4 s → 4.9 s | 10.5 → 2.2 |
| 5 Mbit/s | Practice book (3.5 MB) | secure | 20.2 s → 7.0 s | 62.7 → 4.2 | 17.5 s → 4.7 s | 10.5 → 2.2 |
| 5 Mbit/s | Examen (1.1 MB) | LAN (http) | 13.8 s → 5.0 s | 8.2 → 2.6 | 13.8 s → 2.4 s | 8.2 → 0.8 |
| 5 Mbit/s | Examen (1.1 MB) | secure | 15.9 s → 4.6 s | 60.4 → 2.8 | 13.8 s → 2.2 s | 8.2 → 0.7 |

Before, a cold join on a secure origin kept downloading for 26 s (20 Mbit/s) or 100 s (5 Mbit/s) after the page was drawn. Snapshots: 3.51 → 2.17 MB (Practice book), 1.10 → 0.72 MB (Examen). Guests take up to a second longer than tablets (they also load the notes editor). A warm join is now mostly the snapshot itself.

## Tests

- `cargo test`: replicas loaded from one project that apply the same edits (pressure, erase, undo, redo) agree on views and digest.
- `node --test apps/desktop/collab-server.test.mjs`: the real server with host, guests and tablets: refused/expired invites and codes, second host, full session, oversized messages and floods; snapshot join; concurrent edits from host and tablet in one order; refused edits; live strokes; the digest check (asked in the edit stream, so it holds while edits keep coming) repairing a drifted copy; a new note reloading the tablet; removed tablets; three people typing at once; presence and cursors; a guest offline and back; view-only edits dropped; ending with the guests' last text; the host disappearing.
- The same file: the reader's files gzipped or brotli-compressed by what the browser accepts, kept with an `ETag` and answered with 304; snapshots gzipped for joiners that can unzip them and plain for others; a joiner back after a dropped connection gets only the edits it missed, and the whole note when the host opened another meanwhile.
- `node tools/site_e2e.mjs`: also the service worker: the shell cached at install, the engines not; a second visit takes the app from the cache; offline it still opens.
- `node tools/join_bench.mjs`: join timings and bytes (see Joining speed).
- `node --test apps/reader/sync.test.mjs`: minimal text diffs, emoji, caret mapping through remote edits, snapshot framing.
- `node tools/collab_e2e.mjs` (after a web build, with Playwright): host, tablet (touch + pen with pressure via CDP) and guest in Chromium: code pairing, live stroke, pressure stroke saved on the host, highlighter, eraser, undo, host strokes on the tablet, tape (its colour and width, laid on the host, a tap lifting it on the tablet only), text typed with a finger tap (kept above a stand-in keyboard, committed to the host), a new page (on both, the same size), pinch zoom on the tablet only, loading screen gone once loaded, dock side and orientation (row upright, column sideways), pressure switch, phone width, guest name prompt, typing, chips and cursors, disconnect, ending with the guest's copy.

## Not yet verified

- [!] Real devices: an Android or iOS phone/tablet in the installed app and in its browser, with a real stylus (pressure range, palm/finger handling), on a real Wi-Fi network; a second computer as a notes guest.
- [!] Text on a real tablet: that the keyboard opens from a tap (iOS Safari and Android Chrome) and that the box stays above it. Tested only with a stand-in for the visual viewport in headless Chromium.
- [!] The installed apps' network settings: Android now allows cleartext (needed for `ws://<LAN address>`), iOS allows local networking and asks for the local network permission. Neither has been built and tried.
- [!] The packaged desktop app: the server serves the staged reader from inside the package; the window close prompt; firewalls prompting on first listen (Windows, macOS).
- [!] Very large notes on a tablet: the snapshot is the whole project (source included), so a 250 MB note sends ~330 MB and needs that much memory on the device while it loads.
- Undo on the tablet is the shared history's (it can undo the computer's last edit). Per-person ink undo would need per-author history in the core.

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

- [!] `apps/desktop/collab-server.js`:
  - HTTP + WebSocket on a chosen free port, started and stopped from IPC;
  - serves the reader in guest mode;
  - tokens, guest limits and rate limits.
- [!] *Share notes…* dialog: Can edit / Can view, link + QR code, list of people with *Remove*. (Files allowed and the note itself: Phase 4.)
- [D] Security tests (Node), except path traversal of linked files (Phase 4); reader-file traversal is tested:
  - no token or a wrong token: refused;
  - path traversal and unlinked hashes: refused;
  - a revoked token is disconnected;
  - a view-only edit is rejected;
  - oversized messages close the connection.
- Done when: a guest in a browser on another LAN device sees the host's notes update live (view-only).

### Phase 3: editing together

- [D] Yjs (+ `y-protocols`) vendored and lazy-loaded; the host `Y.Doc` per shared document; sync and awareness over the WebSocket.
- [D] TinyMDE ↔ `Y.Text` binding:
  - local changes become minimal diffs into `Y.Text`;
  - remote updates are applied to the editor keeping the caret and selection;
  - undo stays per person (`Y.UndoManager`).
- [D] Presence: the name prompt (*Guest N* filled in, Enter or OK), colours, remote cursors (view-only guests too), names in the top bar beside the file name, click a name to scroll to that person's cursor.
- [!] Ending: the close prompt (Minimize / End session and close / Cancel), the *session ending* message, guests' last flush and local copy, the host's final save.
- [!] Persistence to `setMarkdown` / `notes:<fp>` (debounced, and when the session ends). Not built: the `collab:<fp>` update log for resuming (Phase 8).
- [D] Tests (Node and headless Chromium; *Minimize* needs the real window):
  - two headless guests and the host type at the same place at once, and all three end with the same text;
  - a guest offline for a while reconnects and their edits merge;
  - closing the host (End session and close) saves the final text on the host and a copy on every guest;
  - Minimize keeps the session running.
- Done when: three people edit the same notes at once without losing text, and the host's saved notes match.

### Drawing tablets (built alongside Phase 3)

- [D] Ink edits through the hub's order; snapshot join; digest check; live strokes; stylus pressure.
- [D] Pairing by QR link or address + 6-digit code; tablet dock (sides, tools including tape and text, colours, widths, undo/redo, fit, new page, disconnect); own zoom and scroll; finger pan and pinch after a stylus.
- [!] On real devices and networks (see *Not yet verified*).

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

- [ ] Needs *Reorder pages* (`REQUESTS.md`, section 3) to be done first or alongside: it is how merged pages are put in order.
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
- **Keep both**: mine first. Any other order is set afterwards with *Reorder pages*, a general reader feature (`REQUESTS.md`, section 3).
- **Guest names**: *Guest N* is filled in; joining shows a name field in the middle of the screen that can be typed over and confirmed with Enter or **OK** (the button stays). See *Guest experience*.
- **Cursors for view-only guests**: yes, if it is not hard (it is not: same awareness channel). Names appear in the top bar beside the file name; clicking one scrolls to that person's cursor.
- **Ending the session**: closing the host's app asks *Minimize* / *End session and close* / *Cancel*. Ending tells everyone to save first. See *Ending a session*.

No open questions left.


## Added in 1.1.34

- **Progress.** A joiner that says `accept: ['gzip', 'chunks']` gets `prepare`, then `begin { id, total, enc, seq, gen, title }`, binary `chunk` frames (`[3][id u32][plain bytes so far u32][gzip data]`) and `end { id }`, then the edits after the snapshot. It reports `progress { stage: receiving | opening | ready, done, total }` (a few times a second) and the hub tells the host `loading { peers }` and `resynced { name }`. Older joiners get one gzipped frame as before. The hub feeds the compressor a megabyte at a time and waits while a joiner's socket holds 8 MB unsent, so the progress is the wire's; above 32 MB only gzip's entropy coding is used (the note's own bytes, in base64, leave nothing for the repeat search: four times faster, 1% larger).
- **Heartbeat and checks.** The reader sends `ping` every 10 s and drops and resumes a connection that has heard nothing for 30 s; the server pings sockets and terminates dead ones; every 10 s, if there were edits, the hub puts a `check` in the edit stream (besides every 100 edits).
- **Text documents.** The host sends `text { name, markdown, content }` for an open `.txt`/Markdown/converted file (up to 4 MB; `tooBig` beyond), and again when it is typed in; the hub forwards it to guests only (and to a guest that joins later) and clears it when the host opens another document. Guests show it read-only.
- **The PIN.** `hello { code, role: 'guest' }` with the pairing code joins as a guest when notes are shared (the welcome carries the guest token to come back with); without a role it joins as a tablet as before.

## Sending study material (1.1.34)

A `sender` is a connection that can only deliver a pack: `hello { code | token, role: 'sender' }` with the PIN, a guest link or an online guest link (a tablet link never makes one). It sends `pack-begin { id, size, parts }` and `pack-part { id, index, data }` (a part is at most 700 000 characters; a pack at most 24 MB and 64 parts; one pack at a time). The hub holds none of it: it passes `pack-begin { id: "<sender>:<id>", from, size, parts }` and the parts on to the host, and the host's `pack-result { id, ok, message }` back to the sender; a sender that leaves early makes the host get `pack-cancel`. The host assembles the parts, reads the pack (`apps/reader/study-pack.js`: `format: 'notecomplete-study'`, decks, quizzes, notes; unknown fields are dropped) and asks before keeping it. Senders get no notes, snapshots or edits, and are not shown as people.

The same pack is a `.ncstudy` file (JSON). On import it is merged into the note with the same fingerprint when the device knows it (decks and quizzes by id, so importing twice adds nothing; notes appended), else kept as `received:<id>` with a `doc:` record, which lists it in Study → All quizzes and decks. The browser can send over `wss://` (an online link) but not over a plain `ws://` LAN address from an https page.

For sharing sessions started in the web app, see [ONLINE-SHARING.md](ONLINE-SHARING.md).

### Receiving by QR code or PIN (1.1.36)

The hub keeps a `send` token (and an `onlineSend` one while online access is on). `…/send#<session>.<token>` is a link that only makes a sender: the same token with `role: 'guest'` or `'tablet'` is refused. The Local tab of the Sharing dialog (and Study → Receive study material…) shows it with a QR code, beside the address and PIN that also make a sender (`hello { code, role: 'sender' }`). The reader opens `/send#…` straight into the Send dialog aimed at that computer, offering the current note's study material, or with no note open the newest note on the device that has some. Where the browser has `BarcodeDetector`, the Send dialog can also scan the QR code itself (`qr-scan.js`).
