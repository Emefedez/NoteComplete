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
| Mobile (Android & iOS/iPadOS) | Web OAuth in Chrome/Safari, or local folder via Dropbox app / Files / Dropsync | Full offline folder access when synced on device. |

## On-device Dropbox installation (all operating systems)

You can also open **Home → Cloud → Dropbox → Setup guide (all devices)** inside NoteComplete for an interactive step-by-step wizard with copyable commands and downloadable auto-setup scripts (`.ps1`, `.command`, `.sh`).

### Windows
1. Install Dropbox via `winget`:
   ```powershell
   winget install --id Dropbox.Dropbox -e
   ```
   (Or download the installer from [dropbox.com/install](https://www.dropbox.com/install).)
2. Sign in and let Dropbox create `%USERPROFILE%\Dropbox`.
3. Right-click your `Noteful` folder → **Make available offline**.
4. Open notes in NoteComplete via **File → Open…** / **Open folder…**, or connect via OAuth under **Home → Cloud → Dropbox**.

### macOS
1. Install Dropbox via Homebrew:
   ```bash
   brew install --cask dropbox
   ```
   (Or download the `.dmg` from [dropbox.com/install](https://www.dropbox.com/install).)
2. Open **Dropbox**, sign in, and allow Finder / File Provider integration.
3. In Finder, open `~/Library/CloudStorage/Dropbox`, right-click `Noteful` → **Make available offline**.
4. Open notes directly in NoteComplete (**Open…** / **Open folder…**) or connect via OAuth.

### Linux
1. Install Dropbox (or `rclone`) for your distribution:
   - **Ubuntu / Debian**: `sudo apt update && sudo apt install -y nautilus-dropbox`
   - **Arch / Omarchy / Manjaro**: `yay -S dropbox` (or `sudo pacman -S rclone && rclone config`)
   - **Fedora**: `sudo dnf install -y nautilus-dropbox` (or `sudo dnf install -y rclone`)
2. Run `dropbox start -i` and sign in in your browser.
3. Open `~/Dropbox/Noteful` in NoteComplete (**Open…** / **Open folder…**) or connect via OAuth.

### Android
- **In-app OAuth (Web)**: Open NoteComplete in Chrome/Brave → **Home → Cloud → Dropbox → Connect Dropbox**.
- **NoteComplete APK**: Install **Dropbox** from Google Play and use **Open… → Dropbox** from the Android file picker, or install **Dropsync / FolderSync** to mirror `/Noteful` to `Internal Storage/Documents/Noteful` for full offline access.

### iOS / iPadOS
1. Install **Dropbox** from the App Store and sign in.
2. Open the Apple **Files** app → tap **⋯** → **Edit** → toggle **Dropbox** ON under Locations.
3. If using Noteful on iPad: **Settings → Auto-Backup → Dropbox** (creates `/Noteful`).
4. In NoteComplete (Safari / PWA): tap **Open… → Browse → Dropbox → Noteful**, or connect via OAuth.
