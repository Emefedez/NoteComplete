//! Paper for written pages: blank, dotted, squared or ruled, ivory or black.
//! New pages get it as a PDF background (the mechanism Noteful imports from
//! noteful-mcp), one A4 page per style. Dots and squares are PDF tiling
//! patterns, so a page costs a few hundred bytes. `paper_svg` draws the same
//! paper for previews.
use pdf_writer::{
    types::{LineCapStyle, PaintType, TilingType},
    Content, Finish, Name, Pdf, Rect, Ref, TextStr,
};

/// A4 in PDF points; Noteful's page is 1.8333 units per point (1091.34 × 1543.46).
pub const A4_POINTS: [f64; 2] = [595.2756, 841.8898];
pub const PAGE_SCALE: f64 = 1.833_333_333_333_333_3;
pub const A4: [f64; 2] = [A4_POINTS[0] * PAGE_SCALE, A4_POINTS[1] * PAGE_SCALE];
/// Pattern pitch (5 mm) and ruled lines, in points.
const STEP: f64 = 14.17;
const RULE_TOP: f64 = 60.;
const RULE: f64 = 22.7;
/// The PDF title names its styles, so previews can redraw the paper.
pub const TITLE_PREFIX: &str = "NoteComplete paper: ";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PaperKind {
    Blank,
    Dot,
    Grid,
    Ruled,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Paper {
    pub kind: PaperKind,
    pub dark: bool,
}
impl Paper {
    pub const DOT: Paper = Paper {
        kind: PaperKind::Dot,
        dark: false,
    };
    /// `dot`, `grid`, `ruled`, `blank`, each also as `dark-dot` or `dot-dark`.
    pub fn parse(name: &str) -> Option<Self> {
        let name = name.trim().to_ascii_lowercase();
        let (base, dark) = if let Some(b) = name.strip_prefix("dark-") {
            (b.to_owned(), true)
        } else if let Some(b) = name.strip_suffix("-dark") {
            (b.to_owned(), true)
        } else {
            (name, false)
        };
        let kind = match base.as_str() {
            "blank" | "plain" => PaperKind::Blank,
            "dot" | "dots" | "dotted" => PaperKind::Dot,
            "grid" | "squared" => PaperKind::Grid,
            "ruled" | "lined" | "lines" => PaperKind::Ruled,
            _ => return None,
        };
        Some(Self { kind, dark })
    }
    pub fn name(&self) -> String {
        let base = match self.kind {
            PaperKind::Blank => "blank",
            PaperKind::Dot => "dot",
            PaperKind::Grid => "grid",
            PaperKind::Ruled => "ruled",
        };
        if self.dark {
            format!("dark-{base}")
        } else {
            base.to_owned()
        }
    }
    pub fn with_dark(self, dark: bool) -> Self {
        Self { dark, ..self }
    }
    fn colors(&self) -> Colors {
        if self.dark {
            Colors {
                page: [0.03, 0.03, 0.034],
                dot: [0.25, 0.25, 0.27],
                grid: [0.15, 0.15, 0.17],
                rule: [0.2, 0.2, 0.22],
            }
        } else {
            Colors {
                page: [0.984, 0.969, 0.937],
                dot: [0.80, 0.76, 0.70],
                grid: [0.90, 0.86, 0.80],
                rule: [0.80, 0.76, 0.70],
            }
        }
    }
    /// Baseline of ruled line `n` from the top, in page units (for snapping text).
    pub fn rule_y(n: usize) -> f64 {
        (RULE_TOP + RULE * n as f64) * PAGE_SCALE
    }
    pub fn rule_pitch() -> f64 {
        RULE * PAGE_SCALE
    }
}
struct Colors {
    page: [f32; 3],
    dot: [f32; 3],
    grid: [f32; 3],
    rule: [f32; 3],
}

/// One A4 PDF page per style, in order.
pub fn paper_pdf(styles: &[Paper]) -> Vec<u8> {
    let mut pdf = Pdf::new();
    let (catalog, tree, info) = (Ref::new(1), Ref::new(2), Ref::new(3));
    let [w, h] = A4_POINTS.map(|v| v as f32);
    let mut kids = Vec::new();
    let mut next = 4;
    let mut alloc = || {
        next += 1;
        Ref::new(next - 1)
    };
    for style in styles {
        let c = style.colors();
        let (page_id, content_id) = (alloc(), alloc());
        kids.push(page_id);
        let mut content = Content::new();
        content.set_fill_rgb(c.page[0], c.page[1], c.page[2]);
        content.rect(0., 0., w, h);
        content.fill_nonzero();
        let step = STEP as f32;
        // A pattern cell with one dot or one corner of the grid.
        let pattern = match style.kind {
            PaperKind::Dot => {
                let mut cell = Content::new();
                cell.set_line_cap(LineCapStyle::RoundCap);
                cell.set_line_width(1.0);
                cell.set_stroke_rgb(c.dot[0], c.dot[1], c.dot[2]);
                cell.move_to(step / 2., step / 2.);
                cell.line_to(step / 2., step / 2.);
                cell.stroke();
                Some((
                    cell.finish(),
                    [2. * step - step / 2., step - step / 2.],
                    [
                        2. * step - step / 2.,
                        step,
                        w - step,
                        h - 2. * step - step / 2.,
                    ],
                ))
            }
            PaperKind::Grid => {
                let mut cell = Content::new();
                cell.set_line_width(0.35);
                cell.set_stroke_rgb(c.grid[0], c.grid[1], c.grid[2]);
                cell.move_to(0., 0.);
                cell.line_to(step, 0.);
                cell.move_to(0., 0.);
                cell.line_to(0., step);
                cell.stroke();
                Some((cell.finish(), [0., h % step], [0., 0., w, h]))
            }
            _ => None,
        };
        if style.kind == PaperKind::Ruled {
            content.set_line_width(0.5);
            content.set_stroke_rgb(c.rule[0], c.rule[1], c.rule[2]);
            let mut y = RULE_TOP;
            while y < A4_POINTS[1] - 20. {
                let py = h - y as f32;
                content.move_to(0., py);
                content.line_to(w, py);
                y += RULE;
            }
            content.stroke();
        }
        let pattern_id = pattern.as_ref().map(|_| alloc());
        if let (Some((_, _, [x0, y0, x1, y1])), Some(_)) = (&pattern, pattern_id) {
            content.set_fill_color_space(pdf_writer::types::ColorSpaceOperand::Pattern);
            content.set_fill_pattern(None, Name(b"P0"));
            content.rect(*x0, *y0, x1 - x0, y1 - y0);
            content.fill_nonzero();
        }
        let mut page = pdf.page(page_id);
        page.media_box(Rect::new(0., 0., w, h));
        page.parent(tree);
        page.contents(content_id);
        if let Some(id) = pattern_id {
            page.resources().patterns().pair(Name(b"P0"), id);
        }
        page.finish();
        pdf.stream(content_id, &content.finish());
        if let (Some((cell, [ox, oy], _)), Some(id)) = (pattern, pattern_id) {
            let mut p = pdf.tiling_pattern(id, &cell);
            p.paint_type(PaintType::Colored)
                .tiling_type(TilingType::ConstantSpacing)
                .bbox(Rect::new(0., 0., step, step))
                .x_step(step)
                .y_step(step)
                .matrix([1., 0., 0., 1., ox, oy]);
            p.resources();
            p.finish();
        }
    }
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree)
        .kids(kids.iter().copied())
        .count(kids.len() as i32);
    let title = format!(
        "{TITLE_PREFIX}{}",
        styles.iter().map(Paper::name).collect::<Vec<_>>().join(",")
    );
    pdf.document_info(info)
        .title(TextStr(&title))
        .producer(TextStr("NoteComplete"));
    pdf.finish()
}

fn hex(c: [f32; 3]) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        (c[0] * 255.).round() as u8,
        (c[1] * 255.).round() as u8,
        (c[2] * 255.).round() as u8
    )
}

/// The same paper as SVG for a page of `size` (page units), for previews.
pub fn paper_svg(style: Paper, size: [f64; 2]) -> String {
    let c = style.colors();
    let k = size[0] / A4_POINTS[0];
    let step = STEP * k;
    let mut out = format!(
        "<rect width=\"{}\" height=\"{}\" fill=\"{}\"/>",
        size[0],
        size[1],
        hex(c.page)
    );
    match style.kind {
        PaperKind::Dot => {
            out.push_str(&format!(
                "<defs><pattern id=\"nc-paper-dot\" patternUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{step}\" height=\"{step}\"><circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{}\"/></pattern></defs><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"url(#nc-paper-dot)\"/>",
                1.5 * step, 1.5 * step, step / 2., step / 2., 0.5 * k, hex(c.dot),
                1.5 * step, 1.5 * step, size[0] - 2.5 * step, size[1] - 2.5 * step
            ));
        }
        PaperKind::Grid => {
            out.push_str(&format!(
                "<defs><pattern id=\"nc-paper-grid\" patternUnits=\"userSpaceOnUse\" width=\"{step}\" height=\"{step}\"><path d=\"M0 0H{step}M0 0V{step}\" stroke=\"{}\" stroke-width=\"{}\" fill=\"none\"/></pattern></defs><rect width=\"{}\" height=\"{}\" fill=\"url(#nc-paper-grid)\"/>",
                hex(c.grid), 0.35 * k, size[0], size[1]
            ));
        }
        PaperKind::Ruled => {
            let mut y = RULE_TOP;
            let mut d = String::new();
            while y < A4_POINTS[1] - 20. {
                d.push_str(&format!("M0 {}H{}", y * k, size[0]));
                y += RULE;
            }
            out.push_str(&format!(
                "<path d=\"{d}\" stroke=\"{}\" stroke-width=\"{}\" fill=\"none\"/>",
                hex(c.rule),
                0.5 * k
            ));
        }
        PaperKind::Blank => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_round_trip_and_pdfs_stay_small() {
        for name in ["dot", "grid", "ruled", "blank", "dark-dot", "dark-ruled"] {
            assert_eq!(Paper::parse(name).unwrap().name(), name);
        }
        assert_eq!(Paper::parse("dot-dark"), Paper::parse("dark-dot"));
        assert!(Paper::parse("lava").is_none());
        let styles: Vec<Paper> = ["dot", "grid", "ruled", "blank", "dark-dot"]
            .iter()
            .map(|n| Paper::parse(n).unwrap())
            .collect();
        let pdf = paper_pdf(&styles);
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() < 12_000, "{} bytes", pdf.len());
        let text = String::from_utf8_lossy(&pdf);
        assert_eq!(
            text.matches("/Type /Page").count() - text.matches("/Type /Pages").count(),
            5
        );
        assert!(text.contains("/PatternType 1"));
        assert!(paper_svg(Paper::DOT, A4).contains("nc-paper-dot"));
    }
}
