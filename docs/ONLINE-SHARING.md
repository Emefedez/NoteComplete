# Sharing from the web app, over the internet, for free

**Status: investigation (1.1.34), nothing built yet.** What can be done, what it costs, and what to build first.

## The problem

Online access today is the desktop app's: it starts a local server and a Cloudflare quick tunnel (`cloudflared`, `apps/desktop/tunnel.js`), and people join through the tunnel's address. A browser cannot do that: a web page cannot listen for connections or run `cloudflared`. So a session started in the web app (the hosted reader, or an installed PWA) has no server to join. Anything for it needs one of: a relay in the middle, or a direct browser-to-browser link.

The hub (`apps/desktop/collab-hub.js`) was written for this: it is session logic with no sockets, and the header says it "could run behind a relay later". Everything below keeps it and changes only where it runs and what carries its messages.

## Options

| | A. Relay on Cloudflare (Durable Object) | B. WebRTC, browser to browser | C. Files and links only |
|---|---|---|---|
| Who hosts the hub | A Durable Object, one per session | The host's browser tab | Nobody |
| Server to run | A small Worker, deployed once | A signalling server (or copy-paste codes), and TURN for hard networks | None |
| Free | Yes, within the limits below | Signalling and STUN are free; TURN is the unknown | Yes |
| Works if the host closes the tab | Session ends (the hub needs the host's note) | No | n/a |
| Big notes (150 MB) | Yes: the note is sent in 1 MiB parts already | Yes, in parts of 16–64 KiB | n/a |
| Join from a phone with the app open on its own | Yes | Mostly (symmetric NAT and some mobile networks fail) | n/a |
| Effort | Medium | High | Done: `.ncstudy` files and **Send study material** to a sharing desktop app |

## What the free Cloudflare plan allows (checked against Cloudflare's pages)

- Durable Objects are on the Workers **Free** plan since April 2025, SQLite-backed only. Per day: **100,000 requests, 13,000 GB-s of duration, 100,000 SQLite rows written, 5 GB stored** in total.
- A WebSocket connection counts as one request; incoming messages are billed 20 to 1; **outgoing messages are free**; no duration is billed while an object sits idle (use the Hibernation API).
- WebSocket messages up to **32 MiB** (it was 1 MiB until October 2025). The reader already sends notes in 1 MiB parts.

A 150 MB note joined by one tablet is about 150 incoming parts (8 billed requests). A session with a few people drawing is a few thousand messages an hour. On those numbers the free plan carries many sessions a day; the limit that matters is the **shared** quota if one relay serves every user.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits), [free plan announcement](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/), [32 MiB WebSocket messages](https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/).

## Recommendation: A, with each user able to deploy their own relay

1. **The relay is the hub in a Durable Object.** One object per session room (`/room/<id>`), the same `CollabHub` class, a `transport` per accepted WebSocket. The hub needs `node:crypto` and `node:zlib` (Workers' `nodejs_compat`) and `yjs`; it holds the host's token and the invite tokens in memory and loses them if the object is evicted, which ends the session (as when the desktop host quits).
2. **The host is the web app.** It opens a WebSocket to `wss://<relay>/room/<id>` as `host` (the same `hello`), and shares the same links and PIN, with the relay's address instead of the LAN address. Tablets, guests, text documents, the PIN, study material and the progress bar all work unchanged because they are hub messages.
3. **Who pays the quota.** One relay for everybody is simplest and is shared free capacity; abuse protection means a token per room and a per-room message budget. The alternative is a *Deploy to Cloudflare* button so each user (or school class) runs their own relay on their own free plan; the app then has a setting "Relay address". Both can exist: a default relay, replaceable.
4. **What the web app needs:** a hub transport over a WebSocket client (small), the Sharing dialog's Online tab to offer "Use a relay" when there is no desktop bridge, and the room link format. About a week of work plus testing on a real Worker (`wrangler dev` first).

## Why not WebRTC first

It needs a signalling channel (the free public ones are best-effort) and a TURN relay for networks where direct connections fail, and free TURN allowances are the part I could not verify. It is attractive for two people on friendly networks and weak for a classroom. It fits **Send study material** between two instances better (small payloads, one-off), and could be added there later as a second transport without touching the hub.

## What works today, online

- A desktop NoteComplete with **Online access** on gives a link that works from anywhere: people join it from a browser, and anyone (browser or app) can **send study material** to it.
- A web-app user can open a desktop host's online link (**Join shared notes**) and take part, and can send study material to it.
- What is missing is only the **web app as the host**.
