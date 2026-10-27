//! Conservative native archive writer: untouched resources remain byte-exact.
use crate::{
    editor::Edit, wire::field, Editor, Error, Field, Line, Package, Result, Style, WireValue as V,
    MAGIC,
};
use std::collections::{HashMap, HashSet};
pub(crate) fn f(tag: u16, wire_type: u16, value: V) -> Field {
    Field {
        tag,
        wire_type,
        value,
        offset: 0,
        size: 0,
        clock: if wire_type & 0x800 != 0 {
            Some(0)
        } else {
            None
        },
    }
}
fn set(fs: &mut Vec<Field>, tag: u16, ty: u16, value: V, clock: u64) {
    if let Some(old) = fs.iter_mut().find(|f| f.tag == tag) {
        old.value = value;
        if old.clock.is_some() {
            old.clock = Some(clock);
        }
    } else {
        let mut item = f(tag, ty, value);
        if item.clock.is_some() {
            item.clock = Some(clock);
        }
        fs.push(item);
    }
}
fn nested(fs: &mut [Field], tag: u16) -> Result<&mut Vec<Field>> {
    match fs.iter_mut().find(|f| f.tag == tag).map(|f| &mut f.value) {
        Some(V::Fields(v)) => Ok(v),
        _ => Err(Error::new(0, format!("Missing nested tag {tag}"))),
    }
}
fn array(fs: &mut [Field], tag: u16) -> Result<&mut Vec<V>> {
    match fs.iter_mut().find(|f| f.tag == tag).map(|f| &mut f.value) {
        Some(V::Array(v)) => Ok(v),
        _ => Err(Error::new(0, format!("Missing array tag {tag}"))),
    }
}
pub(crate) fn collection(id_type: u16) -> Vec<Field> {
    vec![
        f(1, 0x400 | id_type, V::Array(vec![])),
        f(2, 0x402, V::Array(vec![])),
        f(3, 0x401, V::Array(vec![])),
        f(0, 0x407, V::Array(vec![])),
    ]
}
fn clocks(fs: &[Field]) -> u64 {
    fs.iter()
        .map(|f| {
            let inner = match &f.value {
                V::Fields(v) => clocks(v),
                V::Array(v) => v
                    .iter()
                    .filter_map(|v| v.as_fields())
                    .map(clocks)
                    .max()
                    .unwrap_or(0),
                _ => 0,
            };
            inner.max(f.clock.unwrap_or(0))
        })
        .max()
        .unwrap_or(0)
}
fn style(out: &mut Vec<u8>, s: &Style) {
    out.extend([0xf1, 2]);
    for c in s.rgba {
        out.extend(c.to_be_bytes());
    }
    out.extend(s.tool.to_be_bytes());
    out.extend(s.extra);
}
fn new_stroke(out: &mut Vec<u8>, line: &Line, id: u64, time: u64, z: u64) {
    style(
        out,
        &Style {
            rgba: line.rgba,
            tool: line.tool,
            extra: [0; 8],
        },
    );
    out.extend([0xf1, 1]);
    out.extend(id.to_be_bytes());
    out.extend(0u16.to_be_bytes());
    out.extend(time.to_be_bytes());
    out.extend(time.to_be_bytes());
    out.extend(z.to_be_bytes());
    out.extend(line.layer.to_be_bytes());
    out.extend((line.width / 2.).to_be_bytes());
    out.extend(0u32.to_be_bytes());
    out.extend((line.points.len() as u32).to_be_bytes());
    if line.points.len() <= 4 {
        for p in &line.points {
            for c in p {
                out.extend((*c as f32).to_be_bytes());
            }
        }
        return;
    }
    let mut bounds = [[0f32; 2]; 2];
    for (axis, b) in bounds.iter_mut().enumerate() {
        b[0] = line
            .points
            .iter()
            .map(|p| p[axis])
            .fold(f64::INFINITY, f64::min) as f32;
        b[1] = (line
            .points
            .iter()
            .map(|p| p[axis])
            .fold(f64::NEG_INFINITY, f64::max)
            - f64::from(b[0]))
        .max(0.) as f32;
        out.extend(b[0].to_be_bytes());
        out.extend(b[1].to_be_bytes());
    }
    for p in &line.points {
        for (axis, b) in bounds.iter().enumerate() {
            let q = if b[1] == 0. {
                0
            } else {
                ((p[axis] - f64::from(b[0])) / f64::from(b[1]) * 65535.)
                    .round()
                    .clamp(0., 65535.) as u16
            };
            out.extend(q.to_be_bytes());
        }
    }
}
fn edited_stroke(out: &mut Vec<u8>, s: &crate::Stroke) {
    style(out, &s.style);
    out.extend([0xf1, 1]);
    out.extend(s.header);
    if let Some((opaque, id)) = &s.link {
        out.extend(opaque.to_be_bytes());
        out.extend((id.len() as u32).to_be_bytes());
        out.extend(id.as_bytes());
    }
    out.extend(s.radius.to_be_bytes());
    out.extend(s.unknown.to_be_bytes());
    out.extend((s.points.len() as u32).to_be_bytes());
    out.extend(&s.auxiliary);
    let dim = if s.flags & 1 != 0 { 3 } else { 2 };
    let component = |i: usize, axis: usize| {
        if axis < 2 {
            s.points[i][axis]
        } else {
            s.radii[i]
        }
    };
    let mut bounds = vec![(0f32, 0f32); dim];
    if s.points.len() > 4 {
        for (axis, bound) in bounds.iter_mut().enumerate() {
            let min = (0..s.points.len())
                .map(|i| component(i, axis))
                .fold(f64::INFINITY, f64::min) as f32;
            let span = ((0..s.points.len())
                .map(|i| component(i, axis))
                .fold(f64::NEG_INFINITY, f64::max)
                - f64::from(min))
            .max(0.) as f32;
            out.extend(min.to_be_bytes());
            out.extend(span.to_be_bytes());
            *bound = (min, span);
        }
    }
    for i in 0..s.points.len() {
        for (axis, &(min, span)) in bounds.iter().enumerate() {
            let v = component(i, axis);
            if s.points.len() <= 4 {
                out.extend((v as f32).to_be_bytes());
            } else {
                let q = if span == 0. {
                    0
                } else {
                    ((v - f64::from(min)) / f64::from(span) * 65535.)
                        .round()
                        .clamp(0., 65535.) as u16
                };
                out.extend(q.to_be_bytes());
            }
        }
    }
}
fn edit_object(
    fs: &mut [Field],
    item: &crate::scene::Item,
    a: &crate::Adjustment,
    time: u64,
) -> Result<()> {
    let edited = crate::manipulation::adjusted_object(item, a);
    let values = edited["2"]["1"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| V::Float(n.as_f64().unwrap()))
        .collect();
    set(nested(fs, 2)?, 1, 0x403, V::Array(values), time);
    // Lock in place is payload tag 21 (u8 with clock) on images. Other kinds use
    // tag 21 for other values, so their lock stays in the project only.
    if let Some(locked) = a.locked {
        let payload = nested(fs, 6)?;
        let lockable = match field(payload, 21) {
            Some(_) => payload.iter().any(|f| f.tag == 21 && f.wire_type == 0x801),
            None => crate::manipulation::item_geometry(item).kind == "image",
        };
        if lockable {
            set(payload, 21, 0x801, V::UInt(u64::from(locked)), time);
        }
    }
    if crate::manipulation::item_geometry(item).styled {
        let st = nested(nested(fs, 6)?, 7)?;
        set(
            st,
            2,
            0x803,
            V::Float(edited["6"]["7"]["2"].as_f64().unwrap()),
            time,
        );
        if let Some(rgba) = a.rgba {
            if field(st, 7).is_none() {
                set(st, 7, 7, V::Fields(vec![]), time);
            }
            set(
                nested(st, 7)?,
                0,
                0x403,
                V::Array(rgba.iter().map(|n| V::Float(*n)).collect()),
                time,
            );
        }
    }
    Ok(())
}
impl Editor {
    /// Add records for inserted pages to the page collection (d:/2). Their tag-5
    /// order keys fall between the display neighbours' keys, so native sorting by
    /// that string reproduces the display order without touching existing pages.
    fn insert_page_records(
        &self,
        collection: &mut [Field],
        order: &[usize],
        page_assets: &HashMap<String, String>,
        time: u64,
    ) -> Result<()> {
        let originals = self.scene.pages.len();
        let key_of = |records: &[V], id: &str| {
            records
                .iter()
                .filter_map(V::as_fields)
                .find(|fs| field(fs, 1).and_then(V::as_text) == Some(id))
                .and_then(|fs| field(fs, 5).and_then(V::as_text))
                .unwrap_or("")
                .to_owned()
        };
        let records = array(collection, 0)?.clone();
        let mut previous = String::new();
        let mut added = Vec::new();
        for (i, &slot) in order.iter().enumerate() {
            let page = self.page(slot)?;
            if slot < originals {
                previous = key_of(&records, &page.id);
                continue;
            }
            let next = order[i + 1..]
                .iter()
                .find(|&&s| s < originals)
                .map(|&s| self.page(s).map(|p| key_of(&records, &p.id)))
                .transpose()?;
            let key = crate::pages::order_between(&previous, next.as_deref())
                .ok_or_else(|| Error::new(0, "No order key between neighbouring pages"))?;
            let mut spec = self
                .inserted_spec(slot)
                .ok_or_else(|| Error::new(0, "Inserted page missing"))?
                .clone();
            // A resized inserted page is written at its final size and placement.
            let (size, background) = self.page_geometry(slot)?;
            spec.size = size;
            if let (Some(p), Some(b)) = (spec.pdf.as_mut(), background) {
                if b.rect != [0., 0., size[0], size[1]] || p.rect.is_some() {
                    p.rect = Some(b.rect);
                }
            }
            let spec = &spec;
            let set = page_assets.get(&page.id).cloned().unwrap_or_default();
            added.push((
                page.id.clone(),
                V::Fields(vec![
                    f(1, 5, V::Text(page.id.clone())),
                    f(2, 7, V::Fields(vec![f(0, 5, V::Text(set))])),
                    f(4, 7, V::Fields(Self::inserted_background(spec))),
                    f(5, 5, V::Text(key.clone())),
                ]),
            ));
            previous = key;
        }
        for (id, record) in added {
            array(collection, 0)?.push(record);
            array(collection, 1)?.push(V::Text(id));
            array(collection, 2)?.push(V::UInt(time));
            array(collection, 3)?.push(V::UInt(1));
        }
        Ok(())
    }
    /// Flatten the applied history into a native container. Redo entries stay unapplied.
    pub fn export_noteful(&self) -> Result<Vec<u8>> {
        if self.cursor == 0 {
            return Ok(self.source.clone());
        }
        let package = Package::parse(&self.source)?;
        let mut blocks: Vec<(String, Vec<u8>)> = package
            .blocks
            .iter()
            .map(|b| (b.id.clone(), package.resource(&b.id).unwrap().to_vec()))
            .collect();
        let mut index = package.index.clone();
        let max_clock = package
            .blocks
            .iter()
            .filter_map(|b| b.fields.as_deref())
            .map(clocks)
            .max()
            .unwrap_or(0);
        let max_time = package
            .blocks
            .iter()
            .flat_map(|b| b.strokes.iter().flatten())
            .map(|s| u64::from_be_bytes(s.header[10..18].try_into().unwrap()))
            .max()
            .unwrap_or(0);
        // Place new, untimed ink after existing recordings rather than attaching it to old audio.
        let after_audio = self
            .scene
            .recordings
            .iter()
            .filter_map(|r| {
                r.start_us
                    .parse::<u64>()
                    .ok()
                    .and_then(|n| n.checked_add((r.duration * 1e6).ceil() as u64))
            })
            .max()
            .unwrap_or(0);
        let time = max_clock
            .max(max_time)
            .max(after_audio)
            .checked_add(1)
            .ok_or_else(|| Error::new(0, "Clock overflow"))?;
        let mut ids: HashSet<u64> = package
            .blocks
            .iter()
            .flat_map(|b| b.strokes.iter().flatten())
            .map(|s| s.id)
            .collect();
        let mut next_id = 1u64;
        let mut page_assets = HashMap::new();
        let order = self.page_order();
        let originals = self.scene.pages.len();
        for &page_no in &order {
            let page = self.page(page_no)?;
            let deleted = self.deleted(page_no);
            let adjustments = self.adjustments(page_no);
            let added: Vec<_> = self
                .additions(page_no)
                .filter(|(id, _)| !deleted.contains(id.as_str()))
                .map(|(id, line)| {
                    let line = adjustments
                        .get(id.as_str())
                        .map(|a| crate::manipulation::adjusted_line(line, a))
                        .unwrap_or_else(|| line.clone());
                    (id, line)
                })
                .collect();
            if deleted.is_empty()
                && added.is_empty()
                && adjustments.is_empty()
                && self.images(page_no).next().is_none()
            {
                continue;
            }
            let existing = package.blocks.iter().find(|b| b.id == page.editable_id);
            if existing.is_some_and(|b| b.stroke_error.is_some()) {
                return Err(Error::new(0, "Cannot rewrite undecoded ink"));
            }
            let mut fields = existing.and_then(|b| b.fields.clone()).unwrap_or_else(|| {
                vec![
                    f(1, 2, V::UInt(288)),
                    f(
                        2,
                        6,
                        V::Blob {
                            offset: 0,
                            bytes: vec![],
                        },
                    ),
                    f(3, 0x402, V::Array(vec![])),
                    f(4, 0x402, V::Array(vec![])),
                    f(5, 7, V::Fields(collection(5))),
                ]
            });
            let raw = field(&fields, 2)
                .and_then(|v| {
                    if let V::Blob { bytes, .. } = v {
                        Some(bytes.clone())
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            let mut ink = Vec::new();
            let mut z = page.items.iter().map(|i| i.z).max().unwrap_or(0);
            if let Some(b) = existing {
                for (i, s) in b.strokes.iter().flatten().enumerate() {
                    z = z.max(s.z_order);
                    if deleted.contains(format!("stroke:{i}").as_str()) {
                        array(&mut fields, 3)?.push(V::UInt(s.id));
                        array(&mut fields, 4)?.push(V::UInt(time));
                    } else if let Some(a) = adjustments.get(format!("stroke:{i}").as_str()) {
                        let edited = crate::manipulation::adjusted_stroke(s, a);
                        if a.translation == [0., 0.]
                            && a.scale == [1., 1.]
                            && a.rotation == 0.
                            && a.width.is_none()
                        {
                            style(&mut ink, &edited.style);
                            ink.extend(&raw[s.offset..s.offset + s.size]);
                        } else {
                            edited_stroke(&mut ink, &edited);
                        }
                    } else {
                        style(&mut ink, &s.style);
                        ink.extend(&raw[s.offset..s.offset + s.size]);
                    }
                }
            }
            let mut image_objects = Vec::new();
            for (id, image) in self
                .images(page_no)
                .filter(|(id, _)| !deleted.contains(id.as_str()))
            {
                let mut suffix = 0;
                let resource = loop {
                    let key = format!("image-{time}-{page_no}-{id}-{suffix}");
                    if !blocks.iter().any(|(existing, _)| existing == &key) {
                        break key;
                    }
                    suffix += 1;
                };
                z = z
                    .checked_add(1)
                    .ok_or_else(|| Error::new(0, "Z-order overflow"))?;
                let object_id = format!("object-{resource}");
                image_objects.push((
                    object_id.clone(),
                    V::Fields(image.native_object(
                        &object_id,
                        &resource,
                        z,
                        adjustments.get(id.as_str()).copied(),
                        time,
                    )),
                ));
                // Text boxes are self-contained objects; pictures add a resource.
                if image.text.is_none() {
                    array(&mut index, 3)?.push(V::Text(resource.clone()));
                    blocks.push((resource, image.bytes()?));
                }
            }
            for (_, line) in added {
                while ids.contains(&next_id) {
                    next_id = next_id
                        .checked_add(1)
                        .ok_or_else(|| Error::new(0, "Stroke ID overflow"))?;
                }
                ids.insert(next_id);
                z = z
                    .checked_add(1)
                    .ok_or_else(|| Error::new(0, "Z-order overflow"))?;
                new_stroke(&mut ink, &line, next_id, time, z);
            }
            set(
                &mut fields,
                2,
                6,
                V::Blob {
                    offset: 0,
                    bytes: ink,
                },
                time,
            );
            let objects = nested(&mut fields, 5)?;
            let mut removed = HashSet::new();
            let values = array(objects, 0)?;
            for (i, value) in values.iter_mut().enumerate() {
                let id = format!("object:{i}");
                if let Some(a) = adjustments.get(id.as_str()) {
                    if !deleted.contains(id.as_str()) {
                        let item = page
                            .items
                            .iter()
                            .find(|item| item.id == id)
                            .ok_or_else(|| Error::new(0, "Adjusted object missing"))?;
                        if let V::Fields(fs) = value {
                            edit_object(fs, item, a, time)?;
                        }
                    }
                }
            }
            let mut i = 0;
            values.retain(|v| {
                let remove = deleted.contains(format!("object:{i}").as_str());
                i += 1;
                if remove {
                    if let Some(id) = v
                        .as_fields()
                        .and_then(|fs| field(fs, 1))
                        .and_then(V::as_text)
                    {
                        removed.insert(id.to_owned());
                    }
                }
                !remove
            });
            let keys = array(objects, 1)?.clone();
            for (i, id) in keys.iter().enumerate() {
                if id.as_text().is_some_and(|id| removed.contains(id)) {
                    if let Some(v) = array(objects, 3)?.get_mut(i) {
                        *v = V::UInt(0);
                    }
                    if let Some(v) = array(objects, 2)?.get_mut(i) {
                        *v = V::UInt(time);
                    }
                }
            }
            for (id, value) in image_objects {
                array(objects, 0)?.push(value);
                array(objects, 1)?.push(V::Text(id));
                array(objects, 2)?.push(V::UInt(time));
                array(objects, 3)?.push(V::UInt(1));
            }
            let encoded = crate::encode_fields(&fields)?;
            if let Some(b) = existing {
                blocks.iter_mut().find(|(id, _)| id == &b.id).unwrap().1 = encoded;
            } else {
                let mut suffix = 0;
                let id = loop {
                    let id = format!(
                        "{:016X}{:016X}",
                        time,
                        (page_no as u64).wrapping_add(suffix)
                    );
                    if !blocks.iter().any(|(key, _)| key == &id) {
                        break id;
                    }
                    suffix += 1;
                };
                if field(&index, 4).is_none() {
                    set(&mut index, 4, 0x405, V::Array(vec![]), time);
                }
                array(&mut index, 4)?.push(V::Text(id.clone()));
                page_assets.insert(page.id.clone(), id.clone());
                blocks.push((id, encoded));
            }
        }
        let layers_changed = self.history[..self.cursor]
            .iter()
            .any(|e| matches!(e, Edit::Layer { .. }));
        let pages_inserted = order.iter().any(|&s| s >= originals);
        let resized: Vec<usize> = order
            .iter()
            .copied()
            .filter(|&s| {
                s < originals
                    && self.history[..self.cursor]
                        .iter()
                        .any(|e| matches!(e, Edit::ResizePage { page, .. } if *page == s))
            })
            .collect();
        // PDFs added with inserted pages become ordinary resources.
        for edit in &self.history[..self.cursor] {
            if let Edit::InsertPages { pdf: Some(pdf), .. } = edit {
                let bytes = self
                    .added_pdf(&pdf.id)
                    .ok_or_else(|| Error::new(0, "Inserted PDF missing"))?;
                array(&mut index, 3)?.push(V::Text(pdf.id.clone()));
                blocks.push((pdf.id.clone(), bytes.to_vec()));
            }
        }
        if !page_assets.is_empty() || layers_changed || pages_inserted || !resized.is_empty() {
            for b in package
                .blocks
                .iter()
                .filter(|b| b.kind == "drawing_metadata")
            {
                let mut fields = b.fields.clone().unwrap();
                if !page_assets.is_empty() {
                    for v in array(nested(&mut fields, 2)?, 0)? {
                        if let V::Fields(fs) = v {
                            if let Some(new) = field(fs, 1)
                                .and_then(V::as_text)
                                .and_then(|id| page_assets.get(id))
                            {
                                set(nested(fs, 2)?, 0, 5, V::Text(new.clone()), time);
                            }
                        }
                    }
                }
                // Resized pages: background tag 1 is the page size and tag 9 the
                // PDF's rectangle, written so the PDF keeps its place and scale.
                for &slot in &resized {
                    let id = self.page(slot)?.id.clone();
                    let (size, background) = self.page_geometry(slot)?;
                    for v in array(nested(&mut fields, 2)?, 0)? {
                        if let V::Fields(fs) = v {
                            if field(fs, 1).and_then(V::as_text) == Some(id.as_str()) {
                                let bg = nested(fs, 4)?;
                                set(bg, 1, 0x21, V::Pair(size), time);
                                if let Some(b) = &background {
                                    set(bg, 9, 0x23, V::Rect(b.rect), time);
                                }
                            }
                        }
                    }
                }
                if pages_inserted {
                    self.insert_page_records(nested(&mut fields, 2)?, &order, &page_assets, time)?;
                }
                if layers_changed {
                    let collection = nested(&mut fields, 3)?;
                    let old = array(collection, 0)?.clone();
                    let mut records = Vec::new();
                    let layers = self.layers();
                    for (order, l) in layers.iter().enumerate() {
                        let mut fs = old
                            .iter()
                            .filter_map(V::as_fields)
                            .find(|fs| field(fs, 2).and_then(V::as_uint) == Some(l.id as u64))
                            .map(|v| v.to_vec())
                            .unwrap_or_default();
                        for (tag, ty, value) in [
                            (1, 0x805, V::Text(l.name.clone())),
                            (2, 0x12, V::UInt(l.id as u64)),
                            (3, 0x805, V::Text(format!("{order:08}"))),
                            (4, 0x801, V::UInt(u64::from(!l.visible))),
                            (5, 0x801, V::UInt(u64::from(l.locked))),
                            (6, 0x803, V::Float(l.opacity)),
                            (7, 0x801, V::UInt(0)),
                        ] {
                            set(&mut fs, tag, ty, value, time);
                        }
                        records.push(V::Fields(fs));
                    }
                    set(collection, 0, 0x407, V::Array(records), time);
                    set(
                        collection,
                        1,
                        0x412,
                        V::Array(layers.iter().map(|l| V::UInt(l.id as u64)).collect()),
                        time,
                    );
                    set(
                        collection,
                        2,
                        0x402,
                        V::Array(vec![V::UInt(time); layers.len()]),
                        time,
                    );
                    set(
                        collection,
                        3,
                        0x401,
                        V::Array(vec![V::UInt(1); layers.len()]),
                        time,
                    );
                }
                blocks.iter_mut().find(|(id, _)| id == &b.id).unwrap().1 =
                    crate::encode_fields(&fields)?;
            }
        }
        let mut out = MAGIC.to_vec();
        let mut keys = Vec::new();
        let mut offsets = Vec::new();
        let mut sizes = Vec::new();
        for (id, bytes) in blocks {
            keys.push(V::Text(id));
            offsets.push(V::UInt(out.len() as u64));
            sizes.push(V::UInt(bytes.len() as u64));
            out.extend(bytes);
        }
        for (tag, values) in [(10, keys), (11, offsets), (12, sizes)] {
            array(&mut index, tag)?.clone_from(&values);
        }
        let at = out.len();
        let encoded = crate::encode_fields(&index)?;
        let size =
            u32::try_from(encoded.len()).map_err(|_| Error::new(0, "Index exceeds wire length"))?;
        out.extend(encoded);
        out.extend(MAGIC);
        out.extend((at as u64).to_be_bytes());
        out.extend(size.to_be_bytes());
        Package::parse(&out)?;
        Ok(out)
    }
}
