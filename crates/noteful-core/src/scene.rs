//! Owned scene and SVG renderer. No platform APIs or reference PDF pixels.
use crate::{Error, Field, Package, Result, Stroke, WireValue};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub struct Scene {
    pub title: String,
    pub pages: Vec<Page>,
    pub audio: Vec<crate::AudioAsset>,
    pub recordings: Vec<crate::Recording>,
    pub layers: Vec<crate::Layer>,
    pub(crate) pdf_assets: Vec<crate::media::PdfAsset>,
}
pub struct Page {
    pub id: String,
    pub size: [f64; 2],
    pub warnings: Vec<String>,
    pub pdf_background: Option<crate::PdfBackground>,
    pub timings: Vec<crate::InkTiming>,
    pub(crate) background: String,
    pub(crate) editable_id: String,
    pub(crate) items: Vec<Item>,
}
pub(crate) struct Item {
    pub stroke: Option<Stroke>,
    pub object: Option<Value>,
    pub bounds: [f64; 4],
    pub id: String,
    pub svg: String,
    pub hit: Vec<[f64; 2]>,
    pub radius: f64,
    pub z: u64,
    pub layer: u32,
    pub text: Option<crate::RichText>,
}
impl Item {
    pub(crate) fn hit_points(&self) -> &[[f64; 2]] {
        self.stroke
            .as_ref()
            .map(|s| s.points.as_slice())
            .unwrap_or(&self.hit)
    }
}
fn fields(fs: &[Field]) -> Value {
    Value::Object(
        fs.iter()
            .map(|f| (f.tag.to_string(), value(&f.value)))
            .collect(),
    )
}
fn value(v: &WireValue) -> Value {
    match v {
        WireValue::Fields(fs) => fields(fs),
        WireValue::Array(a) => a.iter().map(value).collect(),
        WireValue::UInt(n) => json!(n),
        WireValue::Float(n) => json!(n),
        WireValue::Pair(p) => json!(p),
        WireValue::Rect(p) => json!(p),
        WireValue::Text(s) => json!(s),
        WireValue::Blob { .. } => Value::Null,
    }
}
fn arr(v: &Value) -> &[Value] {
    v.as_array().map_or(&[], |v| v)
}
fn num(v: &Value, default: f64) -> f64 {
    v.as_f64().unwrap_or(default)
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn floats<const N: usize>(v: &Value) -> Result<[f64; N]> {
    let a = arr(v);
    if a.len() != N {
        return Err(Error::new(0, "Invalid scene vector"));
    }
    let mut out = [0.; N];
    for (dst, src) in out.iter_mut().zip(a) {
        *dst = src
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or_else(|| Error::new(0, "Invalid scene number"))?;
    }
    Ok(out)
}
pub(crate) fn color(c: &[f64; 4]) -> String {
    format!(
        "rgb({},{},{})",
        (c[0].clamp(0., 1.) * 255.).round(),
        (c[1].clamp(0., 1.) * 255.).round(),
        (c[2].clamp(0., 1.) * 255.).round()
    )
}
fn composite(el: String, opacity: f64, tool: u64) -> Result<String> {
    if tool > 1 || !(0.0..=1.0).contains(&opacity) {
        return Err(Error::new(0, "Unsupported tool or opacity"));
    }
    Ok(format!(
        "<g opacity=\"{}\"{}>{el}</g>",
        opacity * if tool == 1 { 0.5 } else { 1. },
        if tool == 1 {
            " style=\"mix-blend-mode:multiply\""
        } else {
            ""
        }
    ))
}
pub(crate) fn line_svg(points: &[[f64; 2]], radius: f64, rgba: &[f64; 4]) -> String {
    if points.len() == 1 {
        return format!(
            "<circle cx=\"{}\" cy=\"{}\" r=\"{radius}\" fill=\"{}\" opacity=\"{}\"/>",
            points[0][0],
            points[0][1],
            color(rgba),
            rgba[3]
        );
    }
    let p = points
        .iter()
        .map(|p| format!("{:.5},{:.5}", p[0], p[1]))
        .collect::<Vec<_>>()
        .join(" ");
    format!("<polyline points=\"{p}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"{}\"/>",color(rgba),radius*2.,rgba[3])
}
pub(crate) fn stroke_svg(s: &Stroke) -> Result<String> {
    if s.radius < 0. || s.radii.iter().any(|r| *r < 0.) {
        return Err(Error::new(0, "Negative ink radius"));
    }
    let mut rgba = s.style.rgba;
    rgba[3] = 1.;
    // Partially erased strokes draw only their remaining runs.
    let el: String = s
        .visible_runs()
        .iter()
        .map(|(points, radii)| run_svg(points, radii, s.radius, &rgba))
        .collect();
    composite(el, s.style.rgba[3], u64::from(s.style.tool))
}
fn run_svg(points: &[[f64; 2]], radii: &[f64], radius: f64, rgba: &[f64; 4]) -> String {
    if radii.is_empty() {
        line_svg(points, radius, rgba)
    } else {
        let mut parts = String::new();
        for (p, r) in points.iter().zip(radii) {
            parts.push_str(&format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"{r}\"/>",
                p[0], p[1]
            ));
        }
        for (pp, rr) in points.windows(2).zip(radii.windows(2)) {
            let dx = pp[1][0] - pp[0][0];
            let dy = pp[1][1] - pp[0][1];
            let d = dx.hypot(dy);
            if d < 1e-9 || d <= (rr[1] - rr[0]).abs() {
                continue;
            }
            let (ux, uy, k) = (dx / d, dy / d, (rr[0] - rr[1]) / d);
            let q = (1. - k * k).max(0.).sqrt();
            let (ax, ay, bx, by) = (
                k * ux - q * uy,
                k * uy + q * ux,
                k * ux + q * uy,
                k * uy - q * ux,
            );
            parts.push_str(&format!(
                "<polygon points=\"{},{} {},{} {},{} {},{}\"/>",
                pp[0][0] + rr[0] * ax,
                pp[0][1] + rr[0] * ay,
                pp[1][0] + rr[1] * ax,
                pp[1][1] + rr[1] * ay,
                pp[1][0] + rr[1] * bx,
                pp[1][1] + rr[1] * by,
                pp[0][0] + rr[0] * bx,
                pp[0][1] + rr[0] * by
            ));
        }
        format!("<g fill=\"{}\">{parts}</g>", color(rgba))
    }
}
pub(crate) fn object(o: &Value, package: Option<&Package<'_>>, index: usize) -> Result<Item> {
    let p = &o["6"];
    let kind = p["1"].as_u64().unwrap_or(0);
    let [x, y, w, h, a] = floats::<5>(&o["2"]["1"])?;
    let [sw, sh] = floats::<2>(&p["2"])?;
    let mut hit = Vec::new();
    let mut radius = 0.;
    let mut rich_text = None;
    let el = if kind == 1 {
        let id = text(&p["10"]);
        let package = package.ok_or_else(|| Error::new(0, "Missing image package"))?;
        let b = package
            .blocks
            .iter()
            .find(|b| b.id == id)
            .ok_or_else(|| Error::new(0, "Missing image"))?;
        let mime = match b.kind {
            "jpeg" => "image/jpeg",
            "png" => "image/png",
            _ => return Err(Error::new(0, "Unsupported image")),
        };
        format!("<image width=\"{w}\" height=\"{h}\" preserveAspectRatio=\"none\" href=\"data:{mime};base64,{}\"/>",STANDARD.encode(package.resource(id).ok_or_else(||Error::new(0,"Missing image bytes"))?))
    } else if kind == 2 {
        let parsed = crate::decode_rich_text(&p["4"]);
        let sx = if sw.abs() > 1e-9 { w / sw } else { 1. };
        let sy = if sh.abs() > 1e-9 { h / sh } else { 1. };
        let svg = format!(
            "<g transform=\"scale({sx} {sy})\">{}</g>",
            crate::text_svg(&parsed, sw)
        );
        rich_text = Some(parsed);
        svg
    } else {
        let st = &p["7"];
        let rgba = if st["7"]["0"].is_null() {
            [0., 0., 0., 1.]
        } else {
            floats::<4>(&st["7"]["0"])?
        };
        let width = num(&st["2"], 0.);
        let fill = if p["5"]["1"]["0"].is_null() {
            "fill=\"none\"".to_owned()
        } else {
            let c = floats::<4>(&p["5"]["1"]["0"])?;
            format!("fill=\"{}\" fill-opacity=\"{}\"", color(&c), c[3])
        };
        let attrs=format!("stroke=\"{}\" stroke-opacity=\"{}\" stroke-width=\"{width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\" {fill}",color(&rgba),rgba[3]);
        let sx = if sw.abs() > 1e-9 { w / sw } else { 1. };
        let sy = if sh.abs() > 1e-9 { h / sh } else { 1. };
        let geometry = if !p["13"].is_null() {
            let coords = arr(&p["13"]["1"]);
            let mut cursor = 0;
            let mut path = String::new();
            for cmd in arr(&p["13"]["2"]) {
                let (letter, n) = match cmd.as_u64() {
                    Some(0) => ("M", 2),
                    Some(1) => ("L", 2),
                    Some(3) => ("C", 6),
                    Some(4) => ("Z", 0),
                    _ => return Err(Error::new(0, "Unsupported path command")),
                };
                if cursor + n > coords.len() {
                    return Err(Error::new(0, "Truncated path"));
                }
                path.push_str(letter);
                for v in &coords[cursor..cursor + n] {
                    path.push_str(&format!("{} ", num(v, 0.)));
                }
                if kind == 20 && n == 2 {
                    let px = num(&coords[cursor], 0.) * sx - w / 2.;
                    let py = num(&coords[cursor + 1], 0.) * sy - h / 2.;
                    hit.push([
                        x + px * a.cos() - py * a.sin(),
                        y + px * a.sin() + py * a.cos(),
                    ]);
                }
                cursor += n;
            }
            if cursor != coords.len() {
                return Err(Error::new(0, "Unconsumed path coordinates"));
            }
            format!("<path d=\"{path}\" {attrs}/>")
        } else if kind == 6 {
            format!(
                "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" {attrs}/>",
                sw / 2.,
                sh / 2.,
                sw / 2.,
                sh / 2.
            )
        } else if kind == 3 {
            format!(
                "<rect width=\"{sw}\" height=\"{sh}\" rx=\"{}\" {attrs}/>",
                num(&p["20"], 0.)
            )
        } else {
            return Err(Error::new(0, format!("Unsupported object type {kind}")));
        };
        radius = width / 2. * sx.abs().max(sy.abs());
        format!("<g transform=\"scale({sx} {sy})\">{geometry}</g>")
    };
    let svg = composite(
        format!(
            "<g transform=\"translate({x} {y}) rotate({}) translate({} {})\">{el}</g>",
            a.to_degrees(),
            -w / 2.,
            -h / 2.
        ),
        num(&o["8"], 1.),
        o["9"].as_u64().unwrap_or(0),
    )?;
    Ok(Item {
        id: format!("object:{index}"),
        stroke: None,
        object: Some(o.clone()),
        bounds: [x - w / 2., y - h / 2., w, h],
        svg,
        hit,
        radius,
        z: o["5"].as_u64().unwrap_or(0),
        text: rich_text,
        layer: o["4"].as_u64().unwrap_or(0) as u32,
    })
}
impl Scene {
    pub fn parse(data: &[u8]) -> Result<Self> {
        let package = Package::parse(data)?;
        let audio = package
            .blocks
            .iter()
            .filter_map(|b| {
                crate::audio_mime(b.kind).map(|mime| crate::AudioAsset {
                    id: b.id.clone(),
                    kind: b.kind.to_owned(),
                    mime,
                    bytes: b.size,
                    offset: b.offset,
                })
            })
            .collect();
        let pdf_assets = package
            .blocks
            .iter()
            .filter(|b| b.kind == "pdf")
            .map(|b| crate::media::PdfAsset {
                id: b.id.clone(),
                offset: b.offset,
                bytes: b.size,
            })
            .collect();
        let mut recordings = Vec::new();
        let mut layers = Vec::new();
        let mut title = String::new();
        let mut records = Vec::new();
        for b in &package.blocks {
            if let Some(fs) = &b.fields {
                let v = fields(fs);
                if b.kind == "note_metadata" {
                    title = text(&v["3"]).to_owned();
                }
                if b.kind == "drawing_metadata" {
                    records.extend(arr(&v["2"]["0"]).iter().cloned());
                    let mut layer_records = arr(&v["3"]["0"]).to_vec();
                    layer_records.sort_by(|a, b| text(&a["3"]).cmp(text(&b["3"])));
                    for l in layer_records {
                        layers.push(crate::Layer {
                            id: l["2"].as_u64().unwrap_or(0) as u32,
                            name: text(&l["1"]).to_owned(),
                            visible: l["4"].as_u64().unwrap_or(0) == 0,
                            locked: l["5"].as_u64().unwrap_or(0) != 0,
                            opacity: num(&l["6"], 1.).clamp(0., 1.),
                        });
                    }
                    for r in arr(&v["7"]["0"]) {
                        if let (Some(start), Some(duration)) = (r["5"].as_u64(), r["6"].as_f64()) {
                            if duration.is_finite() && duration >= 0. {
                                recordings.push(crate::Recording {
                                    id: text(&r["1"]).to_owned(),
                                    name: text(&r["2"]).to_owned(),
                                    asset_id: text(&r["3"]).to_owned(),
                                    start_us: start.to_string(),
                                    duration,
                                    pages: Vec::new(),
                                });
                            }
                        }
                    }
                }
            }
        }
        records.sort_by(|a, b| text(&a["5"]).cmp(text(&b["5"])));
        let mut pages = Vec::new();
        for record in records {
            let size = floats::<2>(&record["4"]["1"])?;
            if size.iter().any(|v| *v <= 0. || *v > 1e6) {
                return Err(Error::new(0, "Invalid page size"));
            }
            let mut warnings = Vec::new();
            let bg = &record["4"];
            let (pdf_id, pdf_page) = if bg["0"].as_u64() == Some(1) {
                (text(&bg["4"]), bg["3"].as_u64().unwrap_or(0))
            } else {
                (text(&bg["3"]), bg["7"].as_u64().unwrap_or(0))
            };
            let pdf_background = package
                .blocks
                .iter()
                .find(|b| b.id == pdf_id && b.kind == "pdf")
                .map(|_| crate::PdfBackground {
                    resource_id: pdf_id.to_owned(),
                    page_index: pdf_page,
                    rect: floats::<4>(&bg["9"])
                        .ok()
                        .filter(|r| r.iter().all(|v| v.abs() <= 1e6) && r[2] > 0. && r[3] > 0.)
                        .unwrap_or([0., 0., size[0], size[1]]),
                });
            let mut timings = Vec::new();
            let paper: Value = serde_json::from_str(text(&record["4"]["6"])).unwrap_or(Value::Null);
            let mut background = format!(
                "<rect width=\"100%\" height=\"100%\" fill=\"#{:06x}\"/>",
                paper["pc"].as_u64().unwrap_or(0xffffff) & 0xffffff
            );
            if matches!(paper["lt"].as_u64(), Some(1 | 2)) {
                let gap = num(&paper["lh"], 24.) * 11. / 6.;
                let width = num(&paper["lw"], 0.5) * 11. / 6.;
                if gap > 0. && gap.is_finite() && width >= 0. && width.is_finite() {
                    let vertical = if paper["lt"] == 2 {
                        format!(" M {gap} 0 L {gap} {gap}")
                    } else {
                        String::new()
                    };
                    background.push_str(&format!("<defs><pattern id=\"paper\" width=\"{gap}\" height=\"{gap}\" patternUnits=\"userSpaceOnUse\"><path d=\"M 0 {gap} L {gap} {gap}{vertical}\" fill=\"none\" stroke=\"#9a9888\" stroke-width=\"{width}\"/></pattern></defs><rect width=\"100%\" height=\"100%\" fill=\"url(#paper)\"/>"));
                }
            }
            if paper.is_null() && pdf_background.is_none() {
                warnings.push("PDF background resource not found.".to_owned());
            }
            background = format!("<g data-background=\"true\">{background}</g>");
            let id = text(&record["2"]["0"]);
            let mut items = Vec::new();
            if let Some(b) = package.blocks.iter().find(|b| b.id == id) {
                if let Some(err) = &b.stroke_error {
                    warnings.push(err.to_string());
                }
                for (i, s) in b.strokes.iter().flatten().enumerate() {
                    let end = u64::from_be_bytes(s.header[10..18].try_into().unwrap());
                    let start = u64::from_be_bytes(s.header[18..26].try_into().unwrap());
                    for recording in &mut recordings {
                        let base: u64 = recording.start_us.parse().unwrap();
                        // A trace belongs to a recording only if pen-down falls in its interval.
                        if start >= base && end >= start {
                            let relative = (start - base) as f64 / 1e6;
                            if relative <= recording.duration {
                                timings.push(crate::InkTiming {
                                    item_id: format!("stroke:{i}"),
                                    recording_id: recording.id.clone(),
                                    start: relative,
                                    end: (end - base) as f64 / 1e6,
                                });
                                if !recording.pages.contains(&pages.len()) {
                                    recording.pages.push(pages.len());
                                }
                            }
                        }
                    }
                    match stroke_svg(s) {
                        Ok(svg) => items.push(Item {
                            id: format!("stroke:{i}"),
                            stroke: Some(Stroke {
                                bounds: Vec::new(),
                                quantized: Vec::new(),
                                auxiliary: Vec::new(),
                                ..s.clone()
                            }),
                            object: None,
                            bounds: crate::manipulation::bounds(&s.points),
                            svg,
                            hit: Vec::new(),
                            radius: s.radii.iter().copied().fold(s.radius, f64::max),
                            z: s.z_order,
                            layer: s.layer,
                            text: None,
                        }),
                        Err(e) => warnings.push(e.to_string()),
                    }
                }
                if let Some(fs) = &b.fields {
                    for (i, o) in arr(&fields(fs)["5"]["0"]).iter().enumerate() {
                        // Kind 23 groups flag-0x10 strokes, which already render as ink;
                        // it has no drawable payload and stays untouched for export.
                        if o["6"]["1"].as_u64() == Some(23) {
                            continue;
                        }
                        match object(o, Some(&package), i) {
                            Ok(item) => {
                                if let Some(text) = &item.text {
                                    warnings.extend(text.warnings.iter().cloned());
                                }
                                items.push(item);
                            }
                            Err(e) => warnings.push(e.to_string()),
                        }
                    }
                }
            }
            items.sort_by_key(|i| i.z);
            pages.push(Page {
                id: text(&record["1"]).to_owned(),
                size,
                background,
                editable_id: id.to_owned(),
                pdf_background,
                timings,
                items,
                warnings,
            });
        }
        if layers.is_empty() {
            layers.push(crate::Layer::default());
        }
        for page in &pages {
            for item in &page.items {
                if !layers.iter().any(|l| l.id == item.layer) {
                    layers.push(crate::Layer {
                        id: item.layer,
                        name: format!("Layer {}", item.layer + 1),
                        ..Default::default()
                    });
                }
            }
        }
        Ok(Self {
            title,
            pages,
            audio,
            recordings,
            layers,
            pdf_assets,
        })
    }
}
