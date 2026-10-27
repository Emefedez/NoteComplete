use noteful_core::{Adjustment, Editor, Line, Package};
fn line() -> Line {
    Line {
        points: vec![[10., 10.], [110., 10.]],
        width: 2.,
        rgba: [0., 0., 1., 1.],
        tool: 0,
        layer: 0,
        shape: None,
    }
}
fn adjustment() -> Adjustment {
    Adjustment {
        translation: [50., 40.],
        scale: [2., 1.],
        rotation: 90.,
        width: Some(8.),
        rgba: Some([1., 0., 0., 1.]),
        locked: None,
    }
}
#[test]
fn added_items_transform_style_hit_erase_and_undo_as_one_operation() {
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    e.add_line(0, line()).unwrap();
    e.adjust_item(0, "new:0", adjustment()).unwrap();
    let patch = e.item_patch(0, "new:0").unwrap();
    assert!(patch["svg"]
        .as_str()
        .unwrap()
        .contains("stroke-width=\"8\""));
    assert!(patch["svg"].as_str().unwrap().contains("rgb(255,0,0)"));
    assert_eq!(patch["edit_count"], 2);
    assert_eq!(
        e.pick_item(0, [110., 50.], 2.).unwrap().unwrap()["id"],
        "new:0"
    );
    assert!(e.pick_item(0, [10., 10.], 2.).unwrap().is_none());
    let saved = e.save_project().unwrap();
    let restored = Editor::open_project(&saved).unwrap();
    assert_eq!(restored.view(0).unwrap(), e.view(0).unwrap());
    e.undo();
    assert_eq!(
        e.selection(0, "new:0").unwrap()["adjustment"]["rotation"],
        0.
    );
    e.redo();
    assert_eq!(e.erase_path(0, &[[110., 50.]], 1.).unwrap(), 1);
    e.undo();
    assert!(e.selection(0, "new:0").is_ok());
    let native = e.export_noteful().unwrap();
    let p = Package::parse(&native).unwrap();
    let s = p
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    assert_eq!(s.radius, 4.);
    assert_eq!(s.style.rgba, [1., 0., 0., 1.]);
    assert!((s.points[0][0] - 110.).abs() < 0.001);
}
#[test]
fn imported_ink_keeps_identity_audio_pressure_and_auxiliary_after_native_export() {
    for bytes in [
        include_bytes!("../../../samples/Practice book (vol. 1).noteful").as_slice(),
        include_bytes!("../../../samples/Examen wuolah.noteful").as_slice(),
    ] {
        let mut e = Editor::open(bytes).unwrap();
        let page = if e.scene.pages.len() > 100 { 8 } else { 0 };
        let before = Package::parse(bytes).unwrap();
        e.adjust_item(page, "stroke:0", adjustment()).unwrap();
        let saved = e.save_project().unwrap();
        assert_eq!(
            Editor::open_project(&saved).unwrap().view(page).unwrap(),
            e.view(page).unwrap()
        );
        let out = e.export_noteful().unwrap();
        let parsed = Package::parse(&out).unwrap();
        let changed = parsed
            .blocks
            .iter()
            .flat_map(|b| b.strokes.iter().flatten())
            .find(|s| {
                s.style.rgba == [1., 0., 0., 1.]
                    && before
                        .blocks
                        .iter()
                        .flat_map(|b| b.strokes.iter().flatten())
                        .any(|old| old.id == s.id && old.style.rgba != s.style.rgba)
            })
            .unwrap();
        let original = before
            .blocks
            .iter()
            .flat_map(|b| b.strokes.iter().flatten())
            .find(|s| s.id == changed.id)
            .unwrap();
        assert_eq!(changed.header, original.header);
        assert_eq!(changed.flags, original.flags);
        assert_eq!(changed.auxiliary, original.auxiliary);
        assert_eq!(changed.radii.len(), original.radii.len());
        assert_eq!(changed.style.rgba, [1., 0., 0., 1.]);
        for (a, b) in changed.radii.iter().zip(&original.radii) {
            assert!((a - b * 4. / original.radius).abs() < 0.001);
        }
        let reopened = Editor::open(&out).unwrap();
        assert_eq!(
            reopened.selection(page, "stroke:0").unwrap()["base_rgba"],
            serde_json::json!([1., 0., 0., 1.])
        );
        assert_eq!(
            reopened.scene.pages[page].timings.len(),
            e.scene.pages[page].timings.len()
        );
        for b in before
            .blocks
            .iter()
            .filter(|b| matches!(b.kind, "pdf" | "png" | "jpeg" | "m4a"))
        {
            assert_eq!(before.resource(&b.id), parsed.resource(&b.id));
        }
    }
}
#[test]
fn imported_shapes_images_and_text_keep_native_objects_and_can_be_removed() {
    for bytes in [
        include_bytes!("../../../samples/nota_herramientalinea.noteful").as_slice(),
        include_bytes!("../../../samples/nota_imagen.noteful").as_slice(),
        include_bytes!("../../../samples/texto.noteful").as_slice(),
    ] {
        let mut e = Editor::open(bytes).unwrap();
        let info = e.selection(0, "object:0").unwrap();
        let mut a = adjustment();
        if info["styled"] == false {
            a.width = None;
            a.rgba = None;
        }
        e.adjust_item(0, "object:0", a.clone()).unwrap();
        let out = e.export_noteful().unwrap();
        let reopened = Editor::open(&out).unwrap();
        let new = reopened.selection(0, "object:0").unwrap();
        assert!(
            (new["base_rotation"].as_f64().unwrap()
                - info["base_rotation"].as_f64().unwrap()
                - 90.)
                .abs()
                < 0.0001
        );
        assert_eq!(new["kind"], info["kind"]);
        assert!(
            (new["bounds"][2].as_f64().unwrap() - info["bounds"][2].as_f64().unwrap() * 2.).abs()
                < 0.001
        );
        assert_eq!(
            Editor::open_project(&e.save_project().unwrap())
                .unwrap()
                .view(0)
                .unwrap(),
            e.view(0).unwrap()
        );
        e.remove_item(0, "object:0").unwrap();
        assert!(e.selection(0, "object:0").is_err());
        e.undo();
        assert!(e.selection(0, "object:0").is_ok());
    }
}
#[test]
fn locked_deleted_and_invalid_adjustments_do_not_change_history() {
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    e.add_line(0, line()).unwrap();
    let initial = e.save_project().unwrap();
    let mut bad = adjustment();
    bad.scale = [0., 1.];
    assert!(e.adjust_item(0, "new:0", bad).is_err());
    assert_eq!(initial, e.save_project().unwrap());
    assert!(e.adjust_item(0, "missing", adjustment()).is_err());
    let mut layer = e.layers()[0].clone();
    layer.locked = true;
    e.set_layer(layer).unwrap();
    assert!(e.adjust_item(0, "new:0", adjustment()).is_err());
    assert!(e.pick_item(0, [30., 10.], 5.).unwrap().is_none());
    e.undo();
    e.remove_item(0, "new:0").unwrap();
    assert!(e.adjust_item(0, "new:0", adjustment()).is_err());
}

#[test]
fn locking_in_place_blocks_edits_until_unlocked_and_survives_reload() {
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    e.add_line(0, line()).unwrap();
    e.set_locked(0, "new:0", true).unwrap();
    // Locked: not picked for selection, not moved, not erased, not removed.
    assert!(e.pick_item(0, [60., 10.], 2.).unwrap().is_none());
    let found = e.pick_lockable(0, [60., 10.], 2.).unwrap().unwrap();
    assert_eq!(
        (found["id"].as_str(), found["locked"].as_bool()),
        (Some("new:0"), Some(true))
    );
    assert!(e.adjust_item(0, "new:0", adjustment()).is_err());
    assert_eq!(e.erase_path(0, &[[60., 10.]], 2.).unwrap(), 0);
    assert!(e.remove_item(0, "new:0").is_err());
    let view = e.view(0).unwrap();
    assert_eq!(view["locked"][0]["id"], "new:0");
    // Locking and a move cannot share one edit.
    let mut both = adjustment();
    both.locked = Some(false);
    assert!(e.adjust_item(0, "new:0", both).is_err());
    // The lock is saved in the project and undoable.
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(restored.view(0).unwrap()["locked"], view["locked"]);
    e.undo();
    assert!(e.pick_item(0, [60., 10.], 2.).unwrap().is_some());
    e.redo();
    e.set_locked(0, "new:0", false).unwrap();
    // A move after unlocking keeps it unlocked (the adjustment omits `locked`).
    e.adjust_item(0, "new:0", adjustment()).unwrap();
    assert_eq!(e.view(0).unwrap()["locked"].as_array().unwrap().len(), 0);
    assert_eq!(e.erase_path(0, &[[110., 50.]], 1.).unwrap(), 1);
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(restored.view(0).unwrap(), e.view(0).unwrap());
}
