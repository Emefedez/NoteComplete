//! Marks on an existing page (the `write_on_page` items): handwriting,
//! Markdown, native typed text boxes, lines, arrows, boxes, ellipses,
//! underlines, ticks, crosses, stars, highlighter (under the page's ink),
//! tape and SVG drawings. Coordinates are page units, origin top-left.
use super::{
    compose::{Composer, Setup},
    font::FontName,
    hand::{self, color, highlight_color, text_style, Hand, Pen},
    paper::Paper,
    rng::Rng,
    svg::{self, DrawOptions},
};
use crate::{Image, Line, TextBox};
use serde::Deserialize;

/// One mark. Fields not used by its `type` are ignored.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Item {
    #[serde(rename = "type")]
    pub kind: String,
    pub text: Option<String>,
    pub markdown: Option<String>,
    pub svg: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub x0: Option<f64>,
    pub x1: Option<f64>,
    pub x2: Option<f64>,
    pub y2: Option<f64>,
    pub cx: Option<f64>,
    pub cy: Option<f64>,
    pub rx: Option<f64>,
    pub ry: Option<f64>,
    pub from: Option<[f64; 2]>,
    pub to: Option<[f64; 2]>,
    pub radius: Option<f64>,
    pub size: Option<f64>,
    pub angle: Option<f64>,
    pub color: Option<String>,
    pub palette: Option<String>,
    pub font: Option<String>,
    pub hand: Option<String>,
    pub pen: Option<String>,
    pub pen_width: Option<f64>,
    pub look: Option<String>,
    pub double: bool,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    /// A `textbox` whose text is LaTeX, typeset by readers (never drawn as ink).
    pub math: bool,
    pub align: Option<String>,
}

/// What the items draw: strokes (under-ink ones have `under` set), native
/// text boxes, and warnings.
#[derive(Default)]
pub struct Annotation {
    pub lines: Vec<Line>,
    pub text_boxes: Vec<Image>,
    pub warnings: Vec<String>,
}

const MAX_ITEMS: usize = 500;
const MAX_TEXT: usize = 64 * 1024;

fn need(v: Option<f64>, item: usize, name: &str) -> Result<f64, String> {
    match v {
        Some(v) if v.is_finite() && v.abs() <= 1e5 => Ok(v),
        Some(_) => Err(format!("item {item}: {name} is out of range")),
        None => Err(format!("item {item}: {name} is required")),
    }
}
fn point(
    p: Option<[f64; 2]>,
    x: Option<f64>,
    y: Option<f64>,
    item: usize,
    name: &str,
) -> Result<[f64; 2], String> {
    match p {
        Some(p) => Ok([need(Some(p[0]), item, name)?, need(Some(p[1]), item, name)?]),
        None => Ok([
            need(x, item, &format!("{name} x"))?,
            need(y, item, &format!("{name} y"))?,
        ]),
    }
}

/// Build the marks. `seed` makes the same items write the same strokes.
pub fn annotate(items: &[Item], seed: u64) -> Result<Annotation, String> {
    if items.len() > MAX_ITEMS {
        return Err(format!("At most {MAX_ITEMS} items per call"));
    }
    let mut out = Annotation::default();
    let mut rng = Rng::new(seed);
    for (n, it) in items.iter().enumerate() {
        let n = n + 1;
        let text_len =
            it.text.as_deref().map_or(0, str::len) + it.markdown.as_deref().map_or(0, str::len);
        if text_len > MAX_TEXT {
            return Err(format!("item {n}: text is longer than 64 KB"));
        }
        let kind = it.kind.trim().to_ascii_lowercase();
        let pen_color = |default: &str| -> Result<[f64; 4], String> {
            let name = it.color.as_deref().unwrap_or(default);
            color(name).ok_or_else(|| format!("item {n}: unknown colour '{name}' (use a name like red, blue, green, ink or #hex)"))
        };
        let mut pen = Pen::new(pen_color("red").unwrap_or([1., 0., 0., 1.]), rng.seed());
        if !kind.starts_with("highlight") && kind != "tape" && kind != "textbox" {
            pen.color = pen_color("red")?;
        }
        if it.pen.as_deref() == Some("fineliner") {
            pen.fineliner = true;
            pen.width = 1.0;
        }
        if let Some(w) = it
            .pen_width
            .filter(|w| w.is_finite() && (0.3..=20.).contains(w))
        {
            pen.width = w;
        }
        // A text box's font is a typeface name (Helvetica, …), not a hand.
        let font = match it.font.as_deref().filter(|_| kind != "textbox") {
            None => FontName::Patrick,
            Some(f) => FontName::parse(f)
                .ok_or_else(|| format!("item {n}: unknown handwriting font '{f}'"))?,
        };
        let hand_of = || -> Result<Hand, String> {
            it.hand.as_deref().map_or(Ok(Hand::Natural), |h| {
                Hand::parse(h)
                    .ok_or_else(|| format!("item {n}: hand must be neat, natural or messy"))
            })
        };
        match kind.as_str() {
            "text" => {
                let text = it.text.as_deref().filter(|t| !t.trim().is_empty()).ok_or(format!("item {n}: text is required"))?;
                let size = it.size.unwrap_or(11.).clamp(4., 60.);
                let style = text_style(font, size, hand_of()?);
                let (s, _) = hand::write_block(&mut pen, text, need(it.x, n, "x")?, need(it.y, n, "y")?, it.width.or(it.w).unwrap_or(800.).max(20.), &style);
                out.lines.extend(s);
            }
            "markdown" => {
                let text = it.markdown.as_deref().or(it.text.as_deref()).filter(|t| !t.trim().is_empty()).ok_or(format!("item {n}: markdown is required"))?;
                let (x, y) = (need(it.x, n, "x")?, need(it.y, n, "y")?);
                let study = it.look.as_deref() == Some("study");
                let mut c = Composer::new(Setup {
                    study,
                    dark: false,
                    paper: Paper::parse("blank").unwrap(),
                    ink: it.color.as_deref().and_then(color),
                    accent: it.palette.clone().unwrap_or_else(|| "blue".into()),
                    font,
                    size: it.size.unwrap_or(11.).clamp(4., 60.),
                    hand: hand_of()?,
                    fineliner: it.pen.as_deref() == Some("fineliner") || (study && it.pen.is_none()),
                    seed: rng.seed(),
                })
                .at(x, x + it.width.or(it.w).unwrap_or(800.), y);
                c.markdown(text);
                if c.pages.len() > 1 {
                    out.warnings.push(format!("item {n}: the Markdown ran past the bottom of the page; what did not fit was left out"));
                }
                let page = c.pages.swap_remove(0);
                out.lines.extend(page.under);
                out.lines.extend(page.lines);
                out.warnings.extend(c.warnings.into_iter().map(|w| format!("item {n}: {w}")));
            }
            "textbox" => {
                let text = it.text.as_deref().filter(|t| !t.trim().is_empty()).ok_or(format!("item {n}: text is required"))?;
                let size = it.size.unwrap_or(16.).clamp(4., 200.);
                let rgba = pen_color("#1f2233")?;
                let lines = text.lines().count().max(1) as f64;
                let longest = text.lines().map(|l| l.chars().count()).max().unwrap_or(1) as f64;
                // Typeset math is narrower than its source (commands, braces) and taller
                // (fractions, powers); readers fit the formula into the box either way.
                let (wide, tall) = if it.math { (0.45, 2.2) } else { (0.58, 1.3) };
                let w = it.w.or(it.width).unwrap_or(longest * size * wide + 16.).max(size);
                let h = it.h.or(it.height).unwrap_or(lines * size * tall + 12.).max(size);
                let align = match it.align.as_deref().unwrap_or("left") {
                    "left" => 0,
                    "center" | "centre" => 1,
                    "right" => 2,
                    other => return Err(format!("item {n}: align must be left, center or right, not {other}")),
                };
                let family = it.font.clone().unwrap_or_else(|| "Helvetica".into());
                out.text_boxes.push(Image {
                    base64: String::new(),
                    mime: String::new(),
                    bounds: [need(it.x, n, "x")?, need(it.y, n, "y")?, w, h],
                    layer: 0,
                    joined: false,
                    part: None,
                    text: Some(TextBox {
                        text: text.to_owned(),
                        font_size: size,
                        rgba,
                        bold: it.bold,
                        italic: it.italic,
                        font: family,
                        align,
                        underline: it.underline,
                        strikethrough: it.strikethrough,
                        math: it.math,
                    }),
                });
            }
            "line" | "arrow" => {
                let a = point(it.from, it.x, it.y, n, "from")?;
                let b = point(it.to, it.x2, it.y2, n, "to")?;
                if kind == "arrow" {
                    out.lines.extend(hand::arrow(&mut pen, a, b, it.size.unwrap_or(16.)));
                } else {
                    out.lines.push(hand::line(&mut pen, a, b, 1.6));
                }
            }
            "rect" | "box" => {
                out.lines.extend(hand::rect(&mut pen, need(it.x, n, "x")?, need(it.y, n, "y")?, need(it.w.or(it.width), n, "w")?, need(it.h.or(it.height), n, "h")?, it.radius.unwrap_or(0.).max(0.)));
            }
            "ellipse" | "circle" => {
                let (rx, ry) = match (it.rx, it.ry, it.radius) {
                    (Some(rx), ry, _) => (rx, ry.unwrap_or(rx)),
                    (None, Some(ry), _) => (ry, ry),
                    (None, None, r) => (need(r, n, "rx")?, need(r, n, "ry")?),
                };
                out.lines.push(hand::ellipse(&mut pen, need(it.cx, n, "cx")?, need(it.cy, n, "cy")?, need(Some(rx), n, "rx")?, need(Some(ry), n, "ry")?));
            }
            "underline" => {
                let x0 = need(it.x0.or(it.x), n, "x0")?;
                let x1 = need(it.x1.or(it.x2).or(it.w.map(|w| x0 + w)), n, "x1")?;
                out.lines.extend(hand::underline(&mut pen, x0, x1, need(it.y, n, "y")?, it.double));
            }
            "check" | "tick" => out.lines.push(hand::checkmark(&mut pen, need(it.x, n, "x")?, need(it.y, n, "y")?, it.size.unwrap_or(18.))),
            "cross" | "x" => out.lines.extend(hand::cross(&mut pen, need(it.x, n, "x")?, need(it.y, n, "y")?, it.size.unwrap_or(16.))),
            "star" => out.lines.push(hand::star(&mut pen, need(it.x, n, "x")?, need(it.y, n, "y")?, it.size.unwrap_or(12.))),
            "highlight" => {
                let col = highlight_color(it.color.as_deref().unwrap_or("yellow"));
                out.lines.extend(hand::highlight_rect(need(it.x, n, "x")?, need(it.y, n, "y")?, need(it.w.or(it.width), n, "w")?, it.h.or(it.height).unwrap_or(24.).max(2.), col, &mut rng));
            }
            "highlight_line" => {
                let col = highlight_color(it.color.as_deref().unwrap_or("yellow"));
                let a = point(it.from, it.x, it.y, n, "from")?;
                let b = point(it.to, it.x2, it.y2, n, "to")?;
                out.lines.push(hand::highlight_line(a, b, it.width.unwrap_or(24.), col, &mut rng));
            }
            "tape" => {
                let col = hand::tape_color(it.palette.as_deref().or(it.color.as_deref()).unwrap_or("mint"));
                out.lines.push(hand::tape(need(it.x, n, "x")?, need(it.y, n, "y")?, it.w.or(it.width).unwrap_or(230.), it.h.or(it.height).unwrap_or(40.), it.angle.unwrap_or(0.), col));
            }
            "drawing" | "svg" => {
                let svg_text = it.svg.as_deref().ok_or(format!("item {n}: svg is required"))?;
                let opts = DrawOptions {
                    label_font: font,
                    caps: false,
                    band: 5.,
                    ink: color(it.color.as_deref().unwrap_or("#1f2233")).unwrap_or([0.12, 0.13, 0.2, 1.]),
                    pastel: true,
                };
                pen.color = opts.ink;
                let d = svg::drawing(svg_text, need(it.x, n, "x")?, need(it.y, n, "y")?, it.width.or(it.w).unwrap_or(400.).max(10.), it.height.or(it.h), &mut pen, &opts)
                    .map_err(|e| format!("item {n}: {e}"))?;
                out.lines.extend(d.under);
                out.lines.extend(d.strokes);
                out.warnings.extend(d.warnings.into_iter().map(|w| format!("item {n}: {w}")));
            }
            "" => return Err(format!("item {n}: type is required")),
            other => return Err(format!(
                "item {n}: unknown type '{other}' (text, markdown, textbox, line, arrow, rect, ellipse, underline, check, cross, star, highlight, highlight_line, tape, drawing)"
            )),
        }
    }
    out.lines = out
        .lines
        .into_iter()
        .flat_map(|l| svg::split_long(l, 8000))
        .collect();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn items(json: &str) -> Vec<Item> {
        serde_json::from_str(json).unwrap()
    }
    #[test]
    fn marks_highlights_and_text_boxes() {
        let a = annotate(&items(r###"[
            {"type":"check","x":100,"y":200},
            {"type":"ellipse","cx":300,"cy":200,"rx":40,"ry":20,"color":"blue"},
            {"type":"highlight","x":100,"y":300,"w":200,"h":60,"color":"mint"},
            {"type":"arrow","from":[10,10],"to":[100,100]},
            {"type":"line","x":10,"y":10,"x2":50,"y2":10},
            {"type":"text","text":"Well done — ¡muy bien!","x":100,"y":500,"color":"green"},
            {"type":"textbox","text":"Score: 4/5","x":600,"y":80,"bold":true,"align":"center"},
            {"type":"tape","x":100,"y":700},
            {"type":"markdown","text":"## Note\n- one\n- two","x":100,"y":800,"width":400},
            {"type":"drawing","svg":"<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4' fill='#ffe066' stroke='#000'/></svg>","x":700,"y":700,"width":200}
        ]"###), 1).unwrap();
        assert!(a.warnings.is_empty(), "{:?}", a.warnings);
        let unders = a.lines.iter().filter(|l| l.under).count();
        assert!(
            unders >= 3,
            "highlight passes and the drawing's fill go under the ink"
        );
        assert!(a.lines.iter().filter(|l| l.under).all(|l| l.tool == 1));
        assert!(a.lines.iter().any(|l| l.tool == 2), "tape");
        assert!(a.lines.iter().any(|l| l.rgba == color("green").unwrap()));
        let tb = a.text_boxes[0].text.as_ref().unwrap();
        assert!(tb.bold && tb.align == 1 && tb.font == "Helvetica");
        for bad in [
            r#"[{"type":"check","x":1}]"#,
            r#"[{"type":"zigzag","x":1,"y":1}]"#,
            r#"[{"type":"check","x":1,"y":1,"color":"octarine"}]"#,
            r#"[{"type":"drawing","svg":"<svg","x":1,"y":1}]"#,
            r#"[{"type":"textbox","text":"x","x":1,"y":1,"align":"justify"}]"#,
        ] {
            assert!(annotate(&items(bad), 1).is_err(), "{bad}");
        }
    }
    #[test]
    fn math_text_boxes_are_typed_text_flagged_as_latex_never_ink() {
        let a = annotate(
            &items(r#"[{"type":"textbox","text":"x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}","x":100,"y":100,"math":true}]"#),
            1,
        )
        .unwrap();
        assert!(a.lines.is_empty(), "math is never drawn");
        let image = &a.text_boxes[0];
        let tb = image.text.as_ref().unwrap();
        assert!(tb.math && tb.text.starts_with("x = \\frac"));
        // Sized for a formula: taller than a line of text.
        assert!(image.bounds[3] >= 16. * 2.2, "{:?}", image.bounds);
        let plain = annotate(
            &items(r#"[{"type":"textbox","text":"Score","x":1,"y":1}]"#),
            1,
        )
        .unwrap();
        assert!(!plain.text_boxes[0].text.as_ref().unwrap().math);
    }
}
