//! `noteful mcp`: a stdio Model Context Protocol server over the core, so AI
//! agents (Claude Code, Antigravity, Codex) can read notes and make study
//! material with the user's own subscription. Pages, ink and recordings are never
//! modified; files are written only by `extract_resource`, `write_anki_deck` and
//! `write_notes` (the Markdown notes kept in `.notecomp`/`.notepart`/`.nfedit`
//! files), to paths the agent names. Page images and PDF text use poppler (`pdftoppm`, `pdftotext`)
//! and librsvg (`rsvg-convert`) when installed.
use base64::{engine::general_purpose::STANDARD, Engine};
use noteful_core::{
    is_notecomplete, markdown_pages, notecomplete_audio, pack_notecomplete_with,
    unpack_notecomplete, AddedAudio, Editor,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    error::Error,
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::SystemTime,
};

type Res<T> = Result<T, Box<dyn Error>>;
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

pub fn serve() -> Res<()> {
    let mut server = Server::default();
    let mut out = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(message) => server.handle(&message),
            Err(e) => Some(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":e.to_string()}}),
            ),
        };
        if let Some(reply) = reply {
            writeln!(out, "{reply}")?;
            out.flush()?;
        }
    }
    Ok(())
}

#[derive(Default)]
struct Server {
    // The last few opened notes, keyed by path and checked against size and mtime.
    notes: Vec<(PathBuf, u64, Option<SystemTime>, Editor)>,
    pdf_text: HashMap<(PathBuf, String), Vec<String>>,
}

fn library() -> PathBuf {
    if let Some(dir) = std::env::var_os("NOTECOMPLETE_LIBRARY") {
        return dir.into();
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let documents = Command::new("xdg-user-dir")
        .arg("DOCUMENTS")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join("Documents"));
    documents.join("NoteComplete")
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required}})
}
fn tools() -> Value {
    let path = json!({"type":"string","description":"Path to a .noteful or .nfedit file"});
    let page = json!({"type":"integer","minimum":1,"description":"Page number, starting at 1"});
    json!([
        tool("list_notes", "List notes in a folder (default: the NoteComplete downloads folder) with title, page count and size.", json!({"folder":{"type":"string"}}), &[]),
        tool("note_outline", "Title, pages (size, PDF background, ink and typed-text counts, a text snippet) and recordings of a note.", json!({"path":path}), &["path"]),
        tool("page_text", "Typed text and PDF text of one page. Handwriting is not included: use page_image to read it.", json!({"path":path,"page":page}), &["path","page"]),
        tool("page_image", "PNG of one page as the reader draws it: PDF background, handwriting, highlights, images and typed text. Use it to read handwritten notes.", json!({"path":path,"page":page,"width":{"type":"integer","minimum":200,"maximum":2400,"description":"Pixel width (default 1100)"}}), &["path","page"]),
        tool("search_note", "Find words in a note's typed text and PDF text (accent- and case-insensitive). Returns pages and snippets.", json!({"path":path,"query":{"type":"string"}}), &["path","query"]),
        tool("extract_resource", "Write a note's embedded PDFs, recordings or cover image to a folder. Without `index` it lists them.", json!({"path":path,"kind":{"type":"string","enum":["pdf","audio","cover"]},"index":{"type":"integer","minimum":0},"out_dir":{"type":"string"}}), &["path","kind"]),
        tool("read_notes", "The Markdown notes kept with a note (.notecomp, .notepart or .nfedit), with the pages their <!-- page N --> markers tie sections to.", json!({"path":{"type":"string","description":"Path to a .notecomp, .notepart or .nfedit file"}}), &["path"]),
        tool("write_notes", "Add to or replace the Markdown notes kept with a note (.notecomp, .notepart or .nfedit). Pages, ink and recordings are untouched; the previous file is kept as <name>.bak. With `page`, appended text goes under a <!-- page N --> marker so it follows that page in NoteComplete.", json!({"path":{"type":"string","description":"Path to a .notecomp, .notepart or .nfedit file"},"text":{"type":"string","description":"Markdown to write"},"mode":{"type":"string","enum":["append","replace"],"description":"append (default) adds after the existing notes; replace overwrites them"},"page":page}), &["path","text"]),
        tool("write_anki_deck", "Write flashcards as an Anki-importable text file (File → Import in Anki). Refuses to overwrite unless overwrite is true.", json!({"path":{"type":"string","description":"Output .txt or .tsv path"},"deck":{"type":"string"},"cards":{"type":"array","items":{"type":"object","properties":{"front":{"type":"string"},"back":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["front","back"]}},"overwrite":{"type":"boolean"}}), &["path","deck","cards"]),
    ])
}

impl Server {
    fn handle(&mut self, message: &Value) -> Option<Value> {
        let id = message.get("id")?.clone();
        let params = &message["params"];
        let result = match message["method"].as_str().unwrap_or("") {
            "initialize" => {
                let asked = params["protocolVersion"].as_str().unwrap_or("");
                let version = VERSIONS
                    .iter()
                    .find(|v| **v == asked)
                    .unwrap_or(&VERSIONS[0]);
                Ok(
                    json!({"protocolVersion":version,"capabilities":{"tools":{},"prompts":{}},
                    "serverInfo":{"name":"notecomplete","version":env!("CARGO_PKG_VERSION")},
                    "instructions":format!("Reads Noteful notes (.noteful/.nfedit). Notes kept by NoteComplete are in {}. Use note_outline first, page_image to read handwriting, write_anki_deck to save flashcards and write_notes to add Markdown notes.", library().display())}),
                )
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools":tools()})),
            "prompts/list" => Ok(
                json!({"prompts":[{"name":"flashcards","description":"Make Anki flashcards (and optionally a short quiz) from a note's pages","arguments":[{"name":"path","required":true},{"name":"pages","description":"e.g. 3-8; default all"},{"name":"deck","description":"Anki deck name"}]}]}),
            ),
            "prompts/get" => Ok(flashcards_prompt(&params["arguments"])),
            "tools/call" => Ok(
                match self.call(params["name"].as_str().unwrap_or(""), &params["arguments"]) {
                    Ok(content) => json!({"content":content}),
                    Err(e) => {
                        json!({"content":[{"type":"text","text":format!("Error: {e}")}],"isError":true})
                    }
                },
            ),
            other => Err(json!({"code":-32601,"message":format!("Unknown method {other}")})),
        };
        Some(match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => json!({"jsonrpc":"2.0","id":id,"error":error}),
        })
    }

    fn call(&mut self, name: &str, args: &Value) -> Res<Value> {
        let text = |v: Value| -> Res<Value> {
            Ok(json!([{"type":"text","text":serde_json::to_string_pretty(&v)?}]))
        };
        match name {
            "list_notes" => text(list_notes(
                args["folder"]
                    .as_str()
                    .map(PathBuf::from)
                    .unwrap_or_else(library),
            )?),
            "note_outline" => {
                let editor = self.open(args)?;
                let pages = (0..editor.page_order().len())
                    .map(|display| {
                        let v = editor.view(editor.slot(display)?)?;
                        let typed = typed_text(&v);
                        Ok(json!({"page":display + 1,"size":v["size"],"pdf":v["pdf_background"],
                            "ink_and_objects":v["visible_imported"],"typed_text":snippet(&typed, 160),
                            "timed_ink":v["timings"].as_array().map_or(0, Vec::len)}))
                    })
                    .collect::<Res<Vec<_>>>()?;
                let first = editor.view(0)?;
                text(json!({"title":first["title"],"pages":pages,"recordings":first["recordings"]}))
            }
            "page_text" => {
                let (path, display) = (note_path(args)?, page_arg(args)?);
                let v = self.view(args, display)?;
                let pdf = match v["pdf_background"].as_object() {
                    Some(bg) => self.pdf_page_text(&path, bg)?,
                    None => String::new(),
                };
                text(json!({"page":display + 1,"typed_text":typed_text(&v),"pdf_text":pdf}))
            }
            "page_image" => {
                let display = page_arg(args)?;
                let width = args["width"].as_u64().unwrap_or(1100).clamp(200, 2400) as u32;
                let v = self.view(args, display)?;
                let png = self.page_png(args, &v, width)?;
                Ok(
                    json!([{"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"},
                    {"type":"text","text":format!("Page {} of {}", display + 1, v["pages"])}]),
                )
            }
            "search_note" => text(self.search(args)?),
            "extract_resource" => text(self.extract(args)?),
            "read_notes" => text(read_notes(args)?),
            "write_notes" => text(write_notes(args)?),
            "write_anki_deck" => text(write_deck(args)?),
            other => Err(format!("Unknown tool {other}").into()),
        }
    }

    fn open(&mut self, args: &Value) -> Res<&Editor> {
        let path = note_path(args)?;
        let meta = std::fs::metadata(&path)?;
        let (len, modified) = (meta.len(), meta.modified().ok());
        if let Some(i) = self
            .notes
            .iter()
            .position(|(p, l, m, _)| *p == path && *l == len && *m == modified)
        {
            let entry = self.notes.remove(i);
            self.notes.push(entry);
        } else {
            let data = std::fs::read(&path)?;
            let editor = if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("nfedit"))
            {
                Editor::open_project(std::str::from_utf8(&data)?)?
            } else if is_notecomplete(&data) {
                Editor::open_notecomplete(&data)?
            } else {
                Editor::open(&data)?
            };
            self.notes.retain(|(p, ..)| *p != path);
            if self.notes.len() >= 2 {
                self.notes.remove(0);
            }
            self.notes.push((path, len, modified, editor));
        }
        Ok(&self.notes.last().unwrap().3)
    }
    fn view(&mut self, args: &Value, display: usize) -> Res<Value> {
        let editor = self.open(args)?;
        let slot = editor.slot(display).map_err(|_| {
            format!(
                "Page {} does not exist; the note has {} pages",
                display + 1,
                editor.page_order().len()
            )
        })?;
        Ok(editor.view(slot)?)
    }
    fn pdf_file(&mut self, args: &Value, resource: &str) -> Res<PathBuf> {
        let path = note_path(args)?;
        let dir = std::env::temp_dir().join(format!("notecomplete-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        let file = dir.join(format!(
            "{:016x}-{}.pdf",
            hash(&path.to_string_lossy()),
            safe(resource)
        ));
        if !file.exists() {
            let bytes = self.open(args)?.pdf_bytes(resource)?.to_vec();
            std::fs::write(&file, bytes)?;
        }
        Ok(file)
    }
    fn pdf_page_text(&mut self, path: &Path, bg: &serde_json::Map<String, Value>) -> Res<String> {
        let resource = bg["resource_id"].as_str().unwrap_or_default().to_owned();
        let index = bg["page_index"].as_u64().unwrap_or(0) as usize;
        let key = (path.to_path_buf(), resource.clone());
        if !self.pdf_text.contains_key(&key) {
            let file = self.pdf_file(&json!({"path":path}), &resource)?;
            let output = Command::new("pdftotext")
                .args(["-layout", "-enc", "UTF-8"])
                .arg(&file)
                .arg("-")
                .output()
                .map_err(|_| "PDF text needs pdftotext (poppler) installed")?;
            let pages = String::from_utf8_lossy(&output.stdout)
                .split('\u{c}')
                .map(str::to_owned)
                .collect();
            self.pdf_text.insert(key.clone(), pages);
        }
        Ok(self.pdf_text[&key].get(index).cloned().unwrap_or_default())
    }
    // The page SVG from the core, with the PDF page rasterized into its rect, rendered to PNG.
    fn page_png(&mut self, args: &Value, v: &Value, width: u32) -> Res<Vec<u8>> {
        let mut svg = v["svg"].as_str().unwrap_or_default().to_owned();
        let size = [
            v["size"][0].as_f64().unwrap_or(1.),
            v["size"][1].as_f64().unwrap_or(1.),
        ];
        if let Some(bg) = v["pdf_background"].as_object() {
            let rect: Vec<f64> = bg["rect"]
                .as_array()
                .map(|r| r.iter().filter_map(Value::as_f64).collect())
                .unwrap_or_default();
            let [x, y, w, h] = <[f64; 4]>::try_from(rect).unwrap_or([0., 0., size[0], size[1]]);
            let file = self.pdf_file(args, bg["resource_id"].as_str().unwrap_or_default())?;
            let page = bg["page_index"].as_u64().unwrap_or(0) + 1;
            let raster_width = ((width as f64) * w / size[0]).ceil().max(1.) as u32;
            let output = Command::new("pdftoppm")
                .args([
                    "-png",
                    "-singlefile",
                    "-f",
                    &page.to_string(),
                    "-l",
                    &page.to_string(),
                    "-scale-to-x",
                    &raster_width.to_string(),
                    "-scale-to-y",
                    "-1",
                ])
                .arg(&file)
                .output()
                .map_err(|_| "Page images need pdftoppm (poppler) installed")?;
            if !output.status.success() || output.stdout.is_empty() {
                return Err(format!(
                    "pdftoppm failed: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                )
                .into());
            }
            let image = format!("<image x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" preserveAspectRatio=\"none\" href=\"data:image/png;base64,{}\"/>", STANDARD.encode(&output.stdout));
            let marker = "<g data-background=\"true\">";
            if let Some(at) = svg
                .find(marker)
                .and_then(|at| svg[at..].find("</g>").map(|end| at + end))
            {
                svg.insert_str(at, &image);
            }
        }
        let mut child = Command::new("rsvg-convert")
            .args(["-w", &width.to_string(), "-b", "white", "-f", "png"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| "Page images need rsvg-convert (librsvg) installed")?;
        let mut stdin = child.stdin.take().unwrap();
        let writer = std::thread::spawn(move || stdin.write_all(svg.as_bytes()));
        let output = child.wait_with_output()?;
        writer.join().map_err(|_| "rsvg-convert input failed")??;
        if !output.status.success() {
            return Err(format!(
                "rsvg-convert failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )
            .into());
        }
        Ok(output.stdout)
    }
    fn search(&mut self, args: &Value) -> Res<Value> {
        let path = note_path(args)?;
        let terms: Vec<String> = fold(args["query"].as_str().unwrap_or_default())
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        if terms.is_empty() {
            return Err("Empty query".into());
        }
        let pages = self.open(args)?.page_order().len();
        let mut hits = Vec::new();
        for display in 0..pages {
            let v = self.view(args, display)?;
            let mut sources = vec![("text", typed_text(&v))];
            if let Some(bg) = v["pdf_background"].as_object() {
                sources.push(("pdf", self.pdf_page_text(&path, bg).unwrap_or_default()));
            }
            for (source, content) in sources {
                let folded = fold(&content);
                if terms.iter().all(|t| folded.contains(t.as_str())) {
                    let at = folded.find(terms[0].as_str()).unwrap_or(0);
                    // fold keeps one char per char, so char offsets map back to the original.
                    let start = folded[..at].chars().count().saturating_sub(60);
                    let excerpt: String = content.chars().skip(start).take(200).collect();
                    hits.push(json!({"page":display + 1,"source":source,"snippet":excerpt.split_whitespace().collect::<Vec<_>>().join(" ")}));
                }
            }
        }
        Ok(
            json!({"query":args["query"],"hits":hits,"note":"Handwriting is not searched here; use page_image on candidate pages."}),
        )
    }
    fn extract(&mut self, args: &Value) -> Res<Value> {
        let kind = args["kind"].as_str().unwrap_or("");
        let editor = self.open(args)?;
        let first = editor.view(0)?;
        let items: Vec<(String, String)> = match kind {
            "pdf" => {
                let mut ids: Vec<String> = Vec::new();
                for display in 0..editor.page_order().len() {
                    let v = editor.view(editor.slot(display)?)?;
                    if let Some(id) = v["pdf_background"]["resource_id"].as_str() {
                        if !ids.iter().any(|i| i == id) {
                            ids.push(id.to_owned());
                        }
                    }
                }
                ids.into_iter().map(|id| (id, "pdf".to_owned())).collect()
            }
            "audio" => first["audio"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|a| {
                    (
                        a["id"].as_str().unwrap_or_default().to_owned(),
                        a["kind"].as_str().unwrap_or("bin").to_owned(),
                    )
                })
                .collect(),
            "cover" => vec![("cover".to_owned(), "jpg".to_owned())],
            _ => return Err("kind must be pdf, audio or cover".into()),
        };
        let Some(index) = args["index"].as_u64().map(|i| i as usize) else {
            return Ok(
                json!({"kind":kind,"available":items.iter().enumerate().map(|(i, (id, ext))| json!({"index":i,"id":id,"extension":ext})).collect::<Vec<_>>()}),
            );
        };
        let (id, ext) = items
            .get(index)
            .ok_or("No resource with that index")?
            .clone();
        let dir = PathBuf::from(
            args["out_dir"]
                .as_str()
                .ok_or("out_dir is required to write a file")?,
        );
        std::fs::create_dir_all(&dir)?;
        let stem = note_path(args)?
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let target = dir.join(format!("{}-{}.{ext}", safe(&stem), safe(&id)));
        if target.exists() {
            return Err(format!("{} already exists", target.display()).into());
        }
        let bytes = match kind {
            "pdf" => editor.pdf_bytes(&id)?.to_vec(),
            "audio" => editor.audio_bytes(&id)?.to_vec(),
            _ => cover(&std::fs::read(note_path(args)?)?).ok_or("This note has no cover image")?,
        };
        std::fs::write(&target, bytes)?;
        Ok(json!({"written":target}))
    }
}

fn note_path(args: &Value) -> Res<PathBuf> {
    let path = PathBuf::from(args["path"].as_str().ok_or("path is required")?);
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()).into());
    }
    Ok(path)
}
fn page_arg(args: &Value) -> Res<usize> {
    Ok(args["page"]
        .as_u64()
        .filter(|p| *p >= 1)
        .ok_or("page must be 1 or more")? as usize
        - 1)
}
fn typed_text(v: &Value) -> String {
    v["texts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| {
            t["runs"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| r["text"].as_str())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn snippet(text: &str, n: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > n {
        flat.chars().take(n).collect::<String>() + "…"
    } else {
        flat
    }
}
fn safe(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_.+ ".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect()
}
fn hash(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}
/// Lowercase and drop common Latin diacritics, one output char per input char.
fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c => c,
        })
        .collect()
}
/// The note's own first-page image (n:/7/1), as the reader's Home cards use.
fn cover(data: &[u8]) -> Option<Vec<u8>> {
    let package = noteful_core::Package::parse(data).ok()?;
    let meta = package.blocks.iter().find(|b| b.id.starts_with("n:"))?;
    let fields = meta.fields.as_ref()?;
    let links = fields.iter().find(|f| f.tag == 7)?.value.as_fields()?;
    let id = links.iter().find(|f| f.tag == 1)?.value.as_text()?;
    package.resource(id).map(<[u8]>::to_vec)
}

fn list_notes(folder: PathBuf) -> Res<Value> {
    let mut notes = Vec::new();
    for entry in std::fs::read_dir(&folder).map_err(|e| format!("{}: {e}", folder.display()))? {
        let path = entry?.path();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext != "noteful" && ext != "nfedit" {
            continue;
        }
        let meta = std::fs::metadata(&path)?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());
        let summary = if ext == "noteful" {
            peek(&path).ok()
        } else {
            None
        };
        notes.push(
            json!({"path":path,"bytes":meta.len(),"modified_unix":modified,
            "title":summary.as_ref().map(|s| s.0.clone()),"pages":summary.map(|s| s.1)}),
        );
    }
    notes.sort_by(|a, b| {
        b["modified_unix"]
            .as_u64()
            .cmp(&a["modified_unix"].as_u64())
    });
    Ok(json!({"folder":folder,"notes":notes}))
}
/// Title and page count from the index and metadata blocks only.
fn peek(path: &Path) -> Res<(String, usize)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let mut tail = [0u8; 16];
    file.seek(SeekFrom::Start(len.checked_sub(16).ok_or("short file")?))?;
    file.read_exact(&mut tail)?;
    let at = u64::from_be_bytes(tail[4..12].try_into()?);
    let size = u32::from_be_bytes(tail[12..16].try_into()?) as usize;
    let mut read = |offset: u64, n: usize| -> Res<Vec<u8>> {
        let mut buf = vec![0; n];
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut buf)?;
        Ok(buf)
    };
    let index = noteful_core::decode_fields(&read(at, size)?, 0)?;
    let arr = |tag| {
        index
            .iter()
            .find(|f| f.tag == tag)
            .and_then(|f| f.value.as_array())
            .unwrap_or(&[])
    };
    let (keys, offsets, sizes) = (arr(10), arr(11), arr(12));
    let block = |prefix: &str| {
        keys.iter()
            .position(|k| k.as_text().is_some_and(|k| k.starts_with(prefix)))
    };
    let mut title = String::new();
    if let Some(i) = block("n:") {
        let fields = noteful_core::decode_fields(
            &read(
                offsets[i].as_uint().unwrap_or(0),
                sizes[i].as_uint().unwrap_or(0) as usize,
            )?,
            0,
        )?;
        title = fields
            .iter()
            .find(|f| f.tag == 3)
            .and_then(|f| f.value.as_text())
            .unwrap_or_default()
            .to_owned();
    }
    let mut pages = 0;
    if let Some(i) = block("d:") {
        let fields = noteful_core::decode_fields(
            &read(
                offsets[i].as_uint().unwrap_or(0),
                sizes[i].as_uint().unwrap_or(0) as usize,
            )?,
            0,
        )?;
        pages = fields
            .iter()
            .find(|f| f.tag == 2)
            .and_then(|f| f.value.as_fields())
            .and_then(|c| c.iter().find(|f| f.tag == 0))
            .and_then(|f| f.value.as_array())
            .map_or(0, <[_]>::len);
    }
    Ok((title, pages))
}

fn write_deck(args: &Value) -> Res<Value> {
    let path = PathBuf::from(args["path"].as_str().ok_or("path is required")?);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "txt" && ext != "tsv" {
        return Err("Write the deck to a .txt or .tsv file".into());
    }
    if path.exists() && args["overwrite"].as_bool() != Some(true) {
        return Err(format!(
            "{} exists; pass overwrite: true to replace it",
            path.display()
        )
        .into());
    }
    let deck = args["deck"]
        .as_str()
        .filter(|d| !d.trim().is_empty())
        .ok_or("deck is required")?;
    let cards = args["cards"]
        .as_array()
        .filter(|c| !c.is_empty())
        .ok_or("cards must be a non-empty list")?;
    // Anki's text import: tab-separated, HTML allowed, newlines as <br>.
    let cell = |s: &str| {
        s.replace('\t', "    ")
            .replace("\r\n", "<br>")
            .replace('\n', "<br>")
    };
    let mut out = format!(
        "#separator:tab\n#html:true\n#deck:{}\n#tags column:3\n",
        cell(deck).replace("<br>", " ")
    );
    for card in cards {
        let front = card["front"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("every card needs a front")?;
        let back = card["back"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("every card needs a back")?;
        let tags: Vec<String> = card["tags"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|t| t.split_whitespace().collect::<Vec<_>>().join("_"))
            .collect();
        out.push_str(&format!(
            "{}\t{}\t{}\n",
            cell(front),
            cell(back),
            tags.join(" ")
        ));
    }
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, out)?;
    Ok(
        json!({"written":path,"cards":cards.len(),"import":"In Anki: File → Import, choose this file; deck, separator and tags are read from its header."}),
    )
}

/// The Markdown notes of a `.notecomp`/`.notepart` archive or an `.nfedit` project.
fn notes_of(path: &Path, data: &[u8]) -> Res<String> {
    if is_nfedit(path) {
        Ok(Editor::open_project(std::str::from_utf8(data)?)?
            .markdown()
            .to_owned())
    } else if is_notecomplete(data) {
        Ok(unpack_notecomplete(data)?.1)
    } else {
        Err("Notes are kept in .notecomp, .notepart or .nfedit files; a plain .noteful file has none. Save it from NoteComplete as one of those first.".into())
    }
}
fn is_nfedit(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("nfedit"))
}
fn read_notes(args: &Value) -> Res<Value> {
    let path = note_path(args)?;
    let markdown = notes_of(&path, &std::fs::read(&path)?)?;
    let pages: Vec<usize> = markdown_pages(&markdown).iter().map(|(p, _)| *p).collect();
    Ok(json!({"markdown":markdown,"pages_with_notes":pages}))
}
/// The new notes text: appended (under a page marker when `page` is given) or replaced.
fn merged_notes(old: &str, text: &str, mode: &str, page: Option<usize>) -> Res<String> {
    let text = text.trim_end();
    if text.trim().is_empty() {
        return Err("text is empty".into());
    }
    let block = match page {
        Some(p) => format!("<!-- page {p} -->\n{text}"),
        None => text.to_owned(),
    };
    let merged = match mode {
        "replace" => format!("{block}\n"),
        "append" if old.trim().is_empty() => format!("{block}\n"),
        "append" => format!("{}\n\n{block}\n", old.trim_end()),
        other => return Err(format!("mode must be append or replace, not {other}").into()),
    };
    if merged.len() > 8 << 20 {
        return Err("Notes would be too large (limit 8 MB)".into());
    }
    Ok(merged)
}
fn write_notes(args: &Value) -> Res<Value> {
    let path = note_path(args)?;
    let data = std::fs::read(&path)?;
    let mode = args["mode"].as_str().unwrap_or("append");
    let page = match args["page"].as_u64() {
        Some(p) if p > 0 => Some(p as usize),
        Some(_) => return Err("page starts at 1".into()),
        None => None,
    };
    let merged = merged_notes(
        &notes_of(&path, &data)?,
        args["text"].as_str().ok_or("text is required")?,
        mode,
        page,
    )?;
    let out = if is_nfedit(&path) {
        let mut editor = Editor::open_project(std::str::from_utf8(&data)?)?;
        editor.set_markdown(&merged)?;
        editor.save_project()?.into_bytes()
    } else {
        // Repack the same note and recordings with the new notes.
        let (note, _) = unpack_notecomplete(&data)?;
        let title = Editor::open(&note)?.view(0)?["title"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let entries = notecomplete_audio(&data)?;
        let audio: Vec<(AddedAudio, &[u8])> = entries
            .iter()
            .map(|e| (e.audio.clone(), &data[e.offset..e.offset + e.length]))
            .collect();
        pack_notecomplete_with(&note, &merged, &title, &audio)?
    };
    let backup = PathBuf::from(format!("{}.bak", path.display()));
    std::fs::copy(&path, &backup)?;
    let temp = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&temp, out)?;
    std::fs::rename(&temp, &path)?;
    Ok(
        json!({"written":path,"backup":backup,"mode":mode,"notes_characters":merged.chars().count(),
        "reopen":"Reopen the note in NoteComplete to see the change."}),
    )
}

fn flashcards_prompt(args: &Value) -> Value {
    let path = args["path"].as_str().unwrap_or("<note path>");
    let pages = args["pages"].as_str().unwrap_or("all pages");
    let deck = args["deck"].as_str().unwrap_or("NoteComplete");
    json!({"description":"Flashcards from a note","messages":[{"role":"user","content":{"type":"text","text":format!(
        "Make study flashcards from the Noteful note {path} ({pages}).\n\
         1. Call note_outline, then for each page in range call page_text and page_image: the handwriting, highlights and margin notes are the student's own emphasis, so weigh them heavily.\n\
         2. Write concise cards in the note's language: one fact or concept per card, the question on the front, a short answer on the back, a tag with the page (p12). Prefer definitions, comparisons, causes/effects, formulas and worked steps; skip trivia and slide decoration.\n\
         3. Show me the cards grouped by page and ask what to change.\n\
         4. When I confirm, call write_anki_deck with deck \"{deck}\" and a path next to the note. Offer a five-question quiz from the same cards afterwards.")}}]})
}

#[cfg(test)]
mod tests {
    use super::*;
    const EXAM: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../samples/Examen wuolah.noteful"
    );

    #[test]
    fn protocol_lists_tools_and_reports_tool_errors_as_results() {
        let mut server = Server::default();
        let init = server.handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
        assert!(server
            .handle(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .is_none());
        let tools = server
            .handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .unwrap();
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 9);
        let bad = server.handle(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"page_text","arguments":{"path":EXAM,"page":9}}})).unwrap();
        assert_eq!(bad["result"]["isError"], true);
        let outline = server.handle(&json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"note_outline","arguments":{"path":EXAM}}})).unwrap();
        let text: Value =
            serde_json::from_str(outline["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(text["pages"].as_array().unwrap().len(), 3);
        assert_eq!(
            server
                .handle(&json!({"jsonrpc":"2.0","id":5,"method":"nope"}))
                .unwrap()["error"]["code"],
            -32601
        );
    }

    #[test]
    fn decks_escape_cells_and_refuse_overwrites() {
        let dir = std::env::temp_dir().join(format!("nc-deck-{}", std::process::id()));
        let path = dir.join("deck.txt");
        let args = json!({"path":path,"deck":"ACII::Memoria","cards":[{"front":"a\tb","back":"line1\nline2","tags":["p 7"]}]});
        write_deck(&args).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.starts_with("#separator:tab\n#html:true\n#deck:ACII::Memoria\n#tags column:3\n")
        );
        assert!(text.ends_with("a    b\tline1<br>line2\tp_7\n"));
        assert!(write_deck(&args).is_err());
        assert!(write_deck(
            &json!({"path":dir.join("x.csv"),"deck":"d","cards":[{"front":"a","back":"b"}]})
        )
        .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_are_appended_under_page_markers_and_kept_with_the_note() {
        assert_eq!(
            merged_notes("", "hi", "append", Some(2)).unwrap(),
            "<!-- page 2 -->\nhi\n"
        );
        assert_eq!(
            merged_notes("a\n", "b", "append", None).unwrap(),
            "a\n\nb\n"
        );
        assert_eq!(merged_notes("a", "b", "replace", None).unwrap(), "b\n");
        assert!(merged_notes("a", " ", "append", None).is_err());
        assert!(merged_notes("a", "b", "x", None).is_err());
        // A real archive: notes change, the note and a recording survive.
        let dir = std::env::temp_dir().join(format!("nc-notes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let note = std::fs::read(EXAM).unwrap();
        let webm = [0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3];
        let meta = AddedAudio {
            id: "a".into(),
            name: "Take".into(),
            mime: "audio/webm".into(),
            created: 1.0,
        };
        let path = dir.join("n.notecomp");
        std::fs::write(
            &path,
            pack_notecomplete_with(&note, "old", "T", &[(meta, &webm)]).unwrap(),
        )
        .unwrap();
        let args = json!({"path":path,"text":"new","page":1});
        write_notes(&args).unwrap();
        let data = std::fs::read(&path).unwrap();
        let (kept, md) = unpack_notecomplete(&data).unwrap();
        assert_eq!(md, "old\n\n<!-- page 1 -->\nnew\n");
        assert_eq!(kept, note);
        let e = &notecomplete_audio(&data).unwrap()[0];
        assert_eq!(&data[e.offset..e.offset + e.length], &webm);
        assert!(dir.join("n.notecomp.bak").exists());
        assert_eq!(
            read_notes(&json!({"path":path})).unwrap()["pages_with_notes"],
            json!([1])
        );
        assert!(write_notes(&json!({"path":EXAM,"text":"x"})).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn covers_titles_and_folding() {
        let data = std::fs::read(EXAM).unwrap();
        assert!(cover(&data).unwrap().starts_with(&[0xff, 0xd8, 0xff]));
        let (title, pages) = peek(Path::new(EXAM)).unwrap();
        assert_eq!(pages, 3);
        assert!(!title.is_empty());
        assert_eq!(fold("Memória CACHÉ ñ"), "memoria cache n");
        assert_eq!(fold("Ä").chars().count(), 1);
    }
}
