//! The importer over small Goodnotes and Notability notebooks (tests/fixtures/import).
use noteful_core::{Editor, Image, Line, ProjectExportOptions, TextBox};
use noteful_import::{format_of, import};

fn fixture(name: &str) -> Vec<u8> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/import/");
    std::fs::read(format!("{path}{name}")).unwrap()
}

/// Strokes, text boxes and the PDF (resource, page) behind a page.
type PageFacts = (usize, usize, Option<(String, u64)>);

/// Each page of the note, in page order.
fn pages(editor: &Editor) -> Vec<PageFacts> {
    editor
        .page_order()
        .into_iter()
        .map(|slot| {
            let view = editor.view(slot).unwrap();
            let svg = view["svg"].as_str().unwrap();
            let pdf = view["pdf_background"].as_object().map(|b| {
                (
                    b["resource_id"].as_str().unwrap().to_owned(),
                    b["page_index"].as_u64().unwrap(),
                )
            });
            (
                svg.matches("data-item=\"stroke:").count()
                    + svg.matches("data-item=\"new:").count(),
                view["texts"].as_array().unwrap().len(),
                pdf,
            )
        })
        .collect()
}

#[test]
fn notebooks_are_told_apart() {
    assert_eq!(
        format_of(&fixture("goodnotes-basic.goodnotes")),
        Some("goodnotes")
    );
    assert_eq!(
        format_of(&fixture("goodnotes-pdf.goodnotes")),
        Some("goodnotes")
    );
    assert_eq!(
        format_of(&fixture("notability-basic.ntb")),
        Some("notability")
    );
    assert_eq!(
        format_of(&fixture("notability-pdf.ntb")),
        Some("notability")
    );
    assert_eq!(format_of(&fixture("README.md")), None);
    assert_eq!(format_of(b"PK\x03\x04 not a zip"), None);
    assert!(import("x.goodnotes", b"PK\x03\x04 not a zip").is_err());
}

#[test]
fn goodnotes_ink_text_shapes_and_pictures() {
    let bytes = fixture("goodnotes-basic.goodnotes");
    let imported = import("Lecture 3.goodnotes", &bytes).unwrap();
    assert!(imported.warnings.is_empty(), "{:?}", imported.warnings);
    let pages = pages(&imported.editor);
    assert_eq!(pages.len(), 2);
    // Three strokes and two shapes, one text box; then two strokes (and the picture).
    assert!(pages[0].0 >= 5 && pages[0].1 == 1, "{pages:?}");
    assert_eq!(pages[1].0, 2);
    let view = imported.editor.view(1).unwrap();
    assert!(
        view["svg"].as_str().unwrap().contains("<image"),
        "the picture"
    );
    let origin = imported.editor.origin().unwrap();
    assert_eq!(
        (origin.format.as_str(), origin.name.as_str()),
        ("goodnotes", "Lecture 3.goodnotes")
    );
    assert_eq!(origin.bytes, bytes);
    // What was imported is locked under the undo floor, while its shapes stay real editable shapes.
    let v0 = imported.editor.view(0).unwrap();
    assert_eq!(v0["can_undo"], false);
    assert_eq!(v0["shapes"].as_array().unwrap().len(), 2);
}

#[test]
fn notebook_pdfs_stay_vector_page_backgrounds() {
    let imported = import("Worksheet.goodnotes", &fixture("goodnotes-pdf.goodnotes")).unwrap();
    let pages = pages(&imported.editor);
    assert_eq!(pages.len(), 2);
    let (a, b) = (pages[0].2.clone().unwrap(), pages[1].2.clone().unwrap());
    assert_eq!(
        (a.0 == b.0, a.1, b.1),
        (true, 0, 1),
        "one PDF, its pages 1 and 2"
    );
    assert!(pages.iter().all(|p| p.0 == 1));

    let imported = import("Worksheet.ntb", &fixture("notability-pdf.ntb")).unwrap();
    let pages = self::pages(&imported.editor);
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].0, 1);
    assert_eq!(pages[0].2.as_ref().unwrap().1, 0);
}

#[test]
fn notability_points_become_page_units_and_paper_a_pdf() {
    let imported = import("Biology.ntb", &fixture("notability-basic.ntb")).unwrap();
    let pages = pages(&imported.editor);
    assert_eq!(pages.len(), 2);
    assert!(pages[0].0 >= 4 && pages[1].0 == 2, "{pages:?}");
    // The grid paper is drawn into a PDF behind both pages.
    assert!(pages.iter().all(|p| p.2.is_some()));
    let size = imported.editor.view(0).unwrap()["size"].clone();
    let w = size[0].as_f64().unwrap();
    assert!(
        (w - 595.28 * 11. / 6.).abs() < 0.5,
        "A4 in page units, not points: {w}"
    );
}

#[test]
fn imported_notes_edit_save_and_reopen_like_any_note() {
    for name in [
        "goodnotes-basic.goodnotes",
        "goodnotes-pdf.goodnotes",
        "notability-basic.ntb",
        "notability-pdf.ntb",
    ] {
        let bytes = fixture(name);
        let mut editor = import(name, &bytes).unwrap().editor;
        let before = pages(&editor);
        editor
            .add_line(
                0,
                Line::new(vec![[50., 50.], [300., 80.]], 3., [0., 0., 1., 1.]),
            )
            .unwrap();
        editor
            .add_image(
                0,
                Image {
                    base64: String::new(),
                    mime: String::new(),
                    bounds: [60., 900., 300., 40.],
                    layer: 0,
                    text: Some(TextBox {
                        text: "Added in NoteComplete".into(),
                        font_size: 24.,
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
                },
            )
            .unwrap();
        editor
            .set_markdown("# Notes\n\nKept with the notebook.")
            .unwrap();
        editor.undo();
        editor.redo();
        let after = pages(&editor);
        assert_eq!(
            (after[0].0, after[0].1),
            (before[0].0 + 1, before[0].1 + 1),
            "{name}"
        );

        // The .nfedit keeps the edits, the Markdown and the notebook it came from.
        let archive = editor.save_project_archive().unwrap();
        let reopened = Editor::open_project_bytes(&archive).unwrap();
        assert_eq!(pages(&reopened), after, "{name}");
        assert_eq!(reopened.markdown(), "# Notes\n\nKept with the notebook.");
        assert_eq!(reopened.origin().unwrap().bytes, bytes, "{name}");
        assert!(reopened.view(0).unwrap()["can_undo"].as_bool().unwrap());
        // Its JSON form (autosave) too.
        let json = editor.save_project().unwrap();
        assert_eq!(
            pages(&Editor::open_project(&json).unwrap()),
            after,
            "{name}"
        );
        // A filtered copy keeps the edits.
        let filtered = editor
            .export_filtered_project_archive(ProjectExportOptions::default())
            .unwrap();
        assert_eq!(
            pages(&Editor::open_project_bytes(&filtered).unwrap()).len(),
            after.len()
        );

        // And the plain Noteful note other apps read.
        let noteful = editor.export_noteful().unwrap();
        assert_eq!(pages(&Editor::open(&noteful).unwrap()), after, "{name}");
    }
}

const PHOTO: &str = "0000009A-0000-4000-8000-0000ABCDEF01";

/// A Goodnotes notebook of one page with these elements, written by oblyx's writer in this
/// order (each element's clock follows it), with the 8×8 PNG of `goodnotes-basic` as `PHOTO`.
fn goodnotes_page(items: Vec<oblyx::doc::Item>) -> Vec<u8> {
    let png = oblyx::doc::Document::from_bytes(fixture("goodnotes-basic.goodnotes"))
        .unwrap()
        .attachments
        .values()
        .find(|b| b.starts_with(b"\x89PNG"))
        .unwrap()
        .to_vec();
    let mut doc = oblyx::doc::Document::empty();
    doc.insert_attachment(PHOTO, png);
    let page = oblyx::doc::Page::new("page", items);
    let written = oblyx::goodnotes_write::write_goodnotes_to_vec(&[page], &doc).unwrap();
    // The writer stores the picture under a new id but keeps `PHOTO` in the page: the
    // picture is listed again under `PHOTO` (one index record: 1 id, 2 path).
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(written)).unwrap();
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).unwrap();
        if name == "index.attachments.pb" {
            let path = format!("attachments/{PHOTO}");
            let mut rec = vec![0x0a, PHOTO.len() as u8];
            rec.extend_from_slice(PHOTO.as_bytes());
            rec.extend_from_slice(&[0x12, path.len() as u8]);
            rec.extend_from_slice(path.as_bytes());
            bytes.push(rec.len() as u8);
            bytes.extend_from_slice(&rec);
        }
        out.start_file(name.as_str(), opts).unwrap();
        std::io::Write::write_all(&mut out, &bytes).unwrap();
    }
    out.start_file(format!("attachments/{PHOTO}"), opts)
        .unwrap();
    std::io::Write::write_all(&mut out, &doc.attachments[PHOTO]).unwrap();
    out.finish().unwrap().into_inner()
}

fn stroke(x: f32) -> oblyx::doc::Item {
    oblyx::doc::Item::Stroke(oblyx::doc::Stroke {
        points: vec![[x, 100.], [x + 50., 400.]],
        width: 3.,
        rgba: [0., 0., 1., 1.],
        dash: None,
        parented: false,
    })
}

fn photo() -> oblyx::doc::Item {
    oblyx::doc::Item::Image(oblyx::doc::ImageEl {
        attachment: PHOTO.into(),
        x: 50.,
        y: 50.,
        w: 500.,
        h: 500.,
        from_frame: false,
        bytes: None,
    })
}

/// The kinds of a page's items in the order the reader draws them: `s` ink, `p` a picture.
fn drawn(editor: &Editor, page: usize) -> String {
    let view = editor.view(page).unwrap();
    let svg = view["svg"].as_str().unwrap();
    svg.split("data-item=\"")
        .skip(1)
        .map(|rest| {
            let item = &rest[..rest.find('"').unwrap()];
            let body = &rest[..rest.find("</g>").unwrap_or(rest.len())];
            if body.contains("<image") {
                'p'
            } else if item.starts_with("stroke:") || item.starts_with("new:") {
                's'
            } else {
                '?'
            }
        })
        .collect()
}

#[test]
fn goodnotes_pictures_stay_under_the_ink() {
    // Ink written before and after a pasted picture: Goodnotes keeps pictures under the ink,
    // so both strokes are drawn over it, in the note and in the Noteful file it saves.
    let bytes = goodnotes_page(vec![stroke(100.), photo(), stroke(300.)]);
    let editor = import("Photo.goodnotes", &bytes).unwrap().editor;
    assert_eq!(drawn(&editor, 0), "pss");
    let note = editor.export_noteful().unwrap();
    assert_eq!(drawn(&Editor::open(&note).unwrap(), 0), "pss");
    // A picture pasted last does not cover the handwriting either.
    let bytes = goodnotes_page(vec![stroke(100.), stroke(300.), photo()]);
    let editor = import("Photo.goodnotes", &bytes).unwrap().editor;
    assert_eq!(drawn(&editor, 0), "pss");
}

#[test]
fn goodnotes_filled_shapes_stay_real_editable_shapes_without_flattening() {
    use oblyx::doc::{Item, ShapeEl, ShapeKind};
    let rect = Item::Shape(ShapeEl {
        kind: ShapeKind::Rect,
        x: 100.,
        y: 120.,
        w: 180.,
        h: 90.,
        points: vec![],
        rotation: 0.,
        fill: [0.2, 0.4, 0.8, 0.25],
        stroke: [0.2, 0.4, 0.8, 1.0],
        width: 2.,
        dash: None,
        radius: 0.,
        uuid: None,
        from_f9: false,
    });
    let bytes = goodnotes_page(vec![rect]);
    let imported = import("Shapes.goodnotes", &bytes).unwrap();
    assert!(imported.warnings.is_empty(), "{:?}", imported.warnings);
    let view = imported.editor.view(0).unwrap();
    let shapes = view["shapes"].as_array().unwrap();
    assert_eq!(shapes.len(), 1, "shape must stay a real Shape object");
    assert_eq!(shapes[0]["line"]["shape"]["kind"], "rectangle");
    assert!(shapes[0]["line"]["shape"]["fill"].is_array());
    // Must not have been flattened into highlighter bands (tool == 1).
    assert!(!view["svg"]
        .as_str()
        .unwrap()
        .contains("mix-blend-mode:multiply"));
}

#[test]
fn ink_added_over_an_imported_picture_is_on_top() {
    let bytes = goodnotes_page(vec![photo(), stroke(100.)]);
    let mut editor = import("Photo.goodnotes", &bytes).unwrap().editor;
    editor
        .add_line(
            0,
            Line::new(vec![[60., 60.], [500., 500.]], 4., [1., 0., 0., 1.]),
        )
        .unwrap();
    assert_eq!(drawn(&editor, 0), "pss");
    let note = editor.export_noteful().unwrap();
    assert_eq!(drawn(&Editor::open(&note).unwrap(), 0), "pss");
}
