# Google Drive: browse and download

NoteComplete can list files in a Noteful folder and download a file when selected. This is one-way access: no uploads, remote edits, deletes, background mirroring or automatic replacement of the open document. Save/export still creates a local file. iCloud sync is not implemented.

## Use it

1. Open **Home** (or **Drive** in the command bar) and choose **Connect Google Drive**. If the deployment is not configured, enter its public OAuth web client ID under **Connection setup** first.
2. Complete Google's account selection and read-only consent in the sign-in popup.
3. Search for **Noteful** (or your folder's actual name), then choose the matching folder — typing a note's name also lists matching notes directly. Clear the box and search again to list the top level of Drive, where files that do not live inside a folder appear. If several folders match, open the intended one; a folder link/ID can select it precisely.
4. Browse subfolders. While inside a folder the same box filters its children by name. Each card shows its name, modification date and size, plus a cover: Google's thumbnail for PDFs and images, or the note's own embedded first-page JPEG read with HTTP Range requests (the trailer, index and cover only, about 320 KiB, never the whole note). Covers are kept per file version. Opened notes are kept in the downloads folder shown at the bottom of Home and reused while Drive reports the same modification time and size. Select a supported file to **Download & open**. Noteful, `.nfedit`, PDF, PNG, JPEG and WebP use the normal local decoder/import path.
5. Use **Refresh** for the current listing, **Back** for the parent listing, and **Load more** for additional results. Downloads happen only on file selection. Unsupported formats and restricted downloads cannot be opened.

Closing the panel cancels an in-progress listing/download. Opening a downloaded file checks for unsaved edits before replacing the document; declining leaves the current document open. Failed downloads and invalid files do not intentionally replace the current note. Disconnect drops the access token and the displayed listing. Reconnect when the session expires. Disconnect does not revoke the app's grant in your Google Account; permissions can also be removed in Google's account settings.

## Public folder links without sign-in

A folder shared as **Anyone with the link** can be browsed and downloaded without connecting a Google account, if the deployment has a Google API key:

1. In the same Google Cloud project, enable **Google Drive API** and create an **API key**. Restrict it to the Drive API and to the reader's website (HTTP referrer, for example `https://example.github.io/*`). The key is public by design and only reads public files.
2. Set it in `<meta name="google-drive-api-key" content="AIza…">` in `apps/reader/index.html` before deploying. This shared key is the default for every visitor. Anyone can override it on their device with a personal key under **Connection setup → Personal Google API key**. The personal key is saved locally, and clearing it returns to the site's key.
3. Open **Home → Google Drive → Use a public folder link**, paste the folder link and choose **Open folder**. Subfolders and downloads work the same way. Folder search needs sign-in.

Signing in still takes precedence when connected. Without an API key or a sign-in, Google refuses all Drive API requests, so a public link alone cannot be opened.

## Deployment setup

The app owner must configure a Google Cloud project; no client ID is included in this repository.

1. Enable **Google Drive API** in the project.
2. Configure Google's OAuth consent screen with the scope `https://www.googleapis.com/auth/drive.readonly`. In testing mode, add the Google accounts that will test the integration.
3. Create an OAuth client of type **Web application**. Register the reader's exact **Authorized JavaScript origins**, including scheme, hostname and port. For example, a local server at `http://localhost:8767` needs that origin; it is distinct from a `127.0.0.1` URL.
4. Serve the reader over HTTPS, or localhost for development. Permit the Google sign-in popup and the Google Identity script at `https://accounts.google.com/gsi/client`.
5. Set the public client ID in the reader's `<meta name="google-drive-client-id" content="…apps.googleusercontent.com">` in `apps/reader/index.html` before building/deploying. Alternatively, enter it in **Connection setup** for local testing. No client secret, backend or service account is used by this browser flow; the optional API key is only for public folder links.

Google's read-only scope grants access across Drive, not only to one folder. NoteComplete limits its UI to the folder search/browse flow and uses only GET requests to the Drive API. Existing arbitrary files in a folder cannot be listed using per-file grants alone. `drive.readonly` is a restricted scope; public distribution may require Google's OAuth verification. See [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) and the [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Native build configuration

The same folder browser and GET-only Drive client run in the web reader, Electron packages and installed mobile builds. Authentication is platform-specific; Google OAuth client types are not interchangeable.

| Build | Authentication | Configuration |
|---|---|---|
| Web browser | Google Identity Services popup | Web application client ID and exact Authorized JavaScript origin. |
| Linux AppImage / macOS / Windows | System browser, PKCE and a random-port loopback callback | Google OAuth client of type **Desktop app**. |
| Android APK | Native Google Sign-In SDK | Android OAuth client registered for `com.notecomplete.viewer` and the APK certificate's SHA-1; optionally a Web client in the same project. Google Play services are required. |
| iOS installed development build | Native Google Sign-In SDK | iOS OAuth client registered for the app bundle ID and its reversed-client URL scheme. No IPA release workflow is currently provided. |

### Desktop

In Google Cloud create a **Desktop app** OAuth client and download its JSON. A build can bundle that configuration using repository variable `GOOGLE_DESKTOP_CLIENT_ID` and repository secret `GOOGLE_DESKTOP_CLIENT_SECRET`. The packaging workflow writes an ignored `google-desktop-client.json` and includes it in the app. The Desktop client secret is an installed-application value shipped with the binary, not a confidential server credential. Never use a Web client's secret here.

If no configuration was bundled, the first **Connect Google Drive** action opens a native picker for that downloaded Desktop JSON. The validated configuration is saved in Electron's user-data directory; access/refresh tokens are not saved there. To replace a locally imported client, remove `google-desktop-client.json` from that directory and reconnect. A bundled client is updated by rebuilding the app.

Sign-in opens the system browser. The callback listener binds only to `127.0.0.1`, checks a random OAuth state and exchanges a PKCE verifier; it closes after completion, cancellation or timeout. Google credentials are never entered in Electron's WebView. The renderer bridge exposes sign-in/cancel only, not arbitrary URLs, filesystem operations or network requests.

### Android and iOS

Enable Drive API and configure consent/test users in the Google Cloud project used by the native clients. For Android, register both the application ID and the signing certificate SHA-1. The APK workflow prints the preview certificate fingerprint with `keytool`; if you switch to a production signing key, register that certificate too. Wrong package/certificate/client combinations can produce `DEVELOPER_ERROR` or `invalid_client`.

Set repository variable `GOOGLE_WEB_CLIENT_ID` when using a Web client with the Android SDK; the workflow passes it as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. It is a public identifier, not a secret. The SDK requests read-only Drive scope and returns an access token to the already-trusted reader origin. Reloading or dismissing the pending sign-in invalidates late replies. Disconnect signs out of the native SDK as well as clearing the reader token.

For an iOS development build, set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` before prebuild/build and configure `ios.bundleIdentifier` for that client. `app.config.js` adds the Google URL-scheme plugin from the client ID. A full native rebuild is required after adding these settings. **Expo Go cannot include this native module**; use the installed APK/development build or the browser version for Google Drive. Other Expo Go reader features remain available.

Deploy the updated web reader to Android's configured `READER_URL`; an older hosted reader will not know about the new native bridge.

References: [Google native OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app), [native Google Sign-In Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo).

## Troubleshooting `invalid_client` on the web

1. Open **Connection setup** and check the displayed origin. In the Web application OAuth client, add that exact value under **Authorized JavaScript origins**. `http://localhost:8769` and `http://127.0.0.1:8769` are different origins.
2. Copy the **client ID** from that existing Web client. An API key, project ID, client secret, Desktop/Android client ID or example placeholder is not a Web client ID. A deleted client must be replaced.
3. Enable Drive API and add your account as an OAuth test user if the consent screen is in testing. These may cause different errors such as denied access after the client is recognized.
4. Reconnect. The app cannot register a Cloud project or repair its OAuth settings merely from the client ID.

Electron being Chromium-based does not make its custom `notecomplete://` origin a registered HTTPS web client. Desktop packages therefore use the separate native flow above.

## Data and limitations

The client ID and optional folder link are saved locally. Reader access tokens remain in memory and are never placed in URLs or local storage. Native mobile account credentials are managed by the Google SDK; no refresh token is forwarded to the reader. Listings and downloaded Drive bytes are not persistently cached by this feature. Opened documents use the same reader state and local transcript cache as any other file. Google receives authentication and file-list/download requests; note bytes are downloaded directly from Google to the browser, without a NoteComplete server.

The list paginates 100 items at a time. Folder searches may have duplicate names; use a folder link to disambiguate. Shared-drive results depend on account access, and incomplete searches are reported. Resource keys from folder links are retained for API requests. Google Docs/Sheets/Slides export, Drive shortcuts, background synchronization and offline Drive browsing are not implemented. A file's remote name does not bypass normal content validation.

## Validation

Mocked transport and native-bridge tests cover read-only requests, folder query escaping, pagination, exact downloaded bytes, expired tokens, denied downloads, missing files, resource keys and cancellation. Desktop loopback tests verify OAuth state, PKCE exchange and cancellation. Mobile SDK tests check scope and token handling; Android/iOS JavaScript bundles can be built without credentials. A real Google account round-trip still requires the deployment's registered client ID and consent; mocked tests are not proof of a completed live sign-in.
