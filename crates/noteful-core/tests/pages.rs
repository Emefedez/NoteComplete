use base64::{engine::general_purpose::STANDARD, Engine};
use noteful_core::{Editor, Line, NewPage, NewPdf, Package, PdfPlacement};

fn line() -> Line {
    Line {
        points: vec![[10., 10.], [80., 40.], [120., 90.]],
        width: 4.,
        rgba: [0., 0., 1., 1.],
        tool: 0,
        layer: 0,
        shape: None,
        square: false,
    }
}
fn blank(w: f64, h: f64) -> NewPage {
    NewPage {
        size: [w, h],
        pdf: None,
    }
}
fn sizes(editor: &Editor) -> Vec<[f64; 2]> {
    serde_json::from_value(editor.view(0).unwrap()["page_sizes"].clone()).unwrap()
}

#[test]
fn inserted_pages_keep_earlier_edits_on_their_pages_through_undo_project_and_export() {
    let source = include_bytes!("../../../samples/Examen wuolah.noteful");
    let mut editor = Editor::open(source).unwrap();
    let original = sizes(&editor);
    assert_eq!(original.len(), 3);
    // Ink on the second page, then a wide blank page inserted before it.
    editor.add_line(1, line()).unwrap();
    editor
        .insert_pages(1, vec![blank(2000., 1000.)], None)
        .unwrap();
    assert_eq!(editor.page_order(), vec![0, 3, 1, 2]);
    assert_eq!(sizes(&editor)[1], [2000., 1000.]);
    let second = editor.slot(2).unwrap();
    assert_eq!(second, 1);
    assert_eq!(editor.view(second).unwrap()["visible_added"], 1);
    assert_eq!(editor.view(second).unwrap()["page"], 2);
    // Draw on the inserted page by its slot; insert at both ends too.
    let inserted = editor.slot(1).unwrap();
    editor.add_line(inserted, line()).unwrap();
    editor
        .insert_pages(0, vec![blank(500., 700.)], None)
        .unwrap();
    editor
        .insert_pages(5, vec![blank(600., 600.)], None)
        .unwrap();
    assert_eq!(editor.page_order(), vec![4, 0, 3, 1, 2, 5]);
    // Undo the last insertion, then redo it.
    editor.undo();
    assert_eq!(editor.page_order().len(), 5);
    editor.redo();
    assert_eq!(editor.page_order().len(), 6);

    let reopened = Editor::open_project(&editor.save_project().unwrap()).unwrap();
    assert_eq!(reopened.page_order(), editor.page_order());
    assert_eq!(sizes(&reopened), sizes(&editor));

    let bytes = editor.export_noteful().unwrap();
    assert_eq!(Package::parse(&bytes).unwrap().rebuild().unwrap(), bytes);
    let native = Editor::open(&bytes).unwrap();
    let exported = sizes(&native);
    assert_eq!(
        exported,
        sizes(&editor),
        "native page order follows the display order"
    );
    assert_eq!(exported[1], original[0]);
    assert_eq!(exported[2], [2000., 1000.]);
    assert_eq!(
        native.view(2).unwrap()["visible_imported"],
        1,
        "ink drawn on the inserted page"
    );
    let before = Editor::open(source).unwrap().view(1).unwrap()["visible_imported"]
        .as_u64()
        .unwrap();
    assert_eq!(
        native.view(3).unwrap()["visible_imported"]
            .as_u64()
            .unwrap(),
        before + 1,
        "ink drawn before the insertion stays on the original second page"
    );
}

#[test]
fn inserted_pdf_pages_embed_the_pdf_and_place_it_in_a_wider_page() {
    let pdf = b"%PDF-1.7\ninserted slides\n%%EOF".to_vec();
    let mut editor = Editor::create_document("Base", &[[1091., 1543.]], &[]).unwrap();
    let pages = (0..2)
        .map(|i| NewPage {
            size: [2242.6, 990.],
            pdf: Some(PdfPlacement {
                resource: "slides-1".into(),
                page_index: i,
                rect: Some([0., 0., 1320., 990.]),
            }),
        })
        .collect();
    let new = NewPdf {
        id: "slides-1".into(),
        base64: STANDARD.encode(&pdf),
    };
    editor.insert_pages(1, pages, Some(new)).unwrap();
    assert_eq!(editor.pdf_bytes("slides-1").unwrap(), pdf);
    let wide = editor.view(editor.slot(2).unwrap()).unwrap();
    assert_eq!(wide["pdf_background"]["page_index"], 1);
    assert_eq!(
        wide["pdf_background"]["rect"],
        serde_json::json!([0., 0., 1320., 990.])
    );

    let native = Editor::open(&editor.export_noteful().unwrap()).unwrap();
    assert_eq!(native.page_order().len(), 3);
    assert_eq!(native.pdf_bytes("slides-1").unwrap(), pdf);
    assert_eq!(
        native.view(1).unwrap()["pdf_background"]["rect"],
        serde_json::json!([0., 0., 1320., 990.])
    );
    assert_eq!(native.view(2).unwrap()["pdf_background"]["page_index"], 1);
}

#[test]
fn invalid_insertions_are_rejected_without_changing_history() {
    let mut editor = Editor::create_document("Base", &[[600., 800.]], &[]).unwrap();
    for (at, pages, pdf) in [
        (2, vec![blank(100., 100.)], None),
        (0, vec![], None),
        (0, vec![blank(f64::NAN, 100.)], None),
        (0, vec![blank(1., 100.)], None),
        (
            0,
            vec![NewPage {
                size: [100., 100.],
                pdf: Some(PdfPlacement {
                    resource: "missing".into(),
                    page_index: 0,
                    rect: None,
                }),
            }],
            None,
        ),
        (
            0,
            vec![blank(100., 100.)],
            Some(NewPdf {
                id: "x".into(),
                base64: STANDARD.encode(b"not a pdf"),
            }),
        ),
    ] {
        assert!(editor.insert_pages(at, pages, pdf).is_err());
    }
    assert_eq!(editor.view(0).unwrap()["edit_count"], 0);
    assert!(editor.slot(1).is_err());
}

#[test]
fn resized_pages_keep_their_pdf_in_place_through_undo_project_and_export() {
    let source = include_bytes!("../../../samples/Examen wuolah.noteful");
    let mut editor = Editor::open(source).unwrap();
    let original = sizes(&editor);
    let [w, h] = original[0];
    let pdf = editor.view(0).unwrap()["pdf_background"]["rect"].clone();
    assert!(editor.resize_page(0, [5., h], None).is_err());
    // Wider page: writing space on the right, the PDF stays at native scale.
    editor.resize_page(0, [w * 1.5, h], None).unwrap();
    editor.add_line(0, line()).unwrap();
    let view = editor.view(0).unwrap();
    assert_eq!(view["size"], serde_json::json!([w * 1.5, h]));
    assert_eq!(view["pdf_background"]["rect"], pdf);
    assert!(view["svg"]
        .as_str()
        .unwrap()
        .contains(&format!("viewBox=\"0 0 {} {h}\"", w * 1.5)));
    // An inserted page can be resized too, and its PDF fitted to the new size.
    editor
        .insert_pages(3, vec![blank(400., 300.)], None)
        .unwrap();
    editor.resize_page(3, [800., 300.], None).unwrap();
    editor
        .resize_page(2, [w, h * 2.], Some([0., 0., w, h * 2.]))
        .unwrap();
    assert_eq!(sizes(&editor)[0], [w * 1.5, h]);
    assert_eq!(sizes(&editor)[3], [800., 300.]);
    // Project and native export both carry the sizes and PDF rectangles.
    let restored = Editor::open_project(&editor.save_project().unwrap()).unwrap();
    let (a, b) = (restored.view(2).unwrap(), editor.view(2).unwrap());
    for (k, v) in a.as_object().unwrap() {
        assert!(
            v == &b[k],
            "{k}: {} vs {}",
            v.to_string().chars().take(300).collect::<String>(),
            b[k].to_string().chars().take(300).collect::<String>()
        );
    }
    let bytes = editor.export_noteful().unwrap();
    assert_eq!(Package::parse(&bytes).unwrap().rebuild().unwrap(), bytes);
    let native = Editor::open(&bytes).unwrap();
    assert_eq!(sizes(&native), sizes(&editor));
    for page in [0, 2] {
        assert_eq!(
            native.view(page).unwrap()["pdf_background"]["rect"],
            editor.view(page).unwrap()["pdf_background"]["rect"]
        );
    }
    assert_eq!(
        native.view(0).unwrap()["visible_imported"]
            .as_u64()
            .unwrap(),
        view["visible_imported"].as_u64().unwrap() + 1
    );
    // Undo walks back the resizes one at a time.
    editor.undo();
    editor.undo();
    editor.undo();
    editor.undo();
    assert_eq!(sizes(&editor)[0], [w * 1.5, h]);
    editor.undo();
    editor.undo();
    assert_eq!(sizes(&editor), original);
}
