//! Prefab insertion for Markdown, HTML, Euro-Office (OOXML `.docx`/`.pptx` and
//! ODF `.odt`/`.odp`), and `.notecomp`/`.nfedit` Markdown notes, plus the
//! `create_markdown` tool for generating Markdown documents with embedded
//! editable NoteComplete prefabs.
use super::*;
use std::io::{Cursor, Read, Write as _};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub(super) struct RenderedPrefab {
    pub svg: String,
    pub svg_with_spec: String,
    pub width: f64,
    pub height: f64,
    pub name: String,
    pub spec_json: String,
}

/// JS-compatible `encodeURIComponent`, also escaping `(` and `)` as `%28`/`%29`
/// so SVG data URIs are safe inside Markdown `![alt](...)` links.
pub(super) fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3 / 2);
    for b in s.bytes() {
        let safe = matches!(
            b,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\''
        );
        if safe {
            out.push(b as char);
        } else {
            out.push('%');
            const HEX: &[u8; 16] = b"0123456789ABCDEF";
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0x0f) as usize] as char);
        }
    }
    out
}

pub(super) fn embed_spec_in_svg(svg: &str, spec_json: &str) -> String {
    let encoded = encode_uri_component(spec_json);
    if let Some(at) = svg.find("<svg") {
        let rest = &svg[at + 4..];
        if rest.is_empty()
            || rest.starts_with(char::is_whitespace)
            || rest.starts_with('>')
            || rest.starts_with('/')
        {
            return format!(
                "{}<svg data-nc-prefab-spec=\"{encoded}\"{rest}",
                &svg[..at]
            );
        }
    }
    svg.to_owned()
}

fn sanitize_markdown_alt(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if matches!(c, '[' | ']' | '\n' | '\r') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = collapsed.chars();
    let taken: String = chars.by_ref().take(90).collect();
    if chars.next().is_some() {
        format!("{}…", taken.trim_end())
    } else if taken.is_empty() {
        "Prefab".to_owned()
    } else {
        taken
    }
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

impl RenderedPrefab {
    pub(super) fn data_uri(&self) -> String {
        format!(
            "data:image/svg+xml;utf8,{}",
            encode_uri_component(&self.svg_with_spec)
        )
    }

    pub(super) fn markdown_block(&self, alt_override: Option<&str>) -> String {
        let alt = sanitize_markdown_alt(alt_override.unwrap_or(&self.name));
        format!("![{alt}]({})", self.data_uri())
    }

    pub(super) fn html_block(&self, alt_override: Option<&str>) -> String {
        let alt = xml_escape(&sanitize_markdown_alt(alt_override.unwrap_or(&self.name)));
        format!(
            "<figure class=\"nc-prefab\"><img alt=\"{alt}\" src=\"{}\" style=\"max-width:100%;height:auto;\" /></figure>",
            self.data_uri()
        )
    }

    pub(super) fn to_png(&self, px_w: u32) -> Res<Vec<u8>> {
        let mut rsvg = Command::new("rsvg-convert")
            .args(["-w", &px_w.to_string(), "-f", "png"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start rsvg-convert: {e}"))?;
        if let Some(mut stdin) = rsvg.stdin.take() {
            stdin.write_all(self.svg.as_bytes())?;
        }
        let png_out = rsvg.wait_with_output()?;
        if !png_out.status.success() || png_out.stdout.is_empty() {
            return Err(format!(
                "rsvg-convert failed: {}",
                String::from_utf8_lossy(&png_out.stderr).trim()
            )
            .into());
        }
        Ok(png_out.stdout)
    }
}

/// Renders a NoteComplete prefab spec via `apps/reader/prefabs.js`.
pub(super) fn render_prefab(spec: &Value) -> Res<RenderedPrefab> {
    if !spec.is_object() {
        return Err("spec must be a JSON object".into());
    }
    let prefabs_js = ink_tools::find_prefabs_js()
        .ok_or("Could not locate apps/reader/prefabs.js (set NOTEFUL_READER_DIR)")?;
    let spec_json = serde_json::to_string(spec)?;
    let script = r#"
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { prefabSvg, prefabPrepare, prefabMissingReason, prefabName } = await import(pathToFileURL(process.argv[1]).href);
const given = JSON.parse(fs.readFileSync(0, 'utf8'));
const missing = prefabMissingReason?.(given);
if (missing) throw new Error(missing);
const spec = prefabPrepare ? await prefabPrepare(given) : given;
const out = prefabSvg(spec);
if (!out?.svg) throw new Error(prefabMissingReason?.(spec) || 'Spec produced no prefab SVG');
const name = (prefabName?.(spec) || spec.title || spec.type || 'Prefab');
process.stdout.write(JSON.stringify({ width: out.width || 540, height: out.height || 300, svg: out.svg, name, spec: spec === given ? undefined : spec }));
"#;
    let mut node = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            script,
            &prefabs_js.to_string_lossy(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start node to render prefab: {e}"))?;
    if let Some(mut stdin) = node.stdin.take() {
        stdin.write_all(spec_json.as_bytes())?;
    }
    let node_out = node.wait_with_output()?;
    if !node_out.status.success() {
        return Err(format!(
            "Prefab render failed: {}",
            String::from_utf8_lossy(&node_out.stderr).trim()
        )
        .into());
    }
    let rendered: Value = serde_json::from_slice(&node_out.stdout)?;
    let svg = rendered["svg"]
        .as_str()
        .ok_or("Missing prefab SVG")?
        .to_owned();
    let width = rendered["width"].as_f64().unwrap_or(540.0).max(1.0);
    let height = rendered["height"].as_f64().unwrap_or(300.0).max(1.0);
    let name = rendered["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Prefab")
        .to_owned();
    let final_spec_json = match rendered.get("spec").filter(|s| s.is_object()) {
        Some(prepared) => serde_json::to_string(prepared)?,
        None => spec_json,
    };
    let svg_with_spec = embed_spec_in_svg(&svg, &final_spec_json);
    Ok(RenderedPrefab {
        svg,
        svg_with_spec,
        width,
        height,
        name,
        spec_json: final_spec_json,
    })
}

pub(super) fn is_markdown_ext(e: &str) -> bool {
    matches!(e, "md" | "markdown" | "rmd" | "qmd" | "txt")
}
pub(super) fn is_html_ext(e: &str) -> bool {
    matches!(e, "html" | "htm")
}
pub(super) fn is_office_ext(e: &str) -> bool {
    matches!(e, "docx" | "docm" | "pptx" | "pptm" | "odt" | "odp")
}

/// Inserts a Markdown prefab block into Markdown text at a placeholder, under a
/// heading, at the start (preserving YAML frontmatter), or at the end.
pub(super) fn insert_into_markdown(
    content: &str,
    block: &str,
    position: Option<&str>,
    after_heading: Option<&str>,
    replace_placeholder: Option<&str>,
) -> Res<String> {
    if let Some(ph) = replace_placeholder.filter(|s| !s.is_empty()) {
        if !content.contains(ph) {
            return Err(format!("Placeholder '{ph}' was not found in the document").into());
        }
        return Ok(content.replacen(ph, block, 1));
    }
    if let Some(heading) = after_heading.filter(|s| !s.trim().is_empty()) {
        let wanted = fold(heading.trim().trim_start_matches('#').trim());
        let lines: Vec<&str> = content.lines().collect();
        let mut found: Option<(usize, usize)> = None;
        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim_start();
            let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
            if hashes > 0 && hashes <= 6 && trimmed[hashes..].starts_with(char::is_whitespace) {
                let title = trimmed[hashes..].trim().trim_end_matches('#').trim();
                if fold(title) == wanted {
                    found = Some((i, hashes));
                    break;
                }
            }
        }
        let Some((idx, level)) = found else {
            return Err(format!("Heading '{heading}' was not found in the document").into());
        };
        let insert_at = if position == Some("after_heading") {
            idx + 1
        } else {
            let mut end = lines.len();
            for (j, line) in lines.iter().enumerate().skip(idx + 1) {
                let trimmed = line.trim_start();
                let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
                if hashes > 0
                    && hashes <= level
                    && trimmed[hashes..].starts_with(char::is_whitespace)
                {
                    end = j;
                    break;
                }
            }
            while end > idx + 1 && lines[end - 1].trim().is_empty() {
                end -= 1;
            }
            end
        };
        let mut out_lines: Vec<String> = lines[..insert_at].iter().map(|s| (*s).to_owned()).collect();
        if !out_lines.is_empty() && !out_lines.last().unwrap().trim().is_empty() {
            out_lines.push(String::new());
        }
        out_lines.push(block.to_owned());
        if insert_at < lines.len() && !lines[insert_at].trim().is_empty() {
            out_lines.push(String::new());
        }
        out_lines.extend(lines[insert_at..].iter().map(|s| (*s).to_owned()));
        let mut out = out_lines.join("\n");
        if content.ends_with('\n') || !out.ends_with('\n') {
            out.push('\n');
        }
        return Ok(out);
    }
    match position.unwrap_or("end") {
        "start" => {
            // Preserve YAML frontmatter if present.
            if let Some(after_open) = content.strip_prefix("---\n") {
                if let Some(close) = after_open.find("\n---\n") {
                    let split = 4 + close + 5;
                    let head = &content[..split];
                    let tail = content[split..].trim_start_matches('\n');
                    return Ok(if tail.is_empty() {
                        format!("{head}\n{block}\n")
                    } else {
                        format!("{head}\n{block}\n\n{tail}")
                    });
                }
            }
            let trimmed = content.trim_start_matches('\n');
            Ok(if trimmed.is_empty() {
                format!("{block}\n")
            } else {
                format!("{block}\n\n{trimmed}")
            })
        }
        "end" | "after_heading" => {
            let trimmed = content.trim_end();
            Ok(if trimmed.is_empty() {
                format!("{block}\n")
            } else {
                format!("{trimmed}\n\n{block}\n")
            })
        }
        other => Err(format!("position must be 'end', 'start' or 'after_heading', not '{other}'").into()),
    }
}

pub(super) fn insert_into_html(
    content: &str,
    block: &str,
    position: Option<&str>,
    replace_placeholder: Option<&str>,
) -> Res<String> {
    if let Some(ph) = replace_placeholder.filter(|s| !s.is_empty()) {
        if !content.contains(ph) {
            return Err(format!("Placeholder '{ph}' was not found in the HTML document").into());
        }
        return Ok(content.replacen(ph, block, 1));
    }
    let lower = content.to_ascii_lowercase();
    match position.unwrap_or("end") {
        "start" => {
            if let Some(at) = lower.find("<body") {
                if let Some(gt) = content[at..].find('>') {
                    let pos = at + gt + 1;
                    return Ok(format!("{}\n{block}\n{}", &content[..pos], &content[pos..]));
                }
            }
            Ok(format!("{block}\n{content}"))
        }
        "end" => {
            if let Some(at) = lower.rfind("</body>") {
                return Ok(format!("{}\n{block}\n{}", &content[..at], &content[at..]));
            }
            let trimmed = content.trim_end();
            Ok(if trimmed.is_empty() {
                format!("{block}\n")
            } else {
                format!("{trimmed}\n{block}\n")
            })
        }
        other => Err(format!("position must be 'end' or 'start', not '{other}'").into()),
    }
}

/// Destination for non-notebook documents (`.md`, `.html`, `.docx`, `.pptx`, `.odt`, `.odp`).
fn doc_destination(args: &Value, source: &Path) -> Res<(PathBuf, Option<PathBuf>)> {
    let overwrite = args["overwrite"].as_bool() == Some(true);
    if args["in_place"].as_bool() == Some(true) {
        return Ok((
            source.to_path_buf(),
            Some(PathBuf::from(format!("{}.bak", source.display()))),
        ));
    }
    if let Some(out) = args["out"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        let out = PathBuf::from(out);
        if source == out
            || std::fs::canonicalize(source).ok() == std::fs::canonicalize(&out).ok()
        {
            return Err(
                "out is the source document; pass in_place: true to change it (a .bak copy is kept)"
                    .into(),
            );
        }
        if out.exists() && !overwrite {
            return Err(format!(
                "{} exists; pass overwrite: true to replace it",
                out.display()
            )
            .into());
        }
        return Ok((out, None));
    }
    let dir = source
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(library);
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Document".into());
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut path = dir.join(format!("{stem} (prefab).{ext}"));
    let mut n = 2;
    while path.exists() && !overwrite {
        path = dir.join(format!("{stem} (prefab {n}).{ext}"));
        n += 1;
    }
    Ok((path, None))
}

fn write_atomic(path: &Path, bytes: &[u8], backup: Option<&Path>) -> Res<()> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    if let Some(b) = backup {
        std::fs::copy(path, b)?;
    }
    let temp = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}

// ---- Euro-Office (OOXML .docx / .pptx and ODF .odt / .odp) ----

fn ensure_png_content_type(xml: &str) -> String {
    if xml.contains("Extension=\"png\"") || xml.contains("Extension=\"PNG\"") {
        return xml.to_owned();
    }
    let entry = "<Default Extension=\"png\" ContentType=\"image/png\"/>";
    if let Some(at) = xml.rfind("</Types>") {
        format!("{}{entry}{}", &xml[..at], &xml[at..])
    } else {
        xml.to_owned()
    }
}

fn next_rel_id(rels_xml: &str) -> String {
    let mut max_id = 0u64;
    let mut rest = rels_xml;
    while let Some(at) = rest.find("Id=\"rId") {
        let after = &rest[at + 7..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u64>() {
            max_id = max_id.max(n);
        }
        rest = after;
    }
    format!("rId{}", max_id + 1)
}

fn add_relationship(rels_xml: &str, rel_id: &str, target: &str) -> String {
    let entry = format!(
        "<Relationship Id=\"{rel_id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"{target}\"/>"
    );
    if let Some(at) = rels_xml.rfind("</Relationships>") {
        format!("{}{entry}{}", &rels_xml[..at], &rels_xml[at..])
    } else {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{entry}</Relationships>"
        )
    }
}

fn emu_fit(svg_w: f64, svg_h: f64, max_cx: f64, max_cy: f64) -> (u64, u64) {
    let aspect = (svg_h / svg_w.max(1.0)).max(0.05);
    let mut cx = max_cx;
    let mut cy = cx * aspect;
    if cy > max_cy {
        cy = max_cy;
        cx = cy / aspect;
    }
    (cx.round().max(91440.0) as u64, cy.round().max(91440.0) as u64)
}

fn next_numeric_id(xml: &str) -> u32 {
    let mut max_id = 100u32;
    let mut rest = xml;
    while let Some(at) = rest.find("id=\"") {
        let after = &rest[at + 4..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = digits.parse::<u32>() {
            max_id = max_id.max(n);
        }
        rest = after;
    }
    max_id.saturating_add(1)
}

fn docx_drawing_paragraph(
    doc_pr_id: u32,
    rel_id: &str,
    name: &str,
    spec_json: &str,
    cx: u64,
    cy: u64,
) -> String {
    let esc_name = xml_escape(name);
    let descr = xml_escape(&format!("notecomplete-prefab:{spec_json}"));
    format!(
        "<w:p><w:r><w:drawing>\
        <wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\" \
          xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\">\
          <wp:extent cx=\"{cx}\" cy=\"{cy}\"/>\
          <wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>\
          <wp:docPr id=\"{doc_pr_id}\" name=\"{esc_name}\" descr=\"{descr}\"/>\
          <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>\
          <a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">\
            <a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">\
              <pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">\
                <pic:nvPicPr>\
                  <pic:cNvPr id=\"{doc_pr_id}\" name=\"{esc_name}\" descr=\"{descr}\"/>\
                  <pic:cNvPicPr/>\
                </pic:nvPicPr>\
                <pic:blipFill>\
                  <a:blip xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" r:embed=\"{rel_id}\"/>\
                  <a:stretch><a:fillRect/></a:stretch>\
                </pic:blipFill>\
                <pic:spPr>\
                  <a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
                  <a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>\
                </pic:spPr>\
              </pic:pic>\
            </a:graphicData>\
          </a:graphic>\
        </wp:inline>\
        </w:drawing></w:r></w:p>"
    )
}

fn pptx_pic_xml(
    pic_id: u32,
    rel_id: &str,
    name: &str,
    spec_json: &str,
    x: u64,
    y: u64,
    cx: u64,
    cy: u64,
) -> String {
    let esc_name = xml_escape(name);
    let descr = xml_escape(&format!("notecomplete-prefab:{spec_json}"));
    format!(
        "<p:pic>\
          <p:nvPicPr>\
            <p:cNvPr id=\"{pic_id}\" name=\"{esc_name}\" descr=\"{descr}\"/>\
            <p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr>\
            <p:nvPr/>\
          </p:nvPicPr>\
          <p:blipFill>\
            <a:blip r:embed=\"{rel_id}\"/>\
            <a:stretch><a:fillRect/></a:stretch>\
          </p:blipFill>\
          <p:spPr>\
            <a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
            <a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>\
          </p:spPr>\
        </p:pic>"
    )
}

fn replace_xml_paragraph_containing(
    xml: &str,
    open_tag: &str,
    close_tag: &str,
    needle: &str,
    replacement: &str,
) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel_start) = xml[search_from..].find(open_tag) {
        let start = search_from + rel_start;
        let after_tag = start + open_tag.len();
        let valid_open = xml[after_tag..].starts_with('>')
            || xml[after_tag..].starts_with(' ')
            || xml[after_tag..].starts_with('\t')
            || xml[after_tag..].starts_with('\n');
        if !valid_open {
            search_from = after_tag;
            continue;
        }
        let Some(rel_end) = xml[after_tag..].find(close_tag) else {
            break;
        };
        let end = after_tag + rel_end + close_tag.len();
        let slice = &xml[start..end];
        // Strip XML tags inside this paragraph to match even split Word runs (<w:t>).
        let mut plain = String::new();
        let mut in_tag = false;
        for c in slice.chars() {
            match c {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => plain.push(c),
                _ => {}
            }
        }
        if plain.contains(needle) || slice.contains(needle) {
            return Some(format!("{}{replacement}{}", &xml[..start], &xml[end..]));
        }
        search_from = end;
    }
    None
}

fn read_zip_entries(data: &[u8]) -> Res<Vec<(String, Vec<u8>, CompressionMethod)>> {
    let mut archive = ZipArchive::new(Cursor::new(data))?;
    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_owned();
        let method = file.compression();
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        entries.push((name, buf, method));
    }
    Ok(entries)
}

fn write_zip_entries(entries: &[(String, Vec<u8>, CompressionMethod)]) -> Res<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut out);
        for (name, bytes, method) in entries {
            let opts = SimpleFileOptions::default().compression_method(*method);
            writer.start_file(name, opts)?;
            writer.write_all(bytes)?;
        }
        writer.finish()?;
    }
    Ok(out.into_inner())
}

fn upsert_zip_entry(
    entries: &mut Vec<(String, Vec<u8>, CompressionMethod)>,
    name: &str,
    bytes: Vec<u8>,
    method: CompressionMethod,
) {
    if let Some(existing) = entries.iter_mut().find(|(n, _, _)| n == name) {
        existing.1 = bytes;
    } else {
        entries.push((name.to_owned(), bytes, method));
    }
}

pub(super) fn insert_into_docx(
    data: &[u8],
    prefab: &RenderedPrefab,
    png: &[u8],
    id: &str,
    position: Option<&str>,
    replace_placeholder: Option<&str>,
) -> Res<Vec<u8>> {
    let mut entries = read_zip_entries(data)?;
    let doc_xml_bytes = entries
        .iter()
        .find(|(n, _, _)| n == "word/document.xml")
        .map(|(_, b, _)| b.clone())
        .ok_or("Not a valid .docx file (missing word/document.xml)")?;
    let doc_xml = String::from_utf8(doc_xml_bytes)?;
    let ct_xml = entries
        .iter()
        .find(|(n, _, _)| n == "[Content_Types].xml")
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .ok_or("Not a valid .docx file (missing [Content_Types].xml)")?;
    let rels_xml = entries
        .iter()
        .find(|(n, _, _)| n == "word/_rels/document.xml.rels")
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();

    let media_rel = format!("media/nc_prefab_{id}.png");
    let media_path = format!("word/{media_rel}");
    let rel_id = next_rel_id(&rels_xml);
    let doc_pr_id = next_numeric_id(&doc_xml);
    // Max 6.0 in × 7.5 in (914400 EMU per inch).
    let (cx, cy) = emu_fit(prefab.width, prefab.height, 5_486_400.0, 6_858_000.0);
    let para = docx_drawing_paragraph(doc_pr_id, &rel_id, &prefab.name, &prefab.spec_json, cx, cy);

    let new_doc_xml = if let Some(ph) = replace_placeholder.filter(|s| !s.is_empty()) {
        replace_xml_paragraph_containing(&doc_xml, "<w:p", "</w:p>", ph, &para).ok_or_else(|| {
            format!("Placeholder '{ph}' was not found in word/document.xml")
        })?
    } else if position == Some("start") {
        let body_start = doc_xml
            .find("<w:body")
            .and_then(|at| doc_xml[at..].find('>').map(|gt| at + gt + 1))
            .ok_or("Missing <w:body> in word/document.xml")?;
        format!("{}{para}{}", &doc_xml[..body_start], &doc_xml[body_start..])
    } else {
        // Insert before trailing <w:sectPr> inside <w:body> (if present) so page setup stays intact.
        let body_end = doc_xml
            .rfind("</w:body>")
            .ok_or("Missing </w:body> in word/document.xml")?;
        let insert_at = doc_xml[..body_end].rfind("<w:sectPr").unwrap_or(body_end);
        format!("{}{para}{}", &doc_xml[..insert_at], &doc_xml[insert_at..])
    };

    upsert_zip_entry(
        &mut entries,
        &media_path,
        png.to_vec(),
        CompressionMethod::Stored,
    );
    upsert_zip_entry(
        &mut entries,
        "[Content_Types].xml",
        ensure_png_content_type(&ct_xml).into_bytes(),
        CompressionMethod::Deflated,
    );
    upsert_zip_entry(
        &mut entries,
        "word/_rels/document.xml.rels",
        add_relationship(&rels_xml, &rel_id, &media_rel).into_bytes(),
        CompressionMethod::Deflated,
    );
    upsert_zip_entry(
        &mut entries,
        "word/document.xml",
        new_doc_xml.into_bytes(),
        CompressionMethod::Deflated,
    );
    write_zip_entries(&entries)
}

pub(super) fn insert_into_pptx(
    data: &[u8],
    prefab: &RenderedPrefab,
    png: &[u8],
    id: &str,
    slide_page: Option<usize>,
) -> Res<(Vec<u8>, usize)> {
    let mut entries = read_zip_entries(data)?;
    let mut slide_nums: Vec<usize> = entries
        .iter()
        .filter_map(|(n, _, _)| {
            let rest = n.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?;
            rest.parse::<usize>().ok()
        })
        .collect();
    slide_nums.sort_unstable();
    if slide_nums.is_empty() {
        return Err("Not a valid .pptx file (no slides found)".into());
    }
    let slide_num = match slide_page {
        Some(n) if slide_nums.contains(&n) => n,
        Some(n) => {
            return Err(format!(
                "Slide {n} does not exist (available slides: 1..={})",
                slide_nums.last().unwrap()
            )
            .into())
        }
        None => *slide_nums.last().unwrap(),
    };

    let slide_path = format!("ppt/slides/slide{slide_num}.xml");
    let rels_path = format!("ppt/slides/_rels/slide{slide_num}.xml.rels");
    let slide_xml = entries
        .iter()
        .find(|(n, _, _)| n == &slide_path)
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .ok_or("Missing slide XML")?;
    let ct_xml = entries
        .iter()
        .find(|(n, _, _)| n == "[Content_Types].xml")
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .ok_or("Missing [Content_Types].xml")?;
    let rels_xml = entries
        .iter()
        .find(|(n, _, _)| n == &rels_path)
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();

    // Standard 4:3 / 16:9 slide bounds (read <p:sldSz> when available).
    let (slide_cx, slide_cy) = entries
        .iter()
        .find(|(n, _, _)| n == "ppt/presentation.xml")
        .and_then(|(_, b, _)| {
            let xml = String::from_utf8_lossy(b);
            let at = xml.find("<p:sldSz")?;
            let tag = &xml[at..at + xml[at..].find('>')?];
            let read_attr = |k: &str| -> Option<f64> {
                let p = tag.find(k)?;
                let v = &tag[p + k.len()..];
                v[..v.find('"')?].parse().ok()
            };
            Some((read_attr("cx=\"")?, read_attr("cy=\"")?))
        })
        .unwrap_or((9_144_000.0, 6_858_000.0));

    let (cx, cy) = emu_fit(prefab.width, prefab.height, slide_cx * 0.78, slide_cy * 0.72);
    let x = ((slide_cx - cx as f64) / 2.0).max(0.0) as u64;
    let y = ((slide_cy - cy as f64) / 2.0).max(0.0) as u64;

    let media_path = format!("ppt/media/nc_prefab_{id}.png");
    let media_rel = format!("../media/nc_prefab_{id}.png");
    let rel_id = next_rel_id(&rels_xml);
    let pic_id = next_numeric_id(&slide_xml);
    let pic = pptx_pic_xml(pic_id, &rel_id, &prefab.name, &prefab.spec_json, x, y, cx, cy);

    let sp_end = slide_xml
        .rfind("</p:spTree>")
        .ok_or("Missing </p:spTree> in slide XML")?;
    let new_slide_xml = format!("{}{pic}{}", &slide_xml[..sp_end], &slide_xml[sp_end..]);

    upsert_zip_entry(
        &mut entries,
        &media_path,
        png.to_vec(),
        CompressionMethod::Stored,
    );
    upsert_zip_entry(
        &mut entries,
        "[Content_Types].xml",
        ensure_png_content_type(&ct_xml).into_bytes(),
        CompressionMethod::Deflated,
    );
    upsert_zip_entry(
        &mut entries,
        &rels_path,
        add_relationship(&rels_xml, &rel_id, &media_rel).into_bytes(),
        CompressionMethod::Deflated,
    );
    upsert_zip_entry(
        &mut entries,
        &slide_path,
        new_slide_xml.into_bytes(),
        CompressionMethod::Deflated,
    );
    Ok((write_zip_entries(&entries)?, slide_num))
}

pub(super) fn insert_into_odf(
    data: &[u8],
    ext: &str,
    prefab: &RenderedPrefab,
    png: &[u8],
    id: &str,
    page: Option<usize>,
    replace_placeholder: Option<&str>,
) -> Res<Vec<u8>> {
    let mut entries = read_zip_entries(data)?;
    let content_xml = entries
        .iter()
        .find(|(n, _, _)| n == "content.xml")
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .ok_or("Not a valid OpenDocument file (missing content.xml)")?;
    let manifest_xml = entries
        .iter()
        .find(|(n, _, _)| n == "META-INF/manifest.xml")
        .map(|(_, b, _)| String::from_utf8_lossy(b).into_owned())
        .ok_or("Not a valid OpenDocument file (missing META-INF/manifest.xml)")?;

    let pic_path = format!("Pictures/nc_prefab_{id}.png");
    let aspect = (prefab.height / prefab.width.max(1.0)).max(0.05);
    let max_w_cm = if ext == "odp" { 20.0 } else { 15.0 };
    let max_h_cm = if ext == "odp" { 13.0 } else { 19.0 };
    let mut w_cm = max_w_cm;
    let mut h_cm = w_cm * aspect;
    if h_cm > max_h_cm {
        h_cm = max_h_cm;
        w_cm = h_cm / aspect;
    }
    let esc_name = xml_escape(&prefab.name);
    let esc_desc = xml_escape(&format!("notecomplete-prefab:{}", prefab.spec_json));

    let new_content_xml = if ext == "odp" {
        let frame = format!(
            "<draw:frame draw:name=\"{esc_name}\" svg:width=\"{w_cm:.2}cm\" svg:height=\"{h_cm:.2}cm\" svg:x=\"3.00cm\" svg:y=\"3.00cm\">\
            <draw:image xlink:href=\"{pic_path}\" xlink:type=\"simple\" xlink:show=\"embed\" xlink:actuate=\"onLoad\"/>\
            <svg:desc>{esc_desc}</svg:desc>\
            </draw:frame>"
        );
        let positions: Vec<usize> = content_xml
            .match_indices("</draw:page>")
            .map(|(i, _)| i)
            .collect();
        if positions.is_empty() {
            return Err("No <draw:page> found in .odp content.xml".into());
        }
        let target_idx = match page {
            Some(p) if p >= 1 && p <= positions.len() => p - 1,
            Some(p) => {
                return Err(format!(
                    "Slide {p} does not exist (.odp has {} slides)",
                    positions.len()
                )
                .into())
            }
            None => positions.len() - 1,
        };
        let at = positions[target_idx];
        format!("{}{frame}{}", &content_xml[..at], &content_xml[at..])
    } else {
        let para = format!(
            "<text:p><draw:frame draw:name=\"{esc_name}\" text:anchor-type=\"as-char\" svg:width=\"{w_cm:.2}cm\" svg:height=\"{h_cm:.2}cm\">\
            <draw:image xlink:href=\"{pic_path}\" xlink:type=\"simple\" xlink:show=\"embed\" xlink:actuate=\"onLoad\"/>\
            <svg:desc>{esc_desc}</svg:desc>\
            </draw:frame></text:p>"
        );
        if let Some(ph) = replace_placeholder.filter(|s| !s.is_empty()) {
            replace_xml_paragraph_containing(&content_xml, "<text:p", "</text:p>", ph, &para)
                .ok_or_else(|| format!("Placeholder '{ph}' was not found in content.xml"))?
        } else {
            let at = content_xml
                .rfind("</office:text>")
                .ok_or("Missing </office:text> in .odt content.xml")?;
            format!("{}{para}{}", &content_xml[..at], &content_xml[at..])
        }
    };

    let manifest_entry = format!(
        "<manifest:file-entry manifest:full-path=\"{pic_path}\" manifest:media-type=\"image/png\"/>"
    );
    let new_manifest = if let Some(at) = manifest_xml.rfind("</manifest:manifest>") {
        format!("{}{manifest_entry}{}", &manifest_xml[..at], &manifest_xml[at..])
    } else {
        manifest_xml
    };

    upsert_zip_entry(
        &mut entries,
        &pic_path,
        png.to_vec(),
        CompressionMethod::Stored,
    );
    upsert_zip_entry(
        &mut entries,
        "content.xml",
        new_content_xml.into_bytes(),
        CompressionMethod::Deflated,
    );
    upsert_zip_entry(
        &mut entries,
        "META-INF/manifest.xml",
        new_manifest.into_bytes(),
        CompressionMethod::Deflated,
    );
    write_zip_entries(&entries)
}

fn prefab_id() -> String {
    format!(
        "p{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(1)
    )
}

fn preview_content(report: Value, prefab: &RenderedPrefab) -> Res<Value> {
    let mut content =
        vec![json!({"type":"text","text":serde_json::to_string_pretty(&report)?})];
    match prefab.to_png(900) {
        Ok(png) => content.push(
            json!({"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"}),
        ),
        Err(e) => content.push(json!({"type":"text","text":format!("No preview: {e}")})),
    }
    Ok(Value::Array(content))
}

/// Handles `add_prefab` for non-notebook documents (`.md`, `.html`, Euro-Office
/// `.docx`/`.pptx`/`.odt`/`.odp`) and for `.notecomp`/`.nfedit` Markdown notes
/// (`target: "notes"`).
pub(super) fn add_prefab_to_document(args: &Value, source: &Path, ext: &str) -> Res<Value> {
    let prefab = render_prefab(&args["spec"])?;
    let position = args["position"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let after_heading = args["after_heading"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let replace_placeholder = args["replace_placeholder"].as_str();
    let alt = args["alt"].as_str().map(str::trim).filter(|s| !s.is_empty());

    // Target: embedded Markdown notes inside a .notecomp / .notepart / .nfedit notebook.
    if args["target"].as_str() == Some("notes") {
        let block = prefab.markdown_block(alt);
        let mut write_args = json!({
            "path": source,
            "text": block,
            "mode": "append",
        });
        if let Some(p) = args["page"].as_u64() {
            write_args["page"] = json!(p);
        }
        let res = super::write_notes(&write_args)?;
        let report = json!({
            "written": res["written"],
            "backup": res["backup"],
            "target": "notes",
            "prefab": prefab.name,
            "editable_in_notecomplete": true,
        });
        return preview_content(report, &prefab);
    }

    if is_markdown_ext(ext) {
        let original = std::fs::read_to_string(source)?;
        let block = prefab.markdown_block(alt);
        let updated = insert_into_markdown(
            &original,
            &block,
            position,
            after_heading,
            replace_placeholder,
        )?;
        let (out, backup) = doc_destination(args, source)?;
        write_atomic(&out, updated.as_bytes(), backup.as_deref())?;
        let report = json!({
            "written": out,
            "backup": backup,
            "format": "markdown",
            "prefab": prefab.name,
            "editable_in_notecomplete": true,
        });
        return preview_content(report, &prefab);
    }

    if is_html_ext(ext) {
        let original = std::fs::read_to_string(source)?;
        let block = prefab.html_block(alt);
        let updated = insert_into_html(&original, &block, position, replace_placeholder)?;
        let (out, backup) = doc_destination(args, source)?;
        write_atomic(&out, updated.as_bytes(), backup.as_deref())?;
        let report = json!({
            "written": out,
            "backup": backup,
            "format": "html",
            "prefab": prefab.name,
            "editable_in_notecomplete": true,
        });
        return preview_content(report, &prefab);
    }

    if is_office_ext(ext) {
        let data = std::fs::read(source)?;
        let px_w = (prefab.width * 2.5).round().clamp(600.0, 2000.0) as u32;
        let png = prefab.to_png(px_w)?;
        let id = prefab_id();
        let page = args["page"].as_u64().map(|p| p as usize);
        let (updated, slide_used) = match ext {
            "docx" | "docm" => (
                insert_into_docx(&data, &prefab, &png, &id, position, replace_placeholder)?,
                None,
            ),
            "pptx" | "pptm" => {
                let (bytes, slide) = insert_into_pptx(&data, &prefab, &png, &id, page)?;
                (bytes, Some(slide))
            }
            "odt" | "odp" => (
                insert_into_odf(&data, ext, &prefab, &png, &id, page, replace_placeholder)?,
                if ext == "odp" { page } else { None },
            ),
            _ => return Err(format!("Unsupported Office format .{ext}").into()),
        };
        let (out, backup) = doc_destination(args, source)?;
        write_atomic(&out, &updated, backup.as_deref())?;
        let mut report = json!({
            "written": out,
            "backup": backup,
            "format": format!("euro-office (.{ext})"),
            "prefab": prefab.name,
            "prefab_id": id,
        });
        if let Some(slide) = slide_used {
            report["slide"] = json!(slide);
        }
        return preview_content(report, &prefab);
    }

    Err(format!(
        "Unsupported document type '.{ext}' for add_prefab. Supported: .noteful, .notecomp, .nfedit, .goodnotes, .ntb, .md/.markdown/.txt, .html/.htm, and Euro-Office (.docx, .pptx, .odt, .odp)."
    )
    .into())
}

/// Creates a new Markdown (`.md`) document in the NoteComplete folder (or `out`),
/// optionally rendering and embedding editable NoteComplete prefabs for any
/// `<!-- PREFAB:key -->` or `{{prefab:key}}` placeholders supplied in `prefabs`.
pub(super) fn create_markdown(args: &Value) -> Res<Value> {
    let title = args["title"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("title is required")?;
    if title.len() > 512 {
        return Err("title is longer than 512 bytes".into());
    }
    let raw_md = args["markdown"]
        .as_str()
        .filter(|m| !m.trim().is_empty())
        .ok_or("markdown is required")?;
    if raw_md.len() > 8 << 20 {
        return Err("markdown is larger than 8 MiB".into());
    }

    let mut md = raw_md.to_owned();
    let mut rendered_list: Vec<(String, RenderedPrefab)> = Vec::new();
    if let Some(prefabs) = args["prefabs"].as_object() {
        for (key, spec) in prefabs {
            let rendered = render_prefab(spec)?;
            let block = rendered.markdown_block(None);
            let comment_ph = format!("<!-- PREFAB:{key} -->");
            let brace_ph = format!("{{{{prefab:{key}}}}}");
            if md.contains(&comment_ph) {
                md = md.replace(&comment_ph, &block);
            } else if md.contains(&brace_ph) {
                md = md.replace(&brace_ph, &block);
            } else {
                // Append at the end if no explicit placeholder was placed.
                md = insert_into_markdown(&md, &block, Some("end"), None, None)?;
            }
            rendered_list.push((key.clone(), rendered));
        }
    }
    if !md.ends_with('\n') {
        md.push('\n');
    }

    let overwrite = args["overwrite"].as_bool() == Some(true);
    let out = if let Some(p) = args["out"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        let out = PathBuf::from(p);
        let e = out
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !matches!(e.as_str(), "md" | "markdown") {
            return Err("out for create_markdown must end in .md or .markdown".into());
        }
        if out.exists() && !overwrite {
            return Err(format!(
                "{} exists; pass overwrite: true to replace it",
                out.display()
            )
            .into());
        }
        out
    } else {
        let dir = library();
        let stem = safe(title).trim().chars().take(80).collect::<String>();
        let stem = if stem.is_empty() {
            "Document".to_owned()
        } else {
            stem
        };
        let mut path = dir.join(format!("{stem}.md"));
        let mut n = 2;
        while path.exists() && !overwrite {
            path = dir.join(format!("{stem} ({n}).md"));
            n += 1;
        }
        path
    };

    write_atomic(&out, md.as_bytes(), None)?;
    let report = json!({
        "written": out,
        "format": "markdown",
        "characters": md.chars().count(),
        "prefabs_embedded": rendered_list.iter().map(|(k, r)| json!({"key": k, "name": r.name})).collect::<Vec<_>>(),
        "open": "Open this .md file in NoteComplete to view and double-click any embedded prefab to edit it.",
    });
    let mut content =
        vec![json!({"type":"text","text":serde_json::to_string_pretty(&report)?})];
    for (_, rendered) in rendered_list.iter().take(3) {
        if let Ok(png) = rendered.to_png(900) {
            content.push(
                json!({"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"}),
            );
        }
    }
    Ok(Value::Array(content))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_prefab() -> RenderedPrefab {
        let spec_json = r#"{"type":"bar","title":"Scores","bins":[{"label":"A","value":5}]}"#.to_owned();
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 200\"><rect width=\"400\" height=\"200\" fill=\"#fff\"/></svg>".to_owned();
        let svg_with_spec = embed_spec_in_svg(&svg, &spec_json);
        RenderedPrefab {
            svg,
            svg_with_spec,
            width: 400.0,
            height: 200.0,
            name: "Scores".to_owned(),
            spec_json,
        }
    }

    fn minimal_docx() -> Vec<u8> {
        let entries = vec![
            (
                "[Content_Types].xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/></Types>".to_vec(),
                CompressionMethod::Deflated,
            ),
            (
                "word/_rels/document.xml.rels".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>".to_vec(),
                CompressionMethod::Deflated,
            ),
            (
                "word/document.xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Hello <!-- CHART --></w:t></w:r></w:p><w:sectPr/></w:body></w:document>".to_vec(),
                CompressionMethod::Deflated,
            ),
        ];
        write_zip_entries(&entries).unwrap()
    }

    fn minimal_pptx() -> Vec<u8> {
        let entries = vec![
            (
                "[Content_Types].xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>".to_vec(),
                CompressionMethod::Deflated,
            ),
            (
                "ppt/presentation.xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:presentation xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:sldSz cx=\"9144000\" cy=\"5143500\"/></p:presentation>".to_vec(),
                CompressionMethod::Deflated,
            ),
            (
                "ppt/slides/slide1.xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>".to_vec(),
                CompressionMethod::Deflated,
            ),
        ];
        write_zip_entries(&entries).unwrap()
    }

    fn minimal_odt() -> Vec<u8> {
        let entries = vec![
            (
                "META-INF/manifest.xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\"></manifest:manifest>".to_vec(),
                CompressionMethod::Deflated,
            ),
            (
                "content.xml".into(),
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\" xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><office:body><office:text><text:p>Intro</text:p></office:text></office:body></office:document-content>".to_vec(),
                CompressionMethod::Deflated,
            ),
        ];
        write_zip_entries(&entries).unwrap()
    }

    #[test]
    fn markdown_prefab_embedding_and_positioning() {
        let p = sample_prefab();
        let block = p.markdown_block(None);
        assert!(block.starts_with("![Scores](data:image/svg+xml;utf8,"));
        assert!(block.contains("data-nc-prefab-spec"));
        assert!(!block[block.find('(').unwrap() + 1..block.len() - 1].contains(')'));

        let doc = "# Title\n\n## Results\nSome text.\n\n## Next\nMore.\n";
        let by_heading = insert_into_markdown(doc, &block, None, Some("Results"), None).unwrap();
        let res_pos = by_heading.find("Some text.").unwrap();
        let blk_pos = by_heading.find(&block).unwrap();
        let next_pos = by_heading.find("## Next").unwrap();
        assert!(res_pos < blk_pos && blk_pos < next_pos);

        let ph_doc = "# Title\n\n<!-- PREFAB:chart -->\n";
        let by_ph = insert_into_markdown(ph_doc, &block, None, None, Some("<!-- PREFAB:chart -->")).unwrap();
        assert!(by_ph.contains(&block) && !by_ph.contains("<!-- PREFAB:chart -->"));

        let fm_doc = "---\ntitle: Test\n---\n\nBody\n";
        let at_start = insert_into_markdown(fm_doc, &block, Some("start"), None, None).unwrap();
        assert!(at_start.starts_with("---\ntitle: Test\n---\n\n![Scores]"));
    }

    #[test]
    fn html_and_euro_office_prefab_insertion() {
        let p = sample_prefab();
        let html = "<html><body><p>Hi</p></body></html>";
        let out_html = insert_into_html(html, &p.html_block(None), Some("end"), None).unwrap();
        assert!(out_html.contains("<figure class=\"nc-prefab\">") && out_html.ends_with("</body></html>"));

        let fake_png = b"\x89PNG\r\n\x1a\nfake";
        // DOCX append before sectPr
        let docx_out = insert_into_docx(&minimal_docx(), &p, fake_png, "abc", None, None).unwrap();
        let docx_entries = read_zip_entries(&docx_out).unwrap();
        assert!(docx_entries.iter().any(|(n, _, _)| n == "word/media/nc_prefab_abc.png"));
        let doc_xml = String::from_utf8(docx_entries.iter().find(|(n, _, _)| n == "word/document.xml").unwrap().1.clone()).unwrap();
        assert!(doc_xml.contains("notecomplete-prefab:") && doc_xml.find("<w:drawing>").unwrap() < doc_xml.find("<w:sectPr/>").unwrap());
        let ct_xml = String::from_utf8(docx_entries.iter().find(|(n, _, _)| n == "[Content_Types].xml").unwrap().1.clone()).unwrap();
        assert!(ct_xml.contains("Extension=\"png\""));

        // DOCX placeholder replacement
        let docx_ph = insert_into_docx(&minimal_docx(), &p, fake_png, "ph1", None, Some("<!-- CHART -->")).unwrap();
        let docx_ph_entries = read_zip_entries(&docx_ph).unwrap();
        let doc_ph_xml = String::from_utf8(docx_ph_entries.iter().find(|(n, _, _)| n == "word/document.xml").unwrap().1.clone()).unwrap();
        assert!(doc_ph_xml.contains("<w:drawing>") && !doc_ph_xml.contains("<!-- CHART -->"));

        // PPTX slide insertion
        let (pptx_out, slide) = insert_into_pptx(&minimal_pptx(), &p, fake_png, "s1", Some(1)).unwrap();
        assert_eq!(slide, 1);
        let pptx_entries = read_zip_entries(&pptx_out).unwrap();
        assert!(pptx_entries.iter().any(|(n, _, _)| n == "ppt/media/nc_prefab_s1.png"));
        let slide_xml = String::from_utf8(pptx_entries.iter().find(|(n, _, _)| n == "ppt/slides/slide1.xml").unwrap().1.clone()).unwrap();
        assert!(slide_xml.contains("<p:pic>") && slide_xml.contains("notecomplete-prefab:"));

        // ODT insertion
        let odt_out = insert_into_odf(&minimal_odt(), "odt", &p, fake_png, "o1", None, None).unwrap();
        let odt_entries = read_zip_entries(&odt_out).unwrap();
        assert!(odt_entries.iter().any(|(n, _, _)| n == "Pictures/nc_prefab_o1.png"));
        let odt_xml = String::from_utf8(odt_entries.iter().find(|(n, _, _)| n == "content.xml").unwrap().1.clone()).unwrap();
        assert!(odt_xml.contains("Pictures/nc_prefab_o1.png") && odt_xml.contains("notecomplete-prefab:"));
    }
}
