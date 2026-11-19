use noteful_core::{Editor, Line};
use serde_json::Value;
fn exam() -> Editor {
    Editor::open(crate::samples::EXAM).unwrap()
}
fn line() -> Line {
    Line {
        part: None,
        points: vec![[10., 10.], [100., 10.]],
        width: 2.,
        rgba: [0., 0., 1., 1.],
        tool: 0,
        layer: 0,
        shape: None,
        square: false,
        pressure: None,
        under: false,
        joined: false,
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
    let data = crate::samples::EXAM;
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
    let mut e = Editor::open(crate::samples::LINE_TOOL).unwrap();
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
/// A shared drawing session: replicas loaded from the same project that apply
/// the same edits in the same order end with the same items, ids and digest.
#[test]
fn replicas_applying_the_same_edits_agree() {
    let mut host = exam();
    host.add_line(0, line()).unwrap();
    let project = host.save_project().unwrap();
    let mut tablet = Editor::open_project(&project).unwrap();
    assert_eq!(
        host.history_digest().unwrap(),
        tablet.history_digest().unwrap()
    );
    let pressured = Line {
        points: vec![[20., 40.], [60., 42.], [90., 45.]],
        pressure: Some(vec![0.8, 1.4, 1.1]),
        ..line()
    };
    for replica in [&mut host, &mut tablet] {
        replica.add_line(0, pressured.clone()).unwrap();
        replica.erase_path(0, &[[50., 0.], [50., 20.]], 1.).unwrap();
        replica.undo();
        replica.undo();
        replica.redo();
    }
    assert_eq!(host.view(0).unwrap(), tablet.view(0).unwrap());
    assert_eq!(
        host.history_digest().unwrap(),
        tablet.history_digest().unwrap()
    );
    // The digest follows the undo position, not only the stored edits.
    let before = tablet.history_digest().unwrap();
    tablet.undo();
    assert_ne!(before, tablet.history_digest().unwrap());
}
#[test]
fn eraser_reaches_shapes_drawn_as_objects() {
    // Exam page 1: a highlighter ellipse (object:3) and two triangles (object:9, object:10,
    // the Δ marks) are Noteful shapes, not free-form paths; the eraser used to pass over them.
    for id in ["object:3", "object:9", "object:10"] {
        let mut e = exam();
        let b = e.selection(0, id).unwrap()["bounds"].clone();
        let [x, y, w, h] = [0, 1, 2, 3].map(|i| b[i].as_f64().unwrap());
        // A sweep across the middle, top to bottom: it crosses the outline.
        let path = [[x + w / 2., y - 1.], [x + w / 2., y + h + 1.]];
        assert!(e.erase_path(0, &path, 0.5).unwrap() >= 1, "{id}");
        assert!(e.selection(0, id).is_err(), "{id} erased");
        e.undo();
        assert!(e.selection(0, id).is_ok(), "{id} back after undo");
    }
}
#[test]
fn every_page_resized_at_once_is_one_undo_step() {
    let mut e = exam();
    let sizes = |e: &Editor| e.view(0).unwrap()["page_sizes"].clone();
    let before = sizes(&e);
    let order = e.page_order();
    let all: Vec<_> = order.iter().map(|&s| (s, [700., 900.], None)).collect();
    assert_eq!(e.resize_pages(&all).unwrap(), order.len());
    let after = sizes(&e);
    assert!(
        after
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s[0] == 700. && s[1] == 900.),
        "{after}"
    );
    // Saved and opened again: still one step.
    let mut again = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(sizes(&again), after);
    again.undo();
    assert_eq!(sizes(&again), before, "one undo brings every page back");
    again.redo();
    assert_eq!(sizes(&again), after, "one redo resizes them all again");
    // A stroke after it undoes on its own.
    again.add_line(0, line()).unwrap();
    again.undo();
    assert_eq!(sizes(&again), after);
    // One invalid size: nothing changes.
    let mut bad = exam();
    let mut wrong = all.clone();
    wrong[1].1 = [5., 900.];
    assert!(bad.resize_pages(&wrong).is_err());
    assert_eq!(sizes(&bad), before);
    // Pages already that size are left alone.
    assert_eq!(e.resize_pages(&all).unwrap(), 0);
}

#[test]
fn project_round_trips_study_sets_and_compaction_keeps_them() {
    let mut e = exam();
    // Without study data, projects remain pre-v10 (no study field serialized).
    let baseline: Value = serde_json::from_str(&e.save_project().unwrap()).unwrap();
    assert!(baseline["version"].as_u64().unwrap() < 10);
    assert!(baseline.get("study").is_none());

    let study: noteful_core::ProjectStudy = serde_json::from_value(serde_json::json!({
        "decks": [{"id": "d1", "name": "Biology", "cards": [{"id": "c1", "front": "ATP", "back": "Energy"}]}],
        "quizzes": [{"id": "q1", "title": "Cell Quiz", "questions": []}],
        "scratch": [{"id": "s1", "title": "Quick note", "text": "Review mitochondria", "messages": [], "at": 1234}]
    }))
    .unwrap();
    e.set_study(study.clone()).unwrap();
    e.add_line(0, line()).unwrap();
    e.add_line(0, line()).unwrap();

    let saved = e.save_project().unwrap();
    let raw: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(raw["version"], 10);
    assert_eq!(raw["study"]["decks"].as_array().unwrap().len(), 1);
    assert_eq!(raw["study"]["quizzes"].as_array().unwrap().len(), 1);
    assert_eq!(raw["study"]["scratch"].as_array().unwrap().len(), 1);

    let reopened = Editor::open_project(&saved).unwrap();
    assert_eq!(reopened.study(), &study);

    // Compacting history preserves version 10 and the study sets.
    let mut compacted = reopened;
    compacted.compact_history(1).unwrap();
    assert_eq!(compacted.study(), &study);
    let compacted_raw: Value = serde_json::from_str(&compacted.save_project().unwrap()).unwrap();
    assert_eq!(compacted_raw["version"], 10);

    // Non-object entries and oversized study payloads are rejected.
    let mut bad_entry: Value = raw.clone();
    bad_entry["study"]["quizzes"] = serde_json::json!(["not-an-object"]);
    assert!(Editor::open_project(&bad_entry.to_string()).is_err());

    let mut bad_version: Value = raw;
    bad_version["version"] = 99.into();
    assert!(Editor::open_project(&bad_version.to_string()).is_err());
}

#[test]
fn project_round_trips_exam_html_and_respects_compaction_and_export_filter() {
    let mut e = exam();
    let baseline: Value = serde_json::from_str(&e.save_project().unwrap()).unwrap();
    assert!(baseline.get("exam").is_none());

    let embedded = noteful_core::ProjectExam {
        html: "<!doctype html><html><body><div class=\"exam-flow\"><p>Q1</p></div></body></html>"
            .into(),
        source: Some(serde_json::json!({
            "mode": "create",
            "exam": {"title": "OS Mock", "sections": [{"heading": "CPU", "problems": []}]}
        })),
    };
    e.set_exam(embedded.clone()).unwrap();
    e.add_line(0, line()).unwrap();
    e.add_line(0, line()).unwrap();

    let saved = e.save_project().unwrap();
    let raw: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(raw["version"], 12);
    assert_eq!(raw["exam"]["html"], embedded.html);

    let mut reopened = Editor::open_project(&saved).unwrap();
    assert_eq!(reopened.exam(), &embedded);

    let breakdown = reopened.project_breakdown().unwrap();
    assert!(breakdown.exam_bytes > embedded.html.len());
    assert_eq!(
        breakdown.total_bytes,
        reopened.save_project_archive().unwrap().len()
    );

    // Compacting history preserves version 12 and the embedded exam HTML/source.
    reopened.compact_history(1).unwrap();
    assert_eq!(reopened.exam(), &embedded);
    let compacted_raw: Value = serde_json::from_str(&reopened.save_project().unwrap()).unwrap();
    assert_eq!(compacted_raw["version"], 12);

    // Filtered export can strip or retain the embedded exam HTML.
    let stripped = reopened
        .export_filtered_project(noteful_core::ProjectExportOptions {
            include_exam: false,
            ..noteful_core::ProjectExportOptions::default()
        })
        .unwrap();
    let stripped_ed = Editor::open_project(&stripped).unwrap();
    assert!(stripped_ed.exam().is_empty());
}

#[test]
fn copied_items_are_lines_and_pictures_where_they_are_drawn_now() {
    use noteful_core::Adjustment;
    let mut e = exam();
    e.add_line(0, line()).unwrap();
    e.adjust_item(
        0,
        "new:0",
        Adjustment {
            translation: [5., 7.],
            ..Default::default()
        },
    )
    .unwrap();
    let imported = e.view(0).unwrap()["svg"]
        .as_str()
        .unwrap()
        .split("data-item=\"stroke:")
        .nth(1)
        .map(|rest| format!("stroke:{}", &rest[..rest.find('"').unwrap()]))
        .unwrap();
    let copied = e
        .copy_items(0, &["new:0".to_owned(), imported.clone()])
        .unwrap();
    assert_eq!(
        copied.lines.len(),
        2,
        "the drawn line and the imported stroke"
    );
    let moved = copied
        .lines
        .iter()
        .find(|l| l.rgba == [0., 0., 1., 1.])
        .unwrap();
    assert_eq!(moved.points[0], [15., 17.]);
    assert!(copied.others.is_empty());
    // Pasted on another page: the same lines there, in one step.
    let before = e.view(1).unwrap()["svg"].as_str().unwrap().len();
    e.add_lines(1, copied.lines).unwrap();
    assert!(e.view(1).unwrap()["svg"].as_str().unwrap().len() > before);
}

#[test]
fn project_keeps_chinese_settings_in_every_form() {
    let mut e = exam();
    let baseline: Value = serde_json::from_str(&e.save_project().unwrap()).unwrap();
    assert!(baseline.get("chinese").is_none() && baseline["version"].as_u64().unwrap() < 14);
    let chinese: noteful_core::ProjectChinese = serde_json::from_value(serde_json::json!({
        "mode": "hanzi", "script": "simplified", "ruby": "on", "rubyMinLevel": 3,
        "readings": [{"item": "text:a1", "index": 1, "pinyin": "háng"}, {"md": 12, "index": 0, "pinyin": "le"}]
    }))
    .unwrap();
    e.set_chinese(chinese.clone()).unwrap();
    let saved = e.save_project().unwrap();
    let raw: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(raw["version"], 14);
    assert_eq!(raw["chinese"]["rubyMinLevel"], 3);
    assert_eq!(Editor::open_project(&saved).unwrap().chinese(), &chinese);
    // The archive (.nfedit) and .notecomp carry them too.
    let archive = e.save_project_archive().unwrap();
    assert_eq!(
        Editor::open_project_bytes(&archive).unwrap().chinese(),
        &chinese
    );
    let comp = e.export_notecomplete().unwrap();
    assert_eq!(
        Editor::open_notecomplete(&comp).unwrap().chinese(),
        &chinese
    );
    // Clearing them writes no field and the version they would have had.
    e.set_chinese(Default::default()).unwrap();
    let cleared: Value = serde_json::from_str(&e.save_project().unwrap()).unwrap();
    assert!(cleared.get("chinese").is_none() && cleared["version"] == baseline["version"]);
    // Unknown values and keys are refused.
    for bad in [
        serde_json::json!({"mode": "klingon"}),
        serde_json::json!({"rubyMinLevel": 12}),
        serde_json::json!({"readings": [{"index": 0, "pinyin": "a"}]}),
        serde_json::json!({"colour": true}),
    ] {
        let mut project = raw.clone();
        project["chinese"] = bad;
        assert!(Editor::open_project(&project.to_string()).is_err());
    }
}
