//! Markdown notes kept alongside a note: preview rendering (pulldown-cmark),
//! page markers that tie a section to a page, the plain Markdown export, and
//! the `.notecomp` archive (a tar holding the note and its notes).
use crate::{Editor, Error, Result};
use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag};
use std::io::Read;

/// Upper bound for the notes text (bytes).
pub const MARKDOWN_LIMIT: usize = 8 << 20;

/// `<!-- page N -->` on a line of its own ties what follows to page N (1-based).
pub fn page_marker(line: &str) -> Option<usize> {
    let inner = line
        .trim()
        .strip_prefix("<!--")?
        .strip_suffix("-->")?
        .trim();
    inner
        .strip_prefix("page")?
        .trim()
        .parse()
        .ok()
        .filter(|n| *n > 0)
}

/// Page markers with their 0-based line numbers, in document order.
pub fn markdown_pages(src: &str) -> Vec<(usize, usize)> {
    src.lines()
        .enumerate()
        .filter_map(|(line, text)| page_marker(text).map(|page| (page, line)))
        .collect()
}

// Links may only go to the web, mail or within the notes; images may only be
// embedded data or web images. Anything else (javascript:, file:) is dropped.
fn safe_url(url: &str, image: bool) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if image {
        lower.starts_with("https://") || lower.starts_with("data:image/")
    } else {
        lower.starts_with("https://")
            || lower.starts_with("http://")
            || lower.starts_with("mailto:")
            || lower.starts_with('#')
            || relative(&lower)
    }
}
/// A link to a file beside the document ("otro.md", "../Tema 2.md#parte"): no
/// scheme before the path, and not protocol-relative ("//host").
fn relative(url: &str) -> bool {
    !url.is_empty()
        && !url.starts_with("//")
        && url
            .find(':')
            .is_none_or(|colon| url[..colon].contains(['/', '?', '#']))
}

/// Preview HTML. Raw HTML in the notes is shown as text, never interpreted;
/// page markers become `<div class="md-page" data-page="N">` chips.
pub fn markdown_html(src: &str) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_MATH;
    let events = Parser::new_ext(src, options).map(|event| match event {
        Event::Html(raw) | Event::InlineHtml(raw) => match page_marker(&raw) {
            Some(n) => Event::Html(
                format!("<div class=\"md-page\" data-page=\"{n}\">Page {n}</div>\n").into(),
            ),
            None => Event::Text(raw),
        },
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) if !safe_url(&dest_url, false) => Event::Start(Tag::Link {
            link_type,
            dest_url: CowStr::Borrowed("#"),
            title,
            id,
        }),
        Event::Start(Tag::Image {
            link_type,
            dest_url,
            title,
            id,
        }) if !safe_url(&dest_url, true) => Event::Start(Tag::Image {
            link_type,
            dest_url: CowStr::Borrowed(""),
            title,
            id,
        }),
        other => other,
    });
    let mut out = String::new();
    html::push_html(&mut out, events);
    out
}

/// The notes as a plain Markdown file to go with an exported note: page
/// markers become a visible break ("Page N") so readers see where pages change.
pub fn markdown_export(src: &str, title: &str) -> String {
    let mut out = String::new();
    if !title.trim().is_empty() {
        out.push_str(&format!("# {}\n\n", title.trim()));
    }
    for line in src.lines() {
        match page_marker(line) {
            Some(n) => out.push_str(&format!("\n---\n\n**Page {n}**\n\n")),
            None => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out
}

const MANIFEST: &str = "manifest.json";
const NOTE: &str = "note.noteful";
const NOTES: &str = "notes.md";

fn add(builder: &mut tar::Builder<Vec<u8>>, name: &str, data: &[u8]) -> Result<()> {
    let mut header = tar::Header::new_ustar();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(0);
    header.set_entry_type(tar::EntryType::Regular);
    builder
        .append_data(&mut header, name, data)
        .map_err(|e| Error::new(0, e.to_string()))
}

/// Audio added in NoteComplete (recorded or imported), kept beside the note: `id`, `name`, `mime`
/// and `created` (ms since 1970) are listed in the manifest, the bytes go in `audio/`.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AddedAudio {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub created: f64,
}

/// Where one added recording's bytes are inside a `.notecomp` file.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct AddedAudioEntry {
    #[serde(flatten)]
    pub audio: AddedAudio,
    pub offset: usize,
    pub length: usize,
}

const AUDIO_LIMIT: usize = 64;

// The file extension: sniffed from the bytes, else from a known MIME type.
fn audio_extension(data: &[u8], mime: &str) -> &'static str {
    crate::audio_kind(data).unwrap_or(match mime.split(';').next().unwrap_or("").trim() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/mpeg" => "mp3",
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        _ => "bin",
    })
}

fn clean(text: &str, limit: usize) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}

/// A `.notecomp` file (also read as `.notecomplete`): a tar with `manifest.json`, `note.noteful` (the
/// native note, as exported), `notes.md` (the notes, page markers kept) and `audio/` (recordings
/// added in NoteComplete, listed in the manifest).
pub fn pack_notecomplete(note: &[u8], markdown: &str, title: &str) -> Result<Vec<u8>> {
    pack_notecomplete_with(note, markdown, title, &[])
}

pub fn pack_notecomplete_with(
    note: &[u8],
    markdown: &str,
    title: &str,
    audio: &[(AddedAudio, &[u8])],
) -> Result<Vec<u8>> {
    if audio.len() > AUDIO_LIMIT {
        return Err(Error::new(0, "Too many recordings"));
    }
    let mut files = Vec::with_capacity(audio.len());
    let mut listed = Vec::with_capacity(audio.len());
    for (i, (meta, data)) in audio.iter().enumerate() {
        let file = format!("audio/{}.{}", i + 1, audio_extension(data, &meta.mime));
        listed.push(serde_json::json!({
            "file": file, "id": clean(&meta.id, 80), "name": clean(&meta.name, 200),
            "mime": clean(&meta.mime, 80), "created": meta.created,
        }));
        files.push((file, *data));
    }
    let mut manifest = serde_json::json!({
        "format": "notecomplete", "version": 1, "title": title, "note": NOTE, "notes": NOTES,
    });
    if !listed.is_empty() {
        manifest["audio"] = serde_json::Value::Array(listed);
    }
    let mut builder = tar::Builder::new(Vec::new());
    add(&mut builder, MANIFEST, manifest.to_string().as_bytes())?;
    add(&mut builder, NOTE, note)?;
    add(&mut builder, NOTES, markdown.as_bytes())?;
    for (file, data) in files {
        add(&mut builder, &file, data)?;
    }
    builder
        .into_inner()
        .map_err(|e| Error::new(0, e.to_string()))
}

/// The recordings added in NoteComplete inside a `.notecomp` file, as byte ranges of `data`
/// (tar keeps each file's bytes in one piece). Files without them give an empty list.
pub fn notecomplete_audio(data: &[u8]) -> Result<Vec<AddedAudioEntry>> {
    let invalid = |e: std::io::Error| Error::new(0, format!("Not a NoteComplete file: {e}"));
    let mut archive = tar::Archive::new(data);
    let mut manifest = None;
    let mut ranges = std::collections::HashMap::new();
    for entry in archive.entries().map_err(invalid)? {
        let mut entry = entry.map_err(invalid)?;
        let name = entry
            .path()
            .map_err(invalid)?
            .to_string_lossy()
            .into_owned();
        let size = entry.header().size().map_err(invalid)? as usize;
        let offset = entry.raw_file_position() as usize;
        if offset.checked_add(size).is_none_or(|end| end > data.len()) {
            return Err(Error::new(0, "Truncated NoteComplete file"));
        }
        if name == MANIFEST {
            let mut bytes = Vec::with_capacity(size);
            (&mut entry)
                .take(size as u64)
                .read_to_end(&mut bytes)
                .map_err(invalid)?;
            manifest = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
        } else if name.starts_with("audio/") {
            ranges.insert(name, (offset, size));
        }
    }
    let Some(manifest) = manifest.filter(|m| m["format"].as_str() == Some("notecomplete")) else {
        return Err(Error::new(0, "Not a NoteComplete file"));
    };
    let listed = manifest["audio"].as_array().cloned().unwrap_or_default();
    Ok(listed
        .iter()
        .take(AUDIO_LIMIT)
        .filter_map(|item| {
            let &(offset, length) = ranges.get(item["file"].as_str()?)?;
            let audio = AddedAudio {
                id: clean(item["id"].as_str()?, 80),
                name: clean(item["name"].as_str().unwrap_or(""), 200),
                mime: clean(item["mime"].as_str().unwrap_or(""), 80),
                created: item["created"].as_f64().unwrap_or(0.0),
            };
            Some(AddedAudioEntry {
                audio,
                offset,
                length,
            })
        })
        .collect())
}

/// Whether bytes look like a tar archive (ustar magic).
pub fn is_notecomplete(data: &[u8]) -> bool {
    data.get(257..262) == Some(b"ustar")
}

/// The note and notes inside a `.notecomp` file.
pub fn unpack_notecomplete(data: &[u8]) -> Result<(Vec<u8>, String)> {
    let invalid = |e: std::io::Error| Error::new(0, format!("Not a NoteComplete file: {e}"));
    let mut archive = tar::Archive::new(data);
    let (mut manifest, mut note, mut notes) = (None, None, String::new());
    for entry in archive.entries().map_err(invalid)? {
        let entry = entry.map_err(invalid)?;
        let name = entry
            .path()
            .map_err(invalid)?
            .to_string_lossy()
            .into_owned();
        let size = entry.header().size().map_err(invalid)? as usize;
        if size > data.len() {
            return Err(Error::new(0, "Truncated NoteComplete file"));
        }
        let mut bytes = Vec::with_capacity(size);
        entry
            .take(size as u64)
            .read_to_end(&mut bytes)
            .map_err(invalid)?;
        match name.as_str() {
            MANIFEST => manifest = serde_json::from_slice::<serde_json::Value>(&bytes).ok(),
            NOTE => note = Some(bytes),
            NOTES => {
                if bytes.len() > MARKDOWN_LIMIT {
                    return Err(Error::new(0, "Notes too large"));
                }
                notes = String::from_utf8(bytes)
                    .map_err(|_| Error::new(0, "Notes are not UTF-8 text"))?;
            }
            _ => {}
        }
    }
    if manifest.as_ref().and_then(|m| m["format"].as_str()) != Some("notecomplete") {
        return Err(Error::new(0, "Not a NoteComplete file"));
    }
    let note = note.ok_or_else(|| Error::new(0, "NoteComplete file has no note"))?;
    Ok((note, notes))
}

impl Editor {
    pub fn markdown(&self) -> &str {
        &self.markdown
    }
    /// The notes are not an undoable edit: they are saved as they are typed.
    pub fn set_markdown(&mut self, markdown: &str) -> Result<()> {
        if markdown.len() > MARKDOWN_LIMIT {
            return Err(Error::new(0, "Notes too large"));
        }
        markdown.clone_into(&mut self.markdown);
        Ok(())
    }
    pub fn open_notecomplete(data: &[u8]) -> Result<Self> {
        let (note, notes) = unpack_notecomplete(data)?;
        let mut editor = Self::open(&note)?;
        editor.markdown = notes;
        Ok(editor)
    }
    pub fn export_notecomplete(&self) -> Result<Vec<u8>> {
        self.export_notecomplete_with(&[])
    }
    /// With recordings added in NoteComplete, which the reader keeps per note.
    pub fn export_notecomplete_with(&self, audio: &[(AddedAudio, &[u8])]) -> Result<Vec<u8>> {
        pack_notecomplete_with(
            &self.export_noteful()?,
            &self.markdown,
            &self.scene.title,
            audio,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn markers_render_export_and_stay_safe() {
        let src = "Intro\n<!-- page 2 -->\n## Sector\n**bold** <script>x</script> [a](javascript:alert(1)) ![i](file:///etc/passwd)\n<!-- page 10 -->\n- [x] done\n";
        assert_eq!(markdown_pages(src), vec![(2, 1), (10, 4)]);
        let html = markdown_html(src);
        assert!(html.contains("<div class=\"md-page\" data-page=\"2\">Page 2</div>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("&lt;script&gt;") && !html.contains("<script>"));
        assert!(!html.contains("javascript:") && !html.contains("file:"));
        assert!(html.contains("checkbox"));
        // Links to files beside the document stay (the text view opens them).
        let links = markdown_html("[a](otro.md) [b](../Tema%202.md#parte) [c](//evil.example) [d](data:text/html,x) [e](a/b:c)");
        assert!(
            links.contains("href=\"otro.md\"")
                && links.contains("href=\"../Tema%202.md#parte\"")
                && links.contains("href=\"a/b:c\""),
            "{links}"
        );
        assert!(
            !links.contains("evil") && !links.contains("data:"),
            "{links}"
        );
        let md = markdown_export(src, "Memoria 1");
        assert!(md.starts_with("# Memoria 1\n"));
        assert!(md.contains("\n---\n\n**Page 10**\n") && !md.contains("<!--"));
        assert_eq!(page_marker("  <!--page 3-->  "), Some(3));
        assert_eq!(page_marker("<!-- page 0 -->"), None);
        // AI answers use LaTeX; the host typesets these spans.
        let math = markdown_html("02 $\\rightarrow$ 03 and $$x^2$$");
        assert!(
            math.contains("<span class=\"math math-inline\">\\rightarrow</span>"),
            "{math}"
        );
        assert!(math.contains("math-display"));
    }
    #[test]
    fn archives_round_trip_and_reject_other_files() {
        let packed = pack_notecomplete(b"NOTE", "# Notas\n<!-- page 1 -->\n", "T").unwrap();
        assert!(is_notecomplete(&packed));
        assert_eq!(
            unpack_notecomplete(&packed).unwrap(),
            (b"NOTE".to_vec(), "# Notas\n<!-- page 1 -->\n".to_owned())
        );
        assert!(unpack_notecomplete(b"not a tar").is_err());
        assert_eq!(notecomplete_audio(&packed).unwrap(), vec![]);
        let mut other = tar::Builder::new(Vec::new());
        add(&mut other, NOTE, b"x").unwrap();
        assert!(unpack_notecomplete(&other.into_inner().unwrap()).is_err());
    }
    #[test]
    fn added_audio_travels_in_the_archive() {
        let webm = [0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3];
        let meta = |id: &str, mime: &str| AddedAudio {
            id: id.into(),
            name: format!("Take {id}\n"),
            mime: mime.into(),
            created: 1.5e12,
        };
        let packed = pack_notecomplete_with(
            b"NOTE",
            "",
            "T",
            &[
                (meta("a", "audio/webm;codecs=opus"), &webm),
                (meta("b", "audio/mp4"), b"MP4DATA"),
            ],
        )
        .unwrap();
        assert_eq!(unpack_notecomplete(&packed).unwrap().0, b"NOTE".to_vec());
        let found = notecomplete_audio(&packed).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(
            &packed[found[0].offset..found[0].offset + found[0].length],
            &webm
        );
        assert_eq!(
            &packed[found[1].offset..found[1].offset + found[1].length],
            b"MP4DATA"
        );
        assert_eq!(
            (found[0].audio.name.as_str(), found[0].audio.created),
            ("Take a", 1.5e12)
        );
        assert_eq!(found[1].audio.mime, "audio/mp4");
        let names: Vec<String> = tar::Archive::new(&packed[..])
            .entries()
            .unwrap()
            .map(|e| e.unwrap().path().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            [
                "manifest.json",
                "note.noteful",
                "notes.md",
                "audio/1.webm",
                "audio/2.m4a"
            ]
        );
    }
}
