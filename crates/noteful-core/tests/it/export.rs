use noteful_core::{Editor, Layer, Line, Package};
fn line(layer: u32, tool: u16) -> Line {
    Line {
        part: None,
        points: vec![[10., 10.], [30., 20.], [45., 60.], [66., 80.], [90., 15.]],
        width: 8.,
        rgba: [1., 0.8, 0., 1.],
        layer,
        shape: None,
        square: false,
        pressure: None,
        under: false,
        joined: false,
        tool,
    }
}
#[test]
fn native_export_preserves_resources_and_applies_visible_history() {
    let source = crate::samples::PRACTICE_BOOK;
    let original = Package::parse(source).unwrap();
    let mut editor = Editor::open(source).unwrap();
    assert_eq!(editor.export_noteful().unwrap(), source);
    editor.add_line(0, line(0, 1)).unwrap();
    let ink = original
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    editor.erase_path(8, &[ink.points[0]], 1.).unwrap();
    let data = editor.export_noteful().unwrap();
    let package = Package::parse(&data).unwrap();
    let read = Editor::open(&data).unwrap();
    for block in original
        .blocks
        .iter()
        .filter(|b| ["pdf", "m4a", "jpeg"].contains(&b.kind))
    {
        assert_eq!(original.resource(&block.id), package.resource(&block.id));
    }
    assert_eq!(read.view(0).unwrap()["visible_imported"], 1);
    assert_eq!(read.view(8).unwrap()["visible_imported"], 2);
    let new = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .find(|s| s.style.tool == 1)
        .unwrap();
    assert_eq!(new.radius, 4.);
    assert_eq!(new.points.len(), 5);
    for (a, b) in new.points.iter().zip(line(0, 1).points) {
        assert!((a[0] - b[0]).abs() < 0.002);
        assert!((a[1] - b[1]).abs() < 0.002);
    }
    assert!(read.scene.pages[0].timings.is_empty());
    editor.undo();
    assert_eq!(
        Editor::open(&editor.export_noteful().unwrap())
            .unwrap()
            .view(8)
            .unwrap()["visible_imported"],
        3
    );
}
#[test]
fn layers_export_lock_visibility_and_old_projects() {
    let mut e = Editor::open(crate::samples::TEXT).unwrap();
    let layer = Layer {
        id: 1,
        name: "Highlights".into(),
        ..Default::default()
    };
    e.set_layer(layer.clone()).unwrap();
    e.add_line(0, line(1, 1)).unwrap();
    let mut hidden = layer.clone();
    hidden.visible = false;
    e.set_layer(hidden).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    assert!(e.add_line(0, line(1, 0)).is_err());
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.layers().len(), 2);
    assert!(!read.layers()[1].visible);
    assert_eq!(read.view(0).unwrap()["texts"].as_array().unwrap().len(), 3);
    e.undo();
    assert_eq!(e.view(0).unwrap()["visible_added"], 1);
    let mut locked = layer;
    locked.locked = true;
    e.set_layer(locked).unwrap();
    assert_eq!(e.erase_path(0, &[[10., 10.]], 1.).unwrap(), 0);
    let old = crate::samples::EDITING_DEMO;
    assert!(Editor::open_project(old).is_ok());
}
#[test]
fn native_export_removes_straight_line_object_and_keeps_unknown_metadata() {
    let mut e = Editor::open(crate::samples::LINE_TOOL).unwrap();
    e.erase_path(0, &[[299.6000737915465, 439.85772508134784]], 1.)
        .unwrap();
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.view(0).unwrap()["visible_imported"], 0);
    assert_eq!(Package::parse(&data).unwrap().rebuild().unwrap(), data);
}
#[test]
fn empty_note_gets_a_new_editable_block_and_index_entry() {
    let mut e = Editor::open(crate::samples::BLANK).unwrap();
    e.add_line(0, line(0, 0)).unwrap();
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.view(0).unwrap()["visible_imported"], 1);
    assert!(read.scene.pages[0].pdf_background.is_some());
}
#[test]
fn shape_corners_resize_undo_project_reload_and_native_geometry() {
    use noteful_core::{Shape, ShapeKind};
    let mut e = Editor::open(crate::samples::BLANK).unwrap();
    let mut l = line(0, 0);
    l.shape = Some(Shape {
        fill: None,
        kind: ShapeKind::Rectangle,
        start: [100., 100.],
        end: [200., 200.],
    });
    e.add_line(0, l).unwrap();
    let before = e.view(0).unwrap()["svg"].clone();
    e.resize_shape(
        0,
        "new:0",
        Shape {
            fill: None,
            kind: ShapeKind::Rectangle,
            start: [80., 90.],
            end: [250., 280.],
        },
    )
    .unwrap();
    let saved = e.save_project().unwrap();
    let loaded = Editor::open_project(&saved).unwrap();
    assert_eq!(loaded.view(0).unwrap(), e.view(0).unwrap());
    let data = e.export_noteful().unwrap();
    let package = Package::parse(&data).unwrap();
    let stroke = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    assert_eq!(stroke.points[0], [80., 90.]);
    assert_eq!(stroke.points[2], [250., 280.]);
    e.undo();
    assert_eq!(e.view(0).unwrap()["svg"], before);
    e.redo();
    assert!(e
        .resize_shape(
            0,
            "new:0",
            Shape {
                fill: None,
                kind: ShapeKind::Ellipse,
                start: [0., 0.],
                end: [1., 1.]
            }
        )
        .is_err());
    e.erase_path(0, &[[80., 90.]], 1.).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    assert!(e
        .resize_shape(
            0,
            "new:0",
            Shape {
                fill: None,
                kind: ShapeKind::Rectangle,
                start: [0., 0.],
                end: [1., 1.]
            }
        )
        .is_err());
}

#[test]
fn square_highlight_bands_have_square_ends_and_stay_inside_their_box_in_noteful() {
    let mut e = Editor::open(crate::samples::BLANK).unwrap();
    let band = Line {
        part: None,
        points: vec![[100., 200.], [300., 200.]],
        width: 120.,
        rgba: [1., 0.9, 0., 1.],
        tool: 1,
        layer: 0,
        shape: None,
        square: true,
        pressure: None,
        under: false,
        joined: false,
    };
    assert!(
        e.add_line(
            0,
            Line {
                square: false,
                pressure: None,
                under: false,
                joined: false,
                ..band.clone()
            }
        )
        .is_err(),
        "round highlighter is limited to 100"
    );
    e.add_line(0, band).unwrap();
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    assert!(svg.contains("stroke-linecap=\"butt\"") && svg.contains("mix-blend-mode:multiply"));
    let bytes = e.export_noteful().unwrap();
    let native = Editor::open(&bytes).unwrap();
    assert_eq!(native.view(0).unwrap()["visible_imported"], 1);
    // Noteful's round ends (radius 60) now reach exactly x = 100 and 300.
    let package = noteful_core::Package::parse(&bytes).unwrap();
    let stroke = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    let xs: Vec<f64> = stroke.points.iter().map(|p| p[0]).collect();
    assert!(
        (xs[0] - 160.).abs() < 0.5 && (xs.last().unwrap() - 240.).abs() < 0.5,
        "{xs:?}"
    );
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(restored.view(0).unwrap(), e.view(0).unwrap());
}

#[test]
fn content_digest_matches_noteful_export_before_and_after_edits() {
    let mut e = Editor::open(crate::samples::BLANK).unwrap();
    let initial = e.content_digest().unwrap();
    assert_eq!(initial.len(), 32);

    e.add_line(
        0,
        Line {
            part: None,
            points: vec![[20., 30.], [80., 90.]],
            width: 3.,
            rgba: [0.1, 0.2, 0.3, 1.],
            tool: 0,
            layer: 0,
            shape: None,
            square: false,
            pressure: None,
            under: false,
            joined: false,
        },
    )
    .unwrap();
    let edited = e.content_digest().unwrap();
    assert_ne!(edited, initial);
    let exported = e.export_noteful().unwrap();
    let reopened = Editor::open(&exported).unwrap();
    assert_eq!(reopened.content_digest().unwrap(), edited);

    e.undo();
    assert_eq!(e.content_digest().unwrap(), initial);

    e.set_canvas(true).unwrap();
    assert!(e.content_digest().is_err());
}

fn find_field(fields: &[noteful_core::Field], tag: u16) -> Option<&noteful_core::Field> {
    fields.iter().find(|f| f.tag == tag)
}

fn assert_noteful_native_structure(bytes: &[u8], expected_pages: usize) {
    use noteful_core::{decode_fields, WireValue as V};

    let package = Package::parse(bytes).unwrap();
    let version = match find_field(&package.index, 1).unwrap().value {
        V::Float(v) => v,
        ref other => panic!("expected float version, got {other:?}"),
    };
    assert!(
        (version - 1.21).abs() < 1e-4,
        "unexpected index version {version}"
    );
    let note_ids = find_field(&package.index, 2)
        .unwrap()
        .value
        .as_array()
        .unwrap();
    assert_eq!(note_ids.len(), 1);
    let note_id = note_ids[0].as_text().unwrap();
    assert_eq!(note_id.len(), 32);
    assert!(note_id
        .bytes()
        .all(|b| matches!(b, b'0'..=b'9' | b'A'..=b'F')));

    let note_raw = package.resource(&format!("n:{note_id}")).unwrap();
    let note_fields = decode_fields(note_raw, 0).unwrap();
    assert_eq!(
        find_field(&note_fields, 1).unwrap().value.as_text(),
        Some(note_id)
    );
    assert!(find_field(&note_fields, 3).unwrap().clock.is_some());
    let cover_field = find_field(&note_fields, 7)
        .unwrap()
        .value
        .as_fields()
        .unwrap();
    let cover_id = find_field(cover_field, 1).unwrap().value.as_text().unwrap();
    assert!(package
        .resource(cover_id)
        .unwrap()
        .starts_with(b"\xff\xd8\xff"));
    assert_eq!(
        find_field(&note_fields, 9).unwrap().value.as_text(),
        Some("")
    );

    let draw_raw = package.resource(&format!("d:{note_id}")).unwrap();
    let draw_fields = decode_fields(draw_raw, 0).unwrap();
    assert_eq!(
        find_field(&draw_fields, 1).unwrap().value.as_text(),
        Some(note_id)
    );
    let layer_col = find_field(&draw_fields, 3)
        .unwrap()
        .value
        .as_fields()
        .unwrap();
    let layers = find_field(layer_col, 0).unwrap().value.as_array().unwrap();
    assert!(
        !layers.is_empty(),
        "drawing metadata must include at least one layer"
    );

    let page_col = find_field(&draw_fields, 2)
        .unwrap()
        .value
        .as_fields()
        .unwrap();
    let pages = find_field(page_col, 0).unwrap().value.as_array().unwrap();
    assert_eq!(pages.len(), expected_pages);
    for page in pages {
        let pfs = page.as_fields().expect("expected nested page fields");
        assert!(find_field(pfs, 4).unwrap().clock.is_some());
        assert!(find_field(pfs, 5).unwrap().clock.is_some());
        assert!(find_field(pfs, 6).is_some());
        assert!(find_field(pfs, 7).is_some());
        assert!(find_field(pfs, 9).is_some());
        let bg = find_field(pfs, 4).unwrap().value.as_fields().unwrap();
        let bg_kind = find_field(bg, 0).unwrap();
        assert_eq!(bg_kind.wire_type, 0x0011);
        assert_eq!(bg_kind.value.as_uint(), Some(1));
        assert!(find_field(bg, 2).is_some());
        assert!(find_field(bg, 5).is_some());
    }
}

#[test]
fn created_blank_pdf_and_notebook_packages_match_noteful_structure() {
    let blank_editor =
        Editor::create_document("Blank Check", &[[595.28, 841.89], [595.28, 841.89]], &[]).unwrap();
    let blank_bytes = blank_editor.export_noteful().unwrap();
    assert_noteful_native_structure(&blank_bytes, 2);
    let reopened_blank = Editor::open(&blank_bytes).unwrap();
    assert_eq!(reopened_blank.scene.pages.len(), 2);
    let bg_res = reopened_blank.scene.pages[0]
        .pdf_background
        .as_ref()
        .unwrap()
        .resource_id
        .clone();
    assert!(reopened_blank
        .pdf_bytes(&bg_res)
        .unwrap()
        .starts_with(b"%PDF-"));
    assert_eq!(
        Package::parse(&blank_bytes).unwrap().rebuild().unwrap(),
        blank_bytes
    );

    let dot_page = noteful_core::ink::InkPage {
        lines: vec![],
        under: vec![],
        text_boxes: vec![],
        paper: noteful_core::ink::Paper::DOT,
        words: vec![],
    };
    let notebook_editor =
        noteful_core::ink::new_notebook("Notebook Check", &[dot_page.clone(), dot_page]).unwrap();
    let notebook_bytes = notebook_editor.export_noteful().unwrap();
    assert_noteful_native_structure(&notebook_bytes, 2);
    assert_eq!(
        Package::parse(&notebook_bytes).unwrap().rebuild().unwrap(),
        notebook_bytes
    );
}

#[test]
fn legacy_notecomplete_package_is_repaired_both_explicitly_and_on_export() {
    use noteful_core::{encode_fields, repair_noteful, Field, WireValue as V};

    let f = |tag: u16, wire_type: u16, value: V| Field {
        tag,
        wire_type,
        value,
        offset: 0,
        size: 0,
        clock: None,
    };

    let page_record = vec![
        f(1, 0x0005, V::Text("page-0".into())),
        f(
            4,
            0x0007,
            V::Fields(vec![
                f(0, 0x0001, V::UInt(0)),
                f(1, 0x0021, V::Pair([595.28, 841.89])),
            ]),
        ),
        f(5, 0x0005, V::Text(String::new())),
    ];
    let draw_meta = encode_fields(&[
        f(
            2,
            0x0007,
            V::Fields(vec![f(0, 0x0407, V::Array(vec![V::Fields(page_record)]))]),
        ),
        f(3, 0x0007, V::Fields(vec![f(0, 0x0407, V::Array(vec![]))])),
    ])
    .unwrap();
    let note_meta = encode_fields(&[f(3, 0x0005, V::Text("Legacy Exam".into()))]).unwrap();
    let blocks = [
        ("n:imported", note_meta.as_slice()),
        ("d:imported", draw_meta.as_slice()),
    ];
    let off0 = noteful_core::MAGIC.len() as u64;
    let off1 = off0 + note_meta.len() as u64;
    let index = vec![
        f(1, 0x0003, V::Float(1.0)),
        f(3, 0x0405, V::Array(vec![])),
        f(4, 0x0405, V::Array(vec![])),
        f(
            10,
            0x0405,
            V::Array(blocks.iter().map(|(id, _)| V::Text((*id).into())).collect()),
        ),
        f(11, 0x0401, V::Array(vec![V::UInt(off0), V::UInt(off1)])),
        f(
            12,
            0x0401,
            V::Array(vec![
                V::UInt(note_meta.len() as u64),
                V::UInt(draw_meta.len() as u64),
            ]),
        ),
    ];
    let trailer = encode_fields(&index).unwrap();
    let mut legacy = noteful_core::MAGIC.to_vec();
    for (_, bytes) in &blocks {
        legacy.extend_from_slice(bytes);
    }
    let idx_offset = legacy.len() as u64;
    legacy.extend_from_slice(&trailer);
    legacy.extend_from_slice(&noteful_core::MAGIC);
    legacy.extend_from_slice(&idx_offset.to_be_bytes());
    legacy.extend_from_slice(&(trailer.len() as u32).to_be_bytes());

    // Explicit repair
    let repaired = repair_noteful(&legacy).unwrap();
    assert_noteful_native_structure(&repaired, 1);
    let opened_repaired = Editor::open(&repaired).unwrap();
    assert_eq!(opened_repaired.scene.title, "Legacy Exam");
    let bg_res = opened_repaired.scene.pages[0]
        .pdf_background
        .as_ref()
        .unwrap()
        .resource_id
        .clone();
    assert!(opened_repaired
        .pdf_bytes(&bg_res)
        .unwrap()
        .starts_with(b"%PDF-"));

    // Automatic upgrade during Editor::open + export_noteful
    let auto_exported = Editor::open(&legacy).unwrap().export_noteful().unwrap();
    assert_noteful_native_structure(&auto_exported, 1);
}

#[test]
fn added_ink_and_text_boxes_stack_in_the_order_they_were_made() {
    use noteful_core::{Image, TextBox};
    let mut e = Editor::create_document("Order", &[[600., 800.]], &[]).unwrap();
    let text = Image {
        base64: String::new(),
        mime: String::new(),
        bounds: [20., 20., 200., 60.],
        layer: 0,
        text: Some(TextBox {
            text: "encima".into(),
            font_size: 20.,
            rgba: [0., 0., 0., 1.],
            bold: false,
            italic: false,
            font: "Helvetica".into(),
            align: 0,
            underline: false,
            strikethrough: false,
            math: false,
            line_height: None,
            spans: vec![],
        }),
        joined: false,
        part: None,
        under: false,
    };
    e.add_line(0, line(0, 1)).unwrap();
    e.add_image(0, text).unwrap();
    e.add_line(0, line(0, 1)).unwrap();
    // On the page: the first stroke, the text box over it, the second stroke over both.
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    let at = |needle: &str| {
        svg.find(needle)
            .unwrap_or_else(|| panic!("{needle} in {svg}"))
    };
    assert!(at("data-item=\"new:0\"") < at("data-item=\"image:1\""));
    assert!(at("data-item=\"image:1\"") < at("data-item=\"new:2\""));
    // In the native file, by z: Noteful (and the reader) draw them in the same order.
    let native = Editor::open(&e.export_noteful().unwrap()).unwrap();
    let svg = native.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    let strokes: Vec<usize> = svg
        .match_indices("data-item=\"stroke:")
        .map(|(i, _)| i)
        .collect();
    let text_at = svg.find(">encima<").unwrap();
    assert_eq!(strokes.len(), 2, "{svg}");
    assert!(
        strokes[0] < text_at && text_at < strokes[1],
        "stroke, text, stroke: {svg}"
    );
}

#[test]
fn a_notes_own_order_of_pictures_and_ink_is_kept_through_edits() {
    use noteful_core::Image;
    let picture = |x: f64| {
        Image {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=".into(),
        mime: "image/png".into(),
        bounds: [x, 30., 300., 300.],
        layer: 0,
        text: None,
        joined: false,
        part: None,
        under: false,
    }
    };
    // What each item of a page is, in the order it is drawn: `p` a picture, `s` ink.
    let drawn = |e: &Editor| -> String {
        let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
        svg.split("data-item=\"")
            .skip(1)
            .map(|rest| {
                if rest[..rest.find("</g>").unwrap()].contains("<image") {
                    'p'
                } else {
                    's'
                }
            })
            .collect()
    };
    // A note whose file has a picture under a stroke, then a picture over both (as an
    // imported Goodnotes or Noteful page can).
    let mut e = Editor::create_document("Order", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, picture(20.)).unwrap();
    e.add_line(0, line(0, 1)).unwrap();
    e.add_image(0, picture(200.)).unwrap();
    let note = Editor::open(&e.export_noteful().unwrap()).unwrap();
    assert_eq!(drawn(&note), "psp");
    // Edited: ink and a picture added after it are over the note's own items, and the
    // note's items keep their order when it is saved again.
    let mut edited = note;
    edited.add_line(0, line(0, 1)).unwrap();
    edited.add_image(0, picture(100.)).unwrap();
    edited.add_line(0, line(0, 1)).unwrap();
    assert_eq!(drawn(&edited), "pspsps");
    let saved = Editor::open(&edited.export_noteful().unwrap()).unwrap();
    assert_eq!(drawn(&saved), "pspsps");
}
