//! Absolute adjustments relative to immutable item geometry. One history entry per gesture.
use crate::{editor::Edit, scene::Item, Editor, Error, Line, Result, Stroke};
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
pub(crate) fn line_geometry(line: &Line) -> Geometry {
    Geometry {
        bounds: bounds(&line.points),
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
        Geometry {
            bounds: item.bounds,
            rotation: 0.,
            width: s.radius * 2.,
            rgba: s.style.rgba,
            styled: true,
            kind: "ink",
        }
    }
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
        line.width = w;
    }
    if let Some(c) = a.rgba {
        line.rgba = c;
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
            } = edit
            {
                if *p == page {
                    map.insert(id.as_str(), adjustment);
                }
            }
        }
        map
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
        })
    }
    pub fn selection(&self, page: usize, id: &str) -> Result<Value> {
        self.editable_layer(page, id)?;
        let g = self.geometry(page, id)?;
        let adjustments = self.adjustments(page);
        let a = adjustments.get(id).copied().cloned().unwrap_or_default();
        let mut out = json!({"id":id,"page":page,"bounds":g.bounds,"base_rotation":g.rotation,"base_width":g.width,"base_rgba":g.rgba,"styled":g.styled,"kind":g.kind,"adjustment":a});
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
        let page_ref = self.page(page)?;
        let adjustments = self.adjustments(page);
        let deleted = self.deleted(page);
        let added: Vec<_> = self.additions(page).collect();
        let skip = |id: &str, native: bool| {
            !include_locked && adjustments.get(id).and_then(|a| a.locked).unwrap_or(native)
        };
        for layer in self
            .layers()
            .iter()
            .rev()
            .filter(|l| l.visible && !l.locked)
        {
            for (id, line) in added.iter().rev().filter(|(_, l)| l.layer == layer.id) {
                if !deleted.contains(id.as_str())
                    && !skip(id, false)
                    && hit_geometry(
                        p,
                        tolerance,
                        &line_geometry(line),
                        &line.points,
                        adjustments.get(id.as_str()).copied(),
                        false,
                    )
                {
                    return Ok(Some(id.clone()));
                }
            }
            for (id, image) in self
                .images(page)
                .collect::<Vec<_>>()
                .iter()
                .rev()
                .filter(|(_, image)| image.layer == layer.id)
            {
                let item = image.item(id.clone());
                if !deleted.contains(id.as_str())
                    && !skip(id, false)
                    && hit_geometry(
                        p,
                        tolerance,
                        &item_geometry(&item),
                        &[],
                        adjustments.get(id.as_str()).copied(),
                        true,
                    )
                {
                    return Ok(Some(id.clone()));
                }
            }
            for item in page_ref
                .items
                .iter()
                .rev()
                .filter(|i| i.layer == layer.id && !skip(&i.id, i.locked()))
            {
                if !deleted.contains(item.id.as_str())
                    && hit_geometry(
                        p,
                        tolerance,
                        &item_geometry(item),
                        item.hit_points(),
                        adjustments.get(item.id.as_str()).copied(),
                        item.object.is_some(),
                    )
                {
                    return Ok(Some(item.id.clone()));
                }
            }
        }
        Ok(None)
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
