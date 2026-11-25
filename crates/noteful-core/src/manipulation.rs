//! Absolute adjustments relative to immutable item geometry. One history entry per gesture.
use crate::{
    editor::{edit_index, Edit},
    scene::Item,
    Editor, Error, Line, Result, Stroke,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Adjustment {
    pub translation: [f64; 2],
    pub scale: [f64; 2],
    pub rotation: f64,
    pub width: Option<f64>,
    pub rgba: Option<[f64; 4]>,
    /// Lock in place, set by the Lock tool. `None` keeps the item's own state
    /// (Noteful's payload tag 21 for objects, unlocked otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// Images only: the visible part, `[x0, y0, x1, y1]` in the image's native size
    /// (payload tag 2), as Noteful's crop outline (payload tag 12). Set by `crop_item`,
    /// which also moves and scales the item so its box is the visible part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<[f64; 4]>,
    /// Closed drawn shapes only: their inside colour (RGBA 0–1). An alpha of 0 takes
    /// the fill away, leaving the outline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<[f64; 4]>,
    /// Its place in its layer's stack, set by Bring to front, Send to back and the steps
    /// between: `[band, value]` as `stack_place` gives (`None` keeps the place it was
    /// made in). Moves and restyles keep it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<[f64; 2]>,
    /// Undo and redo this edit together with the one before it (moving a group of
    /// items is one adjustment per item, undone as one). Not part of the item's state.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub joined: bool,
}
impl Default for Adjustment {
    fn default() -> Self {
        Self {
            translation: [0., 0.],
            scale: [1., 1.],
            rotation: 0.,
            width: None,
            rgba: None,
            locked: None,
            crop: None,
            fill: None,
            z: None,
            joined: false,
        }
    }
}
#[derive(Clone)]
pub(crate) struct Geometry {
    pub bounds: [f64; 4],
    pub rotation: f64,
    pub width: f64,
    pub rgba: [f64; 4],
    pub styled: bool,
    pub kind: &'static str,
}
pub(crate) fn bounds(points: &[[f64; 2]]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in points {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    if points.is_empty() {
        return [0.; 4];
    };
    [b[0], b[1], b[2] - b[0], b[3] - b[1]]
}
/// Visual bounding box of a stroke ribbon, including perpendicular thickness and caps.
pub(crate) fn stroke_ribbon_bounds(points: &[[f64; 2]], width: f64, square_ends: bool) -> [f64; 4] {
    if points.is_empty() {
        return [0.; 4];
    }
    let r = (width / 2.).max(0.);
    if points.len() == 1 {
        let p = points[0];
        return [p[0] - r, p[1] - r, 2. * r, 2. * r];
    }
    if !square_ends {
        let [x, y, w, h] = bounds(points);
        return [x - r, y - r, w + 2. * r, h + 2. * r];
    }
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    let mut expand = |x: f64, y: f64| {
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    };
    for seg in points.windows(2) {
        let (a, c) = (seg[0], seg[1]);
        let (dx, dy) = (c[0] - a[0], c[1] - a[1]);
        let len = dx.hypot(dy);
        if len > 1e-9 {
            let (ox, oy) = (-dy / len * r, dx / len * r);
            expand(a[0] + ox, a[1] + oy);
            expand(a[0] - ox, a[1] - oy);
            expand(c[0] + ox, c[1] + oy);
            expand(c[0] - ox, c[1] - oy);
        } else {
            expand(a[0] - r, a[1] - r);
            expand(a[0] + r, a[1] + r);
        }
    }
    [b[0], b[1], b[2] - b[0], b[3] - b[1]]
}
pub(crate) fn line_geometry(line: &Line) -> Geometry {
    let mut b = if line.tool == 2 || line.square {
        stroke_ribbon_bounds(&line.points, line.width, true)
    } else {
        bounds(&line.points)
    };
    if line.shape.is_some() && !line.points.is_empty() && (b[2] < line.width || b[3] < line.width) {
        b = stroke_ribbon_bounds(&line.points, line.width, false);
    }
    Geometry {
        bounds: b,
        rotation: 0.,
        width: line.width,
        rgba: line.rgba,
        styled: true,
        kind: if line.shape.is_some() { "shape" } else { "ink" },
    }
}
pub(crate) fn item_geometry(item: &Item) -> Geometry {
    if let Some(o) = &item.object {
        let b = o["2"]["1"].as_array().unwrap();
        let v = |i: usize| b[i].as_f64().unwrap_or(0.);
        let kind = o["6"]["1"].as_u64().unwrap_or(0);
        let rgba =
            serde_json::from_value(o["6"]["7"]["7"]["0"].clone()).unwrap_or([0., 0., 0., 1.]);
        Geometry {
            bounds: [v(0) - v(2) / 2., v(1) - v(3) / 2., v(2), v(3)],
            rotation: v(4).to_degrees(),
            width: item.radius * 2.,
            rgba,
            styled: !matches!(kind, 1 | 2),
            kind: match kind {
                1 => "image",
                2 => "text",
                _ => "shape",
            },
        }
    } else {
        let s = item.stroke.as_ref().unwrap();
        let b = if s.style.tool == 2 {
            crate::view::imported_tape_bounds(item)
        } else {
            let [x, y, w, h] = item.bounds;
            if w == 0. || h == 0. {
                let r = s.radius.max(0.);
                [x - r, y - r, w + 2. * r, h + 2. * r]
            } else {
                item.bounds
            }
        };
        Geometry {
            bounds: b,
            rotation: 0.,
            width: s.radius * 2.,
            rgba: s.style.rgba,
            styled: true,
            kind: "ink",
        }
    }
}
/// Bands of a layer's stack, bottom to top: additions under the ink (highlighter fills,
/// sticky note cards), the page's own imported items, then the pictures, text boxes and ink
/// added over the ink. Within a band an addition's value is its edit's place in the
/// history (so later ones are higher) and an imported item's its place in the page.
pub(crate) const UNDER: f64 = 0.;
pub(crate) const IMPORTED: f64 = 1.;
pub(crate) const OVER: f64 = 2.;
/// Where an item is drawn in its layer: the place Bring to front and the like gave it,
/// else `made`, the one it was made in.
pub(crate) fn stack_place(made: [f64; 2], a: Option<&Adjustment>) -> [f64; 2] {
    a.and_then(|a| a.z).unwrap_or(made)
}
/// Sorts `(place, made, entry)` bottom to top; equal places keep the order they were made in.
pub(crate) fn sort_stack<T>(entries: &mut [([f64; 2], [f64; 2], T)]) {
    let cmp = |a: [f64; 2], b: [f64; 2]| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1]));
    entries.sort_by(|a, b| cmp(a.0, b.0).then(cmp(a.1, b.1)));
}
/// `(place, made, (id, item))`, as `sort_stack` takes it.
type StackEntry<'a> = ([f64; 2], [f64; 2], (String, Stacked<'a>));
/// One item of a layer's stack.
pub(crate) enum Stacked<'a> {
    Line(&'a Line),
    Image(&'a crate::Image),
    Imported(&'a Item),
}
impl Adjustment {
    pub(crate) fn valid(&self) -> bool {
        self.translation
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 1e6)
            && self
                .scale
                .iter()
                .all(|n| n.is_finite() && (0.001..=1000.).contains(n))
            && self.rotation.is_finite()
            && self.rotation.abs() <= 36000.
            && self
                .width
                .is_none_or(|n| n.is_finite() && (0.1..=100.).contains(&n))
            && self
                .rgba
                .is_none_or(|c| c.iter().all(|n| n.is_finite() && (0.0..=1.).contains(n)))
            && self
                .crop
                .is_none_or(|c| c.iter().all(|n| n.is_finite()) && c[2] > c[0] && c[3] > c[1])
            && self
                .fill
                .is_none_or(|c| c.iter().all(|n| n.is_finite() && (0.0..=1.).contains(n)))
            && self
                .z
                .is_none_or(|z| z.iter().all(|n| n.is_finite()) && (0.0..=2.).contains(&z[0]))
    }
    pub(crate) fn matrix(&self, g: &Geometry) -> [f64; 6] {
        let old = g.rotation.to_radians();
        let angle = old + self.rotation.to_radians();
        let (s, c) = (angle.sin(), angle.cos());
        let (os, oc) = (old.sin(), old.cos());
        let [sx, sy] = self.scale;
        let (a, b, cc, d) = (
            c * sx * oc + s * sy * os,
            s * sx * oc - c * sy * os,
            c * sx * os - s * sy * oc,
            s * sx * os + c * sy * oc,
        );
        let [x, y, w, h] = g.bounds;
        let (x, y) = (x + w / 2., y + h / 2.);
        [
            a,
            b,
            cc,
            d,
            x + self.translation[0] - a * x - cc * y,
            y + self.translation[1] - b * x - d * y,
        ]
    }
}
fn point(m: [f64; 6], p: [f64; 2]) -> [f64; 2] {
    [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ]
}
pub(crate) fn adjusted_line(line: &Line, a: &Adjustment) -> Line {
    let m = a.matrix(&line_geometry(line));
    let mut line = line.clone();
    line.points = line.points.iter().map(|p| point(m, *p)).collect();
    if let Some(w) = a.width {
        // A ballpoint's pressure is its drawn radius: scale it with the width.
        if let Some(pressure) = &mut line.pressure {
            let factor = if line.width > 0. { w / line.width } else { 1. };
            for p in pressure.iter_mut() {
                *p = (*p * factor).clamp(0., 50.);
            }
        }
        line.width = w;
    }
    if let Some(c) = a.rgba {
        line.rgba = c;
    }
    if let (Some(f), Some(shape)) = (a.fill, line.shape.as_mut()) {
        if shape.closed() {
            shape.fill = (f[3] > 0.).then_some(f);
        }
    }
    line
}
pub(crate) fn adjusted_stroke(stroke: &Stroke, a: &Adjustment) -> Stroke {
    let g = Geometry {
        bounds: bounds(&stroke.points),
        rotation: 0.,
        width: stroke.radius * 2.,
        rgba: stroke.style.rgba,
        styled: true,
        kind: "ink",
    };
    let m = a.matrix(&g);
    let mut s = stroke.clone();
    s.points = s.points.iter().map(|p| point(m, *p)).collect();
    if let Some(w) = a.width {
        let factor = if s.radius > 0. {
            w / (2. * s.radius)
        } else {
            1.
        };
        s.radius = w / 2.;
        for r in &mut s.radii {
            *r *= factor;
        }
    }
    if let Some(c) = a.rgba {
        s.style.rgba = c;
    }
    s
}
pub(crate) fn adjusted_object(item: &Item, a: &Adjustment) -> Value {
    let mut o = item.object.clone().unwrap();
    let g = item_geometry(item);
    let b = o["2"]["1"].as_array_mut().unwrap();
    b[0] = json!(b[0].as_f64().unwrap() + a.translation[0]);
    b[1] = json!(b[1].as_f64().unwrap() + a.translation[1]);
    b[2] = json!(b[2].as_f64().unwrap() * a.scale[0]);
    b[3] = json!(b[3].as_f64().unwrap() * a.scale[1]);
    b[4] = json!(b[4].as_f64().unwrap() + a.rotation.to_radians());
    if g.styled {
        let sw = o["6"]["2"][0].as_f64().unwrap_or(1.).abs().max(1e-9);
        let sh = o["6"]["2"][1].as_f64().unwrap_or(1.).abs().max(1e-9);
        let factor = (g.bounds[2] * a.scale[0] / sw)
            .abs()
            .max((g.bounds[3] * a.scale[1] / sh).abs())
            .max(1e-9);
        o["6"]["7"]["2"] = json!(a.width.unwrap_or(g.width) / factor);
        if let Some(c) = a.rgba {
            o["6"]["7"]["7"]["0"] = json!(c);
        }
    }
    if let Some([x0, y0, x1, y1]) = a.crop {
        o["6"]["12"] = json!({"1": [x0, y0, x1, y0, x1, y1, x0, y1], "2": [0, 1, 1, 1, 4]});
    }
    o
}
/// An image's native size (payload tag 2) and its visible part: the crop outline's
/// bounds, or the whole image.
pub(crate) fn image_frame(o: &Value) -> ([f64; 2], [f64; 4]) {
    let sw = o["6"]["2"][0].as_f64().unwrap_or(1.);
    let sh = o["6"]["2"][1].as_f64().unwrap_or(1.);
    let coords: Vec<f64> = o["6"]["12"]["1"]
        .as_array()
        .map(|v| v.iter().filter_map(|n| n.as_f64()).collect())
        .unwrap_or_default();
    if coords.len() >= 4 {
        let (xs, ys) = (coords.iter().step_by(2), coords.iter().skip(1).step_by(2));
        let (x0, x1) = xs.fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
        let (y0, y1) = ys.fold((f64::MAX, f64::MIN), |(a, b), &y| (a.min(y), b.max(y)));
        if x1 > x0 && y1 > y0 {
            return ([sw, sh], [x0, y0, x1, y1]);
        }
    }
    ([sw, sh], [0., 0., sw, sh])
}
pub(crate) fn item_svg(item: &Item, a: Option<&Adjustment>) -> Result<String> {
    let Some(a) = a else {
        return Ok(item.svg.clone());
    };
    if let Some(s) = &item.stroke {
        return crate::scene::stroke_svg(&adjusted_stroke(s, a));
    }
    if item_geometry(item).kind == "image" && a.crop.is_some() {
        // A new crop changes which part of the image shows: draw it again from its bytes.
        let href = item
            .svg
            .split("href=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
            .ok_or_else(|| Error::new(0, "Image data missing"))?;
        return crate::scene::cropped_image(&adjusted_object(item, a), href);
    }
    if item_geometry(item).kind == "image" {
        let m = a.matrix(&item_geometry(item));
        return Ok(format!(
            "<g transform=\"matrix({} {} {} {} {} {})\">{}</g>",
            m[0], m[1], m[2], m[3], m[4], m[5], item.svg
        ));
    }
    Ok(crate::scene::object(&adjusted_object(item, a), None, 0)?.svg)
}
impl Editor {
    pub(crate) fn adjustments(&self, page: usize) -> HashMap<&str, &Adjustment> {
        let mut map = HashMap::new();
        for edit in &self.history[..self.cursor] {
            if let Edit::Adjust {
                page: p,
                id,
                adjustment,
                ..
            } = edit
            {
                if *p == page {
                    map.insert(id.as_str(), adjustment);
                }
            }
        }
        map
    }
    /// A drawn rectangle, ellipse, triangle or star: its fill as drawn (`Some(None)` for
    /// an outline), or `None` for anything else.
    fn closed_shape(&self, page: usize, id: &str) -> Option<Option<[f64; 4]>> {
        self.additions(page)
            .find(|(key, _)| key == id)
            .and_then(|(_, l)| l.shape.as_ref())
            .filter(|s| s.closed())
            .map(|s| s.fill)
    }
    fn geometry(&self, page: usize, id: &str) -> Result<Geometry> {
        if let Some(item) = self.page(page)?.items.iter().find(|i| i.id == id) {
            return Ok(item_geometry(item));
        }
        if let Some((key, image)) = self.images(page).find(|(key, _)| key == id) {
            return Ok(item_geometry(&image.item(key)));
        }
        self.additions(page)
            .find(|(key, _)| key == id)
            .map(|(_, l)| line_geometry(l))
            .ok_or_else(|| Error::new(0, "Item not found"))
    }
    /// Whether an item is locked in place: the Lock tool's choice, else the
    /// native lock of imported objects.
    pub(crate) fn is_locked(&self, page: usize, id: &str) -> bool {
        self.adjustments(page)
            .get(id)
            .and_then(|a| a.locked)
            .unwrap_or_else(|| {
                self.page(page)
                    .ok()
                    .and_then(|p| p.items.iter().find(|i| i.id == id))
                    .is_some_and(|i| i.locked())
            })
    }
    /// The layer of a live item, if that layer is visible and unlocked.
    fn item_layer(&self, page: usize, id: &str) -> Result<u32> {
        if self.deleted(page).contains(id) {
            return Err(Error::new(0, "Item was erased"));
        }
        let layer = self
            .page(page)?
            .items
            .iter()
            .find(|i| i.id == id)
            .map(|i| i.layer)
            .or_else(|| {
                self.additions(page)
                    .find(|(key, _)| key == id)
                    .map(|(_, l)| l.layer)
            })
            .or_else(|| {
                self.images(page)
                    .find(|(key, _)| key == id)
                    .map(|(_, image)| image.layer)
            })
            .ok_or_else(|| Error::new(0, "Item not found"))?;
        if !self
            .layers()
            .iter()
            .any(|l| l.id == layer && l.visible && !l.locked)
        {
            return Err(Error::new(0, "Layer is hidden or locked"));
        }
        Ok(layer)
    }
    pub(crate) fn editable_layer(&self, page: usize, id: &str) -> Result<u32> {
        let layer = self.item_layer(page, id)?;
        if self.is_locked(page, id) {
            return Err(Error::new(0, "This item is locked in place"));
        }
        Ok(layer)
    }
    /// Lock or unlock one item in place, as one undoable edit.
    pub fn set_locked(&mut self, page: usize, id: &str, locked: bool) -> Result<()> {
        if self.is_locked(page, id) == locked {
            return Ok(());
        }
        let mut a = self
            .adjustments(page)
            .get(id)
            .copied()
            .cloned()
            .unwrap_or_default();
        a.locked = Some(locked);
        self.adjust_item(page, id, a)
    }
    pub fn adjust_item(&mut self, page: usize, id: &str, mut adjustment: Adjustment) -> Result<()> {
        let joined = std::mem::take(&mut adjustment.joined);
        let current = self
            .adjustments(page)
            .get(id)
            .copied()
            .cloned()
            .unwrap_or_default();
        // Moves and restyles leave the lock as it was; a lock change is its own edit.
        if adjustment.locked.is_none() {
            adjustment.locked = current.locked;
        }
        // ...and the place in the stack (an adjustment sent without one keeps it).
        if adjustment.z.is_none() {
            adjustment.z = current.z;
        }
        if adjustment.locked != current.locked {
            let mut rest = adjustment.clone();
            rest.locked = current.locked;
            if rest != current {
                return Err(Error::new(0, "Lock and move items in separate edits"));
            }
            self.item_layer(page, id)?;
        } else {
            self.editable_layer(page, id)?;
        }
        let g = self.geometry(page, id)?;
        if !adjustment.valid()
            || (!g.styled && (adjustment.width.is_some() || adjustment.rgba.is_some()))
        {
            return Err(Error::new(0, "Invalid item adjustment"));
        }
        if adjustment.fill.is_some()
            && adjustment.fill != current.fill
            && self.closed_shape(page, id).is_none()
        {
            return Err(Error::new(
                0,
                "Only rectangles, ellipses, triangles and stars take a fill",
            ));
        }
        let m = adjustment.matrix(&g);
        if g.bounds.iter().any(|n| !n.is_finite())
            || [
                [g.bounds[0], g.bounds[1]],
                [g.bounds[0] + g.bounds[2], g.bounds[1] + g.bounds[3]],
            ]
            .iter()
            .flat_map(|p| point(m, *p))
            .any(|n| !n.is_finite() || n.abs() > 1e6)
        {
            return Err(Error::new(0, "Adjustment outside coordinate range"));
        }
        if self
            .adjustments(page)
            .get(id)
            .copied()
            .unwrap_or(&Adjustment::default())
            == &adjustment
        {
            return Ok(());
        }
        self.commit(Edit::Adjust {
            page,
            id: id.to_owned(),
            adjustment,
            joined,
        })
    }
    /// Show only part of an image: `rect` is `[x0, y0, x1, y1]` in the image's native size,
    /// clamped to the image. One undoable edit that also moves and scales the item so its box
    /// is the visible part; a rect covering the whole image shows all of it again.
    pub fn crop_item(&mut self, page: usize, id: &str, rect: [f64; 4]) -> Result<()> {
        let frame = |item: &Item| (item_geometry(item), item.object.as_ref().map(image_frame));
        let (g, frame) = if let Some(item) = self.page(page)?.items.iter().find(|i| i.id == id) {
            frame(item)
        } else if let Some((key, image)) = self.images(page).find(|(key, _)| key == id) {
            frame(&image.item(key))
        } else {
            return Err(Error::new(0, "Item not found"));
        };
        let Some(([sw, sh], original)) = frame.filter(|_| g.kind == "image") else {
            return Err(Error::new(0, "Only images can be cropped"));
        };
        let a = self
            .adjustments(page)
            .get(id)
            .copied()
            .cloned()
            .unwrap_or_default();
        let current = a.crop.unwrap_or(original);
        let r = [
            rect[0].max(0.),
            rect[1].max(0.),
            rect[2].min(sw),
            rect[3].min(sh),
        ];
        if !(r[2] - r[0] > 1e-3 && r[3] - r[1] > 1e-3) {
            return Err(Error::new(0, "The crop is empty"));
        }
        // Native units to page units along the item's own axes, from the current crop.
        let kx = g.bounds[2] * a.scale[0] / (current[2] - current[0]);
        let ky = g.bounds[3] * a.scale[1] / (current[3] - current[1]);
        let d = [
            ((r[0] + r[2]) - (current[0] + current[2])) / 2. * kx,
            ((r[1] + r[3]) - (current[1] + current[3])) / 2. * ky,
        ];
        let angle = (g.rotation + a.rotation).to_radians();
        let (s, c) = angle.sin_cos();
        let mut next = a.clone();
        next.scale = [
            a.scale[0] * (r[2] - r[0]) / (current[2] - current[0]),
            a.scale[1] * (r[3] - r[1]) / (current[3] - current[1]),
        ];
        next.translation = [
            a.translation[0] + d[0] * c - d[1] * s,
            a.translation[1] + d[0] * s + d[1] * c,
        ];
        next.crop = Some(r);
        self.adjust_item(page, id, next)
    }
    pub fn remove_item(&mut self, page: usize, id: &str) -> Result<()> {
        self.editable_layer(page, id)?;
        self.commit(Edit::Erase {
            page,
            ids: vec![id.to_owned()],
            joined: false,
        })
    }
    /// Several items in one edit (a graph or table being drawn again); `joined` undoes it
    /// with the edit before it.
    pub fn remove_items(&mut self, page: usize, ids: &[String], joined: bool) -> Result<()> {
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        if ids.is_empty() || unique.len() != ids.len() {
            return Err(Error::new(0, "Invalid items to remove"));
        }
        let deleted = self.deleted(page);
        for id in ids {
            if deleted.contains(id.as_str()) {
                return Err(Error::new(0, "Item already removed"));
            }
            self.editable_layer(page, id)?;
        }
        self.commit(Edit::Erase {
            page,
            ids: ids.to_vec(),
            joined,
        })
    }
    pub fn selection(&self, page: usize, id: &str) -> Result<Value> {
        self.editable_layer(page, id)?;
        let g = self.geometry(page, id)?;
        let adjustments = self.adjustments(page);
        let a = adjustments.get(id).copied().cloned().unwrap_or_default();
        let mut out = json!({"id":id,"page":page,"bounds":g.bounds,"base_rotation":g.rotation,"base_width":g.width,"base_rgba":g.rgba,"styled":g.styled,"kind":g.kind,"adjustment":a});
        // Closed drawn shapes: their fill now (null for an outline), for the menu.
        if let Some(fill) = self.closed_shape(page, id) {
            out["fill"] =
                json!(a
                    .fill
                    .filter(|f| f[3] > 0.)
                    .or(if a.fill.is_some() { None } else { fill }));
        }
        // Images: their native size and visible part, for the crop handles.
        if g.kind == "image" {
            let object = if let Some(item) = self.page(page)?.items.iter().find(|i| i.id == id) {
                item.object.clone()
            } else {
                self.images(page)
                    .find(|(key, _)| key == id)
                    .and_then(|(key, image)| image.item(key).object)
            };
            if let Some(o) = object {
                let (native, original) = image_frame(&o);
                out["native"] = json!(native);
                out["crop"] = json!(a.crop.unwrap_or(original));
            }
        }
        Ok(out)
    }
    pub fn item_patch(&self, page: usize, id: &str) -> Result<Value> {
        let selection = self.selection(page, id)?;
        let adjustments = self.adjustments(page);
        let a = adjustments.get(id).copied();
        let svg = if let Some(item) = self.page(page)?.items.iter().find(|i| i.id == id) {
            item_svg(item, a)?
        } else if let Some((key, image)) = self.images(page).find(|(key, _)| key == id) {
            item_svg(&image.item(key), a)?
        } else {
            let (_, line) = self
                .additions(page)
                .find(|(key, _)| key == id)
                .ok_or_else(|| Error::new(0, "Item not found"))?;
            crate::editor::added_svg(
                &a.map(|a| adjusted_line(line, a))
                    .unwrap_or_else(|| line.clone()),
            )
        };
        Ok(
            json!({"page":page,"id":id,"svg":svg,"selection":selection,"can_undo":self.cursor>0,"can_redo":self.cursor<self.history.len(),"edit_count":self.cursor}),
        )
    }
    pub fn pick_item(&self, page: usize, p: [f64; 2], tolerance: f64) -> Result<Option<Value>> {
        match self.pick(page, p, tolerance, false)? {
            Some(id) => self.selection(page, &id).map(Some),
            None => Ok(None),
        }
    }
    /// The topmost item under a point, locked ones included, for the Lock tool.
    pub fn pick_lockable(&self, page: usize, p: [f64; 2], tolerance: f64) -> Result<Option<Value>> {
        Ok(self.pick(page, p, tolerance, true)?.map(|id| {
            let locked = self.is_locked(page, &id);
            json!({"id": id, "page": page, "locked": locked, "bounds": self.current_bounds(page, &id).ok()})
        }))
    }
    /// The topmost visible timed stroke under a point, including strokes on locked layers
    /// or locked in place, for jumping to the audio recorded when it was written.
    pub fn pick_timed(&self, page: usize, p: [f64; 2], tolerance: f64) -> Result<Option<String>> {
        if p.iter().any(|n| !n.is_finite())
            || !tolerance.is_finite()
            || !(0.0..=100.).contains(&tolerance)
        {
            return Err(Error::new(0, "Invalid selection point"));
        }
        let page_ref = self.page(page)?;
        let timed: std::collections::HashSet<&str> = page_ref
            .timings
            .iter()
            .map(|t| t.item_id.as_str())
            .collect();
        if timed.is_empty() {
            return Ok(None);
        }
        let adjustments = self.adjustments(page);
        let deleted = self.deleted(page);
        for layer in self.layers().iter().rev().filter(|l| l.visible) {
            for item in page_ref
                .items
                .iter()
                .rev()
                .filter(|i| i.layer == layer.id && timed.contains(i.id.as_str()))
            {
                if !deleted.contains(item.id.as_str())
                    && hit_geometry(
                        p,
                        tolerance,
                        &item_geometry(item),
                        item.hit_points(),
                        adjustments.get(item.id.as_str()).copied(),
                        false,
                    )
                {
                    return Ok(Some(item.id.clone()));
                }
            }
        }
        Ok(None)
    }
    /// Axis-aligned bounds of an item as it now sits (adjustments applied).
    pub(crate) fn current_bounds(&self, page: usize, id: &str) -> Result<[f64; 4]> {
        let g = self.geometry(page, id)?;
        let adjustments = self.adjustments(page);
        let a = adjustments.get(id).copied().cloned().unwrap_or_default();
        let m = a.matrix(&g);
        let [x, y, w, h] = g.bounds;
        let corners: Vec<_> = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]
            .iter()
            .map(|c| point(m, *c))
            .collect();
        Ok(bounds(&corners))
    }
    fn pick(
        &self,
        page: usize,
        p: [f64; 2],
        tolerance: f64,
        include_locked: bool,
    ) -> Result<Option<String>> {
        if p.iter().any(|n| !n.is_finite())
            || !tolerance.is_finite()
            || !(0.0..=100.).contains(&tolerance)
        {
            return Err(Error::new(0, "Invalid selection point"));
        }
        let adjustments = self.adjustments(page);
        let skip = |id: &str, native: bool| {
            !include_locked && adjustments.get(id).and_then(|a| a.locked).unwrap_or(native)
        };
        // Top to bottom as drawn: a picture laid over a text box or over ink is found before
        // them, whichever kind of item each one is.
        for layer in self
            .layers()
            .iter()
            .rev()
            .filter(|l| l.visible && !l.locked)
        {
            for (id, _, entry) in self.layer_stack(page, layer.id)?.into_iter().rev() {
                let a = adjustments.get(id.as_str()).copied();
                let hit = match entry {
                    Stacked::Line(line) => {
                        !skip(&id, false)
                            && hit_geometry(
                                p,
                                tolerance,
                                &line_geometry(line),
                                &line.points,
                                a,
                                false,
                            )
                    }
                    Stacked::Image(image) => {
                        !skip(&id, false)
                            && hit_geometry(
                                p,
                                tolerance,
                                &item_geometry(&image.item(id.clone())),
                                &[],
                                a,
                                true,
                            )
                    }
                    Stacked::Imported(item) => {
                        !skip(&id, item.locked())
                            && hit_geometry(
                                p,
                                tolerance,
                                &item_geometry(item),
                                item.hit_points(),
                                a,
                                item.object.is_some(),
                            )
                    }
                };
                if hit {
                    return Ok(Some(id));
                }
            }
        }
        Ok(None)
    }
    /// A page's live items in one layer, bottom to top as they are drawn, each with its place
    /// in the stack (`stack_place`). Tape is listed where it sits, though drawn over the rest.
    pub(crate) fn layer_stack<'a>(
        &'a self,
        page: usize,
        layer: u32,
    ) -> Result<Vec<(String, [f64; 2], Stacked<'a>)>> {
        let page_ref = self.page(page)?;
        let adjustments = self.adjustments(page);
        let deleted = self.deleted(page);
        let mut entries: Vec<StackEntry<'a>> = Vec::new();
        let mut push = |id: String, made: [f64; 2], entry: Stacked<'a>| {
            if !deleted.contains(id.as_str()) {
                let place = stack_place(made, adjustments.get(id.as_str()).copied());
                entries.push((place, made, (id, entry)));
            }
        };
        for (id, line) in self.additions(page).filter(|(_, l)| l.layer == layer) {
            let made = [
                if line.under { UNDER } else { OVER },
                edit_index(&id) as f64,
            ];
            push(id, made, Stacked::Line(line));
        }
        for (id, image) in self.images(page).filter(|(_, i)| i.layer == layer) {
            let made = [
                if image.under { UNDER } else { OVER },
                edit_index(&id) as f64,
            ];
            push(id, made, Stacked::Image(image));
        }
        for (i, item) in page_ref.items.iter().enumerate() {
            if item.layer == layer {
                push(
                    item.id.clone(),
                    [IMPORTED, i as f64],
                    Stacked::Imported(item),
                );
            }
        }
        sort_stack(&mut entries);
        Ok(entries
            .into_iter()
            .map(|(place, _, (id, entry))| (id, place, entry))
            .collect())
    }
    /// Bring an item to the front of its layer (`front`), send it to the back (`back`), or
    /// move it one step: over the next item above it that it overlaps (`forward`), or under
    /// the next one below (`backward`). One undoable edit; nothing when it is already there.
    pub fn restack_item(&mut self, page: usize, id: &str, to: &str) -> Result<()> {
        self.restack(page, id, to, false)
    }
    /// Several items (a group, a graph) to the front or the back, keeping their order among
    /// themselves. One undoable edit.
    pub fn restack_items(&mut self, page: usize, ids: &[String], to: &str) -> Result<()> {
        if let [id] = ids {
            return self.restack(page, id, to, false);
        }
        if !matches!(to, "front" | "back") {
            return Err(Error::new(0, "Only one item at a time moves a step"));
        }
        for id in ids {
            self.editable_layer(page, id)?;
        }
        // Bottom to top as drawn; the bottom one goes to the front first, the top one to the
        // back first, so they end in the order they were in.
        let mut ordered = Vec::new();
        for layer in self.layers() {
            for (id, ..) in self.layer_stack(page, layer.id)? {
                if ids.contains(&id) && !ordered.contains(&id) {
                    ordered.push(id);
                }
            }
        }
        if ordered.len() != ids.len() {
            return Err(Error::new(0, "Invalid items to move"));
        }
        if to == "back" {
            ordered.reverse();
        }
        let mut joined = false;
        for id in &ordered {
            let before = self.cursor;
            self.restack(page, id, to, joined)?;
            joined |= self.cursor > before;
        }
        Ok(())
    }
    fn restack(&mut self, page: usize, id: &str, to: &str, joined: bool) -> Result<()> {
        let layer = self.editable_layer(page, id)?;
        let stack: Vec<(String, [f64; 2])> = self
            .layer_stack(page, layer)?
            .into_iter()
            .map(|(id, place, _)| (id, place))
            .collect();
        let at = stack
            .iter()
            .position(|(key, _)| key == id)
            .ok_or_else(|| Error::new(0, "Item not found"))?;
        let overlaps = |k: usize| -> bool {
            match (
                self.current_bounds(page, id),
                self.current_bounds(page, &stack[k].0),
            ) {
                // Boxes are `[x, y, width, height]`.
                (Ok(a), Ok(b)) => {
                    a[0] <= b[0] + b[2]
                        && b[0] <= a[0] + a[2]
                        && a[1] <= b[1] + b[3]
                        && b[1] <= a[1] + a[3]
                }
                _ => false,
            }
        };
        // Between two places: halfway when they share a band, else just past the first.
        let between = |from: [f64; 2], to: Option<[f64; 2]>, step: f64| match to {
            Some(t) if t[0] == from[0] => [from[0], (from[1] + t[1]) / 2.],
            _ => [from[0], from[1] + step],
        };
        let z = match to {
            "front" if at + 1 < stack.len() => between(stack[stack.len() - 1].1, None, 1.),
            "back" if at > 0 => between(stack[0].1, None, -1.),
            "forward" => match (at + 1..stack.len()).find(|&k| overlaps(k)) {
                Some(k) => between(stack[k].1, stack.get(k + 1).map(|e| e.1), 1.),
                None => return Ok(()),
            },
            "backward" => match (0..at).rev().find(|&k| overlaps(k)) {
                Some(k) => between(stack[k].1, k.checked_sub(1).map(|j| stack[j].1), -1.),
                None => return Ok(()),
            },
            "front" | "back" => return Ok(()),
            _ => return Err(Error::new(0, "Unknown place in the stack")),
        };
        // Halving the gap between two neighbours many times runs out of room.
        if stack.iter().any(|(key, place)| key != id && *place == z) {
            return Err(Error::new(0, "This item cannot move further this way"));
        }
        let mut a = self
            .adjustments(page)
            .get(id)
            .copied()
            .cloned()
            .unwrap_or_default();
        a.z = Some(z);
        a.joined = joined;
        self.adjust_item(page, id, a)
    }
}
fn hit_geometry(
    p: [f64; 2],
    t: f64,
    g: &Geometry,
    points: &[[f64; 2]],
    a: Option<&Adjustment>,
    object: bool,
) -> bool {
    let a = a.cloned().unwrap_or_default();
    let [x, y, w, h] = g.bounds;
    let center = [x + w / 2. + a.translation[0], y + h / 2. + a.translation[1]];
    let angle = (g.rotation + a.rotation).to_radians();
    let (s, c) = (angle.sin(), angle.cos());
    let d = [p[0] - center[0], p[1] - center[1]];
    let local = [d[0] * c + d[1] * s, -d[0] * s + d[1] * c];
    let radius = a.width.unwrap_or(g.width) / 2. + t;
    if local[0].abs() > w.abs() * a.scale[0] / 2. + radius
        || local[1].abs() > h.abs() * a.scale[1] / 2. + radius
    {
        return false;
    }
    if object {
        return true;
    }
    let m = a.matrix(g);
    points.iter().enumerate().any(|(i, q)| {
        crate::editor::point_distance(p, point(m, *q), point(m, *points.get(i + 1).unwrap_or(q)))
            <= radius
    })
}
