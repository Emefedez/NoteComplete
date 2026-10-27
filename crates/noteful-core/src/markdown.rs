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
    }
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

/// A `.notecomp` file (also read as `.notecomplete`): a tar with `manifest.json`, `note.noteful` (the
/// native note, as exported) and `notes.md` (the notes, page markers kept).
pub fn pack_notecomplete(note: &[u8], markdown: &str, title: &str) -> Result<Vec<u8>> {
    let manifest = serde_json::json!({
        "format": "notecomplete", "version": 1, "title": title, "note": NOTE, "notes": NOTES,
    });
    let mut builder = tar::Builder::new(Vec::new());
    add(&mut builder, MANIFEST, manifest.to_string().as_bytes())?;
    add(&mut builder, NOTE, note)?;
    add(&mut builder, NOTES, markdown.as_bytes())?;
    builder
        .into_inner()
        .map_err(|e| Error::new(0, e.to_string()))
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
        pack_notecomplete(&self.export_noteful()?, &self.markdown, &self.scene.title)
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
        let md = markdown_export(src, "Memoria 1");
        assert!(md.starts_with("# Memoria 1\n"));
        assert!(md.contains("\n---\n\n**Page 10**\n") && !md.contains("<!--"));
        assert_eq!(page_marker("  <!--page 3-->  "), Some(3));
        assert_eq!(page_marker("<!-- page 0 -->"), None);
        // AI answers use LaTeX; the host typesets these spans.
        let math = markdown_html("02 $\\rightarrow$ 03 and $$x^2$$");
        assert!(math.contains("<span class=\"math math-inline\">\\rightarrow</span>"), "{math}");
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
        let mut other = tar::Builder::new(Vec::new());
        add(&mut other, NOTE, b"x").unwrap();
        assert!(unpack_notecomplete(&other.into_inner().unwrap()).is_err());
    }
}
