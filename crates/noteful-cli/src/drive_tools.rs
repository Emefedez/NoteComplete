//! Google Drive tools for `noteful mcp`: sign in, search, list, download,
//! upload, move, rename, trash, find duplicates and merge folders (Noteful
//! backups leave same-name copies and whole duplicate folders behind).
//!
//! The server signs in on its own with the desktop app's OAuth client
//! (`google-desktop-client.json` in NoteComplete's settings folder, or the file
//! `NOTECOMPLETE_GOOGLE_CLIENT` names), loopback redirect + PKCE, and keeps
//! only the refresh token, in `mcp-drive-token.json` (mode 0600) next to it.
//! HTTP goes through `curl`; tokens and secrets travel on its standard input,
//! never on its command line. Nothing is deleted: removal is Drive's trash,
//! which the owner can undo for 30 days, and merging is a dry run unless
//! `apply` is true.
use super::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    io::Read,
    net::TcpListener,
    time::{Duration, Instant},
};

const SCOPE: &str = "https://www.googleapis.com/auth/drive";
const API: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";
const FIELDS: &str = "id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed";
const FOLDER: &str = "application/vnd.google-apps.folder";
const ALL: &str = "supportsAllDrives=true";
const NOT_CONNECTED: &str = "Google Drive is not connected. Call drive_connect (it opens a Google sign-in page in the browser), or run `noteful drive-login` in a terminal.";

#[derive(Default)]
pub(super) struct Drive {
    token: Option<(String, Instant)>,
    // id -> (name, first parent), for paths.
    names: HashMap<String, (String, Option<String>)>,
}

/// NoteComplete's settings folders, most specific first.
fn config_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = std::env::var_os("NOTECOMPLETE_CONFIG") {
        dirs.push(PathBuf::from(dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if parent.file_name().is_some_and(|n| n == "mcp") {
                if let Some(user_data) = parent.parent() {
                    dirs.push(user_data.to_path_buf());
                }
            }
        }
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        dirs.push(PathBuf::from(xdg).join("notecomplete-desktop"));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".config/notecomplete-desktop"));
        dirs.push(home.join("Library/Application Support/notecomplete-desktop"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("notecomplete-desktop"));
    }
    dirs
}

struct Client {
    id: String,
    secret: String,
}

fn client() -> Res<Client> {
    let mut files: Vec<PathBuf> = std::env::var_os("NOTECOMPLETE_GOOGLE_CLIENT")
        .map(|p| vec![PathBuf::from(p)])
        .unwrap_or_default();
    files.extend(config_dirs().into_iter().map(|d| d.join("google-desktop-client.json")));
    for file in files {
        let Ok(raw) = std::fs::read_to_string(&file) else { continue };
        let v: Value = serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", file.display()))?;
        let c = &v["installed"];
        if let Some(id) = c["client_id"].as_str().filter(|id| id.ends_with(".apps.googleusercontent.com")) {
            return Ok(Client { id: id.into(), secret: c["client_secret"].as_str().unwrap_or("").into() });
        }
    }
    Err("No Google OAuth client found. In NoteComplete, connect Google Drive once (it saves google-desktop-client.json), or set NOTECOMPLETE_GOOGLE_CLIENT to the OAuth JSON of a Google Desktop app client.".into())
}

fn token_file() -> PathBuf {
    if let Some(file) = std::env::var_os("NOTECOMPLETE_DRIVE_TOKEN") {
        return file.into();
    }
    let dirs = config_dirs();
    dirs.iter()
        .find(|d| d.join("mcp-drive-token.json").exists())
        .or_else(|| dirs.iter().find(|d| d.join("google-desktop-client.json").exists()))
        .or_else(|| dirs.iter().find(|d| d.is_dir()))
        .or(dirs.first())
        .map(|d| d.join("mcp-drive-token.json"))
        .unwrap_or_else(|| PathBuf::from("mcp-drive-token.json"))
}

fn save_token(v: &Value) -> Res<()> {
    let file = token_file();
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(&tmp)?.write_all(serde_json::to_string_pretty(v)?.as_bytes())?;
    std::fs::rename(&tmp, &file)?;
    Ok(())
}

fn saved_token() -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(token_file()).ok()?).ok()
}

/// Percent-encoding for query strings and form bodies.
pub(super) fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// A Drive query string literal.
pub(super) fn quoted(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn temp_file(tag: &str) -> PathBuf {
    let mut n = [0u8; 8];
    let _ = getrandom::fill(&mut n);
    std::env::temp_dir().join(format!("notecomplete-{tag}-{}", u64::from_le_bytes(n)))
}

struct Reply {
    status: u16,
    location: String,
    body: Vec<u8>,
}

/// Runs curl with `stdin` (headers or a form body) on its standard input.
fn curl(args: &[String], stdin: &[u8]) -> Res<Reply> {
    let mut child = Command::new("curl")
        .args(["-sS", "--max-time", "900", "-w", "\n%header{location}\n%{http_code}"])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Drive tools need curl installed")?;
    child.stdin.take().unwrap().write_all(stdin)?;
    let out = child.wait_with_output()?;
    if !out.status.success() {
        return Err(format!("Google Drive could not be reached: {}", String::from_utf8_lossy(&out.stderr).trim()).into());
    }
    let mut body = out.stdout;
    let cut = |body: &mut Vec<u8>| -> String {
        let at = body.iter().rposition(|&b| b == b'\n').unwrap_or(0);
        let tail = String::from_utf8_lossy(&body[at..]).trim().to_string();
        body.truncate(at);
        tail
    };
    let status = cut(&mut body).parse().unwrap_or(0);
    let location = cut(&mut body);
    Ok(Reply { status, location, body })
}

fn google_error(reply: &Reply) -> String {
    let v: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let message = v["error"]["message"].as_str().or(v["error_description"].as_str()).or(v["error"].as_str());
    format!("Drive answered {}: {}", reply.status, message.unwrap_or("no details"))
}

fn token_request(form: &[(&str, &str)]) -> Res<Value> {
    let body = form.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect::<Vec<_>>().join("&");
    let args = ["-X", "POST", "https://oauth2.googleapis.com/token", "-H", "Content-Type: application/x-www-form-urlencoded", "--data-binary", "@-"].map(String::from);
    let reply = curl(&args, body.as_bytes())?;
    if reply.status != 200 {
        let v: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
        if v["error"] == "invalid_grant" {
            return Err("The saved Google session was revoked or expired. Call drive_connect again.".into());
        }
        return Err(google_error(&reply).into());
    }
    Ok(serde_json::from_slice(&reply.body)?)
}

fn open_browser(url: &str) -> bool {
    let (cmd, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else if cfg!(windows) {
        ("rundll32", vec!["url.dll,FileProtocolHandler", url])
    } else {
        ("xdg-open", vec![url])
    };
    Command::new(cmd).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().is_ok()
}

/// Google sign-in with a loopback redirect and PKCE. `show` receives the
/// sign-in URL (printed by the CLI, sent to stderr by the server).
pub(crate) fn sign_in(browser: bool, show: &dyn Fn(&str)) -> Res<Value> {
    let client = client()?;
    let mut random = [0u8; 80];
    getrandom::fill(&mut random).map_err(|e| format!("No randomness: {e}"))?;
    let state = URL_SAFE_NO_PAD.encode(&random[..32]);
    let verifier = URL_SAFE_NO_PAD.encode(&random[32..]);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let redirect = format!("http://127.0.0.1:{}/oauth2callback", listener.local_addr()?.port());
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=select_account%20consent",
        enc(&client.id), enc(&redirect), enc(SCOPE), state, challenge
    );
    show(&url);
    if browser && !open_browser(&url) {
        show("Could not open a browser; open the address above yourself.");
    }
    let deadline = Instant::now() + Duration::from_secs(240);
    let code = loop {
        if Instant::now() > deadline {
            return Err("Google sign-in timed out (4 minutes). Call drive_connect again.".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.split_whitespace().nth(1).unwrap_or("");
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        let params: HashMap<&str, &str> = query.split('&').filter_map(|kv| kv.split_once('=')).collect();
        let answer = |stream: &mut std::net::TcpStream, status: &str, text: &str| {
            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{text}", text.len());
        };
        if path != "/oauth2callback" || params.get("state") != Some(&state.as_str()) {
            answer(&mut stream, "400 Bad Request", "Invalid authorization callback.");
            continue;
        }
        match params.get("code") {
            Some(code) if !params.contains_key("error") => {
                answer(&mut stream, "200 OK", "NoteComplete's Drive tools are connected. You can close this tab.");
                break code.to_string();
            }
            _ => {
                answer(&mut stream, "200 OK", "Sign-in was cancelled.");
                return Err("Google sign-in was cancelled or declined.".into());
            }
        }
    };
    let code = code.replace("%2F", "/").replace("%2f", "/");
    let mut form = vec![("client_id", client.id.as_str()), ("code", code.as_str()), ("code_verifier", verifier.as_str()), ("redirect_uri", redirect.as_str()), ("grant_type", "authorization_code")];
    if !client.secret.is_empty() {
        form.push(("client_secret", client.secret.as_str()));
    }
    let token = token_request(&form)?;
    if !token["scope"].as_str().unwrap_or("").split_whitespace().any(|s| s == SCOPE) {
        return Err("Google did not grant full Drive access; tick the Drive permission on the consent page.".into());
    }
    let refresh = token["refresh_token"].as_str().ok_or("Google returned no refresh token; try again.")?;
    let access = token["access_token"].as_str().ok_or("Google returned no access token")?;
    // The account, so the agent can say which Drive it is working on.
    let headers = format!("Authorization: Bearer {access}\n");
    let reply = curl(&[format!("{API}/about?fields=user(emailAddress,displayName)"), "-H".into(), "@-".into()], headers.as_bytes())?;
    let about: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
    let saved = json!({"client_id": client.id, "refresh_token": refresh, "account": about["user"]["emailAddress"], "name": about["user"]["displayName"]});
    save_token(&saved)?;
    Ok(json!({"connected": true, "account": saved["account"], "name": saved["name"], "token_file": token_file()}))
}

/// One file as tools report it.
fn entry(v: &Value) -> Value {
    let mut e = json!({"id": v["id"], "name": v["name"]});
    if v["mimeType"] == FOLDER {
        e["folder"] = true.into();
    } else {
        e["mime"] = v["mimeType"].clone();
        if let Some(size) = v["size"].as_str().and_then(|s| s.parse::<u64>().ok()) {
            e["size"] = size.into();
        }
        if v["md5Checksum"].is_string() {
            e["md5"] = v["md5Checksum"].clone();
        }
    }
    e["modified"] = v["modifiedTime"].clone();
    if v["trashed"] == true {
        e["trashed"] = true.into();
    }
    e
}

fn id_arg<'a>(args: &'a Value, key: &str) -> Res<&'a str> {
    let id = args[key].as_str().filter(|s| !s.is_empty()).ok_or(format!("{key} is required"))?;
    if id != "root" && !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("{key} must be a Drive file id (or 'root'), not {id:?}").into());
    }
    Ok(id)
}

impl Drive {
    fn access(&mut self) -> Res<String> {
        if let Some((token, until)) = &self.token {
            if Instant::now() < *until {
                return Ok(token.clone());
            }
        }
        let saved = saved_token().ok_or(NOT_CONNECTED)?;
        let refresh = saved["refresh_token"].as_str().ok_or(NOT_CONNECTED)?;
        let client = client()?;
        let mut form = vec![("client_id", client.id.as_str()), ("refresh_token", refresh), ("grant_type", "refresh_token")];
        if !client.secret.is_empty() {
            form.push(("client_secret", client.secret.as_str()));
        }
        let token = token_request(&form)?;
        let access = token["access_token"].as_str().ok_or("Google returned no access token")?.to_string();
        let life = token["expires_in"].as_u64().unwrap_or(3600).saturating_sub(120);
        self.token = Some((access.clone(), Instant::now() + Duration::from_secs(life)));
        Ok(access)
    }

    /// An authorized request; retries once with a fresh token on 401.
    fn send(&mut self, args: &[String], content_type: Option<&str>) -> Res<Reply> {
        for attempt in 0..2 {
            let mut headers = format!("Authorization: Bearer {}\n", self.access()?);
            if let Some(ct) = content_type {
                headers.push_str(&format!("Content-Type: {ct}\n"));
            }
            let mut all = args.to_vec();
            all.extend(["-H".into(), "@-".into()]);
            let reply = curl(&all, headers.as_bytes())?;
            if reply.status == 401 && attempt == 0 {
                self.token = None;
                continue;
            }
            if !(200..300).contains(&reply.status) {
                return Err(google_error(&reply).into());
            }
            return Ok(reply);
        }
        unreachable!()
    }

    fn json(&mut self, method: &str, url: &str, body: Option<&Value>) -> Res<Value> {
        let mut args = vec!["-X".to_string(), method.into(), url.into()];
        if let Some(body) = body {
            args.extend(["--data-binary".into(), "@-".into()]);
            // The body cannot share stdin with the headers: write it to a file.
            let file = temp_file("body");
            std::fs::write(&file, serde_json::to_vec(body)?)?;
            args.pop();
            args.push(format!("@{}", file.display()));
            let reply = self.send(&args, Some("application/json; charset=UTF-8"));
            let _ = std::fs::remove_file(&file);
            let reply = reply?;
            return Ok(serde_json::from_slice(&reply.body).unwrap_or(Value::Null));
        }
        let reply = self.send(&args, None)?;
        Ok(serde_json::from_slice(&reply.body).unwrap_or(Value::Null))
    }

    fn query(&mut self, q: &str, limit: usize) -> Res<Vec<Value>> {
        let mut files = Vec::new();
        let mut page = String::new();
        loop {
            let mut url = format!(
                "{API}/files?q={}&fields=nextPageToken,files({FIELDS})&pageSize=1000&orderBy=folder,name,modifiedTime&{ALL}&includeItemsFromAllDrives=true",
                enc(q)
            );
            if !page.is_empty() {
                url.push_str(&format!("&pageToken={}", enc(&page)));
            }
            let v = self.json("GET", &url, None)?;
            for f in v["files"].as_array().into_iter().flatten() {
                self.remember(f);
                files.push(f.clone());
            }
            match v["nextPageToken"].as_str() {
                Some(next) if files.len() < limit => page = next.into(),
                _ => break,
            }
        }
        files.truncate(limit);
        Ok(files)
    }

    fn children(&mut self, folder: &str) -> Res<Vec<Value>> {
        self.query(&format!("{} in parents and trashed=false", quoted(folder)), usize::MAX)
    }

    fn remember(&mut self, f: &Value) {
        if let Some(id) = f["id"].as_str() {
            let parent = f["parents"][0].as_str().map(String::from);
            self.names.insert(id.into(), (f["name"].as_str().unwrap_or("").into(), parent));
        }
    }

    fn get(&mut self, id: &str) -> Res<Value> {
        let f = self.json("GET", &format!("{API}/files/{id}?fields={FIELDS}&{ALL}"), None)?;
        self.remember(&f);
        Ok(f)
    }

    /// "My Drive/a/b/name", walking parents (cached).
    fn path(&mut self, id: &str) -> String {
        let mut parts = Vec::new();
        let mut at = Some(id.to_string());
        while let Some(id) = at.take() {
            if parts.len() > 40 {
                break;
            }
            if !self.names.contains_key(&id) && self.get(&id).is_err() {
                parts.push("?".to_string());
                break;
            }
            let (name, parent) = self.names[&id].clone();
            parts.push(name);
            at = parent;
        }
        parts.reverse();
        parts.join("/")
    }

    fn with_path(&mut self, f: &Value) -> Value {
        let mut e = entry(f);
        if let Some(id) = f["id"].as_str() {
            e["path"] = self.path(id).into();
        }
        e
    }

    fn move_to(&mut self, id: &str, from: &str, to: &str) -> Res<()> {
        self.json("PATCH", &format!("{API}/files/{id}?addParents={to}&removeParents={from}&fields=id&{ALL}"), Some(&json!({})))?;
        if let Some(e) = self.names.get_mut(id) {
            e.1 = Some(to.into());
        }
        Ok(())
    }

    fn set_trashed(&mut self, id: &str, trashed: bool) -> Res<Value> {
        self.json("PATCH", &format!("{API}/files/{id}?fields={FIELDS}&{ALL}"), Some(&json!({"trashed": trashed})))
    }

    fn tree(&mut self, folder: &str, prefix: &str, depth: usize, out: &mut Vec<Value>, limit: usize) -> Res<()> {
        for f in self.children(folder)? {
            if out.len() >= limit {
                return Ok(());
            }
            let mut e = entry(&f);
            let name = f["name"].as_str().unwrap_or("");
            let path = if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") };
            e["path"] = path.clone().into();
            out.push(e);
            if f["mimeType"] == FOLDER && depth > 1 {
                self.tree(f["id"].as_str().unwrap_or(""), &path, depth - 1, out, limit)?;
            }
        }
        Ok(())
    }

    fn files_under(&mut self, folder: &str, prefix: &str, recursive: bool, out: &mut Vec<(String, Value)>) -> Res<()> {
        for f in self.children(folder)? {
            let name = f["name"].as_str().unwrap_or("").to_string();
            let path = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            if f["mimeType"] == FOLDER {
                if recursive {
                    self.files_under(f["id"].as_str().unwrap_or(""), &path, true, out)?;
                }
            } else {
                out.push((path, f));
            }
        }
        Ok(())
    }

    fn download(&mut self, args: &Value) -> Res<Value> {
        let f = self.get(id_arg(args, "id")?)?;
        let mime = f["mimeType"].as_str().unwrap_or("");
        if mime.starts_with("application/vnd.google-apps") {
            return Err(format!("{} is a Google {} (no file content to download)", f["name"], mime.rsplit('.').next().unwrap_or("item")).into());
        }
        let name = safe(f["name"].as_str().unwrap_or("download"));
        let out = match args["out"].as_str() {
            Some(p) if Path::new(p).is_dir() => Path::new(p).join(&name),
            Some(p) => PathBuf::from(p),
            None => library().join(&name),
        };
        if out.exists() && args["overwrite"] != true {
            return Err(format!("{} exists; pass overwrite: true or another out", out.display()).into());
        }
        if let Some(dir) = out.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let part = out.with_extension("part");
        let url = format!("{API}/files/{}?alt=media&{ALL}", f["id"].as_str().unwrap_or(""));
        let reply = self.send(&["-L".into(), "-o".into(), part.display().to_string(), url], None);
        if let Err(e) = reply {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        std::fs::rename(&part, &out)?;
        Ok(json!({"path": out, "bytes": std::fs::metadata(&out)?.len(), "file": entry(&f)}))
    }

    fn upload(&mut self, args: &Value) -> Res<Value> {
        let local = PathBuf::from(args["path"].as_str().ok_or("path is required")?);
        let size = std::fs::metadata(&local).map_err(|e| format!("{}: {e}", local.display()))?.len();
        let name = args["name"].as_str().map(String::from).unwrap_or_else(|| local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        let (method, url, meta) = match args["replace"].as_str() {
            Some(_) => {
                let id = id_arg(args, "replace")?;
                let mut meta = json!({});
                if args["name"].is_string() {
                    meta["name"] = name.clone().into();
                }
                ("PATCH", format!("{UPLOAD}/files/{id}?uploadType=resumable&{ALL}"), meta)
            }
            None => {
                let folder = args["folder"].as_str().map(|_| id_arg(args, "folder")).transpose()?.unwrap_or("root");
                ("POST", format!("{UPLOAD}/files?uploadType=resumable&{ALL}"), json!({"name": name, "parents": [folder]}))
            }
        };
        // A resumable session (any size), then the bytes in one PUT.
        let file = temp_file("meta");
        std::fs::write(&file, serde_json::to_vec(&meta)?)?;
        let session = self.send(&["-X".into(), method.into(), url, "-H".into(), format!("X-Upload-Content-Length: {size}"), "--data-binary".into(), format!("@{}", file.display())], Some("application/json; charset=UTF-8"));
        let _ = std::fs::remove_file(&file);
        let session = session?;
        if session.location.is_empty() {
            return Err("Drive did not open an upload session".into());
        }
        let reply = self.send(&["-T".into(), local.display().to_string(), format!("{}&fields={FIELDS}", session.location)], Some("application/octet-stream"))?;
        let f: Value = serde_json::from_slice(&reply.body)?;
        self.remember(&f);
        Ok(json!({"uploaded": self.with_path(&f), "replaced": args["replace"].is_string()}))
    }

    fn duplicates(&mut self, args: &Value) -> Res<Value> {
        let folder = args["folder"].as_str().map(|_| id_arg(args, "folder")).transpose()?.unwrap_or("root");
        let mut files = Vec::new();
        self.files_under(folder, "", args["recursive"] != false, &mut files)?;
        let mut by_md5: BTreeMap<String, Vec<&(String, Value)>> = BTreeMap::new();
        let mut by_name: BTreeMap<String, Vec<&(String, Value)>> = BTreeMap::new();
        for f in &files {
            if let Some(md5) = f.1["md5Checksum"].as_str() {
                by_md5.entry(md5.into()).or_default().push(f);
            }
            by_name.entry(f.0.clone()).or_default().push(f);
        }
        let show = |group: &Vec<&(String, Value)>| group.iter().map(|(path, f)| { let mut e = entry(f); e["path"] = path.clone().into(); e }).collect::<Vec<_>>();
        let same: Vec<Value> = by_md5.values().filter(|g| g.len() > 1).map(|g| json!({"copies": g.len(), "files": show(g)})).collect();
        let wasted: u64 = by_md5.values().filter(|g| g.len() > 1).map(|g| g[0].1["size"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0) * (g.len() as u64 - 1)).sum();
        let clashes: Vec<Value> = by_name
            .values()
            .filter(|g| g.len() > 1 && g.iter().filter_map(|f| f.1["md5Checksum"].as_str()).collect::<HashSet<_>>().len() > 1)
            .map(|g| json!({"path": g[0].0, "versions": show(g)}))
            .collect();
        Ok(json!({"folder": self.path(folder), "files": files.len(), "identical_groups": same.len(), "bytes_in_extra_copies": wasted,
            "identical": same, "same_path_different_content": clashes}))
    }
}

/// What merging a set of folders into one does, built as a plan and then
/// (with `apply`) carried out.
#[derive(Default)]
struct Merge {
    apply: bool,
    dedupe: bool,
    moved: Vec<Value>,
    trashed: Vec<Value>,
    folders_merged: Vec<Value>,
    clashes: Vec<Value>,
    sources_removed: Vec<Value>,
    errors: Vec<String>,
}

impl Drive {
    fn merge(&mut self, args: &Value) -> Res<Value> {
        let target = id_arg(args, "target")?.to_string();
        let sources: Vec<String> = args["sources"].as_array().ok_or("sources is required (folder ids)")?.iter().filter_map(Value::as_str).map(String::from).collect();
        if sources.is_empty() {
            return Err("sources is empty".into());
        }
        for s in &sources {
            id_arg(&json!({ "id": s }), "id")?;
            if *s == target {
                return Err("target is also a source".into());
            }
        }
        for id in sources.iter().chain([&target]) {
            if self.get(id)?["mimeType"] != FOLDER {
                return Err(format!("{id} is not a folder").into());
            }
        }
        // A source that contains the target would move the target into itself.
        let mut at = self.names.get(&target).and_then(|e| e.1.clone());
        while let Some(id) = at {
            if sources.contains(&id) {
                return Err(format!("source {} contains the target", self.path(&id)).into());
            }
            if !self.names.contains_key(&id) {
                self.get(&id)?;
            }
            at = self.names[&id].1.clone();
        }
        let mut m = Merge { apply: args["apply"] == true, dedupe: args["dedupe"] != false, ..Default::default() };
        let target_path = self.path(&target);
        let source_paths: Vec<String> = sources.iter().map(|s| self.path(s)).collect();
        self.merge_level(&target, &sources, &target_path, &mut m)?;
        if args["remove_empty_sources"] != false {
            for (s, path) in sources.iter().zip(&source_paths) {
                self.remove_if_empty(s, path, &mut m);
            }
        }
        let cap = |list: &Vec<Value>| -> Value {
            if list.len() > 400 { json!({"count": list.len(), "first": &list[..400]}) } else { json!(list) }
        };
        Ok(json!({
            "applied": m.apply,
            "target": target_path,
            "sources": source_paths,
            "summary": {"moved": m.moved.len(), "trashed_duplicates": m.trashed.len(), "folders_merged": m.folders_merged.len(),
                "same_name_different_content": m.clashes.len(), "sources_removed": m.sources_removed.len(), "errors": m.errors.len()},
            "moved": cap(&m.moved), "trashed": cap(&m.trashed), "folders_merged": m.folders_merged,
            "same_name_different_content": cap(&m.clashes), "sources_removed": m.sources_removed, "errors": m.errors,
            "note": if m.apply { "Done. Trashed items stay in Drive's trash for 30 days." } else { "Dry run: nothing changed. Call again with apply: true to do it." },
        }))
    }

    fn remove_if_empty(&mut self, folder: &str, path: &str, m: &mut Merge) {
        // In a dry run the plan empties the folder unless something failed.
        let empty = if m.apply { self.children(folder).map(|c| c.is_empty()).unwrap_or(false) } else { m.errors.is_empty() };
        if !empty {
            return;
        }
        if m.apply {
            if let Err(e) = self.set_trashed(folder, true) {
                m.errors.push(format!("trash empty folder {path}: {e}"));
                return;
            }
        }
        m.sources_removed.push(json!({"id": folder, "path": path}));
    }

    /// Merges the contents of `sources` into `target` (one folder level, then
    /// same-named subfolders recursively).
    fn merge_level(&mut self, target: &str, sources: &[String], path: &str, m: &mut Merge) -> Res<()> {
        // (item, parent it is in, already in the target)
        let mut items: Vec<(Value, String, bool)> = self.children(target)?.into_iter().map(|f| (f, target.to_string(), true)).collect();
        for s in sources {
            items.extend(self.children(s)?.into_iter().map(|f| (f, s.clone(), false)));
        }
        let (folders, files): (Vec<_>, Vec<_>) = items.into_iter().partition(|(f, _, _)| f["mimeType"] == FOLDER);
        // Folders: same names merge into one, the target's own first.
        let mut by_name: BTreeMap<String, Vec<(Value, String, bool)>> = BTreeMap::new();
        for item in folders {
            by_name.entry(item.0["name"].as_str().unwrap_or("").into()).or_default().push(item);
        }
        for (name, mut group) in by_name {
            group.sort_by_key(|(_, _, in_target)| !*in_target);
            let (keep, keep_parent, keep_in_target) = group.remove(0);
            let keep_id = keep["id"].as_str().unwrap_or("").to_string();
            let sub = format!("{path}/{name}");
            if !keep_in_target {
                self.step_move(&keep, &keep_parent, target, &sub, m);
            }
            if group.is_empty() {
                continue;
            }
            m.folders_merged.push(json!({"path": sub, "copies": group.len() + 1}));
            let others: Vec<String> = group.iter().map(|(f, _, _)| f["id"].as_str().unwrap_or("").to_string()).collect();
            self.merge_level(&keep_id, &others, &sub, m)?;
            for other in &others {
                self.remove_if_empty(other, &format!("{sub} (copy)"), m);
            }
            // Copies that were not removed are reported by remove_if_empty's absence.
        }
        // Files: identical content (same MD5) keeps one copy, preferring one
        // already in the target, then the newest. Files without an MD5
        // (Google Docs, shortcuts) are never treated as duplicates.
        let mut groups: BTreeMap<String, Vec<(Value, String, bool)>> = BTreeMap::new();
        for (i, item) in files.into_iter().enumerate() {
            let key = match item.0["md5Checksum"].as_str() {
                Some(md5) if m.dedupe => format!("md5:{md5}"),
                _ => format!("item:{i}"),
            };
            groups.entry(key).or_default().push(item);
        }
        let mut kept_names: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for (_, mut group) in groups {
            group.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| b.0["modifiedTime"].as_str().cmp(&a.0["modifiedTime"].as_str())));
            let (keep, keep_parent, keep_in_target) = group.remove(0);
            let name = keep["name"].as_str().unwrap_or("").to_string();
            let file_path = format!("{path}/{name}");
            if !keep_in_target {
                self.step_move(&keep, &keep_parent, target, &file_path, m);
            }
            for (dupe, parent, _) in group {
                let id = dupe["id"].as_str().unwrap_or("").to_string();
                if m.apply {
                    if let Err(e) = self.set_trashed(&id, true) {
                        m.errors.push(format!("trash {file_path}: {e}"));
                        continue;
                    }
                }
                let from = self.names.get(&parent).map(|e| e.0.clone()).unwrap_or_default();
                m.trashed.push(json!({"name": dupe["name"], "id": id, "in": from, "modified": dupe["modifiedTime"], "same_as": file_path, "kept_id": keep["id"]}));
            }
            kept_names.entry(name).or_default().push(entry(&keep));
        }
        for (name, versions) in kept_names {
            if versions.len() > 1 {
                m.clashes.push(json!({"path": format!("{path}/{name}"), "versions": versions}));
            }
        }
        Ok(())
    }

    fn step_move(&mut self, item: &Value, from: &str, to: &str, path: &str, m: &mut Merge) {
        let id = item["id"].as_str().unwrap_or("");
        if m.apply {
            if let Err(e) = self.move_to(id, from, to) {
                m.errors.push(format!("move {path}: {e}"));
                return;
            }
        }
        let from_name = self.names.get(from).map(|e| e.0.clone()).unwrap_or_default();
        m.moved.push(json!({"path": path, "id": id, "from": from_name, "folder": item["mimeType"] == FOLDER}));
    }
}

pub(super) fn tools() -> Vec<Value> {
    let id = |what: &str| json!({"type":"string","description":what});
    vec![
        tool("drive_connect", "Connect NoteComplete's Drive tools to the user's Google Drive: opens Google's sign-in page in their browser and waits (up to 4 minutes) for them to approve full Drive access. The session is kept, so this is needed once. Tell the user a sign-in page is opening before calling it.", json!({"open_browser":{"type":"boolean","description":"Open the browser (default true); the sign-in address is also printed to the server's stderr"}}), &[]),
        tool("drive_status", "Whether Drive is connected, the account, and storage use.", json!({}), &[]),
        tool("drive_search", "Find Drive files and folders by name (exact `name` or `name_contains`), optionally only folders, only inside `parent`, or with a raw Drive query (`query`, Drive API q syntax). Returns ids, paths, sizes, MD5s and modified times.", json!({"name":{"type":"string"},"name_contains":{"type":"string"},"folders_only":{"type":"boolean"},"parent":id("Folder id to search directly inside"),"query":{"type":"string","description":"Extra Drive API q clause, ANDed"},"include_trashed":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":2000,"description":"Default 100"}}), &[]),
        tool("drive_list", "List a Drive folder (default: My Drive root), optionally recursively, with each item's path, id, size, MD5 and modified time.", json!({"folder":id("Folder id, or 'root'"),"recursive":{"type":"boolean"},"max_depth":{"type":"integer","minimum":1,"maximum":20,"description":"Levels when recursive (default 5)"},"limit":{"type":"integer","minimum":1,"maximum":20000,"description":"Most items returned (default 2000)"}}), &[]),
        tool("drive_info", "One Drive file's or folder's metadata and full path.", json!({"id":id("File or folder id")}), &["id"]),
        tool("drive_download", "Download a Drive file (not a Google Doc) to a local path or folder (default: the NoteComplete folder), e.g. to read a note with the other tools.", json!({"id":id("File id"),"out":{"type":"string","description":"Output file or folder"},"overwrite":{"type":"boolean"}}), &["id"]),
        tool("drive_upload", "Upload a local file to Drive: a new file in `folder` (default root), or new content for the existing file `replace` (keeps its id, links and revision history).", json!({"path":{"type":"string","description":"Local file"},"folder":id("Destination folder id"),"name":{"type":"string","description":"Name on Drive (default: the local name)"},"replace":id("Existing file id to update instead of creating a file")}), &["path"]),
        tool("drive_create_folder", "Create a folder in Drive.", json!({"name":{"type":"string"},"parent":id("Parent folder id (default root)")}), &["name"]),
        tool("drive_move", "Move and/or rename a Drive file or folder: `folder` moves it there (out of its current folders), `name` renames it.", json!({"id":id("File or folder id"),"folder":id("Destination folder id"),"name":{"type":"string","description":"New name"}}), &["id"]),
        tool("drive_trash", "Move Drive files or folders to the trash (recoverable for 30 days), or take them back out with restore: true. Never deletes permanently. Confirm with the user before trashing anything they did not ask to remove.", json!({"ids":{"type":"array","items":{"type":"string"},"minItems":1},"restore":{"type":"boolean"}}), &["ids"]),
        tool("drive_duplicates", "Find duplicate files in a Drive folder (default root, recursive): groups with identical content (same MD5) wherever they are, and paths that hold different versions under the same name.", json!({"folder":id("Folder id"),"recursive":{"type":"boolean","description":"Default true"}}), &[]),
        tool("drive_merge_folders", "Merge Drive folders into one. Everything in `sources` moves into `target`; subfolders with the same name merge recursively; files with identical content (same MD5) keep one copy (one already in the target, else the newest) and the others go to the trash; files with the same name but different content are all kept and reported. Emptied source folders are trashed. A DRY RUN unless apply is true: show the user the plan first, then apply.", json!({"target":id("Folder id to keep"),"sources":{"type":"array","items":{"type":"string"},"minItems":1,"description":"Folder ids to merge into the target"},"apply":{"type":"boolean","description":"Carry the plan out (default false: only report it)"},"dedupe":{"type":"boolean","description":"Trash identical copies (default true)"},"remove_empty_sources":{"type":"boolean","description":"Trash source folders left empty (default true)"}}), &["target","sources"]),
    ]
}

impl Server {
    pub(super) fn call_drive(&mut self, name: &str, args: &Value) -> Option<Res<Value>> {
        if !name.starts_with("drive_") {
            return None;
        }
        let text = |v: Value| -> Res<Value> { Ok(json!([{"type":"text","text":serde_json::to_string_pretty(&v)?}])) };
        let d = &mut self.drive;
        Some((|| match name {
            "drive_connect" => {
                d.token = None;
                text(sign_in(args["open_browser"] != false, &|line| eprintln!("notecomplete drive: {line}"))?)
            }
            "drive_status" => {
                let Some(saved) = saved_token() else { return text(json!({"connected": false, "how": NOT_CONNECTED})) };
                let about = d.json("GET", &format!("{API}/about?fields=user(emailAddress,displayName),storageQuota"), None)?;
                text(json!({"connected": true, "account": about["user"]["emailAddress"], "name": about["user"]["displayName"], "storage": about["storageQuota"], "token_file": token_file(), "saved_account": saved["account"]}))
            }
            "drive_search" => {
                let mut q = vec![];
                if let Some(n) = args["name"].as_str() {
                    q.push(format!("name = {}", quoted(n)));
                }
                if let Some(n) = args["name_contains"].as_str() {
                    q.push(format!("name contains {}", quoted(n)));
                }
                if args["folders_only"] == true {
                    q.push(format!("mimeType = '{FOLDER}'"));
                }
                if args["parent"].is_string() {
                    q.push(format!("{} in parents", quoted(id_arg(args, "parent")?)));
                }
                if args["include_trashed"] != true {
                    q.push("trashed = false".into());
                }
                if let Some(raw) = args["query"].as_str() {
                    q.push(format!("({raw})"));
                }
                let limit = args["limit"].as_u64().unwrap_or(100).clamp(1, 2000) as usize;
                let found = d.query(&q.join(" and "), limit)?;
                let list: Vec<Value> = found.iter().map(|f| d.with_path(f)).collect();
                text(json!({"count": list.len(), "files": list}))
            }
            "drive_list" => {
                let folder = args["folder"].as_str().map(|_| id_arg(args, "folder")).transpose()?.unwrap_or("root").to_string();
                let depth = if args["recursive"] == true { args["max_depth"].as_u64().unwrap_or(5).clamp(1, 20) as usize } else { 1 };
                let limit = args["limit"].as_u64().unwrap_or(2000).clamp(1, 20000) as usize;
                let mut out = Vec::new();
                d.tree(&folder, "", depth, &mut out, limit)?;
                text(json!({"folder": d.path(&folder), "id": folder, "count": out.len(), "truncated": out.len() >= limit, "items": out}))
            }
            "drive_info" => {
                let f = d.get(id_arg(args, "id")?)?;
                let mut e = d.with_path(&f);
                e["parents"] = f["parents"].clone();
                text(e)
            }
            "drive_download" => text(d.download(args)?),
            "drive_upload" => text(d.upload(args)?),
            "drive_create_folder" => {
                let name = args["name"].as_str().filter(|n| !n.trim().is_empty()).ok_or("name is required")?;
                let parent = args["parent"].as_str().map(|_| id_arg(args, "parent")).transpose()?.unwrap_or("root");
                let f = d.json("POST", &format!("{API}/files?fields={FIELDS}&{ALL}"), Some(&json!({"name": name, "mimeType": FOLDER, "parents": [parent]})))?;
                d.remember(&f);
                text(json!({"created": d.with_path(&f)}))
            }
            "drive_move" => {
                let id = id_arg(args, "id")?;
                let f = d.get(id)?;
                let mut url = format!("{API}/files/{id}?fields={FIELDS}&{ALL}");
                if args["folder"].is_string() {
                    let to = id_arg(args, "folder")?;
                    let from: Vec<&str> = f["parents"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
                    url.push_str(&format!("&addParents={to}&removeParents={}", from.join(",")));
                }
                let body = match args["name"].as_str() {
                    Some(n) => json!({"name": n}),
                    None if args["folder"].is_string() => json!({}),
                    None => return Err("Give folder and/or name".into()),
                };
                let moved = d.json("PATCH", &url, Some(&body))?;
                d.remember(&moved);
                text(json!({"before": d.with_path(&f), "after": d.with_path(&moved)}))
            }
            "drive_trash" => {
                let restore = args["restore"] == true;
                let mut done = vec![];
                let mut failed = vec![];
                for id in args["ids"].as_array().ok_or("ids is required")?.iter().filter_map(Value::as_str) {
                    match id_arg(&json!({ "id": id }), "id").and_then(|id| d.set_trashed(id, !restore)) {
                        Ok(f) => done.push(entry(&f)),
                        Err(e) => failed.push(json!({"id": id, "error": e.to_string()})),
                    }
                }
                text(json!({if restore { "restored" } else { "trashed" }: done, "failed": failed}))
            }
            "drive_duplicates" => text(d.duplicates(args)?),
            "drive_merge_folders" => text(d.merge(args)?),
            other => Err(format!("Unknown tool {other}").into()),
        })())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_and_forms_are_escaped() {
        assert_eq!(quoted("Noteful's \\ folder"), "'Noteful\\'s \\\\ folder'");
        assert_eq!(enc("a b/ñ&='"), "a%20b%2F%C3%B1%26%3D%27");
        assert!(id_arg(&json!({"id": "1dqfDL6p32ZDO6RYGe6ZY1KsJ1-xQOJcZ"}), "id").is_ok());
        assert!(id_arg(&json!({"id": "root"}), "id").is_ok());
        assert!(id_arg(&json!({"id": "x' or '1'='1"}), "id").is_err());
    }

    #[test]
    fn entries_report_folders_and_sizes() {
        let e = entry(&json!({"id":"a","name":"Memoria 1.noteful","mimeType":"application/octet-stream","size":"1024","md5Checksum":"ff","modifiedTime":"2026-01-01T00:00:00Z"}));
        assert_eq!(e["size"], 1024);
        assert_eq!(e["md5"], "ff");
        let f = entry(&json!({"id":"b","name":"Noteful","mimeType":FOLDER}));
        assert_eq!(f["folder"], true);
        assert!(f.get("size").is_none());
    }

    #[test]
    fn drive_tools_are_listed_and_need_a_connection() {
        let list = tools();
        assert!(list.iter().any(|t| t["name"] == "drive_merge_folders"));
        let mut server = Server::default();
        std::env::set_var("NOTECOMPLETE_DRIVE_TOKEN", "/nonexistent/notecomplete-test-token.json");
        let status = server.call_drive("drive_status", &json!({})).unwrap().unwrap();
        assert!(status[0]["text"].as_str().unwrap().contains("\"connected\": false"));
        let err = server.call_drive("drive_list", &json!({})).unwrap().unwrap_err();
        assert!(err.to_string().contains("drive_connect") || err.to_string().contains("OAuth client"));
        assert!(server.call_drive("note_outline", &json!({})).is_none());
    }
}
