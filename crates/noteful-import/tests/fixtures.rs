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
    // What was imported is the note itself, not edits on it.
    assert_eq!(imported.editor.view(0).unwrap()["edit_count"], 0);
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
                    }),
                    joined: false,
                    part: None,
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
