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
}
impl Default for Adjustment {
    fn default() -> Self {
        Self {
            translation: [0., 0.],
            scale: [1., 1.],
            rotation: 0.,
            width: None,
            rgba: None,
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
    o
}
pub(crate) fn item_svg(item: &Item, a: Option<&Adjustment>) -> Result<String> {
    let Some(a) = a else {
        return Ok(item.svg.clone());
    };
    if let Some(s) = &item.stroke {
        return crate::scene::stroke_svg(&adjusted_stroke(s, a));
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
    fn editable_layer(&self, page: usize, id: &str) -> Result<u32> {
        if self.deleted(page).contains(id) {
            return Err(Error::new(0, "Item was erased"));
        }
        let layer = self
            .page(page)?
            .items
            .iter()
            .find(|i| i.id == id)
            .map(|i| {
                if i.locked() {
                    Err(Error::new(0, "This item is locked in place"))
                } else {
                    Ok(i.layer)
                }
            })
            .transpose()?
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
    pub fn adjust_item(&mut self, page: usize, id: &str, adjustment: Adjustment) -> Result<()> {
        self.editable_layer(page, id)?;
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
        Ok(
            json!({"id":id,"page":page,"bounds":g.bounds,"base_rotation":g.rotation,"base_width":g.width,"base_rgba":g.rgba,"styled":g.styled,"kind":g.kind,"adjustment":a}),
        )
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
        for layer in self
            .layers()
            .iter()
            .rev()
            .filter(|l| l.visible && !l.locked)
        {
            for (id, line) in added.iter().rev().filter(|(_, l)| l.layer == layer.id) {
                if !deleted.contains(id.as_str())
                    && hit_geometry(
                        p,
                        tolerance,
                        &line_geometry(line),
                        &line.points,
                        adjustments.get(id.as_str()).copied(),
                        false,
                    )
                {
                    return self.selection(page, id).map(Some);
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
                    && hit_geometry(
                        p,
                        tolerance,
                        &item_geometry(&item),
                        &[],
                        adjustments.get(id.as_str()).copied(),
                        true,
                    )
                {
                    return self.selection(page, id).map(Some);
                }
            }
            for item in page_ref
                .items
                .iter()
                .rev()
                .filter(|i| i.layer == layer.id && !i.locked())
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
                    return self.selection(page, &item.id).map(Some);
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
