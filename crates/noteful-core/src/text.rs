//! Attributed text: run strings + attribute deltas + shared typed value pools.
//! Wire keys 2/3/10/13/14 are confirmed by texto.noteful; decorations and pool
//! types are backed by Ghidra functions 100a485ec / 100a49e04 (see spec/noteful-v0.1.md).
use crate::{Error, Result};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
pub struct TextRun {
    pub text: String,
    pub font_size: f64,
    pub font_family: String,
    pub font_name: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: u64,
    pub strikethrough: u64,
    pub rgba: [f64; 4],
    pub alignment: u64,
    pub line_height: f64,
    pub line_spacing: f64,
}
impl Default for TextRun {
    fn default() -> Self {
        Self {
            text: String::new(),
            font_size: 15.,
            font_family: "Helvetica".into(),
            font_name: String::new(),
            bold: false,
            italic: false,
            underline: 0,
            strikethrough: 0,
            rgba: [0., 0., 0., 1.],
            alignment: 0,
            line_height: 0.,
            line_spacing: 8.,
        }
    }
}
#[derive(Debug, Serialize)]
pub struct RichText {
    pub runs: Vec<TextRun>,
    pub warnings: Vec<String>,
}
fn array(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], |a| a)
}
fn apply(v: &Value, runs: &mut [TextRun]) -> Result<()> {
    let counts = array(&v["3"]);
    let keys = array(&v["4"]);
    let mut cursor: usize = 0;
    let mut pool_cursor = [0usize; 11];
    if counts.len() != runs.len() {
        return Err(Error::new(0, "Text run/count mismatch"));
    }
    let mut style = TextRun::default();
    for (run, count) in runs.iter_mut().zip(counts) {
        let count = count
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| Error::new(0, "Invalid text attribute count"))?;
        let end = cursor
            .checked_add(count)
            .filter(|end| *end <= keys.len())
            .ok_or_else(|| Error::new(0, "Truncated text attributes"))?;
        for key in &keys[cursor..end] {
            let key = key
                .as_u64()
                .ok_or_else(|| Error::new(0, "Invalid text attribute key"))?;
            let pool = match key {
                1 | 13 | 14 => 5,
                2 | 3 => 6,
                4 | 5 | 8 => 8,
                6 | 7 => 7,
                9 => 9,
                10..=12 => 10,
                _ => return Err(Error::new(0, format!("Unknown text attribute {key}"))),
            };
            let item = array(&v[pool.to_string()])
                .get(pool_cursor[pool])
                .ok_or_else(|| Error::new(0, format!("Truncated text pool {pool}")))?;
            pool_cursor[pool] += 1;
            match key {
                1 | 13 => {
                    style.font_family = item
                        .as_str()
                        .ok_or_else(|| Error::new(0, "Invalid font family"))?
                        .to_owned()
                }
                14 => {
                    style.font_name = item
                        .as_str()
                        .ok_or_else(|| Error::new(0, "Invalid font name"))?
                        .to_owned()
                }
                2 | 3 => {
                    let flag = item
                        .as_u64()
                        .filter(|v| *v <= 1)
                        .ok_or_else(|| Error::new(0, "Invalid font trait"))?
                        == 1;
                    if key == 2 {
                        style.bold = flag;
                    } else {
                        style.italic = flag;
                    }
                }
                4 | 5 | 8 => {
                    let n = item
                        .as_u64()
                        .ok_or_else(|| Error::new(0, "Invalid text integer"))?;
                    match key {
                        4 => style.underline = n,
                        5 => style.strikethrough = n,
                        _ => style.alignment = n,
                    }
                }
                6 => {
                    let a = array(&item["0"]);
                    if a.len() != 4 {
                        return Err(Error::new(0, "Unsupported text color"));
                    }
                    for (out, value) in style.rgba.iter_mut().zip(a) {
                        *out = value
                            .as_f64()
                            .filter(|n| (0.0..=1.0).contains(n))
                            .ok_or_else(|| Error::new(0, "Invalid text color"))?;
                    }
                }
                10..=12 => {
                    let n = item
                        .as_f64()
                        .filter(|n| n.is_finite() && (0.0..=10000.).contains(n))
                        .ok_or_else(|| Error::new(0, "Invalid text size/spacing"))?;
                    match key {
                        10 if n > 0. => style.font_size = n,
                        11 => style.line_height = n,
                        12 => style.line_spacing = n,
                        _ => return Err(Error::new(0, "Zero font size")),
                    }
                }
                // Consume background color / paragraph objects to keep pools aligned.
                _ => {}
            }
        }
        cursor = end;
        let text = std::mem::take(&mut run.text);
        *run = style.clone();
        run.text = text;
    }
    if cursor != keys.len() || (5..=10).any(|i| pool_cursor[i] != array(&v[i.to_string()]).len()) {
        return Err(Error::new(0, "Unconsumed text attributes"));
    }
    Ok(())
}
/// Preserve visible characters even when a future attribute is unsupported.
pub fn decode_rich_text(v: &Value) -> RichText {
    let mut runs: Vec<_> = array(&v["2"])
        .iter()
        .map(|s| TextRun {
            text: s.as_str().unwrap_or("").to_owned(),
            ..TextRun::default()
        })
        .collect();
    let mut warnings = Vec::new();
    if let Err(error) = apply(v, &mut runs) {
        warnings.push(format!("Texto visible con estilos parciales: {error}"));
    }
    RichText { runs, warnings }
}
pub(crate) fn xml(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&apos;".into(),
            c if (c < ' ' && !matches!(c, '\n' | '\r' | '\t'))
                || matches!(c, '\u{fffe}' | '\u{ffff}') =>
            {
                "�".into()
            }
            _ => c.to_string(),
        })
        .collect()
}
fn family(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}
pub fn text_svg(text: &RichText, width: f64) -> String {
    let mut lines: Vec<Vec<(&TextRun, String)>> = vec![vec![]];
    for run in &text.runs {
        let content = run
            .text
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace("\u{200b}", "");
        for (i, part) in content.split('\n').enumerate() {
            if i > 0 {
                lines.push(vec![]);
            }
            if !part.is_empty() {
                lines.last_mut().unwrap().push((run, part.to_owned()));
            }
        }
    }
    let mut output = String::new();
    let mut y = 8.;
    for line in lines {
        let size = line.iter().map(|(r, _)| r.font_size).fold(15., f64::max);
        y += size;
        let align = line.first().map_or(0, |(r, _)| r.alignment);
        let (x, anchor) = match align {
            1 => (width / 2., "middle"),
            2 => (width - 5., "end"),
            _ => (5., "start"),
        };
        output.push_str(&format!(
            "<text x=\"{x}\" y=\"{y}\" text-anchor=\"{anchor}\" xml:space=\"preserve\">"
        ));
        for (run, content) in &line {
            let decoration = match (run.underline > 0, run.strikethrough > 0) {
                (true, true) => "underline line-through",
                (true, false) => "underline",
                (false, true) => "line-through",
                _ => "none",
            };
            // iPad fonts may be missing here: fall back to the same kind of face.
            let lower = run.font_family.to_lowercase();
            let generic = if lower.contains("courier") || lower.contains("mono") {
                "'Courier New', monospace"
            } else if lower.contains("times")
                || lower.contains("georgia")
                || lower.contains("serif")
            {
                "'Times New Roman', serif"
            } else if lower.contains("noteworthy")
                || lower.contains("marker")
                || lower.contains("chalk")
            {
                "'Comic Neue', 'Comic Sans MS', cursive"
            } else {
                "Arial, sans-serif"
            };
            let fonts = format!(
                "'{}', '{}', {generic}",
                family(&run.font_family),
                family(&run.font_name)
            );
            output.push_str(&format!("<tspan font-family=\"{}\" font-size=\"{}\" font-weight=\"{}\" font-style=\"{}\" text-decoration=\"{decoration}\" fill=\"{}\" fill-opacity=\"{}\">{}</tspan>",xml(&fonts),run.font_size,if run.bold {700}else{400},if run.italic {"italic"}else{"normal"},crate::scene::color(&run.rgba),run.rgba[3],xml(content)));
        }
        output.push_str("</text>");
        y += line
            .iter()
            .map(|(r, _)| {
                if r.line_height > 0. {
                    (r.line_height - size).max(0.)
                } else {
                    size * 0.2 + r.line_spacing
                }
            })
            .fold(8., f64::max);
    }
    output
}
