//! SVG drawings into ink: outlines become hand-drawn pen strokes, fills become
//! pastel highlighter colouring under the ink, `<text>` becomes handwriting.
//! Supported: path (all commands, arcs included), rect (rx/ry), circle,
//! ellipse, line, polyline, polygon, text, g/svg/a; transform (matrix,
//! translate, scale, rotate, skewX, skewY); fill, stroke, stroke-width,
//! opacity, fill-opacity, display, font-size, text-anchor, font-weight as
//! attributes or inline style. Anything else is skipped with a warning.
//! Ported from noteful-mcp's svgink.py (MIT).
use super::{
    font::{bezier, FontName, Pt},
    hand::{self, highlight_line, text_style, text_width, write_line, Hand, Pen, Rgba},
    rng::Rng,
};
use crate::Line;
use std::{collections::BTreeMap, f64::consts::PI};

const MAX_SVG: usize = 256 * 1024;
const MAX_ELEMENTS: usize = 2000;
const MAX_POINTS: usize = 200_000;

type Matrix = [f64; 6];
const IDENTITY: Matrix = [1., 0., 0., 1., 0., 0.];

fn mul(m: Matrix, n: Matrix) -> Matrix {
    let [a, b, c, d, e, f] = m;
    let [aa, bb, cc, dd, ee, ff] = n;
    [
        a * aa + c * bb,
        b * aa + d * bb,
        a * cc + c * dd,
        b * cc + d * dd,
        a * ee + c * ff + e,
        b * ee + d * ff + f,
    ]
}
fn apply(m: Matrix, p: Pt) -> Pt {
    [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}
fn numbers(s: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let mut tok = String::new();
    let push = |tok: &mut String, out: &mut Vec<f64>| {
        if let Ok(v) = tok.parse::<f64>() {
            if v.is_finite() {
                out.push(v);
            }
        }
        tok.clear();
    };
    for c in s.chars() {
        let starts_new = (c == '-' || c == '+') && !tok.is_empty() && !tok.ends_with(['e', 'E']);
        let second_dot = c == '.' && tok.contains('.') && !tok.contains(['e', 'E']);
        if c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E' {
            if starts_new || second_dot {
                push(&mut tok, &mut out);
            }
            tok.push(c);
        } else {
            push(&mut tok, &mut out);
        }
    }
    push(&mut tok, &mut out);
    out
}
fn parse_transform(s: &str) -> Matrix {
    let mut m = IDENTITY;
    let mut rest = s;
    while let Some(open) = rest.find('(') {
        let name = rest[..open].trim().trim_start_matches([',', ' ']).trim();
        let Some(close) = rest[open..].find(')') else { break };
        let v = numbers(&rest[open + 1..open + close]);
        rest = &rest[open + close + 1..];
        let at = |i: usize, d: f64| v.get(i).copied().unwrap_or(d);
        let t = match name {
            "matrix" if v.len() == 6 => [v[0], v[1], v[2], v[3], v[4], v[5]],
            "translate" => [1., 0., 0., 1., at(0, 0.), at(1, 0.)],
            "scale" => [at(0, 1.), 0., 0., at(1, at(0, 1.)), 0., 0.],
            "rotate" => {
                let r = at(0, 0.).to_radians();
                let t = [r.cos(), r.sin(), -r.sin(), r.cos(), 0., 0.];
                if v.len() == 3 {
                    mul(mul([1., 0., 0., 1., v[1], v[2]], t), [1., 0., 0., 1., -v[1], -v[2]])
                } else {
                    t
                }
            }
            "skewX" => [1., 0., at(0, 0.).to_radians().tan(), 1., 0., 0.],
            "skewY" => [1., at(0, 0.).to_radians().tan(), 0., 1., 0., 0.],
            _ => continue,
        };
        m = mul(m, t);
    }
    m
}

/// SVG/CSS colour; None for none/transparent or unknown values.
pub fn parse_color(v: &str) -> Option<Rgba> {
    let v = v.trim().to_ascii_lowercase();
    let named = match v.as_str() {
        "none" | "transparent" | "" => return None,
        "black" => "#000000",
        "white" => "#ffffff",
        "red" => "#e5383b",
        "green" => "#4e9a3a",
        "blue" => "#2f6fe0",
        "yellow" => "#ffd23f",
        "orange" => "#f08a24",
        "purple" => "#8e5bd8",
        "pink" => "#ef6fa3",
        "gray" | "grey" => "#808080",
        "brown" => "#8b5a2b",
        "navy" => "#1f2f7a",
        "teal" => "#2a9d8f",
        "coral" => "#ff6f61",
        "salmon" => "#fa8072",
        "crimson" => "#d7263d",
        "maroon" => "#800000",
        "gold" => "#e6b800",
        "lime" => "#7ccf3a",
        "cyan" => "#3ccfe0",
        "magenta" => "#d63ab0",
        "violet" => "#9b6ce0",
        "indigo" => "#4b3fa8",
        "beige" => "#f1e3c8",
        "tan" => "#d2b48c",
        "lightblue" => "#a8d8f0",
        "lightgreen" => "#b8e6a8",
        "lightpink" => "#ffc8d8",
        "lavender" => "#d9ccf5",
        "peach" => "#ffcfa8",
        "mint" => "#bdf0d8",
        "skyblue" => "#87ceeb",
        "darkred" => "#8b1a1a",
        other => other,
    };
    if let Some(c) = hand::hex(named) {
        return Some(c);
    }
    if let Some(inner) = named
        .strip_prefix("rgba(")
        .or_else(|| named.strip_prefix("rgb("))
        .and_then(|s| s.strip_suffix(')'))
    {
        let p: Vec<f64> = inner
            .split(',')
            .take(3)
            .filter_map(|x| x.trim().trim_end_matches('%').parse().ok())
            .collect();
        if p.len() == 3 {
            return Some([p[0] / 255., p[1] / 255., p[2] / 255., 1.]);
        }
    }
    None
}

fn cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt) -> Vec<Pt> {
    let len: f64 = [p0, p1, p2, p3]
        .windows(2)
        .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
        .sum();
    bezier(p0, p1, p2, p3, ((len / 3.) as usize).clamp(4, 48))
}
/// An endpoint arc as points, excluding p0.
fn arc(p0: Pt, rx: f64, ry: f64, phi: f64, large: bool, sweep: bool, p1: Pt) -> Vec<Pt> {
    if p0 == p1 {
        return vec![];
    }
    if rx == 0. || ry == 0. {
        return vec![p1];
    }
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    let (cp, sp) = (phi.to_radians().cos(), phi.to_radians().sin());
    let (dx, dy) = ((p0[0] - p1[0]) / 2., (p0[1] - p1[1]) / 2.);
    let (x1, y1) = (cp * dx + sp * dy, -sp * dx + cp * dy);
    let lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
    if lam > 1. {
        rx *= lam.sqrt();
        ry *= lam.sqrt();
    }
    let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let mut k = if den != 0. { (num / den).max(0.).sqrt() } else { 0. };
    if large == sweep {
        k = -k;
    }
    let (cx1, cy1) = (k * rx * y1 / ry, -k * ry * x1 / rx);
    let cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2.;
    let cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2.;
    let ang = |ux: f64, uy: f64, vx: f64, vy: f64| (ux * vy - uy * vx).atan2(ux * vx + uy * vy);
    let t1 = ang(1., 0., (x1 - cx1) / rx, (y1 - cy1) / ry);
    let mut dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if !sweep && dt > 0. {
        dt -= 2. * PI;
    } else if sweep && dt < 0. {
        dt += 2. * PI;
    }
    let n = ((dt.abs() * rx.max(ry) / 3.) as usize).clamp(4, 400);
    (1..=n)
        .map(|i| {
            let t = t1 + dt * i as f64 / n as f64;
            let (x, y) = (rx * t.cos(), ry * t.sin());
            [cp * x - sp * y + cx, sp * x + cp * y + cy]
        })
        .collect()
}

/// Path data into (points, closed) sub-paths, in user units.
pub fn path_subpaths(d: &str) -> Vec<(Vec<Pt>, bool)> {
    // Tokens: command letters and numbers.
    let mut toks: Vec<Result<char, f64>> = Vec::new();
    let mut num = String::new();
    for c in d.chars() {
        if "MmLlHhVvCcSsQqTtAaZz".contains(c) {
            toks.extend(numbers(&num).into_iter().map(Err));
            num.clear();
            toks.push(Ok(c));
        } else {
            num.push(c);
        }
    }
    toks.extend(numbers(&num).into_iter().map(Err));
    let mut out = Vec::new();
    let mut cur: Vec<Pt> = Vec::new();
    let (mut pos, mut start) = ([0., 0.], [0., 0.]);
    let mut last_ctrl: Option<Pt> = None;
    let mut cmd: Option<char> = None;
    let mut i = 0;
    let next = |i: &mut usize| -> Option<f64> {
        match toks.get(*i) {
            Some(Err(v)) => {
                *i += 1;
                Some(*v)
            }
            _ => None,
        }
    };
    while i < toks.len() {
        if let Ok(c) = toks[i] {
            cmd = Some(c);
            i += 1;
            if c == 'Z' || c == 'z' {
                if !cur.is_empty() {
                    out.push((std::mem::take(&mut cur), true));
                }
                pos = start;
                last_ctrl = None;
                continue;
            }
        }
        let Some(c) = cmd else {
            i += 1;
            continue;
        };
        let rel = c.is_ascii_lowercase();
        let o = if rel { pos } else { [0., 0.] };
        let mut ctrl = None;
        let before = i;
        let pt = |i: &mut usize| -> Option<Pt> { Some([o[0] + next(i)?, o[1] + next(i)?]) };
        match c.to_ascii_uppercase() {
            'M' => {
                let Some(p) = pt(&mut i) else { break };
                if cur.len() > 1 {
                    out.push((std::mem::take(&mut cur), false));
                }
                pos = p;
                start = p;
                cur = vec![p];
                cmd = Some(if rel { 'l' } else { 'L' });
            }
            'L' => {
                let Some(p) = pt(&mut i) else { break };
                pos = p;
                cur.push(p);
            }
            'H' => {
                let Some(v) = next(&mut i) else { break };
                pos = [if rel { pos[0] + v } else { v }, pos[1]];
                cur.push(pos);
            }
            'V' => {
                let Some(v) = next(&mut i) else { break };
                pos = [pos[0], if rel { pos[1] + v } else { v }];
                cur.push(pos);
            }
            'C' | 'S' => {
                let p1 = if c.eq_ignore_ascii_case(&'C') {
                    let Some(p) = pt(&mut i) else { break };
                    p
                } else {
                    last_ctrl.map_or(pos, |l| [2. * pos[0] - l[0], 2. * pos[1] - l[1]])
                };
                let (Some(p2), Some(p3)) = (pt(&mut i), pt(&mut i)) else { break };
                cur.extend(cubic(pos, p1, p2, p3));
                pos = p3;
                ctrl = Some(p2);
            }
            'Q' | 'T' => {
                let q = if c.eq_ignore_ascii_case(&'Q') {
                    let Some(p) = pt(&mut i) else { break };
                    p
                } else {
                    last_ctrl.map_or(pos, |l| [2. * pos[0] - l[0], 2. * pos[1] - l[1]])
                };
                let Some(p3) = pt(&mut i) else { break };
                let p1 = [pos[0] + 2. / 3. * (q[0] - pos[0]), pos[1] + 2. / 3. * (q[1] - pos[1])];
                let p2 = [p3[0] + 2. / 3. * (q[0] - p3[0]), p3[1] + 2. / 3. * (q[1] - p3[1])];
                cur.extend(cubic(pos, p1, p2, p3));
                pos = p3;
                ctrl = Some(q);
            }
            'A' => {
                let v: Option<Vec<f64>> = (0..5).map(|_| next(&mut i)).collect();
                let (Some(v), Some(p3)) = (v, pt(&mut i)) else { break };
                cur.extend(arc(pos, v[0], v[1], v[2], v[3] != 0., v[4] != 0., p3));
                pos = p3;
            }
            _ => {}
        }
        if i == before {
            i += 1;
        }
        last_ctrl = if "CcSsQqTt".contains(c) { ctrl } else { None };
        if cur.is_empty() {
            cur.push(pos);
        }
    }
    if cur.len() > 1 {
        out.push((cur, false));
    }
    out
}

pub fn ellipse_pts(cx: f64, cy: f64, rx: f64, ry: f64) -> Vec<Pt> {
    let n = ((2. * PI * rx.max(ry) / 3.) as usize).clamp(16, 2000);
    (0..n)
        .map(|i| {
            let a = 2. * PI * i as f64 / n as f64;
            [cx + rx * a.cos(), cy + ry * a.sin()]
        })
        .collect()
}
pub fn rect_pts(x: f64, y: f64, w: f64, h: f64, rx: f64, ry: f64) -> Vec<Pt> {
    let rx = (if rx > 0. { rx } else { ry }).min(w / 2.);
    let ry = (if ry > 0. { ry } else { rx }).min(h / 2.);
    if rx <= 0. {
        return vec![[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    let mut pts = Vec::new();
    for (cx, cy, a0) in [
        (x + w - rx, y + ry, -90.),
        (x + w - rx, y + h - ry, 0.),
        (x + rx, y + h - ry, 90.),
        (x + rx, y + ry, 180.),
    ] {
        for k in (0..=90).step_by(15) {
            let a = ((a0 + k as f64) as f64).to_radians();
            pts.push([cx + rx * a.cos(), cy + ry * a.sin()]);
        }
    }
    pts
}

fn intervals(polys: &[Vec<Pt>], y: f64) -> Vec<(f64, f64)> {
    let mut xs: Vec<f64> = polys
        .iter()
        .flat_map(|p| (0..p.len()).map(move |i| (p[i], p[(i + 1) % p.len()])))
        .filter(|([_, y0], [_, y1])| (*y0 <= y && y < *y1) || (*y1 <= y && y < *y0))
        .map(|([x0, y0], [x1, y1])| x0 + (y - y0) * (x1 - x0) / (y1 - y0))
        .collect();
    xs.sort_by(f64::total_cmp);
    xs.chunks_exact(2).map(|c| (c[0], c[1])).collect()
}
fn subtract(mut segs: Vec<(f64, f64)>, cuts: &[(f64, f64)]) -> Vec<(f64, f64)> {
    for &(c0, c1) in cuts {
        let mut next = Vec::new();
        for (a, b) in segs {
            if c1 <= a || c0 >= b {
                next.push((a, b));
                continue;
            }
            if a < c0 {
                next.push((a, c0));
            }
            if c1 < b {
                next.push((c1, b));
            }
        }
        segs = next;
    }
    segs
}
/// Colour shapes (polygons, highlighter colour) in painter's order with
/// abutting highlighter strokes. Inside is even-odd; a later shape covers
/// earlier ones, so two translucent colours never stack.
pub fn fill_shapes(shapes: &[(Vec<Vec<Pt>>, Rgba)], band: f64, angle: f64, rng: &mut Rng) -> Vec<Line> {
    let (ca, sa) = (angle.cos(), angle.sin());
    let rots: Vec<Vec<Vec<Pt>>> = shapes
        .iter()
        .map(|(polys, _)| {
            polys
                .iter()
                .filter(|p| p.len() > 2)
                .map(|p| p.iter().map(|[x, y]| [x * ca - y * sa, x * sa + y * ca]).collect())
                .collect()
        })
        .collect();
    let ys: Vec<f64> = rots.iter().flatten().flatten().map(|p| p[1]).collect();
    if ys.is_empty() {
        return vec![];
    }
    let (lo, hi) = ys.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), y| (a.min(*y), b.max(*y)));
    let r = band / 2.;
    let mut out = Vec::new();
    let mut y = lo + r;
    while y < hi && out.len() < 20_000 {
        let rows: Vec<Vec<(f64, f64)>> = rots.iter().map(|rot| intervals(rot, y)).collect();
        for (i, (_, col)) in shapes.iter().enumerate() {
            let later: Vec<(f64, f64)> = rows[i + 1..].iter().flatten().copied().collect();
            for (a, b) in subtract(rows[i].clone(), &later) {
                let (mut a2, mut b2) = (a + r * 0.9, b - r * 0.9);
                if b2 <= a2 {
                    if b - a < r * 0.6 {
                        continue;
                    }
                    a2 = (a + b) / 2.;
                    b2 = a2;
                }
                let jitter = rng.uniform(-0.3, 0.3);
                let back = |[px, py]: Pt| [px * ca + py * sa, -px * sa + py * ca];
                out.push(highlight_line(back([a2, y]), back([b2 + 0.01, y + jitter]), band, *col, rng));
            }
        }
        y += band * 0.98;
    }
    out
}

/// A placed drawing: ink on top, fills under it, and its size on the page.
pub struct Drawing {
    pub strokes: Vec<Line>,
    pub under: Vec<Line>,
    pub size: [f64; 2],
    pub warnings: Vec<String>,
}

const STYLE_KEYS: [&str; 9] = [
    "fill",
    "stroke",
    "stroke-width",
    "opacity",
    "fill-opacity",
    "display",
    "font-size",
    "text-anchor",
    "font-weight",
];
const SKIPPED: [&str; 12] = [
    "defs",
    "clipPath",
    "mask",
    "linearGradient",
    "radialGradient",
    "pattern",
    "marker",
    "style",
    "title",
    "desc",
    "metadata",
    "filter",
];

pub struct DrawOptions {
    pub label_font: FontName,
    pub caps: bool,
    pub band: f64,
    pub ink: Rgba,
    pub pastel: bool,
}

/// Place an SVG drawing at (x, y) scaled to `width` (and at most `height`).
pub fn drawing(svg: &str, x: f64, y: f64, width: f64, height: Option<f64>, pen: &mut Pen, opts: &DrawOptions) -> Result<Drawing, String> {
    if svg.len() > MAX_SVG {
        return Err("The SVG drawing is larger than 256 KB.".into());
    }
    let doc = roxmltree::Document::parse(svg.trim()).map_err(|e| format!("The SVG drawing is not valid XML: {e}"))?;
    let root = doc.root_element();
    let mut vb = root.attribute("viewBox").map(numbers).unwrap_or_default();
    if vb.len() != 4 || vb[2] <= 0. || vb[3] <= 0. {
        let size = |k| root.attribute(k).and_then(|v| numbers(v).first().copied()).filter(|v| *v > 0.);
        vb = vec![0., 0., size("width").unwrap_or(100.), size("height").unwrap_or(100.)];
    }
    let [vx, vy, vw, vh] = [vb[0], vb[1], vb[2], vb[3]];
    let mut k = width / vw;
    if let Some(h) = height.filter(|h| *h > 0.) {
        k = k.min(h / vh);
    }
    let base = [k, 0., 0., k, x - vx * k, y - vy * k];
    let mut cx = Collect {
        strokes: vec![],
        fills: vec![],
        warnings: BTreeMap::new(),
        elements: 0,
        points: 0,
    };
    walk(root, base, &BTreeMap::new(), pen, opts, &mut cx);
    let mut warnings: Vec<String> = cx
        .warnings
        .into_iter()
        .map(|(w, n)| if n > 1 { format!("{w} (×{n})") } else { w })
        .collect();
    if cx.elements > MAX_ELEMENTS || cx.points > MAX_POINTS {
        warnings.push("The drawing was cut short: too many elements or points.".into());
    }
    let fills: Vec<(Vec<Vec<Pt>>, Rgba)> = if opts.pastel { cx.fills } else { vec![] };
    Ok(Drawing {
        strokes: cx.strokes,
        under: fill_shapes(&fills, opts.band, -0.06, &mut pen.rng),
        size: [vw * k, vh * k],
        warnings,
    })
}

struct Collect {
    strokes: Vec<Line>,
    fills: Vec<(Vec<Vec<Pt>>, Rgba)>,
    warnings: BTreeMap<String, usize>,
    elements: usize,
    points: usize,
}
impl Collect {
    fn warn(&mut self, w: String) {
        *self.warnings.entry(w).or_default() += 1;
    }
}

fn attr_f(el: roxmltree::Node, k: &str) -> f64 {
    el.attribute(k).and_then(|v| numbers(v).first().copied()).unwrap_or(0.)
}
fn style_of(el: roxmltree::Node, parent: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut st = parent.clone();
    // Opacity multiplies down the tree; the rest inherits by replacement.
    st.remove("opacity");
    let mut own_opacity = None;
    for k in STYLE_KEYS {
        if let Some(v) = el.attribute(k) {
            if k == "opacity" {
                own_opacity = Some(v.to_owned());
            } else {
                st.insert(k.into(), v.into());
            }
        }
    }
    for decl in el.attribute("style").unwrap_or("").split(';') {
        if let Some((k, v)) = decl.split_once(':') {
            let k = k.trim();
            if STYLE_KEYS.contains(&k) {
                if k == "opacity" {
                    own_opacity = Some(v.trim().to_owned());
                } else {
                    st.insert(k.into(), v.trim().into());
                }
            }
        }
    }
    let inherited: f64 = parent.get("opacity").and_then(|v| v.parse().ok()).unwrap_or(1.);
    let own: f64 = own_opacity.and_then(|v| v.parse().ok()).unwrap_or(1.);
    st.insert("opacity".into(), (inherited * own).to_string());
    st
}

fn walk(el: roxmltree::Node, m: Matrix, parent: &BTreeMap<String, String>, pen: &mut Pen, opts: &DrawOptions, cx: &mut Collect) {
    if !el.is_element() {
        return;
    }
    cx.elements += 1;
    if cx.elements > MAX_ELEMENTS || cx.points > MAX_POINTS {
        return;
    }
    let st = style_of(el, parent);
    if st.get("display").is_some_and(|d| d == "none") {
        return;
    }
    let m = mul(m, el.attribute("transform").map(parse_transform).unwrap_or(IDENTITY));
    let tag = el.tag_name().name();
    if SKIPPED.contains(&tag) {
        if !matches!(tag, "title" | "desc" | "metadata" | "defs") {
            cx.warn(format!("SVG <{tag}> is not drawn"));
        }
        return;
    }
    let scale = m[0].hypot(m[1]);
    let opacity: f64 = st.get("opacity").and_then(|v| v.parse().ok()).unwrap_or(1.);
    match tag {
        "g" | "svg" | "a" => {
            for child in el.children() {
                walk(child, m, &st, pen, opts, cx);
            }
            return;
        }
        "text" => {
            let text: String = el.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect::<String>();
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            if text.is_empty() {
                return;
            }
            let text = if opts.caps { text.to_uppercase() } else { text };
            let fs = st
                .get("font-size")
                .and_then(|v| numbers(v).first().copied())
                .unwrap_or(12.)
                * scale;
            let ts = text_style(opts.label_font, (fs * 0.56).max(5.), Hand::Neat);
            let [mut px, py] = apply(m, [attr_f(el, "x"), attr_f(el, "y")]);
            let w = text_width(&text, &ts);
            match st.get("text-anchor").map(String::as_str) {
                Some("end") => px -= w,
                Some("middle") => px -= w / 2.,
                _ => {}
            }
            let mut col = st.get("fill").and_then(|f| parse_color(f)).unwrap_or(opts.ink);
            col[3] = opacity.clamp(0.05, 1.);
            let bold = st.get("font-weight").is_some_and(|w| w == "bold" || w == "700");
            let mut tp = pen.child(col, pen.width * if bold { 1.3 } else { 1. });
            let (s, _) = write_line(&mut tp, &text, px, py, &ts);
            cx.points += s.iter().map(|l| l.points.len()).sum::<usize>();
            cx.strokes.extend(s);
            return;
        }
        _ => {}
    }
    let shapes: Vec<(Vec<Pt>, bool)> = match tag {
        "path" => path_subpaths(el.attribute("d").unwrap_or("")),
        "rect" => vec![(
            rect_pts(attr_f(el, "x"), attr_f(el, "y"), attr_f(el, "width"), attr_f(el, "height"), attr_f(el, "rx"), attr_f(el, "ry")),
            true,
        )],
        "circle" => {
            let r = attr_f(el, "r");
            vec![(ellipse_pts(attr_f(el, "cx"), attr_f(el, "cy"), r, r), true)]
        }
        "ellipse" => vec![(ellipse_pts(attr_f(el, "cx"), attr_f(el, "cy"), attr_f(el, "rx"), attr_f(el, "ry")), true)],
        "line" => vec![(vec![[attr_f(el, "x1"), attr_f(el, "y1")], [attr_f(el, "x2"), attr_f(el, "y2")]], false)],
        "polyline" | "polygon" => {
            let v = numbers(el.attribute("points").unwrap_or(""));
            vec![(v.chunks_exact(2).map(|c| [c[0], c[1]]).collect(), tag == "polygon")]
        }
        other => {
            cx.warn(format!("SVG <{other}> is not drawn"));
            return;
        }
    };
    let placed: Vec<(Vec<Pt>, bool)> = shapes
        .into_iter()
        .map(|(pts, closed)| (pts.into_iter().map(|p| apply(m, p)).collect(), closed))
        .collect();
    cx.points += placed.iter().map(|(p, _)| p.len()).sum::<usize>();
    let fill_opacity: f64 = st
        .get("fill-opacity")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1.)
        * opacity;
    if tag != "line" {
        let fill = st.get("fill").map_or(Some([0., 0., 0., 1.]), |f| parse_color(f));
        if let Some(fill) = fill.filter(|_| fill_opacity > 0.05) {
            cx.fills.push((placed.iter().map(|(p, _)| p.clone()).collect(), pastel(fill)));
        }
    }
    if let Some(mut col) = st.get("stroke").and_then(|s| parse_color(s)) {
        col[3] = opacity.clamp(0.05, 1.);
        let sw = st
            .get("stroke-width")
            .and_then(|v| numbers(v).first().copied())
            .unwrap_or(1.)
            * scale;
        let mut p = pen.child(col, (sw / 1.3).clamp(0.8, 4.5));
        for (mut pts, closed) in placed {
            if closed && pts.len() > 1 {
                pts.push(pts[0]);
                pts.push(pts[1]);
            }
            if pts.len() > 1 {
                let w = hand::wobble(&mut p, &pts, 0.7);
                cx.strokes.push(p.stroke(&w, 2., 1, 0.25));
            }
        }
    }
}

/// Fill colours become a highlighter wash: pale enough to write over.
fn pastel(c: Rgba) -> Rgba {
    let light = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    let mix = if light > 0.7 { 0. } else { 0.55 - light * 0.5 };
    [
        c[0] + (1. - c[0]) * mix,
        c[1] + (1. - c[1]) * mix,
        c[2] + (1. - c[2]) * mix,
        1.,
    ]
}

/// Split an over-long polyline so every piece fits Noteful's point limit.
pub fn split_long(line: Line, max: usize) -> Vec<Line> {
    if line.points.len() <= max {
        return vec![line];
    }
    let mut out = Vec::new();
    let mut start = 0;
    while start + 1 < line.points.len() {
        let end = (start + max).min(line.points.len());
        let mut piece = line.clone();
        piece.points = line.points[start..end].to_vec();
        piece.pressure = line.pressure.as_ref().map(|p| p[start..end].to_vec());
        out.push(piece);
        start = end - 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_shapes_and_text_become_ink_with_fills_under_it() {
        let subs = path_subpaths("M10 10 h 20 v 20 H 10 Z m 50 0 c 10 0 10 10 0 10 s -10 10 0 20 A 5 5 0 0 1 70 50 q 5 5 10 0 t 10 0");
        assert_eq!(subs.len(), 2);
        assert!(subs[0].1 && !subs[1].1);
        assert_eq!(subs[0].0[..3], [[10., 10.], [30., 10.], [30., 30.]]);
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
            <g transform="translate(10 0)"><rect x="0" y="10" width="80" height="60" rx="8" fill="#8fc3ff" stroke="#1f2233" stroke-width="2"/></g>
            <circle cx="150" cy="40" r="30" fill="none" stroke="red"/>
            <text x="100" y="95" font-size="20" text-anchor="middle">Label</text>
            <linearGradient id="g"/><image href="x.png"/></svg>"##;
        let mut pen = Pen::new([0., 0., 0., 1.], 1);
        let opts = DrawOptions { label_font: FontName::Patrick, caps: false, band: 5., ink: [0., 0., 0., 1.], pastel: true };
        let d = drawing(svg, 100., 100., 400., None, &mut pen, &opts).unwrap();
        assert_eq!(d.size, [400., 200.]);
        assert!(d.strokes.len() > 5, "outlines plus label letters");
        assert!(!d.under.is_empty() && d.under.iter().all(|l| l.tool == 1 && l.under));
        assert!(d.under.iter().flat_map(|l| &l.points).all(|p| p[0] > 115. && p[0] < 290. && p[1] > 115. && p[1] < 245.), "fill stays inside the rect");
        assert!(d.warnings.iter().any(|w| w.contains("<image>")));
        assert!(d.warnings.iter().any(|w| w.contains("<linearGradient>")));
        assert!(drawing("<svg><rect", 0., 0., 10., None, &mut pen, &opts).is_err());
        assert_eq!(parse_transform("rotate(90)").map(|v| (v * 1e9).round() / 1e9), [0., 1., -1., 0., 0., 0.]);
        assert_eq!(numbers("1.5.5-2e-1,3"), vec![1.5, 0.5, -0.2, 3.]);
        let long = Line::new((0..20).map(|i| [i as f64, 0.]).collect(), 1., [0., 0., 0., 1.]);
        let parts = split_long(long, 8);
        assert!(parts.iter().all(|p| p.points.len() <= 8) && parts.len() == 3);
    }
}
