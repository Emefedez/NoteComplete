//! The MCP server's ink tools: new handwritten notebooks, handwritten pages
//! added to a note, clean copies, marks on a page, the page layout for aiming
//! them, example pages, the style guide as resources, and study prompts.
//!
//! Safety: the input note is never changed unless `in_place` is true, and
//! then the previous file is kept as `<name>.bak`. Without `out` a copy goes
//! to the NoteComplete folder's `ink/` subfolder under a free name; an `out`
//! that exists is replaced only with `overwrite: true`.
use super::*;
use noteful_core::ink::{
    self, annotate, compose, insert_pages, layout_overlay, new_notebook, page_layout, paper_styles,
    paper_svg, seed_of, writable_layer, ComposeOptions, FontName, Hand, InkPage, Item, Look, Paper,
    A4, DIALECT, EXAMPLES, FONT_NAMES,
};

pub(super) const STYLE_GUIDE: &str = "How to write a good page with these tools.

1. Pick the kind of page and read its example first (example_pages, or the noteful://examples
   resources): cell-biology or radiation for a summary, clean-copy for a worked problem, quiz for
   questions, answers-tree for an answer key or a tree diagram.
2. Copy the structure, not the words: a title and subtitle, then a diagram next to the
   explanation in '!columns', cards for comparisons, a coloured '!zone' near the end with a
   '!stat' and a '!sticky'. Fill about 90 % of one page; stop before it spills onto a second.
3. Draw diagrams as plain SVG, like the drawing examples: a viewBox about 400-650 wide, fills in
   the palette (#ffb48a #8fc3ff #c9b6ff #9fe3c4 #ffe066 #f4a3a3) with a dark outline, later shapes
   on top of earlier ones, labels outside the drawing (font-size 18-22) joined to their part by a
   <line>.
4. Keep 2-3 accent colours per page, mixed-case body text, '**term**' and '==phrase==' only where
   they matter, '((grey detail))' for the secondary line.
5. Write in the language of the user's notes. After writing, look at the preview the tool returns
   and fix what overlaps or runs off the page.

Avoid (pages built like this look generated): titles split into two colours with doodles on
both sides; body text in capitals (caps belong to titles, headings and card titles); a new colour
for every section; tags crowded into pills at the top; a page of stacked full-width boxes with no
diagram, or blocks touching each other.
";

fn opt_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args[key].as_str().map(str::trim).filter(|s| !s.is_empty())
}
fn enum_err(key: &str, value: &str, allowed: &str) -> Box<dyn Error> {
    format!("{key} must be one of {allowed}, not '{value}'").into()
}

/// Composition options from tool arguments; `defaults` are (paper, hand, look).
fn options(args: &Value, paper: Paper, hand: Option<Hand>, seed: u64) -> Res<ComposeOptions> {
    let dark = match opt_str(args, "theme").unwrap_or("light") {
        "light" => false,
        "dark" => true,
        t => return Err(enum_err("theme", t, "light, dark")),
    };
    let paper = match opt_str(args, "paper") {
        None | Some("inherit") => paper,
        Some(p) => Paper::parse(p).ok_or_else(|| {
            enum_err(
                "paper",
                p,
                "dot, grid, ruled, blank, dark-dot, dark-grid, dark-ruled, dark-blank",
            )
        })?,
    };
    let look = match opt_str(args, "look").unwrap_or("study") {
        "study" => Look::Study,
        "classic" => Look::Classic,
        l => return Err(enum_err("look", l, "study, classic")),
    };
    let font = match opt_str(args, "font") {
        None => FontName::Patrick,
        Some(f) => FontName::parse(f).ok_or_else(|| enum_err("font", f, &FONT_NAMES.join(", ")))?,
    };
    let hand = match opt_str(args, "hand") {
        None => hand,
        Some(h) => Some(Hand::parse(h).ok_or_else(|| enum_err("hand", h, "neat, natural, messy"))?),
    };
    let fineliner = match opt_str(args, "pen") {
        None => None,
        Some("fineliner") => Some(true),
        Some("ballpoint") => Some(false),
        Some(p) => return Err(enum_err("pen", p, "fineliner, ballpoint")),
    };
    let ink = match opt_str(args, "ink") {
        None | Some("ink") | Some("theme") => None,
        Some(c) => Some(
            ink::color(c).ok_or_else(|| format!("ink must be a colour name or #hex, not '{c}'"))?,
        ),
    };
    let accent = opt_str(args, "accent").unwrap_or("sky").to_owned();
    if look == Look::Study && ink::accent_index(&accent).is_none() && ink::color(&accent).is_none()
    {
        return Err(enum_err(
            "accent",
            &accent,
            "coral, amber, sky, purple, teal, pink",
        ));
    }
    let size = args["size"].as_f64().unwrap_or(11.);
    let seed = args["seed"].as_u64().unwrap_or(seed);
    Ok(ComposeOptions {
        paper: paper.with_dark(dark || paper.dark),
        ink,
        accent,
        font,
        size,
        hand,
        fineliner,
        look,
        dark,
        seed,
    })
}

fn ext(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}
/// A note opened for writing, with its bytes (for recordings kept in a .notecomp).
fn open_for_edit(path: &Path) -> Res<(Editor, Vec<u8>)> {
    let data = std::fs::read(path)?;
    let editor = if is_nfedit(path) {
        Editor::open_project(std::str::from_utf8(&data)?)?
    } else if is_notecomplete(&data) {
        Editor::open_notecomplete(&data)?
    } else {
        Editor::open(&data)?
    };
    Ok((editor, data))
}
fn writable_ext(e: &str) -> Res<&'static str> {
    Ok(match e {
        "noteful" => "noteful",
        "notecomp" | "notepart" => "notecomp",
        "nfedit" => "nfedit",
        other => {
            return Err(
                format!("Write to a .noteful, .notecomp or .nfedit file, not .{other}").into(),
            )
        }
    })
}
/// Where to write: (path, backup of the original when replacing it in place).
pub(super) fn destination(
    args: &Value,
    source: Option<&Path>,
    title: &str,
) -> Res<(PathBuf, Option<PathBuf>)> {
    let overwrite = args["overwrite"].as_bool() == Some(true);
    if args["in_place"].as_bool() == Some(true) {
        let source = source.ok_or("in_place needs a source note")?;
        writable_ext(&ext(source))?;
        return Ok((
            source.to_path_buf(),
            Some(PathBuf::from(format!("{}.bak", source.display()))),
        ));
    }
    if let Some(out) = opt_str(args, "out") {
        let out = PathBuf::from(out);
        writable_ext(&ext(&out))?;
        if source.is_some_and(|s| {
            s == out || std::fs::canonicalize(s).ok() == std::fs::canonicalize(&out).ok()
        }) {
            return Err(
                "out is the source note; pass in_place: true to change it (a .bak copy is kept)"
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
    let e = writable_ext(&source.map(ext).unwrap_or_else(|| "noteful".into()))?;
    let dir = library().join("ink");
    let stem = safe(title.trim())
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    let stem = if stem.is_empty() {
        "Handwritten".to_owned()
    } else {
        stem
    };
    let mut path = dir.join(format!("{stem}.{e}"));
    let mut n = 2;
    while path.exists() && !overwrite {
        path = dir.join(format!("{stem} ({n}).{e}"));
        n += 1;
    }
    Ok((path, None))
}
/// Whether the file keeps the text of the handwriting just written, so NoteComplete
/// search and page_text find it without OCR.
fn kept_text(out: &Path) -> &'static str {
    match ext(out).as_str() {
        "notecomp" | "notepart" | "nfedit" => "kept: searchable in NoteComplete and readable with page_text",
        _ => "not kept: .noteful files have no place for it; write .notecomp (or .nfedit) to keep the handwriting searchable",
    }
}
pub(super) fn save(
    editor: &Editor,
    path: &Path,
    source: Option<&[u8]>,
    backup: Option<&Path>,
) -> Res<()> {
    let bytes = match writable_ext(&ext(path))? {
        "nfedit" => editor.save_project()?.into_bytes(),
        "notecomp" => {
            let entries = source
                .filter(|d| is_notecomplete(d))
                .map(notecomplete_audio)
                .transpose()?
                .unwrap_or_default();
            let data = source.unwrap_or_default();
            let audio: Vec<(AddedAudio, &[u8])> = entries
                .iter()
                .map(|e| (e.audio.clone(), &data[e.offset..e.offset + e.length]))
                .collect();
            editor.export_notecomplete_with(&audio)?
        }
        _ => editor.export_noteful()?,
    };
    if bytes.len() > 512 << 20 {
        return Err("The note would be larger than 512 MB".into());
    }
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
fn spill(pages: usize) -> Option<String> {
    (pages > 1).then(|| format!("The content filled {pages} pages; blocks that do not fit (a zone, a drawing, cards) move whole to the next page. If one page was meant, shorten it or drop a block."))
}
fn markdown_arg(args: &Value) -> Res<&str> {
    let md = args["markdown"]
        .as_str()
        .filter(|m| !m.trim().is_empty())
        .ok_or("markdown is required")?;
    if md.len() > ink::MAX_MARKDOWN {
        return Err("markdown is larger than 1 MiB".into());
    }
    Ok(md)
}

pub(super) fn tools() -> Vec<Value> {
    let path =
        json!({"type":"string","description":"Path to a .noteful, .notecomp or .nfedit note"});
    let page = json!({"type":"integer","minimum":1,"description":"Page number, starting at 1"});
    let style = format!("Markdown dialect:\n{DIALECT}\nRead an example first with example_pages.");
    let look_props = json!({
        "paper":{"type":"string","enum":["dot","grid","ruled","blank","dark-dot","dark-grid","dark-ruled","dark-blank"],"description":"Paper (default dot; ruled snaps lines to the rules)"},
        "theme":{"type":"string","enum":["light","dark"],"description":"light: ivory page, pastel washes (summaries). dark: black page, neon ink (questions, trees)"},
        "look":{"type":"string","enum":["study","classic"],"description":"study (default): composed study notes. classic: a plain notebook"},
        "accent":{"type":"string","description":"First section colour: coral, amber, sky (default), purple, teal, pink. Classic: any pen colour"},
        "ink":{"type":"string","description":"Body ink: a name (ink, black, blue, …) or #hex; default the theme's ink"},
        "font":{"type":"string","enum":FONT_NAMES,"description":"Handwriting (default patrick)"},
        "hand":{"type":"string","enum":["neat","natural","messy"],"description":"How much letters wobble (study default neat, classic natural)"},
        "pen":{"type":"string","enum":["fineliner","ballpoint"],"description":"fineliner: even line (study default). ballpoint: pressure strokes (classic default)"},
        "size":{"type":"number","minimum":4,"maximum":60,"description":"Body x-height in page units (default 11; the page is 1091 × 1543)"},
        "seed":{"type":"integer","minimum":0,"description":"Same seed, same strokes (default: from the text)"},
    });
    let write_props = json!({
        "out":{"type":"string","description":"Where to write (.noteful, .notecomp or .nfedit). Default: a new file in the NoteComplete folder's ink/ subfolder"},
        "overwrite":{"type":"boolean","description":"Replace an existing out file"},
        "in_place":{"type":"boolean","description":"Change the source note itself; the previous file is kept as <name>.bak"},
    });
    let merge = |base: Value, more: &[&Value]| -> Value {
        let mut m = base.as_object().cloned().unwrap_or_default();
        for v in more {
            m.extend(v.as_object().cloned().unwrap_or_default());
        }
        Value::Object(m)
    };
    vec![
        tool("create_notebook", &format!("Create a new notebook whose pages are written in natural, editable Noteful handwriting ink (pen, highlighter and tape strokes on generated paper). Returns where it was written and a picture of page 1.\n{style}"),
            merge(json!({"title":{"type":"string"},"markdown":{"type":"string"}}), &[&look_props, &json!({"out":write_props["out"],"overwrite":write_props["overwrite"]})]), &["title","markdown"]),
        tool("add_pages", &format!("Add handwritten pages to a note (at the end, or after page N), written to a copy unless in_place.\n{style}"),
            merge(json!({"path":path,"markdown":{"type":"string"},"after_page":{"type":"integer","minimum":0,"description":"Insert after this page (0 = at the start); default at the end"}}), &[&look_props, &write_props]), &["path","markdown"]),
        tool("clean_copy", &format!("Insert a neat handwritten rewrite right after a page. First read the messy page with page_image (and page_text); then pass the cleaned, well-structured content as markdown. Defaults: ruled paper, neat hand.\n{style}"),
            merge(json!({"path":path,"page":page,"markdown":{"type":"string"}}), &[&look_props, &write_props]), &["path","page","markdown"]),
        tool("write_on_page", "Draw on an existing page, written to a copy unless in_place. Highlighter goes under the page's ink; everything else on top. Coordinates are page units, origin top-left (A4 is 1091 × 1543). Aim with page_layout. Items (fields not used by a type are ignored):\n\
            {\"type\":\"text\",\"text\":\"…\",\"x\":100,\"y\":300,\"width\":800,\"color\":\"red\",\"size\":11,\"font\":\"patrick\",\"hand\":\"natural\",\"pen\":\"ballpoint\"} handwriting; y is the first baseline; wraps inside width\n\
            {\"type\":\"markdown\",\"text\":\"…\",\"x\":100,\"y\":300,\"width\":800,\"look\":\"classic\"} a Markdown snippet\n\
            {\"type\":\"textbox\",\"text\":\"…\",\"x\":..,\"y\":..,\"w\":..,\"h\":..,\"font\":\"Helvetica\",\"size\":16,\"color\":\"#1f2233\",\"bold\":false,\"italic\":false,\"underline\":false,\"strikethrough\":false,\"align\":\"left\"} a native typed Noteful text box (editable as text)\n\
            {\"type\":\"line\"|\"arrow\",\"from\":[x,y],\"to\":[x,y],\"color\":\"blue\"}\n\
            {\"type\":\"rect\",\"x\":..,\"y\":..,\"w\":..,\"h\":..,\"radius\":0}  {\"type\":\"ellipse\",\"cx\":..,\"cy\":..,\"rx\":..,\"ry\":..}\n\
            {\"type\":\"underline\",\"x0\":..,\"x1\":..,\"y\":..,\"double\":false}  {\"type\":\"check\"|\"cross\"|\"star\",\"x\":..,\"y\":..,\"size\":18}\n\
            {\"type\":\"highlight\",\"x\":..,\"y\":..,\"w\":..,\"h\":24,\"color\":\"yellow\"} covers a box (y = top of the letters, h ≈ 24 per line); colours yellow, pink, mint, lavender, peach, blue or #hex\n\
            {\"type\":\"highlight_line\",\"from\":[x,y],\"to\":[x,y],\"width\":24,\"color\":\"pink\"}\n\
            {\"type\":\"tape\",\"x\":..,\"y\":..,\"w\":230,\"h\":40,\"angle\":0.05,\"palette\":\"mint\"} native Noteful tape (hides what is under it until tapped)\n\
            {\"type\":\"drawing\",\"svg\":\"<svg viewBox=…>…</svg>\",\"x\":..,\"y\":..,\"width\":400} an SVG diagram drawn in ink\n\
            Pen colour defaults to red. To grade a quiz: page_image to read the answers, page_layout to find each option's box, then one write_on_page call with every mark (a green check at x1 + 30 of a right answer, a red ellipse around a wrong one, a mint highlight on the right option, the score near the title).",
            merge(json!({"path":path,"page":page,"items":{"type":"array","items":{"type":"object","properties":{"type":{"type":"string","enum":["text","markdown","textbox","line","arrow","rect","ellipse","underline","check","cross","star","highlight","highlight_line","tape","drawing"]}},"required":["type"]}}}), &[&write_props]), &["path","page","items"]),
        tool("page_layout", "Where things are on a page, to aim write_on_page: the handwriting grouped into numbered items (words and phrases on one line) in reading order, highlighted regions, typed text boxes (with their text), images, shapes and tape, each with a bbox [x0, y0, x1, y1] in page units. With image (default true) it also returns the page with each item outlined and numbered.",
            json!({"path":path,"page":page,"image":{"type":"boolean"},"width":{"type":"integer","minimum":200,"maximum":2400}}), &["path","page"]),
        tool("example_pages", "Example pages and drawings to imitate before create_notebook, add_pages, clean_copy or a drawing. Without name: the list and the style guide. With name: its source (study Markdown or SVG) and how it looks.",
            json!({"name":{"type":"string","enum":EXAMPLES.iter().map(|e| e.name).collect::<Vec<_>>()}}), &[]),
    ]
}

impl Server {
    pub(super) fn call_ink(&mut self, name: &str, args: &Value) -> Option<Res<Value>> {
        Some(match name {
            "create_notebook" => self.create_notebook(args),
            "add_pages" => self.add_pages(args, None),
            "clean_copy" => self.add_pages(args, Some(page_arg(args).map(|p| p + 1))),
            "write_on_page" => self.write_on_page(args),
            "page_layout" => self.layout(args),
            "example_pages" => self.example(args),
            _ => return None,
        })
    }

    /// A written note's page as an image, or why there is none.
    pub(super) fn preview(&mut self, path: &Path, display: usize, report: Value) -> Res<Value> {
        let mut content =
            vec![json!({"type":"text","text":serde_json::to_string_pretty(&report)?})];
        let args = json!({"path":path});
        match self
            .view(&args, display)
            .and_then(|v| self.page_png(&args, &v, 900))
        {
            Ok(png) => content
                .push(json!({"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"})),
            Err(e) => content.push(json!({"type":"text","text":format!("No preview: {e}")})),
        }
        Ok(Value::Array(content))
    }

    fn create_notebook(&mut self, args: &Value) -> Res<Value> {
        let title = opt_str(args, "title").ok_or("title is required")?;
        if title.len() > 512 {
            return Err("title is longer than 512 bytes".into());
        }
        let markdown = markdown_arg(args)?;
        let o = options_for(args, title, markdown)?;
        let (pages, warnings) = compose(markdown, &o)?;
        let editor = new_notebook(title, &pages)?;
        let (out, _) = destination(args, None, title)?;
        save(&editor, &out, None, None)?;
        let report = json!({"written":out,"pages":pages.len(),"warnings":warnings,"note":spill(pages.len()),"handwriting_text":kept_text(&out),
            "open":"Open it in NoteComplete, or import it on the iPad (Files → share to Noteful)."});
        self.preview(&out, 0, report)
    }

    /// The paper of a page, when it is generated paper.
    fn paper_of(editor: &Editor, display: usize) -> Option<Paper> {
        let v = editor.view(editor.slot(display).ok()?).ok()?;
        let bg = v["pdf_background"].as_object()?;
        let styles = paper_styles(editor.pdf_bytes(bg["resource_id"].as_str()?).ok()?)?;
        styles.get(bg["page_index"].as_u64()? as usize).copied()
    }

    /// add_pages, or clean_copy when `after` names the page to follow.
    fn add_pages(&mut self, args: &Value, after: Option<Res<usize>>) -> Res<Value> {
        let source = note_path(args)?;
        let markdown = markdown_arg(args)?;
        let (mut editor, data) = open_for_edit(&source)?;
        let count = editor.page_order().len();
        let clean = after.is_some();
        let at = match after {
            Some(page) => page?,
            None => match args["after_page"].as_u64() {
                Some(n) => n as usize,
                None => count,
            },
        };
        if at > count {
            return Err(
                format!("The note has {count} pages; after_page must be 0 to {count}").into(),
            );
        }
        let reference = at.saturating_sub(1).min(count.saturating_sub(1));
        let inherited = Self::paper_of(&editor, reference).unwrap_or(Paper::DOT);
        let paper = if clean && opt_str(args, "paper").is_none() {
            Paper::parse("ruled").unwrap()
        } else {
            inherited
        };
        let hand = clean.then_some(Hand::Neat);
        let o = options(
            args,
            paper,
            hand,
            seed_of(&format!("{}\n{markdown}", source.display())),
        )?;
        let (pages, warnings) = compose(markdown, &o)?;
        let shown = insert_pages(&mut editor, at, &pages)?;
        let title = editor.scene.title.clone();
        let (out, backup) = destination(args, Some(&source), &title)?;
        save(&editor, &out, Some(&data), backup.as_deref())?;
        let report = json!({"written":out,"backup":backup,"new_pages":shown.iter().map(|p| p + 1).collect::<Vec<_>>(),
            "pages":editor.page_order().len(),"warnings":warnings,"note":spill(pages.len()),"handwriting_text":kept_text(&out)});
        self.preview(&out, shown[0], report)
    }

    fn write_on_page(&mut self, args: &Value) -> Res<Value> {
        let source = note_path(args)?;
        let display = page_arg(args)?;
        let items: Vec<Item> =
            serde_json::from_value(args["items"].clone()).map_err(|e| format!("items: {e}"))?;
        if items.is_empty() {
            return Err("items must list at least one mark".into());
        }
        let (mut editor, data) = open_for_edit(&source)?;
        let slot = editor.slot(display).map_err(|_| {
            format!(
                "Page {} does not exist; the note has {} pages",
                display + 1,
                editor.page_order().len()
            )
        })?;
        let seed = args["seed"]
            .as_u64()
            .unwrap_or_else(|| seed_of(&args["items"].to_string()));
        let marks = annotate(&items, seed)?;
        let layer = writable_layer(&editor)?;
        let size = editor.view(slot)?["size"].clone();
        let (w, h) = (
            size[0].as_f64().unwrap_or(A4[0]),
            size[1].as_f64().unwrap_or(A4[1]),
        );
        let mut warnings = marks.warnings;
        let mut points: Vec<[f64; 2]> = marks
            .lines
            .iter()
            .flat_map(|l| l.points.iter().copied())
            .collect();
        for t in &marks.text_boxes {
            let [x, y, bw, bh] = t.bounds;
            points.extend([[x, y], [x + bw, y + bh]]);
        }
        let outside = points
            .iter()
            .filter(|[x, y]| *x < -5. || *y < -5. || *x > w + 5. || *y > h + 5.)
            .count();
        if outside > 0 {
            warnings.push(format!(
                "Some marks fall outside the page ({w:.0} × {h:.0}); check the preview."
            ));
        }
        let under = marks.lines.iter().filter(|l| l.under).count();
        let strokes = marks.lines.len();
        editor.add_lines(
            slot,
            marks
                .lines
                .into_iter()
                .map(|l| noteful_core::Line { layer, ..l })
                .collect(),
        )?;
        let boxes = marks.text_boxes.len();
        for tb in marks.text_boxes {
            editor.add_image(slot, noteful_core::Image { layer, ..tb })?;
        }
        let title = editor.scene.title.clone();
        let (out, backup) = destination(args, Some(&source), &title)?;
        save(&editor, &out, Some(&data), backup.as_deref())?;
        let report = json!({"written":out,"backup":backup,"page":display + 1,"strokes":strokes,"under_ink":under,"text_boxes":boxes,"warnings":warnings,"handwriting_text":kept_text(&out)});
        self.preview(&out, display, report)
    }

    fn layout(&mut self, args: &Value) -> Res<Value> {
        let display = page_arg(args)?;
        let width = args["width"].as_u64().unwrap_or(1100).clamp(200, 2400) as u32;
        let editor = self.open(args)?;
        if display >= editor.page_order().len() {
            return Err(format!(
                "Page {} does not exist; the note has {} pages",
                display + 1,
                editor.page_order().len()
            )
            .into());
        }
        let layout = page_layout(editor, display)?;
        let mut content =
            vec![json!({"type":"text","text":serde_json::to_string_pretty(&layout)?})];
        if args["image"].as_bool() != Some(false) {
            let mut v = self.view(args, display)?;
            let svg = v["svg"].as_str().unwrap_or_default();
            let at = svg.rfind("</svg>").unwrap_or(svg.len());
            v["svg"] = json!(format!(
                "{}{}{}",
                &svg[..at],
                layout_overlay(&layout),
                &svg[at..]
            ));
            match self.page_png(args, &v, width) {
                Ok(png) => content.push(
                    json!({"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"}),
                ),
                Err(e) => content.push(json!({"type":"text","text":format!("No image: {e}")})),
            }
        }
        Ok(Value::Array(content))
    }

    /// The example as a note in the server's temporary folder, for previews.
    fn example_file(&mut self, name: &str) -> Res<PathBuf> {
        let dir = std::env::temp_dir().join(format!("notecomplete-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("example-{}.noteful", safe(name)));
        if !path.exists() {
            let pages: Vec<InkPage> = ink::example_pages(name)?;
            std::fs::write(&path, new_notebook(name, &pages)?.export_noteful()?)?;
        }
        Ok(path)
    }
    pub(super) fn example_png(&mut self, name: &str) -> Res<Vec<u8>> {
        let path = self.example_file(name)?;
        let args = json!({"path":path});
        let v = self.view(&args, 0)?;
        self.page_png(&args, &v, 700)
    }
    fn example(&mut self, args: &Value) -> Res<Value> {
        let Some(name) = opt_str(args, "name") else {
            return Ok(
                json!([{"type":"text","text":format!("{}\n\n{STYLE_GUIDE}", examples_index())}]),
            );
        };
        let e = EXAMPLES.iter().find(|e| e.name == name).ok_or_else(|| {
            enum_err(
                "name",
                name,
                &EXAMPLES
                    .iter()
                    .map(|e| e.name)
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        })?;
        let mut content = vec![
            json!({"type":"text","text":format!("{} ({}, theme={}): {}\n\n{}", e.name, e.kind, if e.dark {"dark"} else {"light"}, e.use_for, e.source)}),
        ];
        match self.example_png(name) {
            Ok(png) => content
                .push(json!({"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"})),
            Err(err) => content.push(json!({"type":"text","text":format!("No preview: {err}")})),
        }
        Ok(Value::Array(content))
    }
}

pub(super) fn examples_index() -> String {
    let mut out = String::from("Example pages and drawings. Read one before writing a page of the same kind and follow its structure; adapt the content, keep the look.\n");
    for e in &EXAMPLES {
        out.push_str(&format!(
            "\n- {} ({}, {}): {}",
            e.name,
            e.kind,
            if e.dark { "dark" } else { "light" },
            e.use_for
        ));
    }
    out
}

/// The generated paper of a page background, drawn as SVG (no PDF renderer needed).
pub(super) fn paper_background(pdf: &[u8], index: u64, rect: [f64; 4]) -> Option<String> {
    let style = *paper_styles(pdf)?.get(index as usize)?;
    let [x, y, w, h] = rect;
    Some(format!(
        "<svg x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {} {}\" preserveAspectRatio=\"none\">{}</svg>",
        A4[0],
        A4[1],
        paper_svg(style, A4)
    ))
}

/// `noteful convert notes.md -o notes.noteful [--paper dot] [--look classic] …`:
/// Markdown into a handwritten notebook, with the same options as create_notebook.
pub(crate) fn convert(args: &[String]) -> Res<String> {
    let mut input = None;
    let mut options = serde_json::Map::new();
    let mut export: Option<String> = None;
    let mut width = 1654u32;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-o" | "--out" => {
                options.insert("out".into(), json!(it.next().ok_or("-o needs a path")?));
            }
            "--overwrite" => {
                options.insert("overwrite".into(), json!(true));
            }
            "--export" => {
                let e = it
                    .next()
                    .ok_or("--export needs pdf, png or svg")?
                    .to_ascii_lowercase();
                if !["pdf", "png", "svg"].contains(&e.as_str()) {
                    return Err(format!("--export must be pdf, png or svg, not {e}").into());
                }
                export = Some(e);
            }
            "--width" => {
                width = it
                    .next()
                    .and_then(|w| w.parse().ok())
                    .filter(|w| (200..=6000).contains(w))
                    .ok_or("--width needs a pixel width from 200 to 6000")?;
            }
            flag if flag.starts_with("--") => {
                let key = flag.trim_start_matches("--");
                if ![
                    "title", "paper", "look", "theme", "font", "hand", "pen", "accent", "ink",
                    "size", "seed",
                ]
                .contains(&key)
                {
                    return Err(format!("Unknown option {flag}").into());
                }
                let value = it.next().ok_or_else(|| format!("{flag} needs a value"))?;
                let value = match key {
                    "size" => json!(value.parse::<f64>().map_err(|_| "--size needs a number")?),
                    "seed" => json!(value
                        .parse::<u64>()
                        .map_err(|_| "--seed needs a whole number")?),
                    _ => json!(value),
                };
                options.insert(key.into(), value);
            }
            path if input.is_none() => input = Some(path.to_owned()),
            extra => return Err(format!("Unexpected argument {extra}").into()),
        }
    }
    let input = input.ok_or("Usage: noteful convert <notes.md|-> -o <out.noteful|.notecomp|.nfedit> [--title T] [--paper dot|grid|ruled|blank] [--look study|classic] [--theme light|dark] [--font F] [--hand neat|natural|messy] [--pen fineliner|ballpoint] [--accent sky] [--size 11] [--seed N] [--overwrite]\n       noteful convert <notes.md> --export pdf|png|svg -o <out.pdf | folder or name.png/.svg> [--width 1654] […]")?;
    let markdown = if input == "-" {
        let mut s = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
        s
    } else {
        std::fs::read_to_string(&input)?
    };
    if !options.contains_key("out") {
        return Err("Name the output with -o (a .noteful, .notecomp or .nfedit file, or with --export a .pdf file or a folder)".into());
    }
    let title = options
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            Path::new(&input)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .filter(|s| s != "-")
        })
        .unwrap_or_else(|| "Notes".into());
    let args = Value::Object(options);
    let o = options_for(&args, &title, &markdown)?;
    let (pages, warnings) = compose(&markdown, &o)?;
    let editor = new_notebook(&title, &pages)?;
    let mut report = match export {
        Some(kind) => {
            let out = PathBuf::from(args["out"].as_str().unwrap_or_default());
            let written = export_pages(
                &editor,
                &kind,
                &out,
                width,
                args["overwrite"].as_bool() == Some(true),
            )?;
            format!(
                "Wrote {} ({} page{})",
                written
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", "),
                pages.len(),
                if pages.len() == 1 { "" } else { "s" }
            )
        }
        None => {
            let (out, _) = destination(&args, None, &title)?;
            save(&editor, &out, None, None)?;
            format!(
                "Wrote {} ({} page{})",
                out.display(),
                pages.len(),
                if pages.len() == 1 { "" } else { "s" }
            )
        }
    };
    for w in warnings {
        report.push_str(&format!("\nWarning: {w}"));
    }
    Ok(report)
}
/// A note's pages as SVG (vector, paper included), PNG or one PDF. `out` is the
/// PDF file, or for images a folder or a name whose stem gets -1, -2, ….
pub(crate) fn export_pages(
    editor: &Editor,
    kind: &str,
    out: &Path,
    width: u32,
    overwrite: bool,
) -> Res<Vec<PathBuf>> {
    let count = editor.page_order().len();
    let mut svgs = Vec::new();
    for i in 0..count {
        let (svg, complete) = ink::page_svg(editor, i)?;
        if !complete {
            return Err(format!("Page {} has a PDF background that only NoteComplete can draw; export it from the app", i + 1).into());
        }
        svgs.push(svg);
    }
    let refuse = |p: &Path| -> Res<()> {
        if p.exists() && !overwrite {
            return Err(format!("{} exists; pass --overwrite to replace it", p.display()).into());
        }
        Ok(())
    };
    if kind == "pdf" {
        if ext(out) != "pdf" {
            return Err("With --export pdf, -o names a .pdf file".into());
        }
        refuse(out)?;
        let dir = std::env::temp_dir().join(format!("notecomplete-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        let mut files = Vec::new();
        for (i, svg) in svgs.iter().enumerate() {
            // Page units are 1.8333 per PDF point: size the page in points.
            let size = editor.view(editor.slot(i)?)?["size"].clone();
            let (w, h) = (
                size[0].as_f64().unwrap_or(A4[0]) / ink::paper::PAGE_SCALE,
                size[1].as_f64().unwrap_or(A4[1]) / ink::paper::PAGE_SCALE,
            );
            let sized = svg
                .replacen(" width=\"", " data-w=\"", 1)
                .replacen(" height=\"", " data-h=\"", 1)
                .replacen(
                    "<svg ",
                    &format!("<svg width=\"{w}pt\" height=\"{h}pt\" "),
                    1,
                );
            let file = dir.join(format!("{:04}.svg", i + 1));
            std::fs::write(&file, sized)?;
            files.push(file);
        }
        if let Some(parent) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let status = Command::new("rsvg-convert")
            .args(["-f", "pdf", "-o"])
            .arg(out)
            .args(&files)
            .status()
            .map_err(|_| "PDF export needs rsvg-convert (librsvg) installed")?;
        let _ = std::fs::remove_dir_all(&dir);
        if !status.success() {
            return Err("rsvg-convert could not write the PDF".into());
        }
        return Ok(vec![out.to_path_buf()]);
    }
    let (dir, stem) = if ext(out) == kind {
        (
            out.parent().map(Path::to_path_buf).unwrap_or_default(),
            out.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "page".into()),
        )
    } else {
        (out.to_path_buf(), "page".to_owned())
    };
    if !dir.as_os_str().is_empty() {
        std::fs::create_dir_all(&dir)?;
    }
    let mut written = Vec::new();
    for (i, svg) in svgs.into_iter().enumerate() {
        let file = if count == 1 && ext(out) == kind {
            out.to_path_buf()
        } else {
            dir.join(format!("{stem}-{}.{kind}", i + 1))
        };
        refuse(&file)?;
        let bytes = if kind == "svg" {
            svg.into_bytes()
        } else {
            rasterize(svg, width)?
        };
        std::fs::write(&file, bytes)?;
        written.push(file);
    }
    Ok(written)
}
fn options_for(args: &Value, title: &str, markdown: &str) -> Res<ComposeOptions> {
    options(
        args,
        Paper::DOT,
        None,
        seed_of(&format!("{title}\n{markdown}")),
    )
}

// -- resources and prompts ----------------------------------------------------
pub(super) fn resources() -> Value {
    let mut list = vec![
        json!({"uri":"noteful://style","name":"style-guide","description":"How to write a good handwritten page, and the Markdown dialect","mimeType":"text/markdown"}),
        json!({"uri":"noteful://examples","name":"examples","description":"Index of example pages and drawings","mimeType":"text/markdown"}),
    ];
    for e in &EXAMPLES {
        list.push(json!({"uri":format!("noteful://examples/{}", e.name),"name":format!("example-{}", e.name),"description":e.use_for,
            "mimeType":if e.kind == "page" {"text/markdown"} else {"image/svg+xml"}}));
        list.push(json!({"uri":format!("noteful://examples/{}/preview", e.name),"name":format!("example-{}-preview", e.name),"description":format!("How {} looks once written", e.name),"mimeType":"image/png"}));
    }
    json!({"resources":list})
}
pub(super) fn resource_templates() -> Value {
    json!({"resourceTemplates":[
        {"uriTemplate":"noteful://examples/{name}","name":"example-source","description":"Source of an example: study Markdown for a page, SVG for a drawing","mimeType":"text/plain"},
        {"uriTemplate":"noteful://examples/{name}/preview","name":"example-preview","description":"How an example looks once written","mimeType":"image/png"}]})
}
impl Server {
    pub(super) fn read_resource(&mut self, uri: &str) -> Res<Value> {
        let text =
            |t: String, mime: &str| json!({"contents":[{"uri":uri,"mimeType":mime,"text":t}]});
        if uri == "noteful://style" {
            return Ok(text(format!("{STYLE_GUIDE}\n{DIALECT}"), "text/markdown"));
        }
        if uri == "noteful://examples" {
            return Ok(text(examples_index(), "text/markdown"));
        }
        let rest = uri
            .strip_prefix("noteful://examples/")
            .ok_or_else(|| format!("Unknown resource {uri}"))?;
        let (name, preview) = match rest.strip_suffix("/preview") {
            Some(n) => (n, true),
            None => (rest, false),
        };
        let e = EXAMPLES
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| format!("Unknown example {name}"))?;
        if preview {
            let png = self.example_png(name)?;
            return Ok(
                json!({"contents":[{"uri":uri,"mimeType":"image/png","blob":STANDARD.encode(png)}]}),
            );
        }
        Ok(text(
            e.source.to_owned(),
            if e.kind == "page" {
                "text/markdown"
            } else {
                "image/svg+xml"
            },
        ))
    }
}

pub(super) fn prompts() -> Vec<Value> {
    vec![
        json!({"name":"summary_page","description":"Turn notes or a topic into a one-page handwritten study summary","arguments":[{"name":"topic","required":true},{"name":"path","description":"A note to summarise (default: textbook knowledge)"},{"name":"pages","description":"e.g. 3-8; default all"}]}),
        json!({"name":"clean_copy","description":"Rewrite a messy page neatly, step by step, right after it","arguments":[{"name":"path","required":true},{"name":"page","required":true}]}),
        json!({"name":"grade_quiz","description":"Grade a quiz page answered by hand: ticks, circles, corrections and a score","arguments":[{"name":"path","required":true},{"name":"page","required":true}]}),
        json!({"name":"quiz","description":"Write a handwritten multiple-choice quiz from notes","arguments":[{"name":"path","required":true},{"name":"pages"},{"name":"questions","description":"How many (default 5)"}]}),
        json!({"name":"tree_page","description":"Classify a topic as a tree diagram on black paper","arguments":[{"name":"topic","required":true},{"name":"path"}]}),
    ]
}
fn with_example(name: &str, task: String) -> String {
    let e = EXAMPLES.iter().find(|e| e.name == name).unwrap();
    format!(
        "{task}\n\n{STYLE_GUIDE}\nExample to imitate ({}, theme={}): {}\n\n```markdown\n{}```",
        e.name,
        if e.dark { "dark" } else { "light" },
        e.use_for,
        e.source
    )
}
pub(super) fn prompt(name: &str, args: &Value) -> Option<Value> {
    let a = |k: &str, d: &str| {
        args[k]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(d)
            .to_owned()
    };
    let path = a("path", "");
    let text = match name {
        "summary_page" => {
            let source = if path.is_empty() {
                "Use reliable textbook knowledge.".to_owned()
            } else {
                format!("Read {path} (pages {}) with note_outline, page_image (handwriting and highlights are my emphasis) and page_text. Use only what is in my notes; add nothing invented.", a("pages", "all"))
            };
            with_example("cell-biology", format!("Write a one-page study summary of: {}. {source} Draw one labelled diagram as SVG. Write it with create_notebook{}.", a("topic", "the topic"), if path.is_empty() { String::new() } else { format!(", or add_pages to {path} if I ask for it in the note") }))
        }
        "clean_copy" => with_example("clean-copy", format!("Read page {} of {path} with page_image (and page_text). Rewrite it as a clean, well-ordered page: the question, the givens, the solution step by step with every result checked, and a short intuition. Keep my notation and numbers; fix only real mistakes and say which. Write it with clean_copy so it goes right after page {}; it goes to a copy unless I ask for in_place.", a("page", "1"), a("page", "1"))),
        "grade_quiz" => format!("Grade the quiz on page {page} of {path}.\n\
            1. page_image (width 1400) and read which option I marked for each question; work out the right answers yourself.\n\
            2. page_layout to get the numbered items: each question line and each option line has its bbox [x0, y0, x1, y1].\n\
            3. One write_on_page call with all marks: a green 'check' at x1 + 30 of each right pick; for a wrong pick a red 'ellipse' around it, a mint 'highlight' on the right option and a short red 'text' after it with the reason; the score (e.g. 4/5) near the title, in a red 'ellipse' or as a 'textbox'.\n\
            4. Tell me the score and what to review, and where the marked copy was written.", page = a("page", "1")),
        "quiz" => with_example("quiz", format!("Read {path} (pages {}) with page_image and page_text. Write a {}-question multiple-choice quiz on what I wrote and highlighted, three options each, one right answer, the wrong ones plausible. Keep the answer key to yourself. Write it with add_pages to {path} (or create_notebook if I prefer a new notebook).", a("pages", "all"), a("questions", "5"))),
        "tree_page" => with_example("answers-tree", format!("Make a tree diagram of {} on a dark page (theme 'dark'): the topic and its guiding question at the top, 3-5 branches, two levels of leaves. {}Write it with create_notebook.", a("topic", "the topic"), if path.is_empty() { String::new() } else { format!("Base it on {path}, read with page_image. ") })),
        _ => return None,
    };
    Some(
        json!({"description":name,"messages":[{"role":"user","content":{"type":"text","text":text}}]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    const EXAM: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../samples/Examen wuolah.noteful"
    );

    fn call(server: &mut Server, name: &str, args: Value) -> Value {
        let reply = server
            .handle(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}}))
            .unwrap();
        reply["result"].clone()
    }
    fn report(result: &Value) -> Value {
        assert_ne!(result["isError"], true, "{result}");
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn ink_tools_write_copies_and_keep_backups() {
        let dir = std::env::temp_dir().join(format!("nc-ink-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut server = Server::default();
        // A new notebook from study Markdown.
        let out = dir.join("new.noteful");
        let r = report(&call(
            &mut server,
            "create_notebook",
            json!({"title":"Célula","markdown":"# LA **CÉLULA**\n## Partes\n- núcleo ==ADN==\n> [sky] NOTA: texto","out":out,"paper":"grid"}),
        ));
        assert_eq!(r["pages"], 1);
        let note = Editor::open(&std::fs::read(&out).unwrap()).unwrap();
        assert_eq!(note.view(0).unwrap()["title"], "Célula");
        assert!(
            call(
                &mut server,
                "create_notebook",
                json!({"title":"x","markdown":"y","out":out})
            )["isError"]
                == true,
            "no silent overwrite"
        );
        assert!(
            call(
                &mut server,
                "create_notebook",
                json!({"title":"x","markdown":"y","out":dir.join("a.pdf")})
            )["isError"]
                == true
        );
        assert!(
            call(
                &mut server,
                "create_notebook",
                json!({"title":"x","markdown":"y","out":dir.join("b.noteful"),"theme":"neon"})
            )["isError"]
                == true
        );

        // Pages added to a copy of a real note; the source stays as it was.
        let source = dir.join("exam.noteful");
        std::fs::copy(EXAM, &source).unwrap();
        let before = std::fs::read(&source).unwrap();
        let copy = dir.join("exam-more.noteful");
        let r = report(&call(
            &mut server,
            "add_pages",
            json!({"path":source,"markdown":"## More\ntext","after_page":1,"out":copy,"look":"classic"}),
        ));
        assert_eq!(r["new_pages"], json!([2]));
        assert_eq!(
            Editor::open(&std::fs::read(&copy).unwrap())
                .unwrap()
                .page_order()
                .len(),
            4
        );
        assert_eq!(std::fs::read(&source).unwrap(), before);
        assert!(
            call(
                &mut server,
                "add_pages",
                json!({"path":source,"markdown":"x","after_page":9})
            )["isError"]
                == true
        );
        assert!(
            call(
                &mut server,
                "add_pages",
                json!({"path":source,"markdown":"x","out":source})
            )["isError"]
                == true,
            "out cannot be the source"
        );

        // Marks on page 1, in place: a .bak keeps the original.
        let items = json!([{"type":"check","x":900,"y":300,"color":"green"},{"type":"highlight","x":100,"y":500,"w":400,"h":30},{"type":"textbox","text":"4/5","x":800,"y":60}]);
        let r = report(&call(
            &mut server,
            "write_on_page",
            json!({"path":source,"page":1,"items":items,"in_place":true}),
        ));
        assert_eq!(r["text_boxes"], 1);
        assert_eq!(
            r["under_ink"], 2,
            "a 30-unit box takes two overlapping passes"
        );
        assert_eq!(std::fs::read(dir.join("exam.noteful.bak")).unwrap(), before);
        let marked = Editor::open(&std::fs::read(&source).unwrap()).unwrap();
        assert!(marked.view(0).unwrap()["texts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["runs"][0]["text"] == "4/5"));
        assert!(
            call(
                &mut server,
                "write_on_page",
                json!({"path":source,"page":1,"items":[{"type":"wobble"}]})
            )["isError"]
                == true
        );

        // A .notecomp keeps its notes when pages are added to it.
        let comp = dir.join("n.notecomp");
        std::fs::write(
            &comp,
            noteful_core::pack_notecomplete(&before, "my notes", "T").unwrap(),
        )
        .unwrap();
        let comp_out = dir.join("n2.notecomp");
        report(&call(
            &mut server,
            "clean_copy",
            json!({"path":comp,"page":1,"markdown":"# Clean\n1. a","out":comp_out}),
        ));
        let (_, md) = unpack_notecomplete(&std::fs::read(&comp_out).unwrap()).unwrap();
        assert_eq!(md, "my notes");

        // The layout numbers the handwriting and lists the text box.
        let layout = report(&call(
            &mut server,
            "page_layout",
            json!({"path":source,"page":1,"image":false}),
        ));
        assert!(layout["items"].as_array().unwrap().len() > 10);
        assert_eq!(layout["text_boxes"][0]["text"], "4/5");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn convert_writes_a_notebook_from_markdown() {
        let dir = std::env::temp_dir().join(format!("nc-convert-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let md = dir.join("lecture.md");
        std::fs::write(&md, "# Lecture\n- point").unwrap();
        let out = dir.join("lecture.noteful");
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let msg = convert(&s(&[
            md.to_str().unwrap(),
            "-o",
            out.to_str().unwrap(),
            "--look",
            "classic",
            "--paper",
            "ruled",
        ]))
        .unwrap();
        assert!(msg.contains("1 page"), "{msg}");
        assert_eq!(
            Editor::open(&std::fs::read(&out).unwrap())
                .unwrap()
                .view(0)
                .unwrap()["title"],
            "lecture"
        );
        assert!(
            convert(&s(&[md.to_str().unwrap(), "-o", out.to_str().unwrap()])).is_err(),
            "no silent overwrite"
        );
        assert!(convert(&s(&[md.to_str().unwrap(), "--paper"])).is_err());
        // Exports: vector SVG pages with their paper, and named PNGs.
        let svg_dir = dir.join("svg");
        let msg = convert(&s(&[
            md.to_str().unwrap(),
            "--export",
            "svg",
            "-o",
            svg_dir.to_str().unwrap(),
        ]))
        .unwrap();
        assert!(msg.contains("page-1.svg"), "{msg}");
        let svg = std::fs::read_to_string(svg_dir.join("page-1.svg")).unwrap();
        assert!(svg.starts_with("<svg") && svg.contains("nc-paper-dot"));
        assert!(
            convert(&s(&[
                md.to_str().unwrap(),
                "--export",
                "svg",
                "-o",
                svg_dir.to_str().unwrap()
            ]))
            .is_err(),
            "no silent overwrite"
        );
        assert!(convert(&s(&[
            md.to_str().unwrap(),
            "--export",
            "pdf",
            "-o",
            dir.join("x.png").to_str().unwrap()
        ]))
        .is_err());
        assert!(convert(&s(&[md.to_str().unwrap(), "--export", "gif", "-o", "x"])).is_err());
        if Command::new("rsvg-convert")
            .arg("--version")
            .output()
            .is_ok()
        {
            let pdf = dir.join("out.pdf");
            convert(&s(&[
                md.to_str().unwrap(),
                "--export",
                "pdf",
                "-o",
                pdf.to_str().unwrap(),
            ]))
            .unwrap();
            assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF-"));
            convert(&s(&[
                md.to_str().unwrap(),
                "--export",
                "png",
                "-o",
                dir.join("one.png").to_str().unwrap(),
            ]))
            .unwrap();
            assert!(std::fs::read(dir.join("one.png"))
                .unwrap()
                .starts_with(b"\x89PNG"));
        }
        assert!(convert(&s(&[
            md.to_str().unwrap(),
            "--colour",
            "red",
            "-o",
            "x.noteful"
        ]))
        .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_resources_and_prompts() {
        let mut server = Server::default();
        let list = call(&mut server, "example_pages", json!({}));
        assert!(list["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("cell-biology"));
        let one = call(&mut server, "example_pages", json!({"name":"quiz"}));
        assert!(one["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("### 1."));
        assert!(call(&mut server, "example_pages", json!({"name":"nope"}))["isError"] == true);
        let read = server.handle(&json!({"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"noteful://style"}})).unwrap();
        assert!(read["result"]["contents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("!columns"));
        let missing = server.handle(&json!({"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"noteful://nope"}})).unwrap();
        assert!(missing["error"].is_object());
        let n = server
            .handle(&json!({"jsonrpc":"2.0","id":4,"method":"resources/list"}))
            .unwrap()["result"]["resources"]
            .as_array()
            .unwrap()
            .len();
        assert_eq!(n, 2 + 2 * EXAMPLES.len());
        let prompts = server
            .handle(&json!({"jsonrpc":"2.0","id":5,"method":"prompts/list"}))
            .unwrap();
        let names: Vec<&str> = prompts["result"]["prompts"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p["name"].as_str())
            .collect();
        assert_eq!(
            names,
            [
                "flashcards",
                "summary_page",
                "clean_copy",
                "grade_quiz",
                "quiz",
                "tree_page"
            ]
        );
        for name in names {
            let got = server.handle(&json!({"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":name,"arguments":{"path":"x.noteful","page":"2","topic":"cells"}}})).unwrap();
            assert!(
                got["result"]["messages"][0]["content"]["text"]
                    .as_str()
                    .unwrap()
                    .len()
                    > 100,
                "{name}"
            );
        }
        assert!(server
            .handle(
                &json!({"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"nope"}})
            )
            .unwrap()["error"]
            .is_object());
    }
}
