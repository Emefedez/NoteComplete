use noteful_core::{Editor, Line};
use serde_json::Value;
fn exam() -> Editor {
    Editor::open(include_bytes!("../../../samples/Examen wuolah.noteful")).unwrap()
}
fn line() -> Line {
    Line {
        points: vec![[10., 10.], [100., 10.]],
        width: 2.,
        rgba: [0., 0., 1., 1.],
        tool: 0,
        layer: 0,
        shape: None,
        square: false,
    }
}
#[test]
fn native_scene_renders_entire_corpus_and_exam_objects() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples");
    for path in std::fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|s| s == "noteful"))
    {
        let editor = Editor::open(&std::fs::read(path).unwrap()).unwrap();
        for i in 0..editor.scene.pages.len() {
            let v = editor.view(i).unwrap();
            assert_eq!(v["warnings"], serde_json::json!([]));
            assert!(v["svg"].as_str().unwrap().contains("<svg"));
        }
    }
    let editor = exam();
    let total: u64 = (0..3)
        .map(|i| {
            editor.view(i).unwrap()["visible_imported"]
                .as_u64()
                .unwrap()
        })
        .sum();
    assert_eq!(total, 2008 + 74);
    assert!(editor.view(0).unwrap()["svg"]
        .as_str()
        .unwrap()
        .contains("mix-blend-mode:multiply"));
}
#[test]
fn draw_swept_erase_undo_redo_and_project_round_trip() {
    let mut e = exam();
    let original = e.view(0).unwrap();
    e.add_line(0, line()).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 1);
    // Cross the line between both sampled endpoints of the eraser gesture.
    assert!(e.erase_path(0, &[[50., 0.], [50., 20.]], 1.).unwrap() >= 1);
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    e.undo();
    assert_eq!(e.view(0).unwrap()["visible_added"], 1);
    let saved = e.save_project().unwrap();
    let mut loaded = Editor::open_project(&saved).unwrap();
    assert_eq!(loaded.view(0).unwrap(), e.view(0).unwrap());
    loaded.redo();
    assert_eq!(loaded.view(0).unwrap()["visible_added"], 0);
    e.undo();
    assert_eq!(e.view(0).unwrap()["svg"], original["svg"]);
    // A new edit after undo discards the old redo branch.
    e.add_line(1, line()).unwrap();
    assert_eq!(e.view(0).unwrap()["can_redo"], false);
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    assert_eq!(e.view(1).unwrap()["visible_added"], 1);
}
#[test]
fn erase_imported_ink_keeps_images_and_restores_original() {
    let data = include_bytes!("../../../samples/Examen wuolah.noteful");
    let p = noteful_core::Package::parse(data).unwrap();
    let mut e = exam();
    let mut changed = false;
    // Find a real imported point; page membership is deliberately resolved by hits.
    let points: Vec<_> = p
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .filter_map(|s| s.points.first().copied())
        .collect();
    'search: for page in 0..3 {
        for point in &points {
            let before = e.view(page).unwrap();
            let svg = before["svg"].as_str().unwrap();
            if e.erase_path(page, &[*point], 0.1).unwrap() > 0 {
                let after = e.view(page).unwrap();
                let after_svg = after["svg"].as_str().unwrap();
                assert!(
                    after["visible_imported"].as_u64().unwrap()
                        < before["visible_imported"].as_u64().unwrap()
                );
                assert_eq!(
                    svg.matches("<image ").count(),
                    after_svg.matches("<image ").count()
                );
                e.undo();
                assert_eq!(e.view(page).unwrap()["svg"], before["svg"]);
                changed = true;
                break 'search;
            }
        }
    }
    assert!(changed);
}
#[test]
fn malformed_edits_and_projects_leave_state_intact() {
    let mut e = exam();
    let original = e.view(0).unwrap();
    let mut bad = line();
    bad.width = f64::NAN;
    assert!(e.add_line(0, bad).is_err());
    assert!(e.add_line(99, line()).is_err());
    assert!(e.erase_path(0, &[], 10.).is_err());
    assert!(e.erase_path(0, &[[0., 0.]], f64::INFINITY).is_err());
    assert_eq!(e.view(0).unwrap(), original);
    let mut saved: Value = serde_json::from_str(&e.save_project().unwrap()).unwrap();
    saved["history"] = serde_json::json!([{"kind":"Erase","page":0,"ids":["object:99999"]}]);
    saved["cursor"] = 1.into();
    assert!(Editor::open_project(&saved.to_string()).is_err());
}

#[test]
fn straight_line_object_can_be_erased_and_undone() {
    let mut e = Editor::open(include_bytes!(
        "../../../samples/nota_herramientalinea.noteful"
    ))
    .unwrap();
    assert_eq!(e.view(0).unwrap()["visible_imported"], 1);
    assert_eq!(
        e.erase_path(0, &[[299.6000737915465, 439.85772508134784]], 1.)
            .unwrap(),
        1
    );
    assert_eq!(e.view(0).unwrap()["visible_imported"], 0);
    e.undo();
    assert_eq!(e.view(0).unwrap()["visible_imported"], 1);
}
