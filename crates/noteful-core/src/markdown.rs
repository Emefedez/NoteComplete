//! Markdown notes kept alongside a note: preview rendering (pulldown-cmark),
//! page markers that tie a section to a page, the plain Markdown export, and
//! the `.notecomp` archive (a tar holding the note and its notes).
use crate::{Editor, Error, Result};
use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag, TagEnd};
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
// embedded data, web images or files beside the document. Anything else (javascript:, file:) is dropped.
fn safe_url(url: &str, image: bool) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if image {
        // A picture beside the document ("Tema_files/image1.png") is for the reader to resolve.
        lower.starts_with("https://") || lower.starts_with("data:image/") || relative(&lower)
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
    let safe = |event| match event {
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
    };
    let mut code = 0;
    let mut texts: Vec<(CowStr, std::ops::Range<usize>)> = Vec::new();
    let mut events = Vec::new();
    for (event, range) in Parser::new_ext(src, options).into_offset_iter() {
        // Raw HTML is shown as text, and not read for ruby either.
        match event {
            Event::Html(_) | Event::InlineHtml(_) => {}
            Event::Text(text) if code == 0 => {
                texts.push((text, range));
                continue;
            }
            Event::Start(Tag::CodeBlock(_)) => code += 1,
            Event::End(TagEnd::CodeBlock) => code -= 1,
            _ => {}
        }
        ruby_events(src, &mut texts, &mut events);
        events.push(safe(event));
    }
    ruby_events(src, &mut texts, &mut events);
    let mut out = String::new();
    html::push_html(&mut out, events.into_iter());
    out
}

/// Pinyin over characters typed in the notes (docs/CHINESE-INPUT.md §6.3): `{漢字|hàn zì}`
/// becomes `<ruby>漢<rt>hàn</rt>字<rt>zì</rt></ruby>`, one `<rt>` per character when there are
/// as many syllables as characters, else one for the group; tone numbers (`ni3`) become marks.
/// Only groups with Chinese or Japanese characters, so `{x | x > 0}` stays text; `\{` too.
fn ruby_events<'a>(
    src: &str,
    texts: &mut Vec<(CowStr<'a>, std::ops::Range<usize>)>,
    out: &mut Vec<Event<'a>>,
) {
    if texts.is_empty() {
        return;
    }
    // One run of text (pulldown-cmark splits it at escapes), with the `{` that were escaped.
    let (mut text, mut escaped) = (String::new(), Vec::new());
    for (part, range) in texts.iter() {
        let source = src.get(range.clone()).unwrap_or("");
        for (i, _) in part.match_indices('{') {
            let before = &src[..range.start + i.min(source.len())];
            if if source == part.as_ref() {
                before.ends_with('\\')
            } else {
                source.contains("\\{")
            } {
                escaped.push(text.len() + i);
            }
        }
        text.push_str(part);
    }
    if !text.contains('{') {
        out.extend(texts.drain(..).map(|(t, _)| Event::Text(t)));
        return;
    }
    texts.clear();
    let mut start = 0;
    let mut at = 0;
    while let Some(open) = text[at..].find('{').map(|i| at + i) {
        at = open + 1;
        if escaped.contains(&open) {
            continue;
        }
        let Some(close) = text[open..].find('}').map(|i| open + i) else {
            break;
        };
        let Some((base, reading)) = text[open + 1..close].split_once('|') else {
            continue;
        };
        if base.is_empty() || base.contains(['{', '\n']) || reading.trim().is_empty() || base.chars().count() > 64 || reading.len() > 256
            || !base.chars().any(|c| matches!(c as u32, 0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x3134f))
        {
            continue;
        }
        if open > start {
            out.push(Event::Text(text[start..open].to_owned().into()));
        }
        out.push(Event::InlineHtml(ruby_html(base, reading).into()));
        start = close + 1;
        at = start;
    }
    if start < text.len() {
        out.push(Event::Text(text[start..].to_owned().into()));
    }
}

fn ruby_html(base: &str, reading: &str) -> String {
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    // Syllables: by spaces, and after each tone number (`ni3hao3`).
    let mut syllables = Vec::new();
    for word in reading.split_whitespace() {
        let mut from = 0;
        for (i, c) in word.char_indices() {
            if c.is_ascii_digit() {
                syllables.push(mark_tone(&word[from..=i]));
                from = i + 1;
            }
        }
        if from < word.len() {
            syllables.push(word[from..].to_owned());
        }
    }
    let chars: Vec<char> = base.chars().collect();
    let mut html = String::from("<ruby>");
    if syllables.len() == chars.len() {
        for (c, s) in chars.iter().zip(&syllables) {
            html.push_str(&format!("{}<rt>{}</rt>", escape(&c.to_string()), escape(s)));
        }
    } else {
        html.push_str(&format!(
            "{}<rt>{}</rt>",
            escape(base),
            escape(&syllables.join(" "))
        ));
    }
    html + "</ruby>"
}

/// A pinyin syllable with a tone number (`hao3`, `lv4`, `Ni3`) with its tone mark instead
/// (`hǎo`, `lǜ`, `Nǐ`); the same rules as the reader's `chinese/pinyin.js` `markTone`: on `a`
/// or `e`, on the `o` of `ou`, else on the last vowel; `ng`, `n`, `m` alone take it themselves.
/// Anything else is returned as it is.
pub fn mark_tone(syllable: &str) -> String {
    let Some(tone) = syllable
        .chars()
        .last()
        .and_then(|c| c.to_digit(10))
        .filter(|&t| t <= 5)
    else {
        return syllable.to_owned();
    };
    let letters = syllable[..syllable.len() - 1]
        .replace("u:", "ü")
        .replace("U:", "Ü")
        .replace('v', "ü")
        .replace('V', "Ü");
    if letters.is_empty()
        || !letters
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == 'ü' || c == 'Ü')
    {
        return syllable.to_owned();
    }
    if tone == 0 || tone == 5 {
        return letters;
    }
    let chars: Vec<char> = letters.chars().collect();
    let lower: String = letters.to_lowercase();
    let vowel = |c: char| "aeiouüAEIOUÜ".contains(c);
    let at = lower
        .find('a')
        .or_else(|| lower.find('e'))
        .or_else(|| lower.find("ou"))
        .map(|byte| lower[..byte].chars().count())
        .or_else(|| chars.iter().rposition(|&c| vowel(c)))
        .or_else(|| {
            (matches!(lower.as_str(), "ng" | "n" | "m" | "hng" | "hm"))
                .then(|| chars.iter().position(|&c| "nmNM".contains(c)).unwrap_or(0))
        });
    let Some(at) = at else {
        return syllable.to_owned();
    };
    const MARKED: [(&str, [&str; 4]); 16] = [
        ("a", ["ā", "á", "ǎ", "à"]),
        ("e", ["ē", "é", "ě", "è"]),
        ("i", ["ī", "í", "ǐ", "ì"]),
        ("o", ["ō", "ó", "ǒ", "ò"]),
        ("u", ["ū", "ú", "ǔ", "ù"]),
        ("ü", ["ǖ", "ǘ", "ǚ", "ǜ"]),
        ("A", ["Ā", "Á", "Ǎ", "À"]),
        ("E", ["Ē", "É", "Ě", "È"]),
        ("I", ["Ī", "Í", "Ǐ", "Ì"]),
        ("O", ["Ō", "Ó", "Ǒ", "Ò"]),
        ("U", ["Ū", "Ú", "Ǔ", "Ù"]),
        ("Ü", ["Ǖ", "Ǘ", "Ǚ", "Ǜ"]),
        ("n", ["n\u{304}", "ń", "ň", "ǹ"]),
        ("m", ["m\u{304}", "ḿ", "m\u{30c}", "m\u{300}"]),
        ("N", ["N\u{304}", "Ń", "Ň", "Ǹ"]),
        ("M", ["M\u{304}", "Ḿ", "M\u{30c}", "M\u{300}"]),
    ];
    let c = chars[at].to_string();
    let Some((_, marks)) = MARKED.iter().find(|(k, _)| *k == c) else {
        return syllable.to_owned();
    };
    let mut out: String = chars[..at].iter().collect();
    out.push_str(marks[tone as usize - 1]);
    out.extend(&chars[at + 1..]);
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
const INK_TEXT: &str = "ink-text.json";
const OCR_TEXT: &str = "ocr-text.json";

pub(crate) fn add(builder: &mut tar::Builder<Vec<u8>>, name: &str, data: &[u8]) -> Result<()> {
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
    pack_notecomplete_text(
        note,
        markdown,
        title,
        audio,
        &[],
        false,
        &[],
        &Default::default(),
    )
}

/// With the words of handwriting written from Markdown, by page in the note's
/// order (`ink-text.json`), so the text stays searchable without recognition.
#[allow(clippy::too_many_arguments)]
pub fn pack_notecomplete_text(
    note: &[u8],
    markdown: &str,
    title: &str,
    audio: &[(AddedAudio, &[u8])],
    ink_text: &[&[crate::InkWord]],
    canvas: bool,
    recognized: &[&[crate::InkWord]],
    chinese: &crate::ProjectChinese,
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
    let text = ink_text
        .iter()
        .any(|w| !w.is_empty())
        .then(|| serde_json::json!({ "pages": ink_text }).to_string());
    if text.is_some() {
        manifest["ink_text"] = INK_TEXT.into();
    }
    // Text recognized in the handwriting (OCR), by page in the same order.
    let ocr = recognized
        .iter()
        .any(|w| !w.is_empty())
        .then(|| serde_json::json!({ "pages": recognized }).to_string());
    if ocr.is_some() {
        manifest["ocr_text"] = OCR_TEXT.into();
    }
    // Infinite canvases (canvas.rs): pages that grow; NoteComplete reopens them as such.
    if canvas {
        manifest["canvas"] = true.into();
    }
    // Chinese mode settings of the note (docs/CHINESE-INPUT.md §9), as in the project JSON.
    if !chinese.is_empty() {
        manifest["chinese"] =
            serde_json::to_value(chinese).map_err(|e| Error::new(0, e.to_string()))?;
    }
    let mut builder = tar::Builder::new(Vec::new());
    add(&mut builder, MANIFEST, manifest.to_string().as_bytes())?;
    add(&mut builder, NOTE, note)?;
    add(&mut builder, NOTES, markdown.as_bytes())?;
    if let Some(text) = text {
        add(&mut builder, INK_TEXT, text.as_bytes())?;
    }
    if let Some(ocr) = ocr {
        add(&mut builder, OCR_TEXT, ocr.as_bytes())?;
    }
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
    // A v13 project keeps its recordings in the project itself (project_archive.rs).
    if crate::is_project_archive(data) {
        return Ok(Vec::new());
    }
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
/// The words of handwriting written from Markdown in a `.notecomp` file, by page
/// (empty when the file has none, as older files).
pub fn notecomplete_ink_text(data: &[u8]) -> Result<Vec<Vec<crate::InkWord>>> {
    page_words(data, INK_TEXT)
}
/// The text recognized in the handwriting (OCR) of a `.notecomp` file, by page.
pub fn notecomplete_recognized_text(data: &[u8]) -> Result<Vec<Vec<crate::InkWord>>> {
    page_words(data, OCR_TEXT)
}
fn page_words(data: &[u8], name: &str) -> Result<Vec<Vec<crate::InkWord>>> {
    let invalid = |e: std::io::Error| Error::new(0, format!("Not a NoteComplete file: {e}"));
    let mut archive = tar::Archive::new(data);
    for entry in archive.entries().map_err(invalid)? {
        let entry = entry.map_err(invalid)?;
        if entry.path().map_err(invalid)?.to_string_lossy() != name {
            continue;
        }
        let size = entry.header().size().map_err(invalid)?;
        if size > MARKDOWN_LIMIT as u64 * 8 {
            return Err(Error::new(0, "Page text too large"));
        }
        let mut bytes = Vec::with_capacity(size as usize);
        entry.take(size).read_to_end(&mut bytes).map_err(invalid)?;
        #[derive(serde::Deserialize)]
        struct Text {
            pages: Vec<Vec<crate::InkWord>>,
        }
        return serde_json::from_slice::<Text>(&bytes)
            .map(|t| t.pages)
            .map_err(|e| Error::new(0, e.to_string()));
    }
    Ok(Vec::new())
}

/// The Chinese mode settings in a `.notecomp` manifest, when it has valid ones.
fn notecomplete_chinese(data: &[u8]) -> Option<crate::ProjectChinese> {
    let mut archive = tar::Archive::new(data);
    for mut entry in archive.entries().ok()?.flatten() {
        if entry.path().is_ok_and(|p| p.to_string_lossy() == MANIFEST) {
            let mut bytes = Vec::new();
            (&mut entry).take(8 << 20).read_to_end(&mut bytes).ok()?;
            let mut manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
            return serde_json::from_value(manifest.get_mut("chinese")?.take()).ok();
        }
    }
    None
}

/// Whether a `.notecomp` file is an infinite canvas (its manifest says so).
pub fn notecomplete_is_canvas(data: &[u8]) -> bool {
    let mut archive = tar::Archive::new(data);
    let Ok(entries) = archive.entries() else {
        return false;
    };
    for mut entry in entries.flatten() {
        if entry.path().is_ok_and(|p| p.to_string_lossy() == MANIFEST) {
            let mut bytes = Vec::new();
            return (&mut entry).take(64 * 1024).read_to_end(&mut bytes).is_ok()
                && serde_json::from_slice::<serde_json::Value>(&bytes)
                    .is_ok_and(|m| m["format"] == "notecomplete" && m["canvas"] == true);
        }
    }
    false
}

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
        // A v13 .nfedit is a tar too: hosts that tell files apart by the ustar magic send it here.
        if crate::is_project_archive(data) {
            return Self::open_project_archive(data);
        }
        let (note, notes) = unpack_notecomplete(data)?;
        let mut editor = Self::open(&note)?;
        editor.markdown = notes;
        // Settings this version cannot keep are dropped, not a reason to refuse the note.
        if let Some(chinese) = notecomplete_chinese(data) {
            editor.set_chinese(chinese).ok();
        }
        if notecomplete_is_canvas(data) && !editor.scene.pages.is_empty() {
            editor.canvas = true;
        }
        // The note inside is flattened: its pages are in display order.
        for (slot, words) in notecomplete_ink_text(data)?.into_iter().enumerate() {
            if slot < editor.scene.pages.len() && crate::pages::words_valid(&words) {
                editor.set_ink_words(slot, words)?;
            }
        }
        for (slot, words) in notecomplete_recognized_text(data)?.into_iter().enumerate() {
            if slot < editor.scene.pages.len() && crate::pages::words_valid(&words) {
                editor.set_recognized_words(slot, words)?;
            }
        }
        Ok(editor)
    }
    pub fn export_notecomplete(&self) -> Result<Vec<u8>> {
        self.export_notecomplete_with(&[])
    }
    /// With recordings added in NoteComplete, which the reader keeps per note.
    pub fn export_notecomplete_with(&self, audio: &[(AddedAudio, &[u8])]) -> Result<Vec<u8>> {
        let order = self.page_order();
        let text: Vec<&[crate::InkWord]> = order.iter().map(|s| self.ink_words(*s)).collect();
        let recognized: Vec<&[crate::InkWord]> =
            order.iter().map(|s| self.recognized_words(*s)).collect();
        pack_notecomplete_text(
            &self.noteful_bytes()?,
            &self.markdown,
            &self.scene.title,
            audio,
            &text,
            self.canvas,
            &recognized,
            &self.chinese,
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
        // Pictures beside the document stay for the reader to resolve; other schemes do not.
        let pics = markdown_html("![a](Tema%203_files/image1.png) ![b](//evil.example/x.png) ![c](file:///etc/passwd) ![d](ftp://x/y.png)");
        assert!(pics.contains("src=\"Tema%203_files/image1.png\""), "{pics}");
        assert!(
            !pics.contains("evil") && !pics.contains("file:") && !pics.contains("ftp:"),
            "{pics}"
        );
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
    fn ruby_groups() {
        let html = markdown_html("说{漢字|hàn zì}了 {你好|nǐhǎo} {x | x > 0}");
        assert!(
            html.contains("说<ruby>漢<rt>hàn</rt>字<rt>zì</rt></ruby>了"),
            "{html}"
        );
        assert!(html.contains("<ruby>你好<rt>nǐhǎo</rt></ruby>"), "{html}");
        assert!(html.contains("{x | x &gt; 0}"), "{html}");
        // In a heading, a link and a table cell too; markup in the reading is shown as text.
        let html = markdown_html("# {中|zhōng<b}\n\n[{好|hǎo}](a.md)");
        assert!(
            html.contains("<ruby>中<rt>zhōng&lt;b</rt></ruby>"),
            "{html}"
        );
        assert!(html.contains("<ruby>好<rt>hǎo</rt></ruby></a>"), "{html}");
    }
    #[test]
    fn ruby_tone_numbers() {
        let html = markdown_html("{你好|ni3 hao3} {中国|Zhong1guo2} {吗|ma5}");
        assert!(
            html.contains("<ruby>你<rt>nǐ</rt>好<rt>hǎo</rt></ruby>"),
            "{html}"
        );
        assert!(
            html.contains("<ruby>中<rt>Zhōng</rt>国<rt>guó</rt></ruby>"),
            "{html}"
        );
        assert!(html.contains("<ruby>吗<rt>ma</rt></ruby>"), "{html}");
        for (from, to) in [
            ("hao3", "hǎo"),
            ("mei2", "méi"),
            ("xue3", "xuě"),
            ("dou3", "dǒu"),
            ("zhou1", "zhōu"),
            ("liu4", "liù"),
            ("jiu3", "jiǔ"),
            ("dui4", "duì"),
            ("hui2", "huí"),
            ("lv4", "lǜ"),
            ("lu:4", "lǜ"),
            ("lü4", "lǜ"),
            ("nve4", "nüè"),
            ("ju2", "jú"),
            ("er2", "ér"),
            ("ma5", "ma"),
            ("ma0", "ma"),
            ("ng2", "ńg"),
            ("Ni3", "Nǐ"),
            ("hao", "hao"),
            ("x9", "x9"),
        ] {
            assert_eq!(mark_tone(from), to, "{from}");
        }
    }
    #[test]
    fn ruby_escaped() {
        let html = markdown_html("\\{你|nǐ} {好|hǎo}");
        assert!(
            html.contains("{你|nǐ}") && !html.contains("<ruby>你"),
            "{html}"
        );
        assert!(html.contains("<ruby>好<rt>hǎo</rt></ruby>"), "{html}");
    }
    #[test]
    fn ruby_not_in_code() {
        let html = markdown_html("`{你|nǐ}`\n\n```\n{好|hǎo}\n```\n\n$\\{x|y\\}$");
        assert!(!html.contains("<ruby>"), "{html}");
        assert!(html.contains("<code>{你|nǐ}</code>"), "{html}");
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
