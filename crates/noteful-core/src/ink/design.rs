//! A page design (an image model's mockup, or any picture of a page) copied
//! into real Noteful ink. The agent lists what is on the mockup in its own
//! pixels; each item is drawn at the same place and size: text as handwriting
//! (the agent supplies the right words, so a mockup's garbled text never
//! reaches the page), cards, bands, highlighter, sticky notes, arrows and
//! circled numbers as pen and highlighter strokes, and drawings traced
//! straight out of the mockup. Ported from noteful-mcp's design.py (MIT).
//!
//! Spec (JSON): `{"size": [896, 1200], "theme": "light", "paper": "dot",
//! "valign": "middle", "items": [...]}`, or `"parts": [{"items", "scale",
//! "top", "mockup"}, ...]` for several designs on one page. Colours are
//! "#rrggbb" or "auto" (sampled from the mockup at that spot). See `SPEC_DOC`.
use super::{
    font::{FontName, Pt},
    hand::{
        self, color, highlight_color, text_style, text_width, wobble, write_line, Hand, Pen, Rgba,
        TextStyle,
    },
    paper::{Paper, A4},
    rng::Rng,
    svg::{fill_shapes, rect_pts},
    trace::{reachable, solid, trace, Raster, TraceOptions},
    InkPage,
};
use crate::{Error, Line, Result};
use serde_json::{json, Map, Value};
use std::f64::consts::TAU;

/// Cap height over x-height of the handwriting fonts.
const CAP: f64 = 1.563;

pub const SPEC_DOC: &str = r##"Design spec (JSON), one per page; coordinates and sizes are the mockup's pixels:
  {"size": [896, 1200], "theme": "light"|"dark", "paper": "dot", "valign": "middle"|"top", "mockup": "<image path>", "items": [...]}
  or "parts": [{"mockup", "items", "scale" (0.5 = half-size handwriting), "top" (page px, or "auto")}, ...] for several designs on one page.
Items are drawn in order; colours are "#rrggbb" or "auto" (sampled from the mockup there):
  text   {"t":"text","x","y" (baseline),"h" (cap height),"text","color","pen" (weight),"w" (fit width),"wmax" (shrink only if wider),"align":left|center|right,"lh" (line step for \n lines),"wrap" (re-wrap width),"font","hand"}
         inline: {#e9573f:word} colours a run ({#e9573f@1.3:word} also enlarges it), ==phrase== highlights ({hl:#ffd27a}==phrase== picks the colour), CO_2 / T^4 scripts
  lines  {"t":"lines","x","y" (first baseline),"h","lh" (baseline step),"lines":[...],"para":true (one paragraph, re-wrapped)} plus any text keys
  rect   {"t":"rect","x","y","w","h","fill","stroke","r" (corner radius),"pen","dots" (dotted inner border colour)}
  band   {"t":"band","y","h","fill"}   full-width colour zone
  hl     {"t":"hl","x","y","w","h","color"}   highlighter swipe
  sticky {"t":"sticky","x","y","w","h","fill","angle" (degrees),"tape","text":[text items]}
  line   {"t":"line","pts":[[x,y],...],"color","pen","head":none|open|hollow|block,"size","width"}
  circle {"t":"circle","cx","cy","r" (or "rx","ry"),"color","pen","fill","text","h"}
  hook   {"t":"hook","x","y","h","color"}   ↳ list mark
  trace  {"t":"trace","box":[x,y,w,h],"erase":[[x,y,w,h],...] (labels to drop),"colors":8}   a drawing traced out of the mockup
Text that runs into the text below pushes it down; what cannot be fixed is reported."##;

fn num(it: &Value, k: &str) -> Option<f64> {
    it.get(k)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.abs() <= 1e5)
}
fn need(it: &Value, k: &str) -> Result<f64> {
    num(it, k).ok_or_else(|| Error::new(0, format!("a {} item needs a number '{k}'", kind(it))))
}
fn kind(it: &Value) -> &str {
    it.get("t").and_then(Value::as_str).unwrap_or("text")
}
fn text_of(it: &Value) -> String {
    match it.get("text") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// One text run: its text, colour, highlight colour and size factor.
type Run = (String, Option<String>, Option<String>, f64);
/// `{#hex:text}`, `{#hex@1.3:text}` and `{hl:c}==text==` / `==text==` runs.
fn runs(text: &str) -> Vec<Run> {
    let mut out: Vec<Run> = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    let flush = |plain: &mut String, out: &mut Vec<Run>| {
        if !plain.is_empty() {
            out.push((std::mem::take(plain), None, None, 1.));
        }
    };
    while !rest.is_empty() {
        if let Some(body) = rest.strip_prefix("{#") {
            if let Some(end) = body.find('}') {
                let inner = &body[..end];
                if let Some((head, t)) = inner.split_once(':') {
                    let (hex, scale) = head.split_once('@').unwrap_or((head, "1"));
                    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                        flush(&mut plain, &mut out);
                        out.push((
                            t.to_owned(),
                            Some(format!("#{hex}")),
                            None,
                            scale.parse().unwrap_or(1.),
                        ));
                        rest = &body[end + 1..];
                        continue;
                    }
                }
            }
        }
        let (hl, after) = match rest.strip_prefix("{hl:").and_then(|b| b.split_once('}')) {
            Some((c, after)) if after.starts_with("==") => (Some(c.to_owned()), after),
            _ => (None, rest),
        };
        if let Some(body) = after.strip_prefix("==") {
            if let Some(end) = body.find("==").filter(|e| *e > 0) {
                flush(&mut plain, &mut out);
                out.push((
                    body[..end].to_owned(),
                    None,
                    Some(hl.unwrap_or_else(|| "#ffe58a".into())),
                    1.,
                ));
                rest = &body[end + 2..];
                continue;
            }
        }
        let c = rest.chars().next().unwrap();
        plain.push(c);
        rest = &rest[c.len_utf8()..];
    }
    flush(&mut plain, &mut out);
    out
}
fn plain(text: &str) -> String {
    runs(text).into_iter().map(|r| r.0).collect()
}
fn scaled(st: &TextStyle, k: f64) -> TextStyle {
    TextStyle {
        size: st.size * k,
        ..*st
    }
}

struct Page<'a> {
    w_px: f64,
    k: f64,
    oy: f64,
    dark: bool,
    ink: String,
    rng: Rng,
    s: f64,
    top: f64,
    dy: f64,
    mock: Option<&'a Raster>,
    strokes: Vec<Line>,
    words: Vec<crate::InkWord>,
    under: Vec<Line>,
    warnings: Vec<String>,
}

impl Page<'_> {
    fn p(&self, x: f64, y: f64) -> Pt {
        [
            x * self.k,
            self.oy + (self.top + (y - self.dy) * self.s) * self.k,
        ]
    }
    /// A size (text, radius, height) in page units.
    fn l(&self, v: f64) -> f64 {
        v * self.k * self.s
    }
    /// A horizontal extent in page units.
    fn lx(&self, v: f64) -> f64 {
        v * self.k
    }
    fn colour(&mut self, c: Option<&str>, sample: Option<[f64; 4]>) -> String {
        match c {
            Some("auto") => match (self.mock, sample) {
                (Some(m), Some([x, y, w, h])) => m
                    .median(x as i64, y as i64, w as i64, h as i64)
                    .map(|p| format!("#{:02x}{:02x}{:02x}", p[0], p[1], p[2]))
                    .unwrap_or_else(|| self.ink.clone()),
                _ => {
                    self.warnings
                        .push("'auto' colour needs the spec's mockup image; used the ink".into());
                    self.ink.clone()
                }
            },
            Some(c) if !c.is_empty() => c.to_owned(),
            _ => self.ink.clone(),
        }
    }
    fn rgba(&mut self, c: &str) -> Rgba {
        color(c).unwrap_or_else(|| {
            self.warnings.push(format!("unknown colour '{c}'"));
            color(&self.ink.clone()).unwrap()
        })
    }
    /// Highlighter ink that shows as `c` on the page (on black, the colour itself).
    fn fill_colour(&mut self, c: &str) -> Rgba {
        if !c.starts_with('#') {
            return highlight_color(c);
        }
        let rgba = self.rgba(c);
        if self.dark {
            rgba
        } else {
            solid([rgba[0], rgba[1], rgba[2]])
        }
    }
    /// A pressure pen like a pencil; `even` is for colouring (no pressure).
    fn pen(&mut self, colour: &str, width: f64, even: bool) -> Pen {
        let mut p = Pen::new(self.rgba(colour), self.rng.seed());
        if even {
            p.fineliner = true;
            p.width = width;
        } else {
            p.width = width * self.rng.uniform(0.9, 1.1) / 1.25;
            p.vary = 0.28;
        }
        p
    }
    /// Colour shapes: highlighter when it can show the colour, opaque pen otherwise.
    fn paint(&mut self, polys: Vec<Vec<Pt>>, c: &str, band: f64, opaque: bool) -> Vec<Line> {
        let rgba = self.rgba(c);
        if c.starts_with('#') && (opaque || self.dark || !reachable([rgba[0], rgba[1], rgba[2]])) {
            let rows = fill_shapes(&[(polys, rgba)], band * 0.85, 0., &mut self.rng);
            let mut pen = self.pen(c, band / 1.05, true);
            return rows
                .iter()
                .map(|r| {
                    let mut l = pen.stroke(&[r.points[0], *r.points.last().unwrap()], 3., 0, 0.1);
                    l.under = true;
                    l
                })
                .collect();
        }
        let fill = self.fill_colour(c);
        fill_shapes(&[(polys, fill)], band, 0., &mut self.rng)
    }

    fn style(&self, it: &Value) -> TextStyle {
        let font = it
            .get("font")
            .and_then(Value::as_str)
            .and_then(FontName::parse)
            .unwrap_or(FontName::Patrick);
        let hand = it
            .get("hand")
            .and_then(Value::as_str)
            .and_then(Hand::parse)
            .unwrap_or(Hand::Natural);
        text_style(font, self.l(num(it, "h").unwrap_or(20.)) / CAP, hand)
    }
    /// Re-wrap a paragraph (text with "wrap") at this part's size; marks stay whole.
    fn wrap(&self, it: &Value) -> Vec<String> {
        let st = self.style(it);
        let wrap_w = num(it, "wrap").unwrap_or(800.);
        let width = self.lx(wrap_w.min(num(it, "_room").unwrap_or(wrap_w)));
        let mut tokens = Vec::new();
        let text = text_of(it);
        let mut rest = text.as_str();
        while let Some(start) = rest.find(|c: char| !c.is_whitespace()) {
            rest = &rest[start..];
            // A marked run stays one token, with what sticks to it.
            let marked = if rest.starts_with("{hl:") || rest.starts_with("==") {
                let from = rest.find("==").unwrap_or(0) + 2;
                rest[from..].find("==").map(|e| from + e + 2)
            } else if rest.starts_with("{#") {
                rest.find('}').map(|e| e + 1)
            } else {
                None
            };
            let mut end = marked.unwrap_or(0);
            end += rest[end..]
                .find(char::is_whitespace)
                .unwrap_or(rest.len() - end);
            tokens.push(&rest[..end]);
            rest = &rest[end..];
        }
        let mut lines = Vec::new();
        let mut cur = String::new();
        for tok in tokens {
            let trial = if cur.is_empty() {
                tok.to_owned()
            } else {
                format!("{cur} {tok}")
            };
            if !cur.is_empty() && text_width(&plain(&trial), &st) * 1.12 > width {
                lines.push(std::mem::replace(&mut cur, tok.to_owned()));
            } else {
                cur = trial;
            }
        }
        if !cur.is_empty() {
            lines.push(cur);
        }
        lines
    }
    /// Paragraphs that now take fewer lines pull what is below them up (`_dy`).
    fn flow(&self, items: &mut [Value]) {
        for it in items.iter_mut() {
            if kind(it) == "text" && num(it, "wrap").is_some() {
                let lines = self.wrap(it);
                it["_lines"] = json!(lines);
            }
        }
        let mut events = Vec::new();
        for it in items.iter() {
            let Some(lines) = it.get("_lines").and_then(Value::as_array) else {
                continue;
            };
            if it.get("flow").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let h = num(it, "h").unwrap_or(20.);
            let lh = num(it, "lh").unwrap_or(h * 1.9);
            let n = num(it, "_n").unwrap_or(1.);
            let end = num(it, "y").unwrap_or(0.) + (n - 1.) * lh;
            events.push((end, (n - lines.len() as f64) * lh));
        }
        for it in items.iter_mut() {
            let top = top_of(it);
            it["_dy"] = json!(events
                .iter()
                .filter(|(end, _)| top > end + 1.)
                .map(|(_, d)| d)
                .sum::<f64>());
        }
    }

    // -- items ----------------------------------------------------------------
    fn draw(&mut self, it: &Value) -> Result<()> {
        match kind(it) {
            "text" => self.text(it),
            "rect" => {
                let (mut s, mut u) = (vec![], vec![]);
                self.rect(it, &mut s, &mut u)?;
                self.strokes.extend(s);
                self.under.extend(u);
                Ok(())
            }
            "band" => {
                let r = json!({"x":-10.,"y":need(it, "y")?,"w":self.w_px + 20.,"h":need(it, "h")?,"fill":it.get("fill").cloned().unwrap_or(json!("auto"))});
                let (mut s, mut u) = (vec![], vec![]);
                self.rect(&r, &mut s, &mut u)?;
                self.under.extend(u);
                Ok(())
            }
            "hl" => {
                let (x, y, w, h) = (need(it, "x")?, need(it, "y")?, need(it, "w")?, need(it, "h")?);
                let [px, py] = self.p(x, y);
                let c = self.colour(Some(it.get("color").and_then(Value::as_str).unwrap_or("auto")), Some([x, y, w, h]));
                let fill = self.fill_colour(&c);
                let (lw, lh) = (self.lx(w), self.l(h));
                let rows = hand::highlight_rect(px, py, lw, lh, fill, &mut self.rng);
                self.under.extend(rows);
                Ok(())
            }
            "sticky" => self.sticky(it),
            "line" => self.line(it),
            "circle" => self.circle(it),
            "hook" => self.hook(it),
            "trace" => self.trace(it),
            other => Err(Error::new(0, format!("unknown design item '{other}' (text, lines, rect, band, hl, sticky, line, circle, hook, trace)"))),
        }
    }
    fn text(&mut self, it: &Value) -> Result<()> {
        need(it, "x")?;
        let y = need(it, "y")?;
        let h = need(it, "h")?;
        let lines: Vec<String> = match it.get("_lines").and_then(Value::as_array) {
            Some(l) => l
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            None => text_of(it).split('\n').map(str::to_owned).collect(),
        };
        let lh = num(it, "lh").unwrap_or(h * 1.9);
        for (i, line) in lines.iter().enumerate() {
            self.text_line(it, line, y + i as f64 * lh);
        }
        Ok(())
    }
    fn text_line(&mut self, it: &Value, text: &str, y: f64) {
        let mut st = self.style(it);
        let rs = runs(text);
        let measure = |st: &TextStyle| {
            rs.iter()
                .map(|r| text_width(&r.0, &scaled(st, r.3)))
                .sum::<f64>()
        };
        let mut width = measure(&st);
        let room = num(it, "_room").map(|r| self.lx(r));
        if let Some(w) = num(it, "w") {
            // Match the mockup's line length: letter spacing first, then size.
            let want = room.map_or(self.lx(w), |r| self.lx(w).min(r));
            if width > 0. {
                st.tracking = (st.tracking * want / width).clamp(0.94, 1.1);
            }
            width = measure(&st);
            if width > want {
                st.size *= want / width;
                width = measure(&st);
            }
        } else if let Some(wmax) = num(it, "wmax").map(|w| self.lx(w)).filter(|w| width > *w) {
            st.size *= wmax / width;
            width = measure(&st);
        } else if let Some(r) = room.filter(|r| width > *r) {
            st.size *= r / width;
            width = measure(&st);
        }
        let limit = [num(it, "w").map(|w| self.lx(w)), room]
            .into_iter()
            .flatten()
            .reduce(f64::min);
        let base = self.colour(it.get("color").and_then(Value::as_str), None);
        let weight =
            num(it, "pen").unwrap_or((self.l(num(it, "h").unwrap_or(20.)) * 0.092).max(1.));
        let [x0, b] = self.p(num(it, "x").unwrap_or(0.), y);
        let align = it
            .get("align")
            .and_then(Value::as_str)
            .unwrap_or("left")
            .to_owned();
        let draw = |pg: &mut Self, st: &TextStyle, width: f64| -> (Vec<Line>, Vec<Line>, f64) {
            let x = x0
                - match align.as_str() {
                    "center" | "centre" => width / 2.,
                    "right" => width,
                    _ => 0.,
                };
            let (start, mut x, mut strokes, mut under) = (x, x, vec![], vec![]);
            for (piece, col, hl, k) in &rs {
                let xa = x;
                let c = col.clone().unwrap_or_else(|| base.clone());
                let mut pen = pg.pen(&c, weight * (1. + (k - 1.) * 0.6), false);
                let (s, end) = write_line(&mut pen, piece, x, b, &scaled(st, *k));
                pg.words
                    .extend(super::hand::word_boxes(piece, x, b, &scaled(st, *k)));
                strokes.extend(s);
                x = end;
                if let Some(hl) = hl {
                    let lead: String = piece.chars().take_while(|c| c.is_whitespace()).collect();
                    let lead = text_width(&lead, st);
                    let yc = b - st.size * 0.55;
                    let fill = pg.fill_colour(hl);
                    under.push(hand::highlight_line(
                        [xa + lead - 4., yc],
                        [x + 4., yc + 0.5],
                        st.size * 2.3,
                        fill,
                        &mut pg.rng,
                    ));
                }
            }
            (strokes, under, x - start)
        };
        let (mut strokes, mut under, actual) = draw(self, &st, width);
        if let Some(limit) = limit.filter(|l| actual > l * 1.02) {
            // Spaces and letters come out a little wider than measured.
            st.size *= limit / actual;
            let w = measure(&st);
            (strokes, under, _) = draw(self, &st, w);
        }
        self.strokes.extend(strokes);
        self.under.extend(under);
    }
    fn rect(&mut self, it: &Value, into: &mut Vec<Line>, under: &mut Vec<Line>) -> Result<()> {
        let (ix, iy, iw, ih) = (
            need(it, "x")?,
            need(it, "y")?,
            need(it, "w")?,
            need(it, "h")?,
        );
        let [x, y] = self.p(ix, iy);
        let (w, h, r) = (self.lx(iw), self.l(ih), self.l(num(it, "r").unwrap_or(0.)));
        if let Some(f) = it.get("fill").and_then(Value::as_str) {
            let fill = self.colour(
                Some(f),
                Some([ix + iw * 0.3, iy + ih * 0.3, iw * 0.4, ih * 0.4]),
            );
            let poly = rect_pts(x + 2., y + 2., w - 4., h - 4., (r - 2.).max(0.), 0.);
            let opaque = it.get("solid").and_then(Value::as_bool).unwrap_or(false);
            under.extend(self.paint(vec![poly], &fill, 12., opaque));
        }
        if let Some(s) = it.get("stroke").and_then(Value::as_str) {
            let c = self.colour(Some(s), None);
            let mut pen = self.pen(&c, num(it, "pen").unwrap_or(1.4), false);
            into.extend(hand::rect(&mut pen, x, y, w, h, r));
        }
        if let Some(d) = it.get("dots").and_then(Value::as_str) {
            let c = self.colour(Some(d), None);
            let mut pen = self.pen(&c, 2.2, false);
            let pts = rect_pts(x + 10., y + 10., w - 20., h - 20., (r - 8.).max(0.), 0.);
            let (gap, mut acc) = (11., 0.);
            for i in 0..pts.len() {
                let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                let seg = (b[0] - a[0]).hypot(b[1] - a[1]);
                let mut t = if acc > 0. { gap - acc } else { 0. };
                while t <= seg && seg > 0. {
                    let p = [
                        a[0] + (b[0] - a[0]) * t / seg,
                        a[1] + (b[1] - a[1]) * t / seg,
                    ];
                    into.push(pen.stroke(&[p, [p[0] + 0.6, p[1] + 0.3]], 0.5, 0, 0.05));
                    t += gap;
                }
                acc = (acc + seg) % gap;
            }
        }
        Ok(())
    }
    fn sticky(&mut self, it: &Value) -> Result<()> {
        let (mut strokes, mut under) = (vec![], vec![]);
        // A sticky note is opaque paper: it covers what is under it.
        let mut paper = it.clone();
        paper["fill"] = it.get("fill").cloned().unwrap_or(json!("auto"));
        paper["solid"] = json!(true);
        paper["stroke"] = Value::Null;
        self.rect(&paper, &mut strokes, &mut under)?;
        let [x, y] = self.p(need(it, "x")?, need(it, "y")?);
        let (w, h) = (self.lx(need(it, "w")?), self.l(need(it, "h")?));
        if it.get("tape") != Some(&Value::Bool(false)) {
            let (tw, th) = (w * 0.38, self.l(22.));
            let tape = rect_pts(x + (w - tw) / 2., y - th / 2., tw, th, 0., 0.);
            let c = it
                .get("tape")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| "#ddd2bd".into());
            under.extend(self.paint(vec![tape], &c, 6., false));
        }
        let saved = (
            std::mem::take(&mut self.strokes),
            std::mem::take(&mut self.under),
        );
        for t in expand(
            it.get("text")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        ) {
            self.draw(&t)?;
        }
        strokes.extend(std::mem::replace(&mut self.strokes, saved.0));
        under.extend(std::mem::replace(&mut self.under, saved.1));
        let ang = num(it, "angle").unwrap_or(0.).to_radians();
        if ang != 0. {
            let (cx, cy, c, s) = (x + w / 2., y + h / 2., ang.cos(), ang.sin());
            for l in strokes.iter_mut().chain(under.iter_mut()) {
                for p in &mut l.points {
                    let (dx, dy) = (p[0] - cx, p[1] - cy);
                    *p = [cx + dx * c - dy * s, cy + dx * s + dy * c];
                }
            }
        }
        self.under.extend(under);
        self.strokes.extend(strokes);
        Ok(())
    }
    fn line(&mut self, it: &Value) -> Result<()> {
        let pts: Vec<Pt> = it
            .get("pts")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| Some(self.p(p.get(0)?.as_f64()?, p.get(1)?.as_f64()?)))
                    .collect()
            })
            .unwrap_or_default();
        if pts.len() < 2 {
            return Err(Error::new(
                0,
                "a line item needs 'pts' with two points or more",
            ));
        }
        let c = self.colour(it.get("color").and_then(Value::as_str), None);
        let mut pen = self.pen(&c, num(it, "pen").unwrap_or(1.3), false);
        let size = self.l(num(it, "size").unwrap_or(16.));
        let head = it.get("head").and_then(Value::as_str).unwrap_or("none");
        let (a, b) = (pts[pts.len() - 2], pts[pts.len() - 1]);
        if head == "block" {
            let outline = block_arrow(pts[0], b, self.l(num(it, "width").unwrap_or(14.)), size);
            let w = wobble(&mut pen, &outline, 0.3);
            self.strokes.push(pen.stroke(&w, 1.5, 0, 0.15));
            return Ok(());
        }
        let w = wobble(&mut pen, &pts, 0.4);
        self.strokes.push(pen.stroke(&w, 2., 1, 0.2));
        if head == "open" || head == "hollow" {
            let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
            let l = [
                b[0] + size * (ang + 2.6).cos(),
                b[1] + size * (ang + 2.6).sin(),
            ];
            let r = [
                b[0] + size * (ang - 2.6).cos(),
                b[1] + size * (ang - 2.6).sin(),
            ];
            let mut h = vec![l, b, r];
            if head == "hollow" {
                h.push(l);
            }
            self.strokes.push(pen.stroke(&h, 1.2, 0, 0.1));
        }
        Ok(())
    }
    fn circle(&mut self, it: &Value) -> Result<()> {
        let (icx, icy, ir) = (
            need(it, "cx")?,
            need(it, "cy")?,
            num(it, "r").or(num(it, "ry")).unwrap_or(12.),
        );
        let [cx, cy] = self.p(icx, icy);
        let r = self.l(ir);
        let rx = num(it, "rx").map(|v| self.lx(v)).unwrap_or(r);
        let ry = num(it, "ry").map(|v| self.l(v)).unwrap_or(r);
        let ring: Vec<Pt> = (0..52)
            .map(|i| {
                let t = TAU * i as f64 / 48. - 1.9;
                [cx + rx * t.cos(), cy + ry * t.sin()]
            })
            .collect();
        if let Some(f) = it.get("fill").and_then(Value::as_str) {
            let fill = self.colour(
                Some(f),
                Some([icx - ir * 0.4, icy - ir * 0.4, ir * 0.8, ir * 0.8]),
            );
            let u = self.paint(vec![ring[..48].to_vec()], &fill, 6., false);
            self.under.extend(u);
        }
        let c = self.colour(it.get("color").and_then(Value::as_str), None);
        let width = num(it, "pen").unwrap_or((r * 0.085).max(1.2));
        if width > 0. {
            let mut pen = self.pen(&c, width, false);
            let w = wobble(&mut pen, &ring, 0.3);
            self.strokes.push(pen.stroke(&w, 1.2, 0, 0.12));
        }
        if it.get("text").is_some() {
            let h = num(it, "h").unwrap_or(ir * 0.9);
            let t = json!({"x":icx,"y":icy + h / 2.,"h":h,"text":text_of(it),"align":"center","color":it.get("text_color").and_then(Value::as_str).unwrap_or(&c)});
            self.text(&t)?;
        }
        Ok(())
    }
    fn hook(&mut self, it: &Value) -> Result<()> {
        let [x, y] = self.p(need(it, "x")?, need(it, "y")?);
        let h = self.l(num(it, "h").unwrap_or(20.));
        let c = self.colour(it.get("color").and_then(Value::as_str), None);
        let mut pen = self.pen(&c, num(it, "pen").unwrap_or((h * 0.09).max(1.2)), false);
        let mid = y - h * 0.4;
        self.strokes.push(pen.stroke(
            &[[x, mid - h * 0.75], [x, mid], [x + h * 0.85, mid]],
            1.5,
            0,
            0.12,
        ));
        let a = h * 0.32;
        self.strokes.push(pen.stroke(
            &[
                [x + h * 0.85 - a, mid - a],
                [x + h * 0.85, mid],
                [x + h * 0.85 - a, mid + a],
            ],
            1.2,
            0,
            0.1,
        ));
        Ok(())
    }
    fn trace(&mut self, it: &Value) -> Result<()> {
        let mock = self
            .mock
            .ok_or_else(|| Error::new(0, "a trace item needs the spec's 'mockup' image"))?;
        let b: Vec<f64> = it
            .get("box")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .unwrap_or_default();
        let [x, y, w, h] = <[f64; 4]>::try_from(b)
            .map_err(|_| Error::new(0, "a trace item needs 'box': [x, y, w, h]"))?;
        if w * h > 4e6 {
            return Err(Error::new(
                0,
                "a trace box may cover at most 4 million pixels",
            ));
        }
        let crop = mock
            .crop(x as i64, y as i64, w as i64, h as i64)
            .ok_or_else(|| Error::new(0, "the trace box is outside the mockup"))?;
        let erase = it
            .get("erase")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        let v: Vec<i64> = e
                            .as_array()?
                            .iter()
                            .filter_map(Value::as_f64)
                            .map(|v| v as i64)
                            .collect();
                        Some([
                            v.first()? - x as i64,
                            v.get(1)? - y as i64,
                            *v.get(2)?,
                            *v.get(3)?,
                        ])
                    })
                    .collect()
            })
            .unwrap_or_default();
        let [px, py] = self.p(x, y);
        let t = trace(
            &crop,
            &TraceOptions {
                x: px,
                y: py,
                scale: self.k * self.s,
                colors: num(it, "colors").unwrap_or(8.) as usize,
                erase,
                band: 6.,
                opaque: self.dark,
                seed: self.rng.seed(),
            },
        );
        if self.dark {
            // Opaque colour is pen ink: it goes in order, under the outlines.
            self.strokes
                .extend(t.under.into_iter().map(|l| Line { under: false, ..l }));
            self.strokes.extend(t.strokes);
        } else {
            self.under.extend(t.under);
            self.strokes.extend(t.strokes);
        }
        Ok(())
    }
}

fn block_arrow(a: Pt, b: Pt, width: f64, head: f64) -> Vec<Pt> {
    let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
    let (ux, uy) = (ang.cos(), ang.sin());
    let (nx, ny) = (-uy, ux);
    let len = (b[0] - a[0]).hypot(b[1] - a[1]);
    let hw = width / 2.;
    let base = [a[0] + ux * (len - head), a[1] + uy * (len - head)];
    let pts = vec![
        [a[0] + nx * hw, a[1] + ny * hw],
        [base[0] + nx * hw, base[1] + ny * hw],
        [base[0] + nx * hw * 2.2, base[1] + ny * hw * 2.2],
        b,
        [base[0] - nx * hw * 2.2, base[1] - ny * hw * 2.2],
        [base[0] - nx * hw, base[1] - ny * hw],
        [a[0] - nx * hw, a[1] - ny * hw],
    ];
    let first = pts[0];
    pts.into_iter().chain([first]).collect()
}

/// Top of an item in mockup pixels (for flow).
fn top_of(it: &Value) -> f64 {
    let n = |k| num(it, k).unwrap_or(0.);
    match kind(it) {
        "text" => n("y") - num(it, "h").unwrap_or(20.),
        "circle" => n("cy") - num(it, "r").unwrap_or(12.),
        "line" => it
            .get("pts")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.get(1)?.as_f64())
                    .fold(f64::INFINITY, f64::min)
            })
            .unwrap_or(0.),
        "trace" => it
            .get("box")
            .and_then(|b| b.get(1))
            .and_then(Value::as_f64)
            .unwrap_or(0.),
        "hook" => n("y") - num(it, "h").unwrap_or(20.),
        _ => n("y"),
    }
}
/// Vertical extent of a text-like item.
fn span(it: &Value) -> Option<(f64, f64)> {
    let n = |k| num(it, k).unwrap_or(0.);
    match kind(it) {
        "text" => Some((n("y") - n("h"), n("y") + n("h") * 0.35)),
        "line" => {
            let ys: Vec<f64> = it
                .get("pts")?
                .as_array()?
                .iter()
                .filter_map(|p| p.get(1)?.as_f64())
                .collect();
            Some((
                ys.iter().copied().fold(f64::INFINITY, f64::min) - 3.,
                ys.iter().copied().fold(f64::NEG_INFINITY, f64::max) + 3.,
            ))
        }
        "circle" => Some((n("cy") - n("r"), n("cy") + n("r"))),
        "hook" => Some((n("y") - num(it, "h").unwrap_or(20.), n("y"))),
        "hl" => Some((n("y"), n("y") + n("h"))),
        _ => None,
    }
}
fn anchor_x(it: &Value) -> f64 {
    match kind(it) {
        "circle" => num(it, "cx").unwrap_or(0.),
        "line" => it
            .get("pts")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.get(0)?.as_f64())
                    .fold(f64::INFINITY, f64::min)
            })
            .unwrap_or(0.),
        "trace" => it
            .get("box")
            .and_then(|b| b.get(0))
            .and_then(Value::as_f64)
            .unwrap_or(0.),
        _ => num(it, "x").unwrap_or(0.),
    }
}

/// A `lines` block becomes one text item per line (or one re-wrapped paragraph).
fn expand(items: Vec<Value>) -> Vec<Value> {
    let mut out = Vec::new();
    for it in items {
        if kind(&it) == "lines" {
            let lines: Vec<String> = it
                .get("lines")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let mut base: Map<String, Value> = it.as_object().cloned().unwrap_or_default();
            for k in ["t", "lines", "para"] {
                base.remove(k);
            }
            if it.get("para").and_then(Value::as_bool) == Some(true) {
                let x = num(&it, "x").unwrap_or(0.);
                let mut t = base.clone();
                t.insert("t".into(), json!("text"));
                t.insert("text".into(), json!(lines.join(" ")));
                t.insert("_n".into(), json!(lines.len()));
                t.entry("wrap").or_insert(json!(882. - x));
                out.push(Value::Object(t));
            } else {
                let (y, lh) = (
                    num(&it, "y").unwrap_or(0.),
                    num(&it, "lh").unwrap_or(num(&it, "h").unwrap_or(20.) * 1.9),
                );
                base.remove("lh");
                for (i, line) in lines.into_iter().enumerate() {
                    let mut t = base.clone();
                    t.insert("t".into(), json!("text"));
                    t.insert("y".into(), json!(y + i as f64 * lh));
                    t.insert("text".into(), json!(line));
                    out.push(Value::Object(t));
                }
            }
        } else {
            let mut it = it;
            if kind(&it) == "sticky" {
                let inner = it
                    .get("text")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                it["text"] = Value::Array(expand(inner));
            }
            out.push(it);
        }
    }
    out
}

/// At a smaller scale, things on one line keep their order but close up
/// towards where the line starts; centred text, boxes, bands and traces stay.
fn compress(items: &mut [Value], s: f64) {
    let left = |it: &Value| {
        kind(it) == "text" && it.get("align").and_then(Value::as_str).unwrap_or("left") == "left"
    };
    let rows: Vec<((f64, f64), f64, usize)> = items
        .iter()
        .enumerate()
        .filter(|(_, it)| left(it))
        .filter_map(|(i, it)| Some((span(it)?, num(it, "x")?, i)))
        .collect();
    let margin = rows.iter().map(|r| r.1).fold(f64::INFINITY, f64::min);
    let margin = if margin.is_finite() { margin } else { 0. };
    let overlaps = |(a, b): (f64, f64), (ta, tb): (f64, f64)| {
        b.min(tb) - a.max(ta) > 0.3 * (b - a).min(tb - ta)
    };
    let mut x0s = vec![None; items.len()];
    for &(sp, x, i) in &rows {
        let starts: Vec<f64> = rows
            .iter()
            .filter(|r| r.2 != i && overlaps(sp, r.0))
            .map(|r| r.1)
            .collect();
        x0s[i] = Some(if starts.is_empty() {
            margin
        } else {
            starts.into_iter().fold(x, f64::min)
        });
    }
    let texts: Vec<((f64, f64), f64)> =
        rows.iter().filter_map(|r| Some((r.0, x0s[r.2]?))).collect();
    for (i, it) in items.iter_mut().enumerate() {
        let t = kind(it).to_owned();
        if t == "text" && !left(it) {
            if let Some(w) = num(it, "w") {
                it["w"] = json!(w * s);
            }
            continue;
        }
        let Some(sp) = span(it) else { continue };
        let x0 = if t == "text" {
            x0s[i].unwrap_or(margin)
        } else {
            texts
                .iter()
                .filter(|(ts, _)| overlaps(sp, *ts))
                .map(|t| t.1)
                .reduce(f64::min)
                .unwrap_or(margin)
        };
        match t.as_str() {
            "line" => {
                if let Some(a) = it.get_mut("pts").and_then(Value::as_array_mut) {
                    for p in a {
                        if let Some(x) = p.get(0).and_then(Value::as_f64) {
                            p[0] = json!(x0 + (x - x0) * s);
                        }
                    }
                }
            }
            "circle" => {
                let cx = num(it, "cx").unwrap_or(0.);
                it["cx"] = json!(x0 + (cx - x0) * s);
            }
            _ => {
                if t == "hl" || t == "text" {
                    if let Some(w) = num(it, "w") {
                        it["w"] = json!(w * s);
                    }
                }
                let x = num(it, "x").unwrap_or(0.);
                it["x"] = json!(x0 + (x - x0) * s);
            }
        }
    }
}

/// Each left-aligned text gets the width it may use (`_room`): to the inner
/// edge of its card, the next box or text on its line, or the page margin.
fn fit_room(items: &mut [Value], page_w: f64) {
    let rect = |it: &Value| {
        Some([
            num(it, "x")?,
            num(it, "y")?,
            num(it, "x")? + num(it, "w")?,
            num(it, "y")? + num(it, "h")?,
        ])
    };
    let boxes: Vec<[f64; 4]> = items
        .iter()
        .filter(|it| matches!(kind(it), "rect" | "sticky"))
        .filter_map(rect)
        .collect();
    // Texts at the top level and inside stickies (with their sticky's box).
    let mut texts: Vec<(Value, Option<[f64; 4]>)> = Vec::new();
    for it in items.iter() {
        let left = |t: &Value| {
            kind(t) == "text" && t.get("align").and_then(Value::as_str).unwrap_or("left") == "left"
        };
        if left(it) {
            texts.push((it.clone(), None));
        }
        if kind(it) == "sticky" {
            for t in it
                .get("text")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|t| left(t))
            {
                texts.push((t.clone(), rect(it)));
            }
        }
    }
    let room_of = |it: &Value, parent: Option<[f64; 4]>| -> Option<f64> {
        let (x0, h, y) = (num(it, "x")?, num(it, "h")?, num(it, "y")?);
        let (top, bot, mid) = (y - h * 1.15, y + h * 0.35, y - h / 2.);
        let mut limit = page_w - 14.;
        let mut inside: Vec<[f64; 4]> = boxes
            .iter()
            .copied()
            .filter(|b| b[0] <= x0 && x0 <= b[2] && b[1] <= mid && mid <= b[3])
            .collect();
        inside.extend(parent);
        if let Some(b) = inside.iter().min_by(|a, b| {
            ((a[2] - a[0]) * (a[3] - a[1])).total_cmp(&((b[2] - b[0]) * (b[3] - b[1])))
        }) {
            limit = limit.min(b[2] - 10.);
        }
        for b in &boxes {
            if Some(*b) == parent || (b[0] <= x0 && x0 <= b[2] && b[1] <= mid && mid <= b[3]) {
                continue;
            }
            if b[0] > x0 + 4. && bot.min(b[3]) - top.max(b[1]) > 0.3 * h {
                limit = limit.min(b[0] - 8.);
            }
        }
        for (o, _) in &texts {
            let (Some(ox), Some(oh), Some(oy)) = (num(o, "x"), num(o, "h"), num(o, "y")) else {
                continue;
            };
            if ox <= x0 + 4. {
                continue;
            }
            if bot.min(oy + oh * 0.35) - top.max(oy - oh * 1.15) > 0.45 * h.min(oh) {
                limit = limit.min(ox - 10.);
            }
        }
        Some((limit - x0).max(10.))
    };
    for it in items.iter_mut() {
        if kind(it) == "text" && it.get("align").and_then(Value::as_str).unwrap_or("left") == "left"
        {
            if let Some(r) = room_of(it, None) {
                it["_room"] = json!(r);
            }
        }
        if kind(it) == "sticky" {
            let parent = rect(it);
            if let Some(a) = it.get_mut("text").and_then(Value::as_array_mut) {
                for t in a.iter_mut().filter(|t| kind(t) == "text") {
                    if let Some(r) = room_of(t, parent) {
                        t["_room"] = json!(r);
                    }
                }
            }
        }
    }
}

/// A drawn design page, with any text that still overlaps.
pub struct Designed {
    pub page: InkPage,
    pub collisions: Vec<String>,
    pub warnings: Vec<String>,
}

/// Mockup images by the paths a spec names (decoded by the host).
pub type Mockups = std::collections::HashMap<String, Raster>;

/// Draw one design spec as a page. Text that runs into the text below it
/// pushes that text (and what is under it in the same column) down.
pub fn design_page(spec: &Value, seed: u64, mockups: &Mockups) -> Result<Designed> {
    let mut push: std::collections::HashMap<usize, f64> = Default::default();
    let mut last = None;
    for _ in 0..4 {
        let (page, hits, warnings) = draw_spec(spec, seed, &push, mockups)?;
        let done = hits.is_empty();
        for (_, moved) in &hits {
            for (j, extra) in moved {
                *push.entry(*j).or_default() += extra;
            }
        }
        last = Some((page, hits, warnings));
        if done {
            break;
        }
    }
    let (page, hits, warnings) = last.unwrap();
    Ok(Designed {
        page,
        collisions: hits.into_iter().map(|(names, _)| names).collect(),
        warnings,
    })
}

type Hit = (String, Vec<(usize, f64)>);
fn draw_spec(
    spec: &Value,
    seed: u64,
    push: &std::collections::HashMap<usize, f64>,
    mockups: &Mockups,
) -> Result<(InkPage, Vec<Hit>, Vec<String>)> {
    let parts: Vec<Value> = match spec.get("parts").and_then(Value::as_array) {
        Some(p) if !p.is_empty() => p.clone(),
        _ => vec![spec.clone()],
    };
    let size: Vec<f64> = spec
        .get("size")
        .or_else(|| parts[0].get("size"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_else(|| vec![896., 1200.]);
    let (w_px, h_px) = (
        size.first().copied().unwrap_or(896.).max(10.),
        size.get(1).copied().unwrap_or(1200.).max(10.),
    );
    let k = A4[0] / w_px;
    let spare = (A4[1] - h_px * k).max(0.);
    let valign = spec
        .get("valign")
        .and_then(Value::as_str)
        .unwrap_or("middle");
    let dark = spec.get("theme").and_then(Value::as_str) == Some("dark");
    let mut pg = Page {
        w_px,
        k,
        oy: spare * if valign == "top" { 0.08 } else { 0.5 },
        dark,
        ink: if dark { "#f4f1ea" } else { "#1f2233" }.into(),
        rng: Rng::new(seed),
        s: 1.,
        top: 0.,
        dy: 0.,
        mock: None,
        strokes: vec![],
        words: vec![],
        under: vec![],
        warnings: vec![],
    };
    let mut drawn: Vec<(usize, Value, f64, Vec<[f64; 4]>)> = Vec::new();
    let mut placed: Vec<(usize, Value, f64)> = Vec::new();
    let mut n = 0;
    for part in &parts {
        let mock_path = part
            .get("mockup")
            .or_else(|| spec.get("mockup"))
            .and_then(Value::as_str);
        pg.mock =
            match mock_path {
                Some(p) => Some(mockups.get(p).ok_or_else(|| {
                    Error::new(0, format!("Could not read the mockup image {p}"))
                })?),
                None => None,
            };
        pg.s = num(part, "scale").unwrap_or(1.).clamp(0.1, 4.);
        pg.top = match part.get("top") {
            Some(Value::String(s)) if s == "auto" => {
                let ys = pg
                    .strokes
                    .iter()
                    .chain(&pg.under)
                    .flat_map(|l| l.points.iter().map(|p| p[1]))
                    .fold(f64::NEG_INFINITY, f64::max);
                if ys.is_finite() {
                    (ys - pg.oy) / pg.k + num(part, "gap").unwrap_or(40.)
                } else {
                    0.
                }
            }
            _ => num(part, "top").unwrap_or(0.),
        };
        let mut items = expand(
            part.get("items")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| Error::new(0, "a design spec needs 'items'"))?,
        );
        if items.len() > 2000 {
            return Err(Error::new(0, "a design spec may have at most 2000 items"));
        }
        if pg.s != 1. {
            compress(&mut items, pg.s);
        }
        fit_room(&mut items, w_px);
        pg.flow(&mut items);
        for it in items {
            pg.dy = num(&it, "_dy").unwrap_or(0.) - push.get(&n).copied().unwrap_or(0.);
            let before = pg.strokes.len();
            pg.draw(&it)?;
            if kind(&it) == "text" && pg.strokes.len() > before {
                let boxes = pg.strokes[before..]
                    .iter()
                    .filter_map(|l| {
                        let (mut b, mut any) = (
                            [
                                f64::INFINITY,
                                f64::INFINITY,
                                f64::NEG_INFINITY,
                                f64::NEG_INFINITY,
                            ],
                            false,
                        );
                        for p in &l.points {
                            b = [
                                b[0].min(p[0]),
                                b[1].min(p[1]),
                                b[2].max(p[0]),
                                b[3].max(p[1]),
                            ];
                            any = true;
                        }
                        any.then_some(b)
                    })
                    .collect();
                drawn.push((n, it.clone(), pg.s, boxes));
            }
            placed.push((n, it, pg.s));
            n += 1;
        }
    }
    let paper = spec
        .get("paper")
        .and_then(Value::as_str)
        .and_then(Paper::parse)
        .unwrap_or(Paper::DOT);
    // Collisions: letter boxes of two text items overlapping.
    let tol = 1.5;
    let mut hits = Vec::new();
    for (i, (ia, a, sa, ba)) in drawn.iter().enumerate() {
        let bound = |bs: &Vec<[f64; 4]>| {
            bs.iter().fold(
                [
                    f64::INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::NEG_INFINITY,
                ],
                |b, p| {
                    [
                        b[0].min(p[0]),
                        b[1].min(p[1]),
                        b[2].max(p[2]),
                        b[3].max(p[3]),
                    ]
                },
            )
        };
        let ax = bound(ba);
        for (ib, b, sb, bb) in &drawn[i + 1..] {
            let bx = bound(bb);
            if ax[2] < bx[0] || bx[2] < ax[0] || ax[3] < bx[1] || bx[3] < ax[1] {
                continue;
            }
            let (upper, lower) = if ax[1] <= bx[1] { (ba, bb) } else { (bb, ba) };
            let depth = upper
                .iter()
                .flat_map(|p| lower.iter().map(move |q| (p, q)))
                .filter(|(p, q)| {
                    p[0] < q[2] - tol && q[0] < p[2] - tol && p[1] < q[3] - tol && q[1] < p[3] - tol
                })
                .map(|(p, q)| p[3] - q[1])
                .fold(0., f64::max);
            if depth <= 0. {
                continue;
            }
            let (up, low, il, lb, scale) = if top_of(a) <= top_of(b) {
                (a, b, *ib, bb, *sb)
            } else {
                (b, a, *ia, ba, *sa)
            };
            let x0 = lb.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min) / k - 50.;
            let x1 = lb.iter().map(|p| p[2]).fold(f64::NEG_INFINITY, f64::max) / k + 20.;
            let dy = depth / k / scale + 6.;
            let mut moved: Vec<(usize, f64)> = placed
                .iter()
                .filter(|(j, it, s)| {
                    *s == scale
                        && *j != il
                        && top_of(it) >= top_of(low) - 1.
                        && (x0..=x1).contains(&anchor_x(it))
                })
                .map(|(j, ..)| (*j, dy))
                .collect();
            moved.push((il, dy));
            let short = |v: &Value| plain(&text_of(v)).chars().take(40).collect::<String>();
            hits.push((format!("'{}' overlaps '{}'", short(up), short(low)), moved));
        }
    }
    let mut warnings = std::mem::take(&mut pg.warnings);
    warnings.dedup();
    let page = InkPage {
        under: pg
            .under
            .into_iter()
            .map(|l| Line {
                under: l.tool == 1 || l.under,
                ..l
            })
            .collect(),
        lines: pg.strokes,
        paper: paper.with_dark(dark),
        words: pg.words,
    };
    Ok((page, hits, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn none() -> Mockups {
        Mockups::new()
    }
    #[test]
    fn runs_and_wrapping_keep_marks_whole() {
        let r = runs("a {#e9573f:red} b {#2f7fd6@1.4:big} {hl:mint}==hm== c ==yes==");
        let kinds: Vec<_> = r
            .iter()
            .map(|r| (r.0.as_str(), r.1.as_deref(), r.2.as_deref(), r.3))
            .collect();
        assert_eq!(kinds[1], ("red", Some("#e9573f"), None, 1.));
        assert_eq!(kinds[3], ("big", Some("#2f7fd6"), None, 1.4));
        assert!(kinds.iter().any(|k| k.0 == "yes" && k.2 == Some("#ffe58a")));
        assert!(kinds.iter().any(|k| k.0 == "hm" && k.2 == Some("mint")));
        assert_eq!(plain("x {#000000:y} ==z=="), "x y z");
    }
    #[test]
    fn a_spec_draws_at_the_mockups_places_and_pushes_overlaps_down() {
        let spec = json!({"size":[896,1200],"items":[
            {"t":"band","y":900,"h":200,"fill":"#cfe6ff"},
            {"t":"text","x":60,"y":100,"h":40,"text":"{#e9573f:CELL} BIOLOGY","w":500},
            {"t":"rect","x":60,"y":200,"w":380,"h":200,"fill":"#ffd8c2","stroke":"#e9573f","r":18},
            {"t":"lines","x":80,"y":260,"h":18,"lh":36,"lines":["first line in the card","==second== line"]},
            {"t":"text","x":500,"y":260,"h":18,"text":"a long paragraph that will need several lines to fit in its column here","wrap":330},
            {"t":"text","x":500,"y":280,"h":18,"text":"below it"},
            {"t":"circle","cx":800,"cy":100,"r":30,"text":"1"},
            {"t":"line","pts":[[60,500],[400,520]],"head":"open"},
            {"t":"sticky","x":500,"y":600,"w":300,"h":150,"fill":"#ffe58a","angle":-3,"text":[{"t":"text","x":520,"y":660,"h":20,"text":"Remember this"}]},
            {"t":"hook","x":60,"y":700},
            {"t":"hl","x":60,"y":760,"w":200,"h":24,"color":"#ffe58a"}
        ]});
        let d = design_page(&spec, 1, &none()).unwrap();
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        assert!(d.page.lines.len() > 50);
        assert!(!d.page.under.is_empty());
        let k = A4[0] / 896.;
        let oy = (A4[1] - 1200. * k) / 2.;
        let title: Vec<_> = d
            .page
            .lines
            .iter()
            .take(4)
            .flat_map(|l| &l.points)
            .collect();
        assert!(
            title.iter().all(|p| p[1] < oy + 110. * k && p[0] > 50. * k),
            "the title sits where the mockup has it"
        );
        assert!(d.collisions.is_empty(), "{:?}", d.collisions);
        assert!(design_page(&json!({"items":[{"t":"zigzag"}]}), 1, &none()).is_err());
        assert!(
            design_page(
                &json!({"items":[{"t":"trace","box":[0,0,10,10]}]}),
                1,
                &none()
            )
            .is_err(),
            "trace needs a mockup"
        );
    }
    #[test]
    fn auto_colours_and_traces_come_from_the_mockup() {
        let (w, h) = (100usize, 100usize);
        let mut rgb = vec![250u8; w * h * 3];
        for y in 40..60 {
            for x in 10..90 {
                rgb[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&[120, 180, 240]);
            }
        }
        let img = Raster::new(w, h, rgb).unwrap();
        let get = Mockups::from([("m.png".to_owned(), img)]);
        let spec = json!({"size":[100,100],"mockup":"m.png","items":[{"t":"rect","x":10,"y":40,"w":80,"h":20,"fill":"auto"},{"t":"trace","box":[0,0,100,100]}]});
        let d = design_page(&spec, 2, &get).unwrap();
        assert!(!d.page.under.is_empty());
        let missing = json!({"mockup":"other.png","items":[]});
        assert!(design_page(&missing, 1, &get).is_err());
    }
}
