# Dropbox: browse and download

NoteComplete can list files in your Dropbox, search folders and notes by name, preview covers, queue batch downloads, and open supported files read-only. No files are uploaded, edited, moved or deleted in Dropbox.

## Use it

1. Open **Home → Cloud → Dropbox** (or **File → Import, export and share… → Dropbox**).
2. If the deployment does not have a built-in app key, open **Connection setup** and enter your Dropbox **App key** (never the app secret).
3. Choose **Connect Dropbox** and allow read-only access in the Dropbox window.
4. Browse folders, search names (use **All Dropbox** inside a folder to search everywhere), or open a folder directly by path (for example `/Noteful` or a `dropbox.com/home/…` link) under **Open a folder by path**.
5. Select any supported note, PDF, HTML, text, Office file or image to **Download & open**. Opened files are kept in the local downloads folder shown at the bottom of Home and reused while Dropbox's revision, modification time and size match.
6. Opening a Dropbox note from **Recent** checks Dropbox for a newer revision when connected (or choose **⋯ → Check Dropbox for updates**).

**Disconnect** revokes the active token at Dropbox and clears it from this device while keeping any already-downloaded files in **Recent**.

## Dropbox App Console setup

No Dropbox app key is included in this repository. To configure your own app:

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps) and choose **Create app**.
2. Choose **Scoped access** and either **Full Dropbox** (to browse your existing Noteful backup or other folders) or **App folder**.
3. Under **Permissions**, enable:
   - `account_info.read`
   - `files.metadata.read`
   - `files.content.read`
4. Under **Settings → OAuth 2 → Redirect URIs**, register the exact redirect URI shown under **Connection setup** in NoteComplete:
   - **Web browser**: `<origin>/dropbox-callback.html` (for example `https://example.github.io/NoteComplete/dropbox-callback.html` or `http://localhost:8767/dropbox-callback.html`)
   - **Desktop app (Electron)**: `http://127.0.0.1:53691/dropbox-callback`
5. Copy the public **App key** into `<meta name="dropbox-app-key" content="…" />` in `apps/reader/index.html` before deploying, or paste it into **Connection setup → Dropbox app key**.

## Platform support

| Build | Authentication | Session persistence |
|---|---|---|
| Web browser | OAuth 2 PKCE in a same-origin popup (`dropbox-callback.html`) | Access token in `localStorage` until expiry; refresh token stays in memory for the session. |
| Desktop (Linux, macOS, Windows) | System browser with PKCE and loopback callback (`127.0.0.1:53691`) | Encrypted refresh token in Electron `safeStorage`, shared across all tabs. |
| Mobile WebView | Not yet wired | Use the web or desktop app for Dropbox for now. |
