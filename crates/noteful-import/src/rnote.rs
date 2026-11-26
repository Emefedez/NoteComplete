//! Rnote (`.rnote`) notes: gzip-compressed JSON (`{"version", "data": {"engine_snapshot"}}`)
//! with pen strokes, shapes, text and pictures on a canvas in pixels at the document's DPI.
//! They become pages the rest of this crate builds Noteful notes from:
//!
//! - Fixed-size and vertical layouts are cut into pages of the document's format.
//! - On an infinite canvas, page-sized pictures (PDF pages Rnote imported) become a page
//!   each, with the ink drawn on them; what lies outside them is cut into format-sized pages.
//! - Brush strokes are strokes (width from the median pressure), shapes are strokes and
//!   fills, text is text, bitmaps are JPEG (opaque) or PNG pictures, and SVG pictures (how
//!   Rnote keeps imported PDF pages) become a vector PDF page background.
//! - A non-white canvas colour becomes the page colour.
use flate2::read::GzDecoder;
use oblyx::doc::{
    Background, Document, FillPathEl, ImageEl, Item, Page, PathEl, PdfBgEl, Stroke, TextBox,
};
use serde_json::Value;
use std::io::Read;

/// Whether `bytes` is an Rnote file (gzip whose JSON names an engine snapshot).
pub fn is_rnote(bytes: &[u8]) -> bool {
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return false;
    }
    let mut head = vec![0u8; 512];
    let mut gz = GzDecoder::new(bytes);
    let mut n = 0;
    while n < head.len() {
        match gz.read(&mut head[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
    }
    let head = String::from_utf8_lossy(&head[..n]);
    head.trim_start().starts_with('{') && head.contains("\"engine_snapshot\"")
}

type Aff = [f64; 6];

fn affine(v: &Value) -> Aff {
    match v["affine"].as_array() {
        Some(a) if a.len() >= 9 => {
            let f = |i: usize| a[i].as_f64().unwrap_or(0.);
            [f(0), f(1), f(3), f(4), f(6), f(7)]
        }
        _ => [1., 0., 0., 1., 0., 0.],
    }
}
fn apply(a: &Aff, x: f64, y: f64) -> [f64; 2] {
    [a[0] * x + a[2] * y + a[4], a[1] * x + a[3] * y + a[5]]
}
fn pos(v: &Value) -> Option<[f64; 2]> {
    Some([v[0].as_f64()?, v[1].as_f64()?])
}
fn color(v: &Value) -> Option<[f32; 4]> {
    let c = |k: &str| v[k].as_f64().unwrap_or(0.).clamp(0., 1.) as f32;
    let rgba = [
        c("r"),
        c("g"),
        c("b"),
        v["a"].as_f64().map_or(1., |a| a.clamp(0., 1.) as f32),
    ];
    (v.is_object() && rgba[3] > 0.004).then_some(rgba)
}

fn bezier(out: &mut Vec<[f64; 2]>, ctrl: &[[f64; 2]]) {
    let from = *out.last().unwrap_or(&ctrl[0]);
    for i in 1..=8 {
        let t = i as f64 / 8.;
        let u = 1. - t;
        out.push(match ctrl {
            [c, e] => [
                u * u * from[0] + 2. * u * t * c[0] + t * t * e[0],
                u * u * from[1] + 2. * u * t * c[1] + t * t * e[1],
            ],
            [c1, c2, e] => [
                u * u * u * from[0]
                    + 3. * u * u * t * c1[0]
                    + 3. * u * t * t * c2[0]
                    + t * t * t * e[0],
                u * u * u * from[1]
                    + 3. * u * u * t * c1[1]
                    + 3. * u * t * t * c2[1]
                    + t * t * t * e[1],
            ],
            _ => return,
        });
    }
}

fn style(v: &Value) -> (f64, Option<[f32; 4]>, Option<[f32; 4]>, bool) {
    let inner = ["smooth", "rough", "textured"]
        .iter()
        .find_map(|k| v.get(*k))
        .or_else(|| v.as_object().and_then(|o| o.values().next()))
        .cloned()
        .unwrap_or(Value::Null);
    let width = inner["stroke_width"]
        .as_f64()
        .or(inner["width"].as_f64())
        .unwrap_or(2.);
    let pressure = inner["pressure_curve"]
        .as_str()
        .is_some_and(|c| c != "const");
    (
        width,
        color(&inner["stroke_color"]).or(color(&inner["color"])),
        color(&inner["fill_color"]),
        pressure,
    )
}

/// One thing on the canvas, in canvas pixels, before it is placed on a page.
enum Thing {
    Line {
        points: Vec<[f64; 2]>,
        width: f64,
        rgba: [f32; 4],
        fill: Option<[f32; 4]>,
        head: Option<[[f64; 2]; 3]>,
    },
    Text {
        at: [f64; 2],
        size: f64,
        text: String,
        rgb: [f32; 3],
        bold: bool,
    },
    Picture {
        rect: [f64; 4],
        data: Vec<u8>,
    },
    Vector {
        rect: [f64; 4],
        /// Its SVG, and the size its own coordinates span.
        svg: String,
        size: [f64; 2],
    },
}

impl Thing {
    fn bounds(&self) -> [f64; 4] {
        match self {
            Thing::Line { points, .. } => {
                let (mut a, mut b) = ([f64::MAX; 2], [f64::MIN; 2]);
                for p in points {
                    a = [a[0].min(p[0]), a[1].min(p[1])];
                    b = [b[0].max(p[0]), b[1].max(p[1])];
                }
                [a[0], a[1], b[0] - a[0], b[1] - a[1]]
            }
            Thing::Text { at, size, text, .. } => {
                let cols = text.lines().map(|l| l.chars().count()).max().unwrap_or(1) as f64;
                [
                    at[0],
                    at[1],
                    cols * size * 0.6,
                    text.lines().count().max(1) as f64 * size * 1.3,
                ]
            }
            Thing::Picture { rect, .. } | Thing::Vector { rect, .. } => *rect,
        }
    }
}

fn rect_of(rectangle: &Value) -> Option<[f64; 4]> {
    let h = &rectangle["cuboid"]["half_extents"];
    let (hx, hy) = (h[0].as_f64()?, h[1].as_f64()?);
    let a = affine(&rectangle["transform"]);
    let corners = [
        apply(&a, -hx, -hy),
        apply(&a, hx, -hy),
        apply(&a, hx, hy),
        apply(&a, -hx, hy),
    ];
    let x0 = corners.iter().map(|c| c[0]).fold(f64::MAX, f64::min);
    let y0 = corners.iter().map(|c| c[1]).fold(f64::MAX, f64::min);
    let x1 = corners.iter().map(|c| c[0]).fold(f64::MIN, f64::max);
    let y1 = corners.iter().map(|c| c[1]).fold(f64::MIN, f64::max);
    (hx > 0. && hy > 0.).then_some([x0, y0, x1 - x0, y1 - y0])
}

/// A bitmap's pixels as PNG or JPEG bytes.
fn picture(image: &Value) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let raw = match &image["data"] {
        Value::String(s) => STANDARD.decode(s.trim()).ok()?,
        Value::Array(a) => a.iter().map(|b| b.as_u64().unwrap_or(0) as u8).collect(),
        _ => return None,
    };
    if raw.starts_with(b"\x89PNG\r\n\x1a\n") || raw.starts_with(b"\xff\xd8\xff") {
        return Some(raw);
    }
    let (w, h) = (
        image["pixel_width"].as_u64()? as u32,
        image["pixel_height"].as_u64()? as u32,
    );
    let format = image["memory_format"]
        .as_str()
        .unwrap_or("R8g8b8a8Premultiplied");
    let bgr = format.starts_with("B8g8r8");
    let premultiplied = format.contains("Premultiplied");
    let pixels = (w as usize) * (h as usize);
    let mut rgba = Vec::with_capacity(pixels * 4);
    if format.contains("a8") {
        for px in raw.get(..pixels * 4)?.as_chunks::<4>().0 {
            let (mut r, g, mut b, a) = (px[0], px[1], px[2], px[3]);
            if bgr {
                std::mem::swap(&mut r, &mut b);
            }
            let un = |c: u8| {
                if premultiplied && a > 0 && a < 255 {
                    ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8
                } else {
                    c
                }
            };
            rgba.extend_from_slice(&[un(r), un(g), un(b), a]);
        }
    } else {
        for px in raw.get(..pixels * 3)?.as_chunks::<3>().0 {
            let (r, b) = if bgr { (px[2], px[0]) } else { (px[0], px[2]) };
            rgba.extend_from_slice(&[r, px[1], b, 255]);
        }
    }
    let opaque = rgba.as_chunks::<4>().0.iter().all(|p| p[3] == 255);
    let mut out = Vec::new();
    if opaque {
        let rgb: Vec<u8> = rgba
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88)
            .encode(&rgb, w, h, image::ExtendedColorType::Rgb8)
            .ok()?;
    } else {
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
            .ok()?;
    }
    Some(out)
}

fn svg_pdf(svg: &str) -> Option<Vec<u8>> {
    let tree = svg2pdf::usvg::Tree::from_str(svg, &svg2pdf::usvg::Options::default()).ok()?;
    svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .ok()
}

use image::ImageEncoder;

fn things(es: &Value, warn: &mut dyn FnMut(&'static str)) -> Vec<Thing> {
    let strokes = es["stroke_components"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let chrono = es["chrono_components"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    // Drawing order: layer, then time.
    let mut order: Vec<(i64, u64, usize)> = (0..strokes.len())
        .map(|i| {
            let c = &chrono
                .get(i)
                .map(|c| c["value"].clone())
                .unwrap_or(Value::Null);
            let layer = match &c["layer"] {
                Value::String(s) if s == "document" => -1,
                v => v["user_layer"].as_i64().unwrap_or(0),
            };
            (layer, c["t"].as_u64().unwrap_or(i as u64), i)
        })
        .collect();
    order.sort();
    let mut out = Vec::new();
    for (_, _, i) in order {
        let v = &strokes[i]["value"];
        if let Some(bs) = v.get("brushstroke") {
            let path = &bs["path"];
            let Some(start) = pos(&path["start"]["pos"]) else {
                continue;
            };
            let (width, rgba, _, pressure) = style(&bs["style"]);
            let mut points = vec![start];
            let mut pressures = vec![path["start"]["pressure"].as_f64().unwrap_or(0.5)];
            for seg in path["segments"].as_array().into_iter().flatten() {
                if let Some(l) = seg.get("lineto") {
                    if let Some(e) = pos(&l["end"]["pos"]) {
                        points.push(e);
                        pressures.push(l["end"]["pressure"].as_f64().unwrap_or(0.5));
                    }
                } else if let Some(q) = seg.get("quadbezto") {
                    if let (Some(c), Some(e)) = (pos(&q["cp"]), pos(&q["end"]["pos"])) {
                        bezier(&mut points, &[c, e]);
                        pressures.push(q["end"]["pressure"].as_f64().unwrap_or(0.5));
                    }
                } else if let Some(c) = seg.get("cubbezto") {
                    if let (Some(c1), Some(c2), Some(e)) =
                        (pos(&c["cp1"]), pos(&c["cp2"]), pos(&c["end"]["pos"]))
                    {
                        bezier(&mut points, &[c1, c2, e]);
                        pressures.push(c["end"]["pressure"].as_f64().unwrap_or(0.5));
                    }
                }
            }
            if points.len() == 1 {
                points.push([start[0] + 0.01, start[1]]);
            }
            pressures.sort_by(|a, b| a.total_cmp(b));
            let median = pressures[pressures.len() / 2];
            let width = if pressure {
                width * median.clamp(0.35, 1.)
            } else {
                width
            };
            out.push(Thing::Line {
                points,
                width,
                rgba: rgba.unwrap_or([0., 0., 0., 1.]),
                fill: None,
                head: None,
            });
        } else if let Some(sh) = v.get("shapestroke") {
            let (width, stroke, fill, _) = style(&sh["style"]);
            let Some((kind, s)) = sh["shape"].as_object().and_then(|o| o.iter().next()) else {
                continue;
            };
            let mut points: Vec<[f64; 2]> = Vec::new();
            let mut head = None;
            let mut closed = false;
            match kind.as_str() {
                "line" => points.extend([pos(&s["start"]), pos(&s["end"])].into_iter().flatten()),
                "arrow" => {
                    if let (Some(a), Some(t)) = (pos(&s["start"]), pos(&s["tip"])) {
                        points = vec![a, t];
                        let (dx, dy) = (t[0] - a[0], t[1] - a[1]);
                        let len = dx.hypot(dy).max(1e-6);
                        let (ux, uy, k) = (dx / len, dy / len, (width * 4.).max(8.));
                        head = Some([
                            t,
                            [t[0] - k * ux + k * 0.5 * uy, t[1] - k * uy - k * 0.5 * ux],
                            [t[0] - k * ux - k * 0.5 * uy, t[1] - k * uy + k * 0.5 * ux],
                        ]);
                    }
                }
                "rect" => {
                    let h = &s["cuboid"]["half_extents"];
                    if let (Some(hx), Some(hy)) = (h[0].as_f64(), h[1].as_f64()) {
                        let a = affine(&s["transform"]);
                        points = vec![
                            apply(&a, -hx, -hy),
                            apply(&a, hx, -hy),
                            apply(&a, hx, hy),
                            apply(&a, -hx, hy),
                        ];
                        closed = true;
                    }
                }
                "ellipse" => {
                    if let (Some(rx), Some(ry)) = (s["radii"][0].as_f64(), s["radii"][1].as_f64()) {
                        let a = affine(&s["transform"]);
                        points = (0..48)
                            .map(|i| {
                                let t = i as f64 / 48. * std::f64::consts::TAU;
                                apply(&a, rx * t.cos(), ry * t.sin())
                            })
                            .collect();
                        closed = true;
                    }
                }
                "quadbez" | "cubbez" => {
                    if let (Some(a), Some(e)) = (pos(&s["start"]), pos(&s["end"])) {
                        points.push(a);
                        let ctrl: Vec<[f64; 2]> = if kind == "quadbez" {
                            [pos(&s["cp"]), Some(e)].into_iter().flatten().collect()
                        } else {
                            [pos(&s["cp1"]), pos(&s["cp2"]), Some(e)]
                                .into_iter()
                                .flatten()
                                .collect()
                        };
                        bezier(&mut points, &ctrl);
                    }
                }
                "polyline" | "polygon" => {
                    points.extend(pos(&s["start"]));
                    for p in s["path"].as_array().into_iter().flatten() {
                        points.extend(pos(p).or_else(|| pos(&p["pos"])));
                    }
                    closed = kind == "polygon";
                }
                _ => {
                    warn("Rnote shapes of an unknown kind left out");
                    continue;
                }
            }
            if closed && !points.is_empty() {
                points.push(points[0]);
            }
            if points.len() < 2 {
                continue;
            }
            out.push(Thing::Line {
                points,
                width,
                rgba: stroke.unwrap_or([0., 0., 0., 0.]),
                fill: if closed { fill } else { None },
                head,
            });
        } else if let Some(ts) = v.get("textstroke") {
            let text = ts["text"].as_str().unwrap_or("").to_string();
            if text.trim().is_empty() {
                continue;
            }
            let a = affine(&ts["transform"]);
            let st = &ts["text_style"];
            let size = st["font_size"].as_f64().unwrap_or(24.);
            let c = color(&st["color"]).unwrap_or([0., 0., 0., 1.]);
            let bold = st["font_weight"].as_u64().is_some_and(|w| w >= 600)
                || st["font_weight"]
                    .as_str()
                    .is_some_and(|w| w.contains("bold"));
            out.push(Thing::Text {
                at: [a[4], a[5]],
                size,
                text,
                rgb: [c[0], c[1], c[2]],
                bold,
            });
        } else if let Some(bm) = v.get("bitmapimage") {
            match (rect_of(&bm["rectangle"]), picture(&bm["image"])) {
                (Some(rect), Some(data)) => out.push(Thing::Picture { rect, data }),
                _ => warn("Rnote pictures that could not be read left out"),
            }
        } else if let Some(vi) = v.get("vectorimage") {
            match (rect_of(&vi["rectangle"]), vi["svg_data"].as_str()) {
                (Some(rect), Some(svg)) if !svg.is_empty() => {
                    let size = [
                        vi["intrinsic_size"][0].as_f64().unwrap_or(rect[2]),
                        vi["intrinsic_size"][1].as_f64().unwrap_or(rect[3]),
                    ];
                    out.push(Thing::Vector {
                        rect,
                        svg: svg.to_string(),
                        size,
                    })
                }
                _ => warn("Rnote vector pictures that could not be read left out"),
            }
        }
    }
    out
}

/// The page frames (canvas pixels) the things are laid out on.
fn frames(doc: &Value, things: &[Thing]) -> Vec<[f64; 4]> {
    let format = &doc["config"]["format"];
    let (fw, fh) = (
        format["width"].as_f64().unwrap_or(793.7).max(50.),
        format["height"].as_f64().unwrap_or(1122.5).max(50.),
    );
    let layout = doc["config"]["layout"].as_str().unwrap_or("infinite");
    let area = [
        doc["x"].as_f64().unwrap_or(0.),
        doc["y"].as_f64().unwrap_or(0.),
        doc["width"].as_f64().unwrap_or(fw),
        doc["height"].as_f64().unwrap_or(fh),
    ];
    let centre = |b: [f64; 4]| [b[0] + b[2] / 2., b[1] + b[3] / 2.];
    let inside = |f: &[f64; 4], p: [f64; 2]| {
        p[0] >= f[0] && p[0] < f[0] + f[2] && p[1] >= f[1] && p[1] < f[1] + f[3]
    };
    let grid = |area: [f64; 4], keep_empty: bool, taken: &[[f64; 4]]| -> Vec<[f64; 4]> {
        let (cols, rows) = (
            ((area[2] / fw).ceil() as usize).clamp(1, 200),
            ((area[3] / fh).ceil() as usize).clamp(1, 2000),
        );
        let mut out = Vec::new();
        for r in 0..rows {
            for c in 0..cols {
                let f = [area[0] + c as f64 * fw, area[1] + r as f64 * fh, fw, fh];
                let used = things.iter().any(|t| {
                    let p = centre(t.bounds());
                    inside(&f, p) && !taken.iter().any(|g| inside(g, p))
                });
                if keep_empty || used {
                    out.push(f);
                }
            }
        }
        out
    };
    if layout != "infinite" && layout != "semi_infinite" {
        return grid(
            area,
            layout == "fixed_size" || layout == "continuous_vertical",
            &[],
        );
    }
    // An infinite canvas has no pages: it becomes one canvas page holding everything where
    // it was drawn, as Rnote shows it (and it keeps growing in NoteComplete).
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for b in things.iter().map(|t| t.bounds()) {
        x0 = x0.min(b[0]);
        y0 = y0.min(b[1]);
        x1 = x1.max(b[0] + b[2]);
        y1 = y1.max(b[1] + b[3]);
    }
    if x0 > x1 {
        return vec![[area[0], area[1], fw, fh]];
    }
    let margin = 48.;
    vec![[
        x0 - margin,
        y0 - margin,
        (x1 - x0 + 2. * margin).max(fw),
        (y1 - y0 + 2. * margin).max(fh),
    ]]
}

/// A vector picture: where it was drawn, its SVG, and the size its own coordinates span.
type VectorPicture = ([f64; 4], String, [f64; 2]);

/// Whether the note is an infinite canvas (one growing page in NoteComplete).
fn is_canvas(doc: &Value) -> bool {
    matches!(
        doc["config"]["layout"].as_str().unwrap_or("infinite"),
        "infinite" | "semi_infinite"
    )
}

/// The vector pictures of one page as one SVG in page pixels (a page has one PDF
/// background), on the canvas colour.
fn vectors_svg(frame: [f64; 4], background: [f32; 4], pictures: &[VectorPicture]) -> String {
    let c = |v: f32| (v.clamp(0., 1.) * 255.).round() as u8;
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="rgb({r},{g},{b})"/>"#,
        w = frame[2],
        h = frame[3],
        r = c(background[0]),
        g = c(background[1]),
        b = c(background[2]),
    );
    for (rect, inner, size) in pictures {
        // The picture's own <svg> (its XML declaration dropped), fitted to where it was drawn.
        let inner = match inner.find("<svg") {
            Some(at) => &inner[at..],
            None => continue,
        };
        svg.push_str(&format!(
            r#"<svg x="{}" y="{}" width="{}" height="{}" viewBox="0 0 {} {}" preserveAspectRatio="none">{inner}</svg>"#,
            rect[0] - frame[0],
            rect[1] - frame[1],
            rect[2],
            rect[3],
            size[0].max(1.),
            size[1].max(1.),
        ));
    }
    svg.push_str("</svg>");
    svg
}

/// The pages of an Rnote note, in PDF points, for `build_bytes` (scale: Noteful units per point).
/// The pages, and whether they are infinite canvases.
pub fn pages(
    bytes: &[u8],
    warn: &mut dyn FnMut(&'static str),
) -> Result<(Document, Vec<Page>, bool), String> {
    let mut json = Vec::new();
    GzDecoder::new(bytes)
        .read_to_end(&mut json)
        .map_err(|e| format!("Rnote: {e}"))?;
    let root: Value = serde_json::from_slice(&json).map_err(|e| format!("Rnote: {e}"))?;
    drop(json);
    let es = root["data"]
        .get("engine_snapshot")
        .or(root.get("engine_snapshot"))
        .ok_or("Rnote: no engine snapshot")?;
    let doc_v = &es["document"];
    let dpi = doc_v["config"]["format"]["dpi"]
        .as_f64()
        .filter(|d| *d > 1.)
        .unwrap_or(96.);
    let pt = 72. / dpi;
    let things = things(es, warn);
    let frames = frames(doc_v, &things);
    let canvas_colour = color(&doc_v["config"]["background"]["color"]).unwrap_or([1., 1., 1., 1.]);
    let background = Some(canvas_colour).filter(|c| c[0] < 0.98 || c[1] < 0.98 || c[2] < 0.98);
    let mut vectors: Vec<Vec<VectorPicture>> = vec![Vec::new(); frames.len()];
    let mut doc = Document::empty();
    let mut pages: Vec<Page> = frames
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let mut page = Page::new(format!("rnote-{i}"), Vec::new());
            page.width = (f[2] * pt) as f32;
            page.height = (f[3] * pt) as f32;
            if let Some(c) = background {
                page.items.push(Item::Background(Background {
                    rects: vec![(0., 0., page.width, page.height, [c[0], c[1], c[2]])],
                }));
            }
            page
        })
        .collect();
    let centre = |b: [f64; 4]| [b[0] + b[2] / 2., b[1] + b[3] / 2.];
    let frame_of = |p: [f64; 2]| {
        frames
            .iter()
            .position(|f| p[0] >= f[0] && p[0] < f[0] + f[2] && p[1] >= f[1] && p[1] < f[1] + f[3])
            .or_else(|| {
                // Nearest frame for things just past every edge.
                frames
                    .iter()
                    .enumerate()
                    .min_by(|a, b| {
                        let d = |f: &[f64; 4]| (centre(*f)[0] - p[0]).hypot(centre(*f)[1] - p[1]);
                        d(a.1).total_cmp(&d(b.1))
                    })
                    .map(|(i, _)| i)
            })
    };
    for (n, thing) in things.into_iter().enumerate() {
        let Some(i) = frame_of(centre(thing.bounds())) else {
            continue;
        };
        let f = frames[i];
        let at = |p: [f64; 2]| [((p[0] - f[0]) * pt) as f32, ((p[1] - f[1]) * pt) as f32];
        let page = &mut pages[i];
        match thing {
            Thing::Line {
                points,
                width,
                rgba,
                fill,
                head,
            } => {
                let pts: Vec<[f32; 2]> = points.iter().map(|p| at(*p)).collect();
                if let Some(fill) = fill {
                    page.items.push(Item::FillPath(FillPathEl {
                        contours: vec![pts.clone()],
                        rgba: fill,
                    }));
                }
                if let Some(h) = head {
                    page.items.push(Item::Path(PathEl {
                        points: pts,
                        head: Some(h.map(at)),
                        width: (width * pt) as f32,
                        rgba,
                    }));
                } else if rgba[3] > 0.004 {
                    page.items.push(Item::Stroke(Stroke {
                        points: pts,
                        width: (width * pt).max(0.2) as f32,
                        rgba,
                        dash: None,
                        parented: false,
                    }));
                }
            }
            Thing::Text {
                at: p,
                size,
                text,
                rgb,
                bold,
            } => {
                let [x, y] = at(p);
                let size = (size * pt) as f32;
                page.items.push(Item::Text(TextBox {
                    x,
                    y: y + size,
                    size,
                    text,
                    font: None,
                    rgb,
                    bold,
                }));
            }
            Thing::Picture { rect, data } => {
                let key = format!("rnote-picture-{n}");
                doc.insert_attachment(key.clone(), data);
                let [x, y] = at([rect[0], rect[1]]);
                page.items.push(Item::Image(ImageEl {
                    attachment: key,
                    x,
                    y,
                    w: (rect[2] * pt) as f32,
                    h: (rect[3] * pt) as f32,
                    from_frame: false,
                    bytes: None,
                }));
            }
            Thing::Vector { rect, svg, size } => vectors[i].push((rect, svg, size)),
        }
    }
    // Each page's vector pictures (PDF pages Rnote imported) become its PDF background.
    for (i, pictures) in vectors.into_iter().enumerate() {
        if pictures.is_empty() {
            continue;
        }
        let Some(pdf) = svg_pdf(&vectors_svg(frames[i], canvas_colour, &pictures)) else {
            warn("Rnote vector pictures that could not be read left out");
            continue;
        };
        let key = format!("rnote-vectors-{i}.pdf");
        doc.insert_attachment(key.clone(), pdf);
        let page = &mut pages[i];
        let (w, h) = (page.width, page.height);
        page.items.insert(
            0,
            Item::PdfBackground(PdfBgEl {
                attachment: key,
                pdf_page: 1,
                x: 0.,
                y: 0.,
                w,
                h,
                src_w: w,
                src_h: h,
            }),
        );
    }
    Ok((doc, pages, is_canvas(doc_v)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    pub(crate) fn sample() -> Vec<u8> {
        let json = serde_json::json!({"version":"0.13.1","data":{"engine_snapshot":{
            "document":{"config":{"format":{"width":800.0,"height":1000.0,"dpi":96.0},"background":{"color":{"r":0.0,"g":0.0,"b":0.0,"a":1.0}},"layout":"infinite"},"x":0.0,"y":0.0,"width":800.0,"height":1000.0},
            "stroke_components":[
                {"value":{"brushstroke":{"path":{"start":{"pos":[100.0,100.0],"pressure":0.5},"segments":[{"lineto":{"end":{"pos":[200.0,120.0],"pressure":0.5}}},{"quadbezto":{"cp":[250.0,150.0],"end":{"pos":[300.0,100.0],"pressure":0.5}}}]},
                    "style":{"smooth":{"stroke_width":4.0,"stroke_color":{"r":1.0,"g":0.5,"b":0.5,"a":1.0},"pressure_curve":"linear"}}}}},
                {"value":{"shapestroke":{"shape":{"rect":{"cuboid":{"half_extents":[50.0,20.0]},"transform":{"affine":[1.0,0.0,0.0,0.0,1.0,0.0,400.0,400.0,1.0]}}},
                    "style":{"smooth":{"stroke_width":2.0,"stroke_color":{"r":0.0,"g":0.0,"b":1.0,"a":1.0},"fill_color":{"r":0.0,"g":0.0,"b":0.0,"a":0.0}}}}}},
                {"value":{"textstroke":{"text":"Hola","transform":{"affine":[1.0,0.0,0.0,0.0,1.0,0.0,100.0,600.0,1.0]},"text_style":{"font_size":32.0,"color":{"r":1.0,"g":1.0,"b":1.0,"a":1.0}}}}},
                {"value":{"brushstroke":{"path":{"start":{"pos":[100.0,2600.0],"pressure":0.5},"segments":[{"lineto":{"end":{"pos":[180.0,2650.0],"pressure":0.5}}}]},"style":{"smooth":{"stroke_width":2.0,"stroke_color":{"r":1.0,"g":1.0,"b":1.0,"a":1.0}}}}}},
                {"value":null}
            ],
            "chrono_components":[{"value":{"t":1,"layer":{"user_layer":0}}},{"value":{"t":2,"layer":{"user_layer":0}}},{"value":{"t":3,"layer":{"user_layer":0}}},{"value":{"t":4,"layer":{"user_layer":0}}},{"value":null}]
        }}});
        let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
        gz.write_all(json.to_string().as_bytes()).unwrap();
        gz.finish().unwrap()
    }

    #[test]
    fn an_infinite_canvas_is_one_canvas_page_with_everything_in_place() {
        let bytes = sample();
        assert!(is_rnote(&bytes));
        assert!(!is_rnote(b"\x1f\x8b not gzip"));
        let mut warnings = Vec::new();
        let (_, pages, canvas) = pages(&bytes, &mut |w| warnings.push(w)).unwrap();
        // Nothing is cut: the far stroke stays on the same canvas, below the rest.
        assert!(canvas);
        assert_eq!(pages.len(), 1, "{warnings:?}");
        let first = &pages[0];
        // Content from x 100 to 400+50, y 100 to 2650, plus a 48 px margin, at least the format.
        assert_eq!(first.width, 600.);
        assert_eq!(first.height, ((2650. - 100. + 96.) * 0.75) as f32);
        assert!(
            matches!(first.items[0], Item::Background(_)),
            "black canvas becomes the page colour"
        );
        let strokes: Vec<&Stroke> = first
            .items
            .iter()
            .filter_map(|i| {
                if let Item::Stroke(s) = i {
                    Some(s)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(strokes.len(), 3, "pen strokes and rectangle outline");
        // (100, 100) drawn, 48 px (the margin) from the canvas page's corner: 36 pt.
        assert_eq!(strokes[0].points[0], [36., 36.]);
        assert!(first
            .items
            .iter()
            .any(|i| matches!(i, Item::Text(t) if t.text == "Hola")));
    }
}
