//! What a host draws for a page: `Editor::view`.
use crate::{
    editor::{added_svg, Edit, Line},
    manipulation::{adjusted_line, bounds, item_svg},
    Adjustment, Editor, Error, Image, Layer, Page, Part, PdfBackground, Result,
};
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fmt::Write as _,
};

/// A line added to the page.
struct Added<'a> {
    /// The place of its `Add` edit in the history; its id is `new:{index}`.
    index: usize,
    id: String,
    /// The line as drawn, or the one a later resize of its shape replaced it with.
    line: &'a Line,
    replaced: bool,
}

/// What the applied history says about one page, read in one walk.
struct PageFacts<'a> {
    deleted: HashSet<&'a str>,
    adjustments: HashMap<&'a str, &'a Adjustment>,
    added: Vec<Added<'a>>,
    /// Added images and text boxes by id, with later text edits applied.
    images: Vec<(String, &'a Image)>,
    layers: Vec<Layer>,
    /// Display order of the document's slots.
    order: Vec<usize>,
    size: [f64; 2],
    pdf_background: Option<PdfBackground>,
    /// The size of every page of the document, in display order.
    page_sizes: Vec<[f64; 2]>,
}

/// The SVG of an added line. A line that was neither moved nor resized is formatted once
/// and kept in `kept` (by its place in the history) for the next view.
fn added_fragment<'k>(
    kept: &'k mut [Option<Box<str>>],
    added: &Added,
    adjustment: Option<&Adjustment>,
) -> Cow<'k, str> {
    match (adjustment, added.replaced, kept.get_mut(added.index)) {
        (None, false, Some(slot)) => {
            Cow::Borrowed(slot.get_or_insert_with(|| added_svg(added.line).into()))
        }
        (Some(a), ..) => Cow::Owned(added_svg(&adjusted_line(added.line, a))),
        (None, ..) => Cow::Owned(added_svg(added.line)),
    }
}

/// An added line as the page's SVG has it. Tape is drawn twice, the second time with its
/// stripes. `view` and `drawn` both write it here, so a host that adds the item `drawn`
/// gives to the page it holds has the text `view` would have sent.
fn write_added(out: &mut String, id: &str, svg: &str, tape: bool) {
    // Writing to a String cannot fail, so the results of `write!` are dropped.
    let _ = if tape {
        write!(
            out,
            "<g data-item=\"{id}\" data-tape=\"{id}\" data-revealed=\"0\" opacity=\"1\">{}</g>",
            crate::scene::tape_with_pattern(svg)
        )
    } else {
        write!(out, "<g data-item=\"{id}\">{svg}</g>")
    };
}
/// An added line that is part of a graph or table, as `view` lists it in `parts`.
fn part_entry(item: &str, part: &Part) -> Value {
    json!({"item": item, "id": part.id, "kind": part.kind, "spec": part.spec})
}
/// An added shape, as `view` lists it in `shapes`.
fn shape_entry(id: &str, line: &Line) -> Value {
    json!({"id": id, "line": line})
}
/// An added strip of tape, as `view` lists it in `tapes`.
fn tape_entry(id: &str, line: &Line) -> Value {
    let [x, y, w, h] = bounds(&line.points);
    let r = line.width / 2.;
    json!({
        "id": id,
        "bounds": [x - r, y - r, w + 2. * r, h + 2. * r],
        "revealed": false,
    })
}

impl Editor {
    fn page_facts(&self, page: usize) -> Result<PageFacts<'_>> {
        let p = self.page(page)?;
        let (mut size, mut pdf_background) = (p.size, p.pdf_background.clone());
        let mut deleted = HashSet::new();
        let mut adjustments = HashMap::new();
        let mut added: Vec<Added> = Vec::new();
        let mut replacements: HashMap<&str, &Line> = HashMap::new();
        let mut images: Vec<(String, &Image)> = Vec::new();
        let mut retexts: HashMap<&str, &Image> = HashMap::new();
        let mut layers = self.scene.layers.clone();
        let mut order: Vec<usize> = (0..self.scene.pages.len()).collect();
        let mut next_slot = order.len();
        let mut resized: HashMap<usize, [f64; 2]> = HashMap::new();
        for (index, edit) in self.history[..self.cursor].iter().enumerate() {
            match edit {
                Edit::Erase { page: p, ids, .. } if *p == page => {
                    deleted.extend(ids.iter().map(String::as_str));
                }
                Edit::Adjust {
                    page: p,
                    id,
                    adjustment,
                    ..
                } if *p == page => {
                    adjustments.insert(id.as_str(), adjustment);
                }
                Edit::Add { page: p, line } if *p == page => added.push(Added {
                    index,
                    id: format!("new:{index}"),
                    line,
                    replaced: false,
                }),
                Edit::Replace { page: p, id, line } if *p == page => {
                    replacements.insert(id.as_str(), line);
                }
                Edit::Image { page: p, image } if *p == page => {
                    images.push((format!("image:{index}"), image));
                }
                Edit::Retext { page: p, id, image } if *p == page => {
                    retexts.insert(id.as_str(), image);
                }
                Edit::Layer { layer } => {
                    if let Some(l) = layers.iter_mut().find(|l| l.id == layer.id) {
                        *l = layer.clone();
                    } else {
                        layers.push(layer.clone());
                    }
                }
                Edit::InsertPages { at, pages, .. } => {
                    let at = (*at).min(order.len());
                    order.splice(at..at, next_slot..next_slot + pages.len());
                    next_slot += pages.len();
                }
                Edit::ResizePage {
                    page: slot,
                    size: s,
                    pdf_rect,
                    ..
                } => {
                    resized.insert(*slot, *s);
                    if *slot == page {
                        size = *s;
                        if let (Some(b), Some(r)) = (pdf_background.as_mut(), pdf_rect) {
                            b.rect = *r;
                        }
                    }
                }
                _ => {}
            }
        }
        // The last resize of a shape and the last edit of a text box are the ones shown.
        if !replacements.is_empty() {
            for a in &mut added {
                if let Some(line) = replacements.get(a.id.as_str()) {
                    (a.line, a.replaced) = (line, true);
                }
            }
        }
        if !retexts.is_empty() {
            for (id, image) in &mut images {
                if let Some(edited) = retexts.get(id.as_str()) {
                    *image = edited;
                }
            }
        }
        let page_sizes = order
            .iter()
            .map(|slot| match resized.get(slot) {
                Some(size) => Ok(*size),
                None => self.page(*slot).map(|p| p.size),
            })
            .collect::<Result<_>>()?;
        Ok(PageFacts {
            deleted,
            adjustments,
            added,
            images,
            layers,
            order,
            size,
            pdf_background,
            page_sizes,
        })
    }

    /// The page's drawing: each visible layer's content, then every layer's tape.
    /// Returns it with the number of imported and added items it shows.
    fn page_content(&self, p: &Page, facts: &PageFacts) -> Result<(String, usize, usize)> {
        let PageFacts {
            deleted,
            adjustments,
            ..
        } = facts;
        let mut kept = self.added_svg.borrow_mut();
        if kept.len() < self.cursor {
            kept.resize(self.cursor, None);
        }
        let mut content = p.background.clone();
        let (mut imported, mut added) = (0, 0);
        // Tape covers whatever is under it, so it is drawn after every layer's content
        // (keeping its own layer's opacity).
        let mut tapes = String::new();
        // Writing to a String cannot fail, so the results of `write!` are dropped.
        for layer in facts.layers.iter().filter(|l| l.visible) {
            let mut layer_tapes = String::new();
            let _ = write!(
                content,
                "<g data-layer=\"{}\" opacity=\"{}\">",
                layer.id, layer.opacity
            );
            let added_in_layer = |under: bool| {
                facts.added.iter().filter(move |a| {
                    a.line.layer == layer.id
                        && a.line.under == under
                        && !deleted.contains(a.id.as_str())
                })
            };
            // Under-ink additions (highlighter fills) go below the layer's ink.
            for a in added_in_layer(true) {
                let svg = added_fragment(&mut kept, a, adjustments.get(a.id.as_str()).copied());
                write_added(&mut content, &a.id, &svg, false);
                added += 1;
            }
            for item in p.items.iter().filter(|i| i.layer == layer.id) {
                if !deleted.contains(item.id.as_str()) {
                    let target = if item.tape().is_some() {
                        &mut layer_tapes
                    } else {
                        &mut content
                    };
                    let svg = item_svg(item, adjustments.get(item.id.as_str()).copied())?;
                    let _ = write!(target, "<g data-item=\"{}\">{svg}</g>", item.id);
                    imported += 1;
                }
            }
            for (id, image) in &facts.images {
                if image.layer == layer.id && !deleted.contains(id.as_str()) {
                    let svg = item_svg(
                        &image.item(id.clone()),
                        adjustments.get(id.as_str()).copied(),
                    )?;
                    let _ = write!(content, "<g data-item=\"{id}\">{svg}</g>");
                    added += 1;
                }
            }
            for a in added_in_layer(false) {
                let svg = added_fragment(&mut kept, a, adjustments.get(a.id.as_str()).copied());
                if a.line.tool == 2 {
                    write_added(&mut layer_tapes, &a.id, &svg, true);
                } else {
                    write_added(&mut content, &a.id, &svg, false);
                }
                added += 1;
            }
            content.push_str("</g>");
            if !layer_tapes.is_empty() {
                let _ = write!(
                    tapes,
                    "<g data-tapes=\"{}\" opacity=\"{}\">{layer_tapes}</g>",
                    layer.id, layer.opacity
                );
            }
        }
        content.push_str(&tapes);
        Ok((content, imported, added))
    }

    pub fn view(&self, page: usize) -> Result<Value> {
        let p = self.page(page)?;
        let facts = self.page_facts(page)?;
        let PageFacts {
            deleted,
            layers,
            order,
            ..
        } = &facts;
        let shown = |id: &str| !deleted.contains(id);
        let display = |slot: usize| order.iter().position(|s| *s == slot);

        let (content, imported, added) = self.page_content(p, &facts)?;
        let defs = if content.contains("nc-tape-pattern") {
            crate::scene::TAPE_DEFS
        } else {
            ""
        };
        let [w, h] = facts.size;
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" \
             height=\"{h}\" style=\"isolation:isolate\">{defs}{content}</svg>"
        );

        // Bounds let search highlight typed text like PDF and OCR words.
        let imported_texts = p.items.iter().filter(|i| shown(&i.id)).filter_map(|i| {
            let mut t = serde_json::to_value(i.text.as_ref()?).ok()?;
            t["bounds"] = json!(i.bounds);
            Some(t)
        });
        let added_texts = facts
            .images
            .iter()
            .filter(|(id, image)| image.text.is_some() && shown(id))
            .filter_map(|(id, image)| {
                let item = image.item(id.clone());
                let mut t = serde_json::to_value(item.text.as_ref()?).ok()?;
                t["bounds"] = json!(self.current_bounds(page, id).ok()?);
                t["id"] = json!(id);
                if image.text.as_ref().is_some_and(|b| b.math) {
                    t["math"] = json!(true);
                }
                Some(t)
            });
        let texts: Vec<Value> = imported_texts.chain(added_texts).collect();

        // Recording page lists are slots; the host navigates by display position.
        let recordings: Vec<Value> = self
            .scene
            .recordings
            .iter()
            .map(|r| {
                let mut r = serde_json::to_value(r).unwrap_or(Value::Null);
                if let Some(pages) = r["pages"].as_array_mut() {
                    for p in pages.iter_mut() {
                        if let Some(d) = p.as_u64().and_then(|s| display(s as usize)) {
                            *p = json!(d);
                        }
                    }
                }
                r
            })
            .collect();

        // Parts of graphs and tables (part.rs): the reader selects and edits each as a whole.
        let line_parts = facts.added.iter().map(|a| (&a.id, &a.line.part));
        let image_parts = facts.images.iter().map(|(id, image)| (id, &image.part));
        let parts: Vec<Value> = line_parts
            .chain(image_parts)
            .filter(|(id, _)| shown(id))
            .filter_map(|(item, part)| Some(part_entry(item, part.as_ref()?)))
            .collect();

        // Shapes the reader can resize by their corners.
        let shapes: Vec<Value> = facts
            .added
            .iter()
            .filter(|a| {
                a.line.shape.is_some()
                    && shown(&a.id)
                    && layers.iter().any(|l| l.id == a.line.layer && l.visible)
            })
            .map(|a| shape_entry(&a.id, a.line))
            .collect();

        let imported_tapes = p.items.iter().filter(|i| shown(&i.id)).filter_map(|i| {
            let open = i.tape()?;
            Some(json!({"id": i.id, "bounds": i.bounds, "revealed": open}))
        });
        let added_tapes = facts
            .added
            .iter()
            .filter(|a| a.line.tool == 2 && shown(&a.id))
            .map(|a| tape_entry(&a.id, a.line));
        let tapes: Vec<Value> = imported_tapes.chain(added_tapes).collect();

        let timings: Vec<_> = p.timings.iter().filter(|t| shown(&t.item_id)).collect();

        Ok(json!({
            "title": self.scene.title,
            "pages": order.len(),
            "page": display(page),
            "slot": page,
            "size": facts.size,
            "base_size": p.size,
            "svg": svg,
            "warnings": p.warnings,
            "texts": texts,
            "parts": parts,
            "audio": self.scene.audio,
            "recordings": recordings,
            "layers": layers,
            "shapes": shapes,
            "page_sizes": facts.page_sizes,
            "pdf_background": facts.pdf_background,
            "tapes": tapes,
            "locked": self.locked_items(page, p, &facts),
            "timings": timings,
            "visible_imported": imported,
            "visible_added": added,
            "erased": deleted.len(),
            "can_undo": self.cursor > self.floor,
            "history_floor": self.floor,
            "can_redo": self.cursor < self.history.len(),
            "edit_count": self.cursor,
            "ink_text": self.ink_words(page),
            "recognized_text": self.recognized_words(page),
            "canvas": self.canvas,
        }))
    }

    /// What changed on `page` when the last edit added a line to it (`add_line`), so that
    /// a host holding the page's view from just before need not be sent the whole page
    /// again: with `item` and the fields beside it, that view becomes the one `view`
    /// gives now.
    ///
    /// `id` is always there. The rest is left out when the host should ask for the view
    /// (tape laid under the ink, which is listed as tape but drawn as ink).
    ///
    /// - `item`: the line's `<g data-item>` element, as it is in the view's `svg`.
    /// - `layer`, and where the element goes: `tape` in the layer's `data-tapes` group
    ///   (last), `under` in the layer's group before the item `before` (last when there
    ///   is none), otherwise last in the layer's group.
    /// - `shape`, `tape_entry`, `part`: what the view's `shapes` and `tapes` end with now,
    ///   and what `parts` has after its other lines.
    /// - `edit_count`, `can_undo`, `can_redo` as in the view; `visible_added` is one more.
    pub fn drawn(&self, page: usize) -> Result<Value> {
        let not_a_line = || Error::new(0, "The last edit did not add a line to this page");
        let index = self.cursor.checked_sub(1).ok_or_else(not_a_line)?;
        let line = match &self.history[index] {
            Edit::Add { page: p, line } if *p == page => line,
            _ => return Err(not_a_line()),
        };
        let id = format!("new:{index}");
        let mut out = json!({"id": id, "page": page, "slot": page});
        let tape = line.tool == 2;
        if tape && line.under {
            return Ok(out);
        }
        // The element that follows a line under the ink: the layer's first imported item,
        // else its first picture or text box, else its first line over the ink.
        let before = if line.under {
            let facts = self.page_facts(page)?;
            let shown = |id: &str| !facts.deleted.contains(id);
            let in_layer = |layer: u32| layer == line.layer;
            let p = self.page(page)?;
            let imported = p
                .items
                .iter()
                .find(|i| in_layer(i.layer) && i.tape().is_none() && shown(&i.id))
                .map(|i| i.id.clone());
            let image = || {
                let found = facts.images.iter();
                found
                    .filter(|(id, image)| in_layer(image.layer) && shown(id))
                    .map(|(id, _)| id.clone())
                    .next()
            };
            let over = || {
                let found = facts.added.iter();
                found
                    .filter(|a| {
                        in_layer(a.line.layer) && !a.line.under && a.line.tool != 2 && shown(&a.id)
                    })
                    .map(|a| a.id.clone())
                    .next()
            };
            imported.or_else(image).or_else(over)
        } else {
            None
        };
        let mut item = String::new();
        {
            // Kept for the next view, which then does not format the line again.
            let mut kept = self.added_svg.borrow_mut();
            if kept.len() < self.cursor {
                kept.resize(self.cursor, None);
            }
            let svg = kept[index].get_or_insert_with(|| added_svg(line).into());
            write_added(&mut item, &id, svg, tape);
        }
        out["item"] = json!(item);
        out["layer"] = json!(line.layer);
        out["under"] = json!(line.under);
        out["tape"] = json!(tape);
        out["before"] = json!(before);
        if line.shape.is_some() {
            out["shape"] = shape_entry(&id, line);
        }
        if tape {
            out["tape_entry"] = tape_entry(&id, line);
        }
        if let Some(part) = &line.part {
            out["part"] = part_entry(&id, part);
        }
        out["edit_count"] = json!(self.cursor);
        out["can_undo"] = json!(self.cursor > self.floor);
        out["can_redo"] = json!(self.cursor < self.history.len());
        Ok(out)
    }

    /// Items locked in place on a page, with their current bounds.
    fn locked_items(&self, page: usize, p: &Page, facts: &PageFacts) -> Vec<Value> {
        let imported = p.items.iter().map(|i| (&i.id, i.locked()));
        let lines = facts.added.iter().map(|a| (&a.id, false));
        let images = facts.images.iter().map(|(id, _)| (id, false));
        imported
            .chain(lines)
            .chain(images)
            .filter(|(id, native)| {
                !facts.deleted.contains(id.as_str())
                    && facts
                        .adjustments
                        .get(id.as_str())
                        .and_then(|a| a.locked)
                        .unwrap_or(*native)
            })
            .filter_map(|(id, _)| {
                Some(json!({"id": id, "bounds": self.current_bounds(page, id).ok()?}))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        Adjustment, Editor, Image, InkWord, Layer, Line, NewPage, Part, Shape, ShapeKind, TextBox,
    };

    /// `view` and the implementation it replaced (view_reference.rs) give the same JSON,
    /// on a first view and on a second one that finds the added lines' SVG already kept.
    fn same_as_before(e: &Editor, step: &str, every_page: bool) {
        let order = e.page_order();
        let original = e.scene.pages.len();
        // A long note is checked on a few pages and the inserted ones while it is edited.
        let checked = |slot: &usize| {
            every_page || order.len() <= 12 || *slot < 3 || *slot == 8 || *slot >= original
        };
        for slot in order.iter().copied().filter(checked) {
            let expected = e.view_reference(slot).unwrap();
            for pass in ["first", "second"] {
                let got = e.view(slot).unwrap();
                if got != expected {
                    let short = |v: &serde_json::Value| -> String {
                        v.to_string().chars().take(400).collect()
                    };
                    for (key, value) in expected.as_object().unwrap() {
                        assert!(
                            got[key] == *value,
                            "after \"{step}\", slot {slot}, {pass} view, \"{key}\":\n{}\nwas\n{}",
                            short(&got[key]),
                            short(value)
                        );
                    }
                    panic!("after \"{step}\", slot {slot}: the view has other keys");
                }
            }
        }
        assert!(e.view(usize::MAX).is_err() && e.view_reference(usize::MAX).is_err());
    }

    fn pen(y: f64) -> Line {
        Line::new(
            vec![[40., y], [120., y + 8.], [200., y]],
            3.,
            [0.1, 0.2, 0.7, 1.],
        )
    }
    fn moved(dx: f64) -> Adjustment {
        Adjustment {
            translation: [dx, 12.],
            ..Default::default()
        }
    }
    fn text_box(text: &str, math: bool) -> Image {
        Image {
            base64: String::new(),
            mime: String::new(),
            bounds: [100., 420., 240., 60.],
            layer: 0,
            joined: false,
            part: None,
            text: Some(typed(text, math)),
        }
    }
    fn typed(text: &str, math: bool) -> TextBox {
        TextBox {
            text: text.into(),
            font_size: 20.,
            rgba: [0.1, 0.1, 0.2, 1.],
            bold: true,
            italic: false,
            font: "Helvetica".into(),
            align: 0,
            underline: false,
            strikethrough: false,
            math,
        }
    }

    /// A session that uses every kind of edit, checked after each step.
    fn session(e: &mut Editor) {
        let step = |e: &Editor, name: &str| same_as_before(e, name, false);
        let new = |index: usize| format!("new:{index}");
        step(e, "opened");

        // Ink of every kind.
        let first = e.cursor;
        e.add_line(0, pen(100.)).unwrap();
        step(e, "pen");
        let highlighter = Line {
            tool: 1,
            width: 14.,
            ..pen(130.)
        };
        e.add_line(0, highlighter.clone()).unwrap();
        step(e, "highlighter");
        e.add_line_under(0, highlighter).unwrap();
        step(e, "highlighter under the ink");
        let ballpoint = Line {
            pressure: Some(vec![0.8, 1.4, 1.1]),
            ..pen(160.)
        };
        e.add_line(0, ballpoint).unwrap();
        step(e, "ballpoint");
        let band = Line {
            square: true,
            tool: 1,
            ..Line::new(vec![[100., 300.], [300., 300.]], 120., [1., 0.9, 0., 1.])
        };
        e.add_line(0, band).unwrap();
        step(e, "square band");
        let tape = e.cursor;
        let strip = Line {
            tool: 2,
            width: 30.,
            ..pen(200.)
        };
        e.add_line(0, strip.clone()).unwrap();
        step(e, "tape");
        let shape = e.cursor;
        let rectangle = Shape {
            kind: ShapeKind::Rectangle,
            start: [100., 100.],
            end: [260., 220.],
            fill: Some([1., 0.8, 0., 0.25]),
        };
        let outline = Line {
            points: rectangle.points(),
            shape: Some(rectangle),
            ..pen(0.)
        };
        e.add_line(0, outline).unwrap();
        step(e, "filled shape");
        let graph = Line {
            part: Some(Part {
                id: "g1".into(),
                kind: "graph".into(),
                spec: Some(r#"{"x":[-5,5]}"#.into()),
            }),
            ..pen(240.)
        };
        e.add_line(0, graph).unwrap();
        step(e, "graph part");

        // Erase, undo, redo.
        assert!(e.erase_path(0, &[[80., 90.], [80., 115.]], 2.).unwrap() > 0);
        step(e, "erase");
        e.undo();
        step(e, "undo the erasure");
        e.redo();
        step(e, "redo the erasure");
        e.undo();

        // Move, restyle, resize, lock.
        let restyled = Adjustment {
            translation: [50., 40.],
            scale: [2., 1.],
            rotation: 90.,
            width: Some(8.),
            rgba: Some([1., 0., 0., 1.]),
            ..Default::default()
        };
        e.adjust_item(0, &new(first), restyled).unwrap();
        step(e, "adjust a line");
        e.adjust_item(0, &new(tape), moved(30.)).unwrap();
        step(e, "move the tape");
        for imported in ["stroke:0", "object:0"] {
            if e.adjust_item(0, imported, moved(20.)).is_ok() {
                step(e, "move an imported item");
            }
        }
        let wider = Shape {
            kind: ShapeKind::Rectangle,
            start: [80., 90.],
            end: [250., 280.],
            fill: None,
        };
        e.resize_shape(0, &new(shape), wider).unwrap();
        step(e, "resize the shape");
        e.adjust_item(0, &new(shape), moved(15.)).unwrap();
        step(e, "move the resized shape");
        e.set_locked(0, &new(first), true).unwrap();
        step(e, "lock a line");
        e.undo();
        e.undo();
        step(e, "undo twice");
        e.redo();
        step(e, "redo");

        // A place in the history used again by another line: what was kept for it goes.
        e.undo();
        e.add_line(0, pen(400.)).unwrap();
        step(e, "a line where an undone edit was");
        e.undo();
        e.add_line(0, pen(430.)).unwrap();
        step(e, "another line in the same place");

        // Pages.
        let blank = NewPage {
            words: vec![],
            size: [500., 700.],
            pdf: None,
        };
        e.insert_pages(1, vec![blank], None).unwrap();
        step(e, "insert a page");
        let inserted = e.slot(1).unwrap();
        e.add_line(inserted, pen(50.)).unwrap();
        step(e, "draw on the inserted page");
        let [w, h] = e.page(0).unwrap().size;
        e.resize_page(0, [w * 1.5, h], None).unwrap();
        step(e, "resize a page");
        e.resize_page(inserted, [600., 700.], None).unwrap();
        step(e, "resize the inserted page");

        // Layers.
        let mut layer = Layer {
            id: 1,
            name: "Top".into(),
            ..Default::default()
        };
        e.set_layer(layer.clone()).unwrap();
        e.add_line(
            0,
            Line {
                layer: 1,
                ..pen(460.)
            },
        )
        .unwrap();
        e.add_line(0, Line { layer: 1, ..strip }).unwrap();
        step(e, "ink and tape on a new layer");
        layer.opacity = 0.5;
        e.set_layer(layer.clone()).unwrap();
        step(e, "layer opacity");
        layer.visible = false;
        e.set_layer(layer.clone()).unwrap();
        step(e, "hidden layer");
        layer.visible = true;
        layer.locked = true;
        e.set_layer(layer).unwrap();
        step(e, "locked layer");

        // Pictures and text boxes.
        let picture = format!("image:{}", e.cursor);
        e.add_image(0, Image {
            base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=".into(),
            mime: "image/png".into(),
            bounds: [20., 30., 120., 80.],
            layer: 0,
            text: None,
            joined: false,
            part: None,
        })
        .unwrap();
        step(e, "picture");
        let text = format!("image:{}", e.cursor);
        e.add_image(0, text_box("Hola\nmundo", false)).unwrap();
        step(e, "text box");
        e.edit_text(0, &text, typed("Adiós", false), [120., 40.])
            .unwrap();
        step(e, "edit the text");
        e.adjust_item(0, &text, moved(50.)).unwrap();
        step(e, "move the text box");
        e.add_image(0, text_box(r"\frac{a}{b} = x^2", true))
            .unwrap();
        step(e, "math box");
        e.set_locked(0, &text, true).unwrap();
        step(e, "lock the text box");
        e.remove_item(0, &picture).unwrap();
        step(e, "remove the picture");
        e.undo();
        step(e, "undo the removal");

        // Text kept beside the history.
        let word = InkWord {
            text: "mitosis".into(),
            bounds: [10., 100., 60., 20.],
            link: None,
        };
        e.set_recognized_words(0, vec![word]).unwrap();
        step(e, "recognized text");

        // Saved and opened again, then compacted: both rebuild the history.
        let reopened = Editor::open_project(&e.save_project().unwrap()).unwrap();
        step(&reopened, "reopened project");
        e.compact_history(e.cursor).unwrap();
        step(e, "compacted");
        e.add_line(0, pen(500.)).unwrap();
        e.undo();
        e.add_line(0, pen(520.)).unwrap();
        same_as_before(e, "a line after compacting", true);
    }

    /// What the reader does with `drawn` (apps/reader/draw-patch.js), written again here:
    /// the view from before the line with the new item put in. None when it cannot be done.
    fn with_drawn(view: &serde_json::Value, d: &serde_json::Value) -> Option<serde_json::Value> {
        let item = d["item"].as_str()?;
        let svg = view["svg"].as_str()?;
        if view["slot"] != d["slot"] || !svg.ends_with("</svg>") {
            return None;
        }
        let layer = d["layer"].as_u64()?;
        let closing = svg.len() - "</svg>".len();
        // A group ends where the next one starts, or where the page does.
        let end_of = |start: usize, next: &[&str]| {
            let rest = &svg[start + 1..];
            let found = next.iter().find_map(|n| rest.find(n));
            found.map_or(closing, |i| start + 1 + i)
        };
        let at = if d["tape"] == true {
            if !svg.contains("nc-tape-pattern") {
                return None;
            }
            let start = svg.find(&format!("<g data-tapes=\"{layer}\" "))?;
            end_of(start, &["<g data-tapes=\""]) - 4
        } else {
            let start = svg.find(&format!("<g data-layer=\"{layer}\" "))?;
            let end = end_of(start, &["<g data-layer=\"", "<g data-tapes=\""]);
            match d["before"].as_str() {
                Some(id) => start + svg[start..end].find(&format!("<g data-item=\"{id}\">"))?,
                None => end - 4,
            }
        };
        if d["before"].is_null() && &svg[at..at + 4] != "</g>" {
            return None;
        }
        let mut next = view.clone();
        next["svg"] = format!("{}{item}{}", &svg[..at], &svg[at..]).into();
        next["visible_added"] = (view["visible_added"].as_u64()? + 1).into();
        for key in ["edit_count", "can_undo", "can_redo"] {
            next[key] = d[key].clone();
        }
        if !d["shape"].is_null() {
            next["shapes"].as_array_mut()?.push(d["shape"].clone());
        }
        if !d["tape_entry"].is_null() {
            next["tapes"].as_array_mut()?.push(d["tape_entry"].clone());
        }
        if !d["part"].is_null() {
            // Lines' parts come before those of pictures and text boxes.
            let parts = next["parts"].as_array_mut()?;
            let images = |p: &serde_json::Value| p["item"].as_str().unwrap().starts_with("image:");
            let at = parts.iter().position(images).unwrap_or(parts.len());
            parts.insert(at, d["part"].clone());
        }
        Some(next)
    }

    /// Adds `line` to the page and checks what `drawn` answers against the views before
    /// and after. Returns whether the reader could have put the item in by itself.
    fn draw_checked(e: &mut Editor, slot: usize, line: Line, name: &str) -> bool {
        let before = e.view(slot).unwrap();
        e.add_line(slot, line.clone()).unwrap();
        // Asked before the next view, as the reader's engine does: nothing is kept yet.
        let d = e.drawn(slot).unwrap();
        let after = e.view(slot).unwrap();
        let id = format!("new:{}", after["edit_count"].as_u64().unwrap() - 1);
        assert_eq!(d["id"], id.as_str(), "{name}");
        assert_eq!(d["slot"], slot, "{name}");
        assert_eq!(
            d,
            e.drawn(slot).unwrap(),
            "{name}: the same answer after a view"
        );
        let Some(item) = d["item"].as_str() else {
            assert!(line.under && line.tool == 2, "{name}: no item");
            return false;
        };
        // The item is, byte for byte, the line's element in the full view.
        let svg = after["svg"].as_str().unwrap();
        let opening = format!("<g data-item=\"{id}\"");
        let at = svg
            .find(&opening)
            .unwrap_or_else(|| panic!("{name}: not in the view"));
        assert!(svg[at..].starts_with(item), "{name}: the item differs");
        assert_eq!(svg.matches(&opening).count(), 1, "{name}");
        assert!(
            item.starts_with(&opening) && item.ends_with("</g>"),
            "{name}"
        );
        match with_drawn(&before, &d) {
            Some(patched) => {
                for (key, value) in after.as_object().unwrap() {
                    assert!(patched[key] == *value, "{name}: \"{key}\" differs");
                }
                assert_eq!(patched, after, "{name}");
                true
            }
            None => {
                // Only the page's first tape, or a layer's first, needs the whole view.
                let had = before["svg"].as_str().unwrap();
                let group = format!("<g data-tapes=\"{}\" ", line.layer);
                assert!(
                    line.tool == 2 && (!had.contains("nc-tape-pattern") || !had.contains(&group)),
                    "{name}: the item could not be put in"
                );
                false
            }
        }
    }

    /// Every kind of line, drawn on `layer` of a page.
    fn lines(layer: u32, y: f64) -> Vec<(&'static str, Line)> {
        let on = |line: Line| Line { layer, ..line };
        let shape = |kind, fill| {
            let shape = Shape {
                kind,
                start: [100., y],
                end: [260., y + 90.],
                fill,
            };
            on(Line {
                points: shape.points(),
                shape: Some(shape),
                ..pen(0.)
            })
        };
        let highlighter = on(Line {
            tool: 1,
            width: 14.,
            ..pen(y + 10.)
        });
        let band = Line {
            square: true,
            ..Line::new(vec![[100., y], [300., y]], 120., [1., 0.9, 0., 1.])
        };
        let tape = on(Line {
            tool: 2,
            width: 30.,
            ..pen(y + 30.)
        });
        vec![
            ("pen", on(pen(y))),
            (
                "pen, one point",
                on(Line::new(vec![[50., y]], 3., [0., 0., 0., 1.])),
            ),
            (
                "pressure pen",
                on(Line {
                    pressure: Some(vec![0.8, 1.4, 1.1]),
                    ..pen(y + 5.)
                }),
            ),
            ("highlighter", highlighter.clone()),
            (
                "highlighter under the ink",
                Line {
                    under: true,
                    ..highlighter.clone()
                },
            ),
            (
                "band under the ink",
                on(Line {
                    tool: 1,
                    under: true,
                    ..band
                }),
            ),
            (
                "pen under the ink",
                on(Line {
                    under: true,
                    ..pen(y + 15.)
                }),
            ),
            ("shape", shape(ShapeKind::Rectangle, None)),
            (
                "filled shape",
                shape(ShapeKind::Rectangle, Some([1., 0.8, 0., 0.25])),
            ),
            (
                "ellipse",
                shape(ShapeKind::Ellipse, Some([0., 0.5, 1., 1.])),
            ),
            ("line shape", shape(ShapeKind::Line, None)),
            ("tape", tape.clone()),
            (
                "tape again",
                Line {
                    width: 12.,
                    ..tape.clone()
                },
            ),
            (
                "tape under the ink",
                Line {
                    under: true,
                    ..tape
                },
            ),
            (
                "graph part",
                on(Line {
                    part: Some(Part {
                        id: "g1".into(),
                        kind: "graph".into(),
                        spec: Some(r#"{"x":[-5,5]}"#.into()),
                    }),
                    ..pen(y + 40.)
                }),
            ),
            ("pen after everything", on(pen(y + 50.))),
        ]
    }

    #[test]
    fn a_drawn_line_patches_the_previous_view_into_the_next() {
        let samples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples");
        for name in [
            "Examen wuolah",
            "Practice book (vol. 1)",
            "nota_herramientalinea",
            "nota_imagen",
            "texto",
            "nota_vacia",
        ] {
            let data = std::fs::read(samples.join(format!("{name}.noteful"))).unwrap();
            let mut e = Editor::open(&data).unwrap();
            let last = e.scene.pages.len() - 1;
            let mut patched = 0;
            let mut all = |e: &mut Editor, slot: usize, layer: u32, step: &str| {
                for (kind, line) in lines(layer, 100.) {
                    let label = format!("{name}, slot {slot}, {step}: {kind}");
                    patched += usize::from(draw_checked(e, slot, line, &label));
                }
            };
            assert!(e.drawn(0).is_err(), "nothing was drawn yet");
            all(&mut e, 0, 0, "first lines");
            assert!(e.drawn(usize::MAX).is_err() && (last == 0 || e.drawn(last).is_err()));
            all(&mut e, last, 0, "last page");

            // After erasing, moving, resizing and undoing: the places of later lines hold.
            assert!(e.erase_path(0, &[[80., 90.], [80., 115.]], 2.).unwrap() > 0);
            assert!(e.drawn(0).is_err(), "an erasure is not a drawn line");
            let first = e.cursor;
            all(&mut e, 0, 0, "after an erasure");
            e.adjust_item(0, &format!("new:{first}"), moved(30.))
                .unwrap();
            e.undo();
            e.undo();
            e.redo();
            all(&mut e, 0, 0, "after a move, undo and redo");
            e.undo();
            all(&mut e, 0, 0, "where an undone line was");

            // A text box and a picture part: lines over the ink come after them, lines
            // under it before them, and a line's part before a text box's.
            let mut label = text_box("Hola", false);
            label.part = Some(Part {
                id: "g1".into(),
                kind: "graph".into(),
                spec: None,
            });
            e.add_image(0, label).unwrap();
            all(&mut e, 0, 0, "with a text box");

            // A second layer over the first, then with the first hidden, then dimmed.
            let mut top = Layer {
                id: 7,
                name: "Top".into(),
                ..Default::default()
            };
            e.set_layer(top.clone()).unwrap();
            all(&mut e, 0, 7, "new layer");
            all(&mut e, 0, 0, "layer under another");
            top.opacity = 0.5;
            e.set_layer(top.clone()).unwrap();
            all(&mut e, 0, 7, "dimmed layer");
            let mut base = e.layers().into_iter().find(|l| l.id == 0).unwrap();
            base.visible = false;
            e.set_layer(base.clone()).unwrap();
            all(&mut e, 0, 7, "over a hidden layer");
            base.visible = true;
            e.set_layer(base).unwrap();

            // An inserted page, and the pages after a project is opened again or compacted.
            let blank = NewPage {
                words: vec![],
                size: [500., 700.],
                pdf: None,
            };
            e.insert_pages(1, vec![blank], None).unwrap();
            let inserted = e.slot(1).unwrap();
            all(&mut e, inserted, 0, "inserted page");
            all(&mut e, inserted, 7, "inserted page, top layer");
            let mut reopened = Editor::open_project(&e.save_project().unwrap()).unwrap();
            all(&mut reopened, 0, 0, "reopened project");
            // Compacted: undo stops where the history was cut, and lines are still added.
            let mut cut = Editor::open(&data).unwrap();
            all(&mut cut, 0, 0, "before compacting");
            cut.compact_history(cut.cursor).unwrap();
            all(&mut cut, 0, 0, "compacted");
            cut.undo();
            all(&mut cut, last, 0, "compacted, after an undo");

            // Most lines were put in without the view; the first tapes and tape under the
            // ink were not.
            assert!(patched > 150, "{name}: {patched} lines patched");
        }
    }

    #[test]
    fn the_view_is_what_the_previous_implementation_gave() {
        let samples = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples");
        for name in [
            "Examen wuolah",
            "Practice book (vol. 1)",
            "nota_herramientalinea",
            "nota_imagen",
            "texto",
            "nota_vacia",
        ] {
            let data = std::fs::read(samples.join(format!("{name}.noteful"))).unwrap();
            let mut e = Editor::open(&data).unwrap();
            same_as_before(&e, name, true);
            session(&mut e);
        }
    }
}
