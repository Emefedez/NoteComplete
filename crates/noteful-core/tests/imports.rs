use noteful_core::{Adjustment, Editor, Image, Package};

fn image() -> Image {
    Image { base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=".into(),mime:"image/png".into(),bounds:[20.,30.,120.,80.],layer:0 }
}

#[test]
fn pdf_pages_keep_dimensions_and_original_resource_through_project_and_export() {
    // Container-level fixture; PDF decoding is covered by the browser integration check.
    let pdf = b"%PDF-1.7\nfixture resource\n%%EOF";
    let editor = Editor::create_document("PDF import", &[[612., 792.], [792., 612.]], pdf).unwrap();
    assert_eq!(
        editor.view(1).unwrap()["size"],
        serde_json::json!([792., 612.])
    );
    assert_eq!(editor.view(1).unwrap()["pdf_background"]["page_index"], 1);
    let mut reopened = Editor::open_project(&editor.save_project().unwrap()).unwrap();
    reopened.add_image(1, image()).unwrap();
    let bytes = reopened.export_noteful().unwrap();
    let exported = Editor::open(&bytes).unwrap();
    assert_eq!(exported.pdf_bytes("imported-pdf").unwrap(), pdf);
    assert_eq!(exported.view(1).unwrap()["visible_imported"], 1);
    assert_eq!(Package::parse(&bytes).unwrap().rebuild().unwrap(), bytes);
}

#[test]
fn image_insert_move_delete_and_undo_survive_save_and_native_export() {
    let mut editor = Editor::create_document("Images", &[[600., 800.]], &[]).unwrap();
    editor.add_image(0, image()).unwrap();
    let selected = editor.pick_item(0, [60., 60.], 0.).unwrap().unwrap();
    assert_eq!(selected["kind"], "image");
    assert_eq!(selected["id"], "image:0");
    let a = Adjustment {
        translation: [50., 40.],
        scale: [2., 1.5],
        rotation: 30.,
        ..Default::default()
    };
    editor.adjust_item(0, "image:0", a).unwrap();
    editor.remove_item(0, "image:0").unwrap();
    assert_eq!(editor.view(0).unwrap()["visible_added"], 0);
    editor.undo();
    let mut restored = Editor::open_project(&editor.save_project().unwrap()).unwrap();
    assert_eq!(restored.view(0).unwrap()["visible_added"], 1);
    let exported = Editor::open(&restored.export_noteful().unwrap()).unwrap();
    let geometry = exported.selection(0, "object:0").unwrap();
    assert_eq!(
        geometry["bounds"],
        serde_json::json!([10., 50., 240., 120.])
    );
    assert!((geometry["base_rotation"].as_f64().unwrap() - 30.).abs() < 1e-8);
    restored.redo();
    assert_eq!(restored.view(0).unwrap()["visible_added"], 0);
    restored.undo();
    restored.undo();
    restored.undo();
    assert_eq!(restored.view(0).unwrap()["visible_added"], 0);
}

#[test]
fn imports_reject_bad_geometry_formats_and_locked_layers() {
    assert!(Editor::create_document("Bad", &[], &[]).is_err());
    assert!(Editor::create_document("Bad", &[[0., 3.]], &[]).is_err());
    assert!(Editor::create_document("Bad", &[[600., 800.]], b"not PDF").is_err());
    let mut editor = Editor::create_document("Images", &[[600., 800.]], &[]).unwrap();
    let mut bad = image();
    bad.mime = "image/svg+xml".into();
    assert!(editor.add_image(0, bad).is_err());
    let mut layer = editor.layers()[0].clone();
    layer.locked = true;
    editor.set_layer(layer).unwrap();
    assert!(editor.add_image(0, image()).is_err());
    assert_eq!(editor.view(0).unwrap()["visible_added"], 0);
}

#[test]
fn image_lock_is_written_as_native_tag_21_and_can_be_lifted_again() {
    let mut editor = Editor::create_document("Lock", &[[600., 800.]], &[]).unwrap();
    editor.add_image(0, image()).unwrap();
    editor.set_locked(0, "image:0", true).unwrap();
    let exported = Editor::open(&editor.export_noteful().unwrap()).unwrap();
    // Reopened, the image is locked by Noteful's own flag.
    assert!(exported.pick_item(0, [60., 60.], 0.).unwrap().is_none());
    let found = exported.pick_lockable(0, [60., 60.], 0.).unwrap().unwrap();
    assert_eq!(found["locked"], true);
    let id = found["id"].as_str().unwrap().to_owned();
    let mut reopened = Editor::open(&editor.export_noteful().unwrap()).unwrap();
    reopened.set_locked(0, &id, false).unwrap();
    let unlocked = Editor::open(&reopened.export_noteful().unwrap()).unwrap();
    assert_eq!(
        unlocked.pick_item(0, [60., 60.], 0.).unwrap().unwrap()["id"],
        id.as_str()
    );
}
