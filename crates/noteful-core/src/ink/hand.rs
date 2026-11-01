//! Text and shapes as natural pen strokes. Each glyph path is resampled,
//! smoothed and jittered so no two letters match; a ballpoint carries a
//! pressure profile that ramps in and tapers out like a pencil stroke.
//! Ported from noteful-mcp's handwriting.py (MIT).
use super::{
    font::{font, FontName, Glyph, Pt},
    glyphs::{self, SUB, SUP},
    rng::{Noise, Rng},
};
use crate::Line;
use std::f64::consts::{PI, TAU};

pub type Rgba = [f64; 4];

pub fn hex(s: &str) -> Option<Rgba> {
    let h = s.trim().strip_prefix('#')?;
    let h: String = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect()
    } else {
        h.to_owned()
    };
    if !(h.len() == 6 || h.len() == 8) || !h.is_ascii() {
        return None;
    }
    let v = |i: usize| {
        u8::from_str_radix(&h[i..i + 2], 16)
            .ok()
            .map(|n| n as f64 / 255.)
    };
    Some([v(0)?, v(2)?, v(4)?, 1.])
}
/// Pen colours by name, or #hex.
pub fn color(name: &str) -> Option<Rgba> {
    Some(match name.trim().to_ascii_lowercase().as_str() {
        "black" => [0., 0., 0., 1.],
        "ink" => [0.09, 0.11, 0.22, 1.],
        "blue" => [0., 0.153, 1., 1.],
        "red" => [1., 0., 0., 1.],
        "green" => [0.306, 0.478, 0.157, 1.],
        "purple" => [0.373, 0.18, 0.922, 1.],
        "orange" => [0.886, 0.35, 0.016, 1.],
        "pink" => [0.902, 0.231, 0.482, 1.],
        "navy" => [0.216, 0.098, 0.569, 1.],
        "grey" | "gray" => [0.42, 0.435, 0.5, 1.],
        "white" => [1., 1., 1., 1.],
        other => return hex(other),
    })
}
/// Highlighter colours (stored opaque; drawn translucent), by name or #hex.
pub fn highlight_color(name: &str) -> Rgba {
    match name.trim().to_ascii_lowercase().as_str() {
        "yellow" | "amber" => [1., 0.969, 0.412, 1.],
        "pink" | "coral" => [0.98, 0.68, 0.78, 1.],
        "mint" | "green" | "teal" => [0.6, 0.93, 0.78, 1.],
        "lavender" | "purple" => [0.78, 0.7, 0.98, 1.],
        "peach" | "orange" => [1., 0.78, 0.6, 1.],
        "blue" | "sky" | "baby blue" => [0.62, 0.84, 1., 1.],
        other => color(other).unwrap_or([1., 0.969, 0.412, 1.]),
    }
}
/// Washi tape colours for native tape strips.
pub fn tape_color(name: &str) -> Rgba {
    let rgb = match name.trim().to_ascii_lowercase().as_str() {
        "pink" => [246., 168., 190.],
        "yellow" => [250., 220., 120.],
        "blue" | "sky" => [150., 190., 240.],
        "lavender" | "purple" => [190., 170., 235.],
        other => return hex(other).unwrap_or([152. / 255., 216. / 255., 200. / 255., 1.]),
    };
    [rgb[0] / 255., rgb[1] / 255., rgb[2] / 255., 1.]
}

pub fn resample(path: &[Pt], step: f64) -> Vec<Pt> {
    if path.len() < 2 {
        return path.to_vec();
    }
    let mut out = vec![path[0]];
    let mut carry = 0.;
    for w in path.windows(2) {
        let ([x0, y0], [x1, y1]) = (w[0], w[1]);
        let seg = (x1 - x0).hypot(y1 - y0);
        if seg == 0. {
            continue;
        }
        let mut t = step - carry;
        while t <= seg {
            out.push([x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg]);
            t += step;
        }
        carry = seg - (t - step);
    }
    if out.last() != path.last() {
        out.push(*path.last().unwrap());
    }
    out
}
fn chaikin(mut path: Vec<Pt>, rounds: usize) -> Vec<Pt> {
    for _ in 0..rounds {
        if path.len() < 3 {
            return path;
        }
        let mut next = vec![path[0]];
        for w in path.windows(2) {
            let ([x0, y0], [x1, y1]) = (w[0], w[1]);
            next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
            next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
        }
        next.push(*path.last().unwrap());
        path = next;
    }
    path
}
fn pressure_profile(n: usize, rng: &mut Rng, base: f64, vary: f64) -> Vec<f64> {
    let noise = Noise::new(rng);
    let off = rng.uniform(0., 50.);
    (0..n)
        .map(|i| {
            let t = i as f64 / (n.max(2) - 1) as f64;
            let (ramp, taper) = if n > 4 {
                ((t / 0.12).min(1.), ((1. - t) / 0.18).min(1.))
            } else {
                (1., 1.)
            };
            let env = 0.45 + 0.55 * ramp.max(0.).sqrt() * (0.35 + 0.65 * taper.max(0.));
            (base * env * (1. + vary * noise.at(off + i as f64 * 0.15))).max(0.15)
        })
        .collect()
}

/// Noteful's line thickness per unit of pressure, in page units.
const PRESSURE_THICKNESS: f64 = 2.1;

/// A pen; its line looks about 1.3 × `width` thick (1.05 × for a fineliner).
#[derive(Clone, Debug)]
pub struct Pen {
    pub color: Rgba,
    pub width: f64,
    pub pressure: f64,
    pub fineliner: bool,
    pub vary: f64,
    pub rng: Rng,
}
impl Pen {
    pub fn new(color: Rgba, seed: u64) -> Self {
        Self {
            color,
            width: 1.3,
            pressure: 0.85,
            fineliner: false,
            vary: 0.08,
            rng: Rng::new(seed),
        }
    }
    pub fn stroke(&mut self, pts: &[Pt], step: f64, smooth: usize, tremor: f64) -> Line {
        let mut pts = resample(pts, step);
        if smooth > 0 {
            pts = resample(&chaikin(pts, smooth), step);
        }
        let noise = Noise::new(&mut self.rng);
        let off = self.rng.uniform(0., 40.);
        let points: Vec<Pt> = pts
            .iter()
            .enumerate()
            .map(|(i, [x, y])| {
                let t = off + i as f64 * 0.21;
                [x + tremor * noise.at(t), y + tremor * noise.at(t + 17.)]
            })
            .collect();
        if self.fineliner {
            return Line::new(points, self.width * 1.05, self.color);
        }
        let thick = self.width * 1.3;
        let profile = pressure_profile(points.len(), &mut self.rng, self.pressure, self.vary);
        let pressure = profile
            .iter()
            .map(|p| thick / PRESSURE_THICKNESS * p / self.pressure)
            .collect();
        Line {
            pressure: Some(pressure),
            ..Line::new(points, self.width * 2., self.color)
        }
    }
    /// A child pen in another colour and width, with its own seed.
    pub fn child(&mut self, color: Rgba, width: f64) -> Pen {
        Pen {
            color,
            width,
            rng: Rng::new(self.rng.seed()),
            ..self.clone()
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TextStyle {
    pub font: FontName,
    /// x-height in page units (an A4 page is ~1091 wide).
    pub size: f64,
    pub slant: f64,
    pub letter_jitter: f64,
    pub baseline_drift: f64,
    pub tracking: f64,
    /// In x-heights.
    pub line_height: f64,
    pub distortion: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hand {
    Neat,
    Natural,
    Messy,
}
impl Hand {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "neat" => Self::Neat,
            "natural" => Self::Natural,
            "messy" => Self::Messy,
            _ => return None,
        })
    }
}
pub fn text_style(font: FontName, size: f64, hand: Hand) -> TextStyle {
    let (slant, letter_jitter, baseline_drift, distortion) = match hand {
        Hand::Neat => (0.05, 0.04, 0.05, 0.03),
        Hand::Natural => (0.10, 0.08, 0.10, 0.07),
        Hand::Messy => (0.15, 0.14, 0.20, 0.12),
    };
    TextStyle {
        font,
        size,
        slant,
        letter_jitter,
        baseline_drift,
        tracking: 0.97,
        line_height: 3.2,
        distortion,
    }
}
fn small(style: &TextStyle) -> TextStyle {
    TextStyle {
        size: style.size * 0.62,
        ..*style
    }
}
fn missing(f: &super::font::Font) -> Glyph {
    Glyph {
        adv: f.em * 0.5,
        paths: vec![],
    }
}

pub fn text_width(text: &str, style: &TextStyle) -> f64 {
    let f = font(style.font);
    let k = style.size / f.xheight;
    let mut w = 0.;
    let mut script = false;
    for c in glyphs::scripts(text).chars() {
        if c == SUP || c == SUB {
            script = true;
        } else if script {
            w += text_width(&c.to_string(), &small(style));
            script = false;
        } else if "→⇒←⇄".contains(c) {
            w += style.size * 2.7;
        } else if "↑↓".contains(c) {
            w += style.size * 1.4;
        } else {
            w += f.glyph(c).map_or_else(|| missing(f).adv, |g| g.adv) * k * style.tracking;
        }
    }
    w
}

/// One line with its baseline at y; returns the strokes and the end x.
/// `T^4`, `CO_2` and Unicode scripts come out small and raised/lowered;
/// arrows are drawn; Greek and math signs the font lacks are drawn by hand.
pub fn write_line(
    pen: &mut Pen,
    text: &str,
    x: f64,
    y: f64,
    style: &TextStyle,
) -> (Vec<Line>, f64) {
    let chars: Vec<char> = glyphs::scripts(text).chars().collect();
    let f = font(style.font);
    let k = style.size / f.xheight;
    let drift = Noise::new(&mut pen.rng);
    let doff = pen.rng.uniform(0., 30.);
    let slope = pen.rng.uniform(-0.006, 0.006);
    let shape = Noise::new(&mut pen.rng);
    let mut out = Vec::new();
    let mut cx = x;
    let mut word_slant = style.slant;
    let mut word_scale = 1.;
    for (i, &ch) in chars.iter().enumerate() {
        if "→⇒←⇄".contains(ch) {
            let w = style.size * 2.2;
            let ay = y - style.size * 0.45;
            let (a, b) = ([cx + 2., ay], [cx + w, ay + pen.rng.uniform(-1., 1.)]);
            if ch == '⇄' {
                let d = style.size * 0.32;
                out.extend(arrow(
                    pen,
                    [a[0], a[1] - d],
                    [b[0], b[1] - d],
                    style.size * 0.5,
                ));
                out.extend(arrow(
                    pen,
                    [b[0], b[1] + d],
                    [a[0], a[1] + d],
                    style.size * 0.5,
                ));
            } else if ch == '←' {
                out.extend(arrow(pen, b, a, style.size * 0.6));
            } else {
                out.extend(arrow(pen, a, b, style.size * 0.6));
            }
            cx += w + style.size * 0.5;
            continue;
        }
        if "↑↓".contains(ch) {
            let ax = cx + style.size * 0.6;
            let top = [ax, y - style.size * 1.3];
            let bottom = [ax + pen.rng.uniform(-0.6, 0.6), y + style.size * 0.15];
            out.extend(if ch == '↑' {
                arrow(pen, bottom, top, style.size * 0.5)
            } else {
                arrow(pen, top, bottom, style.size * 0.5)
            });
            cx += style.size * 1.4;
            continue;
        }
        if ch == SUP || ch == SUB {
            continue;
        }
        if i > 0 && (chars[i - 1] == SUP || chars[i - 1] == SUB) {
            let dy = if chars[i - 1] == SUP {
                -style.size * 0.78
            } else {
                style.size * 0.32
            };
            let (s, end) = write_line(pen, &ch.to_string(), cx, y + dy, &small(style));
            out.extend(s);
            cx = end;
            continue;
        }
        if i == 0 || chars[i - 1] == ' ' {
            word_slant = style.slant + pen.rng.uniform(-0.05, 0.05);
            word_scale = pen.rng.uniform(0.95, 1.05);
        }
        let Some(g) = f.glyph(ch) else {
            cx += f.em * 0.4 * k;
            continue;
        };
        if ch.is_whitespace() || g.paths.is_empty() {
            cx += g.adv * k * style.tracking * pen.rng.uniform(1.05, 1.35);
            continue;
        }
        let s = k * word_scale * (1. + pen.rng.uniform(-style.letter_jitter, style.letter_jitter));
        let sx = pen.rng.uniform(0.93, 1.07);
        let rot: f64 = pen.rng.uniform(-0.05, 0.05);
        let amp = style.distortion * style.size;
        let soff = pen.rng.uniform(0., 60.);
        let by = y
            + slope * (cx - x)
            + style.baseline_drift * style.size * drift.at(doff + i as f64 * 0.35);
        let (cr, sr) = (rot.cos(), rot.sin());
        for path in &g.paths {
            let mut pts: Vec<Pt> = resample(path, f.em * 0.04)
                .into_iter()
                .map(|[gx, gy]| {
                    let (mut px, mut py) = (gx * s * sx, gy * s);
                    let u = soff + (gx + gy) / f.em * 3.;
                    px += amp * shape.at(u);
                    py += amp * shape.at(u + 23.);
                    px -= word_slant * py;
                    let (rx, ry) = (px * cr - py * sr, px * sr + py * cr);
                    [cx + rx, by + ry]
                })
                .collect();
            if pts.len() == 1 {
                pts.push([pts[0][0] + 0.6, pts[0][1] + 0.6]);
            }
            out.push(pen.stroke(&pts, (style.size / 12.).max(1.6), 1, style.size * 0.012));
        }
        cx += g.adv * k * style.tracking * pen.rng.uniform(0.96, 1.05);
    }
    (out, cx)
}

/// Lines that fit `width`, breaking at spaces (and at newlines).
pub fn wrap(text: &str, width: f64, style: &TextStyle) -> Vec<String> {
    let mut lines = Vec::new();
    for para in text.split('\n') {
        let mut cur = String::new();
        for word in para.split(' ') {
            let candidate = if cur.is_empty() {
                word.to_owned()
            } else {
                format!("{cur} {word}")
            };
            if !cur.is_empty() && text_width(&candidate, style) > width {
                lines.push(std::mem::replace(&mut cur, word.to_owned()));
            } else {
                cur = candidate;
            }
        }
        lines.push(cur);
    }
    lines
}

/// The words of a line written by `write_line` at x with its baseline at y, each
/// with a box from the font's advance widths (ascenders to descenders).
pub fn word_boxes(text: &str, x: f64, y: f64, style: &TextStyle) -> Vec<crate::InkWord> {
    let mut out = Vec::new();
    let mut offset = 0;
    for word in text.split_whitespace() {
        let start = offset + text[offset..].find(word).unwrap_or(0);
        offset = start + word.len();
        let left = x + text_width(&text[..start], style);
        let width = text_width(word, style);
        if word.chars().any(char::is_alphanumeric) {
            out.push(crate::InkWord {
                text: word.chars().take(200).collect(),
                bounds: [left, y - style.size * 1.25, width, style.size * 1.65],
                link: None,
            });
        }
    }
    out
}

/// A wrapped paragraph; y is the first baseline. Returns strokes and the next baseline.
pub fn write_block(
    pen: &mut Pen,
    text: &str,
    x: f64,
    mut y: f64,
    width: f64,
    style: &TextStyle,
) -> (Vec<Line>, f64) {
    let mut out = Vec::new();
    let lh = style.size * style.line_height;
    for line in wrap(text, width, style) {
        if !line.trim().is_empty() {
            let dx = pen.rng.uniform(-2., 2.);
            out.extend(write_line(pen, &line, x + dx, y, style).0);
        }
        y += lh;
    }
    (out, y)
}

// -- shapes ---------------------------------------------------------------
pub fn wobble(pen: &mut Pen, pts: &[Pt], amount: f64) -> Vec<Pt> {
    let noise = Noise::new(&mut pen.rng);
    let off = pen.rng.uniform(0., 50.);
    resample(pts, 6.)
        .into_iter()
        .enumerate()
        .map(|(i, [x, y])| {
            let t = off + i as f64 * 0.12;
            [x + amount * noise.at(t), y + amount * noise.at(t + 9.)]
        })
        .collect()
}
pub fn line(pen: &mut Pen, a: Pt, b: Pt, wob: f64) -> Line {
    let (mx, my) = ((a[0] + b[0]) / 2., (a[1] + b[1]) / 2.);
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len = dx.hypot(dy).max(1.);
    let bow = pen.rng.uniform(-0.012, 0.012) * len;
    let mid = [mx - dy / len * bow, my + dx / len * bow];
    let mut pts = vec![a];
    pts.extend(super::font::bezier(a, mid, mid, b, 16));
    let pts = wobble(pen, &pts, wob);
    pen.stroke(&pts, 2.5, 1, 0.3)
}
pub fn arrow(pen: &mut Pen, a: Pt, b: Pt, head: f64) -> Vec<Line> {
    let mut out = vec![line(pen, a, b, 1.6)];
    let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
    for side in [-1., 1.] {
        let t = ang + PI + side * pen.rng.uniform(0.42, 0.52);
        let h = head * pen.rng.uniform(0.9, 1.1);
        out.push(line(pen, b, [b[0] + h * t.cos(), b[1] + h * t.sin()], 0.6));
    }
    out
}
/// A box drawn in one go with overshooting corners, like a quick sketch.
pub fn rect(pen: &mut Pen, x: f64, y: f64, w: f64, h: f64, radius: f64) -> Vec<Line> {
    let j = (0.1 * w.min(h)).clamp(0., 3.);
    let o = |pen: &mut Pen| pen.rng.uniform(-j, j);
    if radius > 0. {
        let mut pts = Vec::new();
        for (cx, cy, a0) in [
            (x + w - radius, y + radius, -90.),
            (x + w - radius, y + h - radius, 0.),
            (x + radius, y + h - radius, 90.),
            (x + radius, y + radius, 180.),
        ] {
            for k in (0..=90).step_by(10) {
                let a = (a0 + k as f64).to_radians();
                pts.push([cx + radius * a.cos(), cy + radius * a.sin()]);
            }
        }
        let end = [pts[0][0] + 10., pts[0][1] + o(pen)];
        pts.push(end);
        let start = [x + radius - 8., y + o(pen)];
        pts.insert(0, start);
        let pts = wobble(pen, &pts, 1.4);
        return vec![pen.stroke(&pts, 2.5, 1, 0.3)];
    }
    let corners = [
        [x + o(pen), y + o(pen)],
        [x + w + o(pen), y + o(pen)],
        [x + w + o(pen), y + h + o(pen)],
        [x + o(pen), y + h + o(pen)],
    ];
    let close = [
        corners[0][0] + o(pen),
        corners[0][1] + pen.rng.uniform(1.3, 3.) * j,
    ];
    let mut pts = vec![[corners[0][0] - 2. * j, corners[0][1] + 1.]];
    pts.extend(corners);
    pts.push(close);
    let pts = wobble(pen, &pts, (j * 0.4).min(1.3));
    vec![pen.stroke(&pts, 2.5, 0, 0.3)]
}
pub fn ellipse(pen: &mut Pen, cx: f64, cy: f64, rx: f64, ry: f64) -> Line {
    let loops = 1.12;
    let start = pen.rng.uniform(0., TAU);
    let tilt: f64 = pen.rng.uniform(-0.08, 0.08);
    let n = (80. * loops) as usize;
    let pts: Vec<Pt> = (0..=n)
        .map(|i| {
            let a = start + loops * TAU * i as f64 / n as f64;
            let grow = 1. + 0.06 * i as f64 / n as f64;
            let (x, y) = (rx * grow * a.cos(), ry * grow * a.sin());
            [
                cx + x * tilt.cos() - y * tilt.sin(),
                cy + x * tilt.sin() + y * tilt.cos(),
            ]
        })
        .collect();
    let pts = wobble(pen, &pts, 1.5);
    pen.stroke(&pts, 2.5, 1, 0.3)
}
pub fn underline(pen: &mut Pen, x0: f64, x1: f64, y: f64, double: bool) -> Vec<Line> {
    let (a, b) = (pen.rng.uniform(-1., 1.), pen.rng.uniform(-3., 2.));
    let mut out = vec![line(pen, [x0 - 4., y + a], [x1 + 6., y + b], 1.6)];
    if double {
        let c = pen.rng.uniform(-2., 2.);
        out.push(line(pen, [x0 + 6., y + 7.], [x1 - 4., y + 6. + c], 1.6));
    }
    out
}
pub fn checkmark(pen: &mut Pen, x: f64, y: f64, size: f64) -> Line {
    let pts = [
        [x, y],
        [x + size * 0.35, y + size * 0.4],
        [x + size, y - size * 0.6],
    ];
    let pts = wobble(pen, &pts, 0.8);
    pen.stroke(&pts, 2., 1, 0.35)
}
pub fn cross(pen: &mut Pen, x: f64, y: f64, size: f64) -> Vec<Line> {
    let h = size / 2.;
    vec![
        line(pen, [x - h, y - h], [x + h, y + h], 0.6),
        line(pen, [x + h, y - h], [x - h, y + h], 0.6),
    ]
}
pub fn star(pen: &mut Pen, cx: f64, cy: f64, r: f64) -> Line {
    let pts: Vec<Pt> = (0..6)
        .map(|i| {
            let a = -PI / 2. + i as f64 * 4. * PI / 5.;
            [cx + r * a.cos(), cy + r * a.sin()]
        })
        .collect();
    let pts = wobble(pen, &pts, 0.7);
    pen.stroke(&pts, 2., 0, 0.35)
}
pub fn bullet(pen: &mut Pen, x: f64, y: f64, r: f64) -> Line {
    let pts: Vec<Pt> = (0..50)
        .map(|a| [x + r * (a as f64 / 6.).cos(), y + r * (a as f64 / 6.).sin()])
        .collect();
    pen.stroke(&pts, 1., 0, 0.1)
}

// -- highlighter and tape -------------------------------------------------
/// One highlighter stroke from a to b; `band` is the full band height. It is
/// drawn translucent, under the ink.
pub fn highlight_line(a: Pt, b: Pt, band: f64, col: Rgba, rng: &mut Rng) -> Line {
    let n = (((b[0] - a[0]).hypot(b[1] - a[1]) / 6.) as usize + 1).max(2);
    let wob = Noise::new(rng);
    let off = rng.uniform(0., 40.);
    let points = (0..n)
        .map(|i| {
            let t = i as f64 / (n - 1) as f64;
            [
                a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t + 0.5 * wob.at(off + t * 3.),
            ]
        })
        .collect();
    Line {
        tool: 1,
        under: true,
        ..Line::new(points, band.clamp(0.5, 100.), col)
    }
}
/// Cover a box with highlighter: one pass for a text line, overlapping passes if taller.
pub fn highlight_rect(x: f64, y: f64, w: f64, h: f64, col: Rgba, rng: &mut Rng) -> Vec<Line> {
    let band = h.min(26.);
    let passes = (((h - band) / (band * 0.8)).ceil().max(0.) as usize) + 1;
    (0..passes)
        .map(|i| {
            let f = if passes > 1 {
                i as f64 / (passes - 1) as f64
            } else {
                0.5
            };
            let cy = y + band / 2. + (h - band) * f;
            let dy = rng.uniform(-0.8, 0.8);
            highlight_line(
                [x + band / 4., cy + dy],
                [x + w - band / 4., cy - dy],
                band,
                col,
                rng,
            )
        })
        .collect()
}
/// A native Noteful tape strip: (x, y) is its top-left corner before turning
/// by `angle` radians about its centre.
pub fn tape(x: f64, y: f64, w: f64, h: f64, angle: f64, col: Rgba) -> Line {
    let (cx, cy) = (x + w / 2., y + h / 2.);
    let (c, s) = (angle.cos(), angle.sin());
    let end = |d: f64| [cx + d * c, cy + d * s];
    Line {
        tool: 2,
        ..Line::new(vec![end(-w / 2.), end(w / 2.)], h.clamp(1., 2000.), col)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writes_varied_pressure_ink_that_repeats_for_a_seed() {
        let style = text_style(FontName::Patrick, 11., Hand::Natural);
        let write = |seed| {
            write_line(
                &mut Pen::new(color("ink").unwrap(), seed),
                "Hello, Αθήνα — T^4 ≈ 10^{-8} → ∞",
                100.,
                200.,
                &style,
            )
        };
        let (a, end) = write(3);
        assert_eq!(a.len(), write(3).0.len());
        assert_eq!(a[5].points, write(3).0[5].points, "same seed, same strokes");
        assert_ne!(a[5].points, write(4).0[5].points);
        assert!(end > 300. && end < 800., "{end}");
        let p = a[0].pressure.as_ref().unwrap();
        assert_eq!(p.len(), a[0].points.len());
        assert!(p.iter().all(|v| *v > 0. && *v < 3.));
        let mut fine = Pen::new([0., 0., 0., 1.], 1);
        fine.fineliner = true;
        assert!(fine
            .stroke(&[[0., 0.], [40., 0.]], 2., 1, 0.3)
            .pressure
            .is_none());
        let h = highlight_line(
            [0., 0.],
            [100., 0.],
            24.,
            highlight_color("pink"),
            &mut Rng::new(1),
        );
        assert!(h.under && h.tool == 1 && h.width == 24.);
        assert!(wrap("one two three four five six", 60., &style).len() > 2);
        assert_eq!(hex("#fff"), Some([1., 1., 1., 1.]));
    }
}
