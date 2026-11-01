//! Writing real, editable Noteful ink: Markdown into handwritten pages, SVG
//! drawings into pen strokes, and marks on existing pages. Everything becomes
//! ordinary pen, highlighter and tape strokes (or native text boxes), so it
//! stays editable on the iPad. Pure computation: fonts are embedded and paper
//! is a generated PDF.
//!
//! Ported from openninoor/noteful-mcp (MIT, commit 175e8d7); fonts are SIL
//! OFL 1.1 (assets/fonts). See docs/INK-WRITING.md.
mod annotate;
mod compose;
pub mod design;
mod font;
mod glyphs;
mod hand;
mod layout;
pub mod paper;
mod rng;
mod svg;
pub mod trace;

pub use annotate::{annotate, Annotation, Item};
pub use compose::accent_index;
pub use font::{FontName, FONT_NAMES};
pub use hand::{color, highlight_color, Hand};
pub use layout::{layout_overlay, page_layout};
pub use paper::{paper_pdf, paper_svg, Paper, PaperKind, A4};
pub use rng::seed_of;

use crate::{Editor, Error, Line, NewPage, NewPdf, PdfPlacement, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use compose::{Composer, Setup};

/// One composed page: ink, highlighter under it, and its paper.
#[derive(Clone, Debug)]
pub struct InkPage {
    pub lines: Vec<Line>,
    /// Drawn below the ink (written first); every line has `under` set.
    pub under: Vec<Line>,
    pub paper: Paper,
}
impl InkPage {
    /// Under-ink first, then ink: the order to add them to a page.
    pub fn strokes(&self) -> impl Iterator<Item = &Line> {
        self.under.iter().chain(&self.lines)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Look {
    /// Composed study notes (cards, columns, zones, drawings).
    Study,
    /// A plain notebook (headings, bullets, boxes).
    Classic,
}

#[derive(Clone, Debug)]
pub struct ComposeOptions {
    pub paper: Paper,
    /// Body ink; the theme's ink when None.
    pub ink: Option<[f64; 4]>,
    /// Study: the first section colour (coral, amber, sky, purple, teal,
    /// pink). Classic: headings and marks (any pen colour).
    pub accent: String,
    pub font: FontName,
    /// Body x-height in page units.
    pub size: f64,
    /// Neat for study, natural for classic when None.
    pub hand: Option<Hand>,
    /// Fineliner (even line) or ballpoint (pressure). Study uses a
    /// fineliner and classic a ballpoint when None.
    pub fineliner: Option<bool>,
    pub look: Look,
    pub dark: bool,
    pub seed: u64,
}
impl Default for ComposeOptions {
    fn default() -> Self {
        Self {
            paper: Paper::DOT,
            ink: None,
            accent: "sky".into(),
            font: FontName::Patrick,
            size: 11.,
            hand: None,
            fineliner: None,
            look: Look::Study,
            dark: false,
            seed: 1,
        }
    }
}

impl ComposeOptions {
    /// Options from JSON as the app and tools send them: `paper`, `theme`
    /// (light | dark), `look` (study | classic), `accent`, `ink`, `font`,
    /// `hand`, `pen` (fineliner | ballpoint), `size`, `seed`. Unknown values
    /// are errors that name the allowed ones.
    pub fn from_json(v: &serde_json::Value, default_seed: u64) -> Result<Self> {
        let s = |k: &str| {
            v.get(k)
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        let bad = |k: &str, got: &str, allowed: &str| {
            Error::new(0, format!("{k} must be one of {allowed}, not '{got}'"))
        };
        let dark = match s("theme").unwrap_or("light") {
            "light" => false,
            "dark" => true,
            t => return Err(bad("theme", t, "light, dark")),
        };
        let paper = match s("paper") {
            None | Some("inherit") => Paper::DOT,
            Some(p) => Paper::parse(p).ok_or_else(|| {
                bad(
                    "paper",
                    p,
                    "dot, grid, ruled, blank, dark-dot, dark-grid, dark-ruled, dark-blank",
                )
            })?,
        };
        let look = match s("look").unwrap_or("study") {
            "study" => Look::Study,
            "classic" => Look::Classic,
            l => return Err(bad("look", l, "study, classic")),
        };
        let font = match s("font") {
            None => FontName::Patrick,
            Some(f) => FontName::parse(f).ok_or_else(|| bad("font", f, &FONT_NAMES.join(", ")))?,
        };
        let hand = match s("hand") {
            None => None,
            Some(h) => Some(Hand::parse(h).ok_or_else(|| bad("hand", h, "neat, natural, messy"))?),
        };
        let fineliner = match s("pen") {
            None => None,
            Some("fineliner") => Some(true),
            Some("ballpoint") => Some(false),
            Some(p) => return Err(bad("pen", p, "fineliner, ballpoint")),
        };
        let ink = match s("ink") {
            None | Some("ink") | Some("theme") => None,
            Some(c) => Some(color(c).ok_or_else(|| {
                Error::new(0, format!("ink must be a colour name or #hex, not '{c}'"))
            })?),
        };
        let accent = s("accent").unwrap_or("sky").to_owned();
        Ok(Self {
            paper: paper.with_dark(dark || paper.dark),
            ink,
            accent,
            font,
            size: v
                .get("size")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(11.),
            hand,
            fineliner,
            look,
            dark,
            seed: v
                .get("seed")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(default_seed),
        })
    }
}

pub const MAX_MARKDOWN: usize = 1 << 20;
pub const MAX_PAGES: usize = 200;

/// Compose Markdown into pages (see `DIALECT`). Returns the pages and
/// warnings worth showing (unknown colours, skipped SVG features).
pub fn compose(markdown: &str, o: &ComposeOptions) -> Result<(Vec<InkPage>, Vec<String>)> {
    if markdown.len() > MAX_MARKDOWN {
        return Err(Error::new(0, "Markdown is larger than 1 MiB"));
    }
    if !(4.0..=60.).contains(&o.size) {
        return Err(Error::new(0, "Text size must be between 4 and 60"));
    }
    let study = o.look == Look::Study;
    let mut c = Composer::new(Setup {
        study,
        dark: o.dark,
        paper: o.paper,
        ink: o.ink,
        accent: o.accent.clone(),
        font: o.font,
        size: o.size,
        hand: o
            .hand
            .unwrap_or(if study { Hand::Neat } else { Hand::Natural }),
        fineliner: o.fineliner.unwrap_or(study),
        seed: o.seed,
    });
    c.markdown(markdown);
    let mut warnings = std::mem::take(&mut c.warnings);
    warnings.dedup();
    let mut pages = c.pages;
    // A trailing page that only a page break opened.
    if pages.len() > 1
        && pages
            .last()
            .is_some_and(|p| p.lines.is_empty() && p.under.is_empty())
    {
        pages.pop();
    }
    if pages.len() > MAX_PAGES {
        return Err(Error::new(
            0,
            format!(
                "The Markdown makes {} pages; the limit is {MAX_PAGES}",
                pages.len()
            ),
        ));
    }
    for page in &mut pages {
        page.lines = split_all(std::mem::take(&mut page.lines));
        page.under = split_all(std::mem::take(&mut page.under));
    }
    Ok((pages, warnings))
}
fn split_all(lines: Vec<Line>) -> Vec<Line> {
    lines
        .into_iter()
        .flat_map(|l| svg::split_long(l, 8000))
        .collect()
}

/// The paper PDF for `pages` and each page's index in it.
fn paper_for(pages: &[InkPage]) -> (Vec<u8>, Vec<u64>, Vec<Paper>) {
    let mut styles: Vec<Paper> = pages.iter().map(|p| p.paper).collect();
    styles.sort();
    styles.dedup();
    let index = pages
        .iter()
        .map(|p| styles.iter().position(|s| *s == p.paper).unwrap() as u64)
        .collect();
    (paper::paper_pdf(&styles), index, styles)
}

/// A new A4 notebook whose pages are `pages`, on generated paper.
pub fn new_notebook(title: &str, pages: &[InkPage]) -> Result<Editor> {
    if pages.is_empty() {
        return Err(Error::new(0, "Nothing to write"));
    }
    let (pdf, index, _) = paper_for(pages);
    let records: Vec<([f64; 2], Option<u64>)> = index.iter().map(|i| (A4, Some(*i))).collect();
    let mut editor = Editor::create_document_with(title, &records, &pdf, "paper-1", 1.)?;
    for (slot, page) in pages.iter().enumerate() {
        editor.add_lines(slot, page.strokes().cloned().collect())?;
    }
    Ok(editor)
}

/// Insert `pages` before display position `at` (the page count appends), on
/// their own paper. Returns the display positions of the new pages.
pub fn insert_pages(editor: &mut Editor, at: usize, pages: &[InkPage]) -> Result<Vec<usize>> {
    if pages.is_empty() {
        return Err(Error::new(0, "Nothing to write"));
    }
    let (pdf, index, _) = paper_for(pages);
    let mut n = 1;
    let id = loop {
        let id = format!("paper-{}-{n}", editor.page_order().len());
        if !editor.has_pdf(&id) {
            break id;
        }
        n += 1;
    };
    let new_pages = index
        .iter()
        .map(|i| NewPage {
            size: A4,
            pdf: Some(PdfPlacement {
                resource: id.clone(),
                page_index: *i,
                rect: None,
            }),
        })
        .collect();
    editor.insert_pages(
        at,
        new_pages,
        Some(NewPdf {
            id,
            base64: STANDARD.encode(pdf),
        }),
    )?;
    let layer = writable_layer(editor)?;
    let mut shown = Vec::new();
    for (k, page) in pages.iter().enumerate() {
        let display = at + k;
        let slot = editor.slot(display)?;
        editor.add_lines(
            slot,
            page.strokes()
                .cloned()
                .map(|l| Line { layer, ..l })
                .collect(),
        )?;
        shown.push(display);
    }
    Ok(shown)
}

/// The layer new ink goes on: the first visible, unlocked one.
pub fn writable_layer(editor: &Editor) -> Result<u32> {
    editor
        .layers()
        .iter()
        .find(|l| l.visible && !l.locked)
        .map(|l| l.id)
        .ok_or_else(|| Error::new(0, "Every layer of this note is hidden or locked"))
}

/// The paper styles of a PDF made by `paper_pdf` (from its title), so
/// previews can draw it without a PDF renderer.
pub fn paper_styles(pdf: &[u8]) -> Option<Vec<Paper>> {
    let prefix = paper::TITLE_PREFIX.as_bytes();
    let head = &pdf[..pdf.len().min(64 * 1024)];
    let at = head.windows(prefix.len()).position(|w| w == prefix)? + prefix.len();
    let end = head[at..].iter().position(|b| *b == b')')?;
    let names = std::str::from_utf8(&head[at..at + end]).ok()?;
    names.split(',').map(Paper::parse).collect()
}

/// A page as standalone SVG, with generated paper drawn in. Pages whose
/// background is another PDF come back without it (None for the paper).
pub fn page_svg(editor: &Editor, display: usize) -> Result<(String, bool)> {
    let v = editor.view(editor.slot(display)?)?;
    let mut svg = v["svg"].as_str().unwrap_or_default().to_owned();
    let Some(bg) = v["pdf_background"].as_object() else {
        return Ok((svg, true));
    };
    let resource = bg["resource_id"].as_str().unwrap_or_default();
    let index = bg["page_index"].as_u64().unwrap_or(0) as usize;
    let rect: Vec<f64> = bg["rect"]
        .as_array()
        .map(|r| r.iter().filter_map(serde_json::Value::as_f64).collect())
        .unwrap_or_default();
    let size = [
        v["size"][0].as_f64().unwrap_or(A4[0]),
        v["size"][1].as_f64().unwrap_or(A4[1]),
    ];
    let [x, y, w, h] = <[f64; 4]>::try_from(rect).unwrap_or([0., 0., size[0], size[1]]);
    let style = editor
        .pdf_bytes(resource)
        .ok()
        .and_then(paper_styles)
        .and_then(|s| s.get(index).copied());
    let Some(style) = style else {
        return Ok((svg, false));
    };
    let paper = format!(
        "<svg x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {} {}\" preserveAspectRatio=\"none\">{}</svg>",
        A4[0],
        A4[1],
        paper_svg(style, A4)
    );
    let marker = "<g data-background=\"true\">";
    if let Some(at) = svg
        .find(marker)
        .and_then(|at| svg[at..].find("</g>").map(|end| at + end))
    {
        svg.insert_str(at, &paper);
    }
    Ok((svg, true))
}

/// The handwriting Markdown dialect, for agents and help text.
pub const DIALECT: &str = include_str!("dialect.md");

/// Bundled example pages and drawings to imitate.
pub struct Example {
    pub name: &'static str,
    /// "page" (study Markdown) or "drawing" (SVG).
    pub kind: &'static str,
    pub dark: bool,
    pub use_for: &'static str,
    pub source: &'static str,
}
pub const EXAMPLES: [Example; 10] = [
    Example { name: "cell-biology", kind: "page", dark: false, use_for: "Summary page of a topic: title and subtitle, a labelled diagram next to the explanation in two columns, comparison cards, a numbered list, a colour zone with stats and a sticky note.", source: include_str!("../../assets/examples/cell-biology.md") },
    Example { name: "radiation", kind: "page", dark: false, use_for: "Science summary: a two-line title, a graph beside formula cards (Greek letters, T^4, 10^{-8}), side-by-side cards and a full-width zone with a diagram, sticky note and stats.", source: include_str!("../../assets/examples/radiation.md") },
    Example { name: "clean-copy", kind: "page", dark: false, use_for: "Clean copy of a messy worked problem: the question in a card, the givens next to a probability tree, the solution step by step, an intuition with cards, the result as a stat and a sticky note on why.", source: include_str!("../../assets/examples/clean-copy.md") },
    Example { name: "quiz", kind: "page", dark: false, use_for: "Multiple-choice quiz: '### N. question' and '- A) option' lines, so page_layout finds every option when grading.", source: include_str!("../../assets/examples/quiz.md") },
    Example { name: "answers-tree", kind: "page", dark: true, use_for: "Answer key and a tree diagram on black paper: circled numbers, '!map TOPIC | question' with indented leaves.", source: include_str!("../../assets/examples/answers-tree.md") },
    Example { name: "heart", kind: "drawing", dark: false, use_for: "Organ cross-section: outline, chambers drawn on top of it, labels outside on leader lines.", source: include_str!("../../assets/examples/drawings/heart.svg") },
    Example { name: "cell", kind: "drawing", dark: false, use_for: "Cell with organelles: nested shapes, curved paths, many labels around the drawing.", source: include_str!("../../assets/examples/drawings/cell.svg") },
    Example { name: "graph", kind: "drawing", dark: false, use_for: "Function graph: axes as lines, filled areas under curves, coloured annotations.", source: include_str!("../../assets/examples/drawings/graph.svg") },
    Example { name: "diagram", kind: "drawing", dark: false, use_for: "Process diagram: bands and ground as filled shapes, thick coloured arrows (lines plus polyline heads), wavy paths, labels near each arrow.", source: include_str!("../../assets/examples/drawings/diagram.svg") },
    Example { name: "probability-tree", kind: "drawing", dark: false, use_for: "Probability tree: branches as lines, outcome nodes as filled circles, values in colour along the branches.", source: include_str!("../../assets/examples/drawings/probability-tree.svg") },
];

/// An example rendered as pages (a drawing is placed on one page).
pub fn example_pages(name: &str) -> Result<Vec<InkPage>> {
    let e = EXAMPLES
        .iter()
        .find(|e| e.name == name)
        .ok_or_else(|| Error::new(0, format!("Unknown example {name}")))?;
    let markdown = if e.kind == "drawing" {
        format!("!draw 600\n{}\n!end", e.source)
    } else {
        e.source.to_owned()
    };
    let o = ComposeOptions {
        dark: e.dark,
        seed: 7,
        ..ComposeOptions::default()
    };
    Ok(compose(&markdown, &o)?.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_example_composes_on_one_page_without_warnings() {
        for e in &EXAMPLES {
            let pages = example_pages(e.name).unwrap();
            assert!(!pages.is_empty(), "{}", e.name);
            for p in &pages {
                for l in p.strokes() {
                    assert!(
                        l.points.iter().flatten().all(|v| v.is_finite()),
                        "{}",
                        e.name
                    );
                    assert!(
                        l.points.iter().all(|[x, y]| *x > -50.
                            && *x < A4[0] + 50.
                            && *y > -50.
                            && *y < A4[1] + 50.),
                        "{} stays on the page",
                        e.name
                    );
                }
            }
            assert!(pages[0].lines.len() > 30, "{} writes ink", e.name);
        }
        let dark = example_pages("answers-tree").unwrap();
        assert!(
            dark[0].paper.dark && dark[0].under.is_empty(),
            "dark pages get no pastel washes"
        );
    }

    #[test]
    fn three_pages_of_markdown_make_three_pages_and_repeat_for_a_seed() {
        let md = "# One\nsome text\n\\pagebreak\n## Two\n- a\n- b\n\\pagebreak\n### Three\n> [sky] CARD: body ==marked==";
        let o = ComposeOptions::default();
        let (a, warnings) = compose(md, &o).unwrap();
        assert_eq!(a.len(), 3);
        assert!(warnings.is_empty(), "{warnings:?}");
        let (b, _) = compose(md, &o).unwrap();
        assert_eq!(a[2].lines[3].points, b[2].lines[3].points);
        assert!(!a[2].under.is_empty(), "card fill and highlight");
        let classic = ComposeOptions {
            look: Look::Classic,
            paper: Paper::parse("ruled").unwrap(),
            ..o.clone()
        };
        let (c, _) = compose(
            "# Title\n[x] done\n{color:red} red line\n!tape pink\n> boxed",
            &classic,
        )
        .unwrap();
        assert_eq!(c.len(), 1);
        assert!(c[0].lines.iter().any(|l| l.tool == 2), "native tape");
        assert!(
            c[0].lines.iter().any(|l| l.pressure.is_some()),
            "classic writes with a ballpoint"
        );
        let long: String = (0..400)
            .map(|i| format!("Paragraph {i} with a few words in it.\n"))
            .collect();
        let (many, _) = compose(&long, &o).unwrap();
        assert!(many.len() > 3);
        assert!(compose(
            "x",
            &ComposeOptions {
                size: 100.,
                ..ComposeOptions::default()
            }
        )
        .is_err());
    }

    #[test]
    fn notebooks_get_paper_pages_and_ink_that_round_trips() {
        let (pages, _) = compose(
            "# Paper\ntext ==marked==\n\\pagebreak\nmore",
            &ComposeOptions {
                paper: Paper::parse("grid").unwrap(),
                ..ComposeOptions::default()
            },
        )
        .unwrap();
        let editor = new_notebook("Ink", &pages).unwrap();
        let bytes = editor.export_noteful().unwrap();
        let back = Editor::open(&bytes).unwrap();
        assert_eq!(back.page_order().len(), 2);
        let v = back.view(0).unwrap();
        assert_eq!(v["title"], "Ink");
        assert_eq!(v["pdf_background"]["resource_id"], "paper-1");
        assert_eq!(
            paper_styles(back.pdf_bytes("paper-1").unwrap()).unwrap(),
            vec![Paper::parse("grid").unwrap()]
        );
        let strokes = pages[0].under.len() + pages[0].lines.len();
        assert_eq!(v["visible_imported"].as_u64().unwrap() as usize, strokes);
        // The highlighter was written first, under the handwriting.
        let package = crate::Package::parse(&bytes).unwrap();
        let ink: Vec<_> = package
            .blocks
            .iter()
            .filter_map(|b| b.strokes.as_ref())
            .flatten()
            .collect();
        assert_eq!(ink.first().unwrap().style.tool, 1);
        assert!(
            ink.iter().any(|s| s.flags & 1 == 0 && s.style.tool == 0),
            "fineliner strokes carry no pressure"
        );

        let mut more = back;
        let classic = ComposeOptions {
            look: Look::Classic,
            ..ComposeOptions::default()
        };
        let (extra, _) = compose("## Added\nballpoint text", &classic).unwrap();
        assert_eq!(insert_pages(&mut more, 1, &extra).unwrap(), vec![1]);
        let bytes = more.export_noteful().unwrap();
        let again = Editor::open(&bytes).unwrap();
        assert_eq!(again.page_order().len(), 3);
        let package = crate::Package::parse(&bytes).unwrap();
        let pressured = package
            .blocks
            .iter()
            .filter_map(|b| b.strokes.as_ref())
            .flatten()
            .filter(|s| s.flags & 1 == 1)
            .count();
        assert!(pressured > 10, "ballpoint strokes keep their pressure");
    }
}
