//! `Editor::view` as it was before it kept the SVG of added lines and read the history in
//! one walk (view.rs). Kept, unchanged, only so a test can compare the two.
use crate::{editor::added_svg, Editor, Result};
use serde_json::{json, Value};

impl Editor {
    pub(crate) fn view_reference(&self, page: usize) -> Result<Value> {
        let p = self.page(page)?;
        let deleted = self.deleted(page);
        let adjustments = self.adjustments(page);
        let additions: Vec<_> = self.additions(page).collect();
        let mut content = p.background.clone();
        let mut imported = 0;
        let mut added = 0;
        let layers = self.layers();
        // Tape covers whatever is under it, so it is drawn after every layer's content
        // (keeping its own layer's opacity).
        let mut tapes = String::new();
        for layer in &layers {
            if !layer.visible {
                continue;
            }
            let mut layer_tapes = String::new();
            content.push_str(&format!(
                "<g data-layer=\"{}\" opacity=\"{}\">",
                layer.id, layer.opacity
            ));
            // Under-ink additions (highlighter fills) go below the layer's ink.
            let added_in_layer = |under: bool| {
                additions
                    .iter()
                    .filter(move |(_, l)| l.layer == layer.id && l.under == under)
            };
            for (id, line) in added_in_layer(true) {
                if !deleted.contains(id.as_str()) {
                    content.push_str(&format!(
                        "<g data-item=\"{id}\">{}</g>",
                        added_svg(
                            &adjustments
                                .get(id.as_str())
                                .map(|a| crate::manipulation::adjusted_line(line, a))
                                .unwrap_or_else(|| (*line).clone())
                        )
                    ));
                    added += 1;
                }
            }
            for item in p.items.iter().filter(|i| i.layer == layer.id) {
                if !deleted.contains(item.id.as_str()) {
                    let target = if item.tape().is_some() {
                        &mut layer_tapes
                    } else {
                        &mut content
                    };
                    target.push_str(&format!(
                        "<g data-item=\"{}\">{}</g>",
                        item.id,
                        crate::manipulation::item_svg(
                            item,
                            adjustments.get(item.id.as_str()).copied()
                        )?
                    ));
                    imported += 1;
                }
            }
            for (id, image) in self
                .images(page)
                .filter(|(_, image)| image.layer == layer.id)
            {
                if !deleted.contains(id.as_str()) {
                    let item = image.item(id.clone());
                    content.push_str(&format!(
                        "<g data-item=\"{id}\">{}</g>",
                        crate::manipulation::item_svg(
                            &item,
                            adjustments.get(id.as_str()).copied()
                        )?
                    ));
                    added += 1;
                }
            }
            for (id, line) in added_in_layer(false) {
                if !deleted.contains(id.as_str()) {
                    let target = if line.tool == 2 {
                        &mut layer_tapes
                    } else {
                        &mut content
                    };
                    target.push_str(&format!(
                        "<g data-item=\"{id}\"{}>{}</g>",
                        if line.tool == 2 {
                            format!(" data-tape=\"{id}\" data-revealed=\"0\" opacity=\"1\"")
                        } else {
                            String::new()
                        },
                        {
                            let svg = added_svg(
                                &adjustments
                                    .get(id.as_str())
                                    .map(|a| crate::manipulation::adjusted_line(line, a))
                                    .unwrap_or_else(|| (*line).clone()),
                            );
                            if line.tool == 2 {
                                crate::scene::tape_with_pattern(&svg)
                            } else {
                                svg
                            }
                        }
                    ));
                    added += 1;
                }
            }
            content.push_str("</g>");
            if !layer_tapes.is_empty() {
                tapes.push_str(&format!(
                    "<g data-tapes=\"{}\" opacity=\"{}\">{layer_tapes}</g>",
                    layer.id, layer.opacity
                ));
            }
        }
        content.push_str(&tapes);
        let (size, pdf_background) = self.page_geometry(page)?;
        let [w, h] = size;
        let texts: Vec<_> = p
            .items
            .iter()
            .filter(|i| !deleted.contains(i.id.as_str()))
            .filter_map(|i| {
                // Bounds let search highlight typed text like PDF and OCR words.
                let mut t = serde_json::to_value(i.text.as_ref()?).ok()?;
                t["bounds"] = json!(i.bounds);
                Some(t)
            })
            .chain(
                self.images(page)
                    .filter(|(id, image)| image.text.is_some() && !deleted.contains(id.as_str()))
                    .filter_map(|(id, image)| {
                        let item = image.item(id.clone());
                        let mut t = serde_json::to_value(item.text.as_ref()?).ok()?;
                        t["bounds"] = json!(self.current_bounds(page, &id).ok()?);
                        t["id"] = json!(id);
                        if image.text.as_ref().is_some_and(|b| b.math) {
                            t["math"] = json!(true);
                        }
                        Some(t)
                    }),
            )
            .collect();
        let order = self.page_order();
        // Recording page lists are slots; the host navigates by display position.
        let recordings: Vec<_> = self
            .scene
            .recordings
            .iter()
            .map(|r| {
                let mut r = serde_json::to_value(r).unwrap_or(Value::Null);
                if let Some(pages) = r["pages"].as_array_mut() {
                    for p in pages.iter_mut() {
                        if let Some(d) = p.as_u64().and_then(|s| self.display_index(s as usize)) {
                            *p = json!(d);
                        }
                    }
                }
                r
            })
            .collect();
        // Parts of graphs and tables (part.rs): the reader selects and edits each as a whole.
        let parts: Vec<Value> = self
            .additions(page)
            .filter_map(|(id, l)| l.part.clone().map(|p| (id, p)))
            .chain(
                self.images(page)
                    .filter_map(|(id, i)| i.part.clone().map(|p| (id, p))),
            )
            .filter(|(id, _)| !deleted.contains(id.as_str()))
            .map(|(item, p)| json!({"item":item,"id":p.id,"kind":p.kind,"spec":p.spec}))
            .collect();
        let defs = if content.contains("nc-tape-pattern") {
            crate::scene::TAPE_DEFS
        } else {
            ""
        };
        let svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\" style=\"isolation:isolate\">{defs}{content}</svg>");
        Ok(
            json!({"title":self.scene.title,"pages":order.len(),"page":self.display_index(page),"slot":page,"size":size,"base_size":p.size,"svg":svg,"warnings":p.warnings,"texts":texts,"parts":parts,"audio":self.scene.audio,"recordings":recordings,"layers":layers,"shapes":self.additions(page).filter(|(id,l)| l.shape.is_some()&&!deleted.contains(id.as_str())&&layers.iter().any(|layer|layer.id==l.layer&&layer.visible)).map(|(id,l)|json!({"id":id,"line":l})).collect::<Vec<_>>(),"page_sizes":order.iter().map(|s| self.page_geometry(*s).map(|g| g.0)).collect::<Result<Vec<_>>>()?,"pdf_background":pdf_background,"tapes":p.items.iter().filter(|i| !deleted.contains(i.id.as_str())).filter_map(|i| i.tape().map(|open| json!({"id":i.id,"bounds":i.bounds,"revealed":open}))).chain(additions.iter().filter(|(id, l)| l.tool == 2 && !deleted.contains(id.as_str())).map(|(id, l)| { let [x, y, w, h] = crate::manipulation::bounds(&l.points); let r = l.width / 2.; json!({"id":id,"bounds":[x - r, y - r, w + 2. * r, h + 2. * r],"revealed":false}) })).collect::<Vec<_>>(),"locked":self.locked_items_reference(page),"timings":p.timings.iter().filter(|t| !deleted.contains(t.item_id.as_str())).collect::<Vec<_>>(),"visible_imported":imported,"visible_added":added,"erased":deleted.len(),"can_undo":self.cursor>self.floor,"history_floor":self.floor,"can_redo":self.cursor<self.history.len(),"edit_count":self.cursor,"ink_text":self.ink_words(page),"recognized_text":self.recognized_words(page),"canvas":self.canvas}),
        )
    }
    /// Items locked in place on a page, with their current bounds.
    fn locked_items_reference(&self, page: usize) -> Vec<Value> {
        let deleted = self.deleted(page);
        let adjustments = self.adjustments(page);
        let Ok(p) = self.page(page) else {
            return vec![];
        };
        p.items
            .iter()
            .map(|i| (i.id.clone(), i.locked()))
            .chain(self.additions(page).map(|(id, _)| (id, false)))
            .chain(self.images(page).map(|(id, _)| (id, false)))
            .filter(|(id, native)| {
                !deleted.contains(id.as_str())
                    && adjustments
                        .get(id.as_str())
                        .and_then(|a| a.locked)
                        .unwrap_or(*native)
            })
            .filter_map(|(id, _)| {
                Some(json!({"id": id, "bounds": self.current_bounds(page, &id).ok()?}))
            })
            .collect()
    }
}
