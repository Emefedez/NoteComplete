//! Where things are on a page, for aiming marks: handwriting grouped into
//! numbered items (words and phrases on one line) in reading order,
//! highlighted regions, typed text boxes, images, shapes and tape, each
//! with a bounding box [x0, y0, x1, y1] in page units. The grouping follows
//! noteful-mcp's ink_items (MIT).
use crate::{Editor, Result};
use serde_json::{json, Value};

type Bbox = [f64; 4];

fn hex(c: &[f64; 4]) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        (c[0].clamp(0., 1.) * 255.).round() as u8,
        (c[1].clamp(0., 1.) * 255.).round() as u8,
        (c[2].clamp(0., 1.) * 255.).round() as u8
    )
}
fn rounded(b: Bbox) -> Value {
    json!(b.map(|v| (v * 10.).round() / 10.))
}
fn corners([x, y, w, h]: [f64; 4]) -> Bbox {
    [x, y, x + w, y + h]
}

/// Group handwriting boxes into items: strokes that share a text row and
/// sit close together, with dots and accents folded into the word below.
fn ink_items(boxes: &[Bbox]) -> Vec<(Bbox, usize)> {
    if boxes.is_empty() {
        return vec![];
    }
    let mut heights: Vec<f64> = boxes.iter().map(|b| b[3] - b[1]).collect();
    heights.sort_by(f64::total_cmp);
    let p90 = heights[(heights.len() as f64 * 0.9) as usize % heights.len()];
    let big: Vec<f64> = heights
        .iter()
        .copied()
        .filter(|x| *x >= 0.35 * p90)
        .collect();
    let h = big.get(big.len() / 2).copied().unwrap_or(6.).max(6.);
    let mut parent: Vec<usize> = (0..boxes.len()).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let is_rule = |b: &Bbox| b[3] - b[1] < h && b[2] - b[0] > 5. * h;
    let mut order: Vec<usize> = (0..boxes.len()).collect();
    order.sort_by(|a, b| boxes[*a][0].total_cmp(&boxes[*b][0]));
    for (ai, &i) in order.iter().enumerate() {
        let a = boxes[i];
        if is_rule(&a) {
            continue;
        }
        for &j in &order[ai + 1..] {
            let b = boxes[j];
            if is_rule(&b) {
                continue;
            }
            if b[0] - a[2] > 2.2 * h {
                break;
            }
            if a[3] - a[1] < 0.5 * h && b[3] - b[1] < 0.5 * h {
                continue;
            }
            let overlap = a[3].min(b[3]) - a[1].max(b[1]);
            let tall = (a[3] - a[1]).max(b[3] - b[1]);
            if overlap > 0.35 * (a[3] - a[1]).min(b[3] - b[1]).min(2. * h) && tall < 6. * h {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                parent[ri] = rj;
            }
        }
    }
    let mut groups: Vec<(usize, Bbox, usize)> = Vec::new();
    for (i, b) in boxes.iter().enumerate() {
        let g = find(&mut parent, i);
        match groups.iter_mut().find(|(k, ..)| *k == g) {
            Some((_, acc, n)) => {
                *acc = [
                    acc[0].min(b[0]),
                    acc[1].min(b[1]),
                    acc[2].max(b[2]),
                    acc[3].max(b[3]),
                ];
                *n += 1;
            }
            None => groups.push((g, *b, 1)),
        }
    }
    // Dots and accents float above their word: fold small marks into the item below.
    let tops: Vec<f64> = groups.iter().map(|g| g.1[1]).collect();
    let mut merged = vec![false; groups.len()];
    for k in 0..groups.len() {
        let g = groups[k].1;
        if g[3] - g[1] > 0.7 * h || g[2] - g[0] > 2. * h || groups[k].2 > 4 {
            continue;
        }
        let cx = (g[0] + g[2]) / 2.;
        let below = (0..groups.len())
            .filter(|&o| {
                o != k
                    && !merged[o]
                    && groups[o].1[0] - 2. <= cx
                    && cx <= groups[o].1[2] + 2.
                    && groups[o].1[3] - groups[o].1[1] > 0.6 * h
                    && (-h..=1.6 * h).contains(&(tops[o] - g[3]))
            })
            .min_by(|a, b| tops[*a].total_cmp(&tops[*b]));
        if let Some(o) = below {
            let acc = &mut groups[o].1;
            *acc = [
                acc[0].min(g[0]),
                acc[1].min(g[1]),
                acc[2].max(g[2]),
                acc[3].max(g[3]),
            ];
            groups[o].2 += groups[k].2;
            merged[k] = true;
        }
    }
    let mut items: Vec<(Bbox, usize)> = groups
        .into_iter()
        .zip(merged)
        .filter(|(_, m)| !m)
        .map(|((_, b, n), _)| (b, n))
        .collect();
    items.sort_by(|a, b| {
        let row = |x: &Bbox| (((x[1] + x[3]) / 2.) / (1.6 * h)).floor();
        row(&a.0)
            .total_cmp(&row(&b.0))
            .then(a.0[0].total_cmp(&b.0[0]))
    });
    items
}

/// Highlighter boxes of one colour that touch (within `gap`) become one region.
fn regions(marks: Vec<(Bbox, String)>, gap: f64) -> Vec<(Bbox, String)> {
    let mut out: Vec<(Bbox, String)> = Vec::new();
    for (b, c) in marks {
        let near = |a: &Bbox| {
            a[0] - gap <= b[2] && b[0] <= a[2] + gap && a[1] - gap <= b[3] && b[1] <= a[3] + gap
        };
        match out.iter_mut().find(|(a, col)| *col == c && near(a)) {
            Some((a, _)) => {
                *a = [
                    a[0].min(b[0]),
                    a[1].min(b[1]),
                    a[2].max(b[2]),
                    a[3].max(b[3]),
                ]
            }
            None => out.push((b, c)),
        }
    }
    out
}

/// The layout of the page shown at display position `display`.
pub fn page_layout(editor: &Editor, display: usize) -> Result<Value> {
    let slot = editor.slot(display)?;
    let page = editor.page(slot)?;
    let deleted = editor.deleted(slot);
    let (size, _) = editor.page_geometry(slot)?;
    let mut ink: Vec<Bbox> = Vec::new();
    let mut marks: Vec<(Bbox, String)> = Vec::new();
    let mut text_boxes = Vec::new();
    let mut images = Vec::new();
    let mut shapes = Vec::new();
    let mut tapes = Vec::new();
    for item in page
        .items
        .iter()
        .filter(|i| !deleted.contains(i.id.as_str()))
    {
        let Ok(b) = editor.current_bounds(slot, &item.id) else {
            continue;
        };
        let mut b = corners(b);
        if let Some(open) = item.tape() {
            tapes.push(json!({"id":item.id,"bbox":rounded(b),"state":if open {"revealed"} else {"covered"}}));
            continue;
        }
        if let Some(s) = &item.stroke {
            let r = s.radii.iter().copied().fold(s.radius, f64::max);
            b = [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
            if s.style.tool == 1 {
                marks.push((b, hex(&s.style.rgba)));
            } else {
                ink.push(b);
            }
            continue;
        }
        match crate::manipulation::item_geometry(item).kind {
            "text" => {
                let runs = item.text.as_ref().map(|t| t.runs.as_slice()).unwrap_or(&[]);
                let first = runs.first();
                text_boxes.push(json!({"id":item.id,"bbox":rounded(b),
                    "text":runs.iter().map(|r| r.text.as_str()).collect::<String>().trim_end_matches('\u{200b}'),
                    "font":first.map(|r| r.font_family.clone()),"size":first.map(|r| r.font_size),
                    "color":first.map(|r| hex(&r.rgba))}));
            }
            "image" => images.push(json!({"id":item.id,"bbox":rounded(b)})),
            _ => shapes.push(json!({"id":item.id,"bbox":rounded(b)})),
        }
    }
    for (id, line) in editor
        .additions(slot)
        .filter(|(id, _)| !deleted.contains(id.as_str()))
    {
        let Ok(b) = editor.current_bounds(slot, &id) else {
            continue;
        };
        let r = line
            .pressure
            .as_ref()
            .map_or(line.width / 2., |p| p.iter().copied().fold(0., f64::max));
        let b = corners(b);
        let b = [b[0] - r, b[1] - r, b[2] + r, b[3] + r];
        match line.tool {
            1 => marks.push((b, hex(&line.rgba))),
            2 => tapes.push(json!({"id":id,"bbox":rounded(b),"state":"covered"})),
            _ => ink.push(b),
        }
    }
    for (id, image) in editor
        .images(slot)
        .filter(|(id, _)| !deleted.contains(id.as_str()))
    {
        let Ok(b) = editor.current_bounds(slot, &id) else {
            continue;
        };
        match &image.text {
            Some(t) => text_boxes.push(json!({"id":id,"bbox":rounded(corners(b)),"text":t.text,"font":t.font,"size":t.font_size,"color":hex(&t.rgba)})),
            None => images.push(json!({"id":id,"bbox":rounded(corners(b))})),
        }
    }
    let items: Vec<Value> = ink_items(&ink)
        .into_iter()
        .enumerate()
        .map(|(n, (b, strokes))| json!({"id":n + 1,"bbox":rounded(b),"strokes":strokes}))
        .collect();
    let highlights: Vec<Value> = regions(marks, 8.)
        .into_iter()
        .map(|(b, c)| json!({"bbox":rounded(b),"color":c}))
        .collect();
    Ok(
        json!({"page":display + 1,"page_size":size,"items":items,"highlights":highlights,
        "text_boxes":text_boxes,"images":images,"shapes":shapes,"tapes":tapes}),
    )
}

/// An SVG overlay that outlines each numbered item and labels it, for the
/// image `page_layout` returns.
pub fn layout_overlay(layout: &Value) -> String {
    let mut out = String::new();
    for it in layout["items"].as_array().into_iter().flatten() {
        let b: Vec<f64> = it["bbox"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_f64)
            .collect();
        let [x0, y0, x1, y1] = <[f64; 4]>::try_from(b).unwrap_or_default();
        let label = it["id"].as_u64().unwrap_or(0).to_string();
        let tw = 9. * label.len() as f64 + 6.;
        out.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"#e63c3c\" stroke-width=\"1.5\"/><rect x=\"{}\" y=\"{}\" width=\"{tw}\" height=\"15\" fill=\"#e63c3c\"/><text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#fff\">{label}</text>",
            x0 - 2., y0 - 2., x1 - x0 + 4., y1 - y0 + 4., x0 - 2., y0 - 17., x0 + 1., y0 - 5.
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::{annotate, compose, new_notebook, ComposeOptions, Item, Look};

    #[test]
    fn words_become_numbered_items_in_reading_order() {
        let md = "first line here\n\nsecond words ==marked==";
        let o = ComposeOptions {
            look: Look::Classic,
            ..ComposeOptions::default()
        };
        let (pages, _) = compose(md, &o).unwrap();
        let mut editor =
            Editor::open(&new_notebook("L", &pages).unwrap().export_noteful().unwrap()).unwrap();
        let items: Vec<Item> =
            serde_json::from_str(r#"[{"type":"textbox","text":"Score 3/3","x":700,"y":100}]"#)
                .unwrap();
        let a = annotate(&items, 1).unwrap();
        for tb in a.text_boxes {
            editor.add_image(0, tb).unwrap();
        }
        let l = page_layout(&editor, 0).unwrap();
        let items = l["items"].as_array().unwrap();
        // "first", "line", "here" are one row; the second paragraph is lower.
        assert!(items.len() >= 2 && items.len() <= 7, "{items:?}");
        let y = |i: usize| items[i]["bbox"][1].as_f64().unwrap();
        assert!(y(items.len() - 1) > y(0));
        assert_eq!(l["highlights"].as_array().unwrap().len(), 1);
        assert_eq!(l["text_boxes"][0]["text"], "Score 3/3");
        assert!(layout_overlay(&l).contains("<rect"));
    }
}
