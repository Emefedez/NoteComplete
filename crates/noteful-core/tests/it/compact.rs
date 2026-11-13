use noteful_core::{Adjustment, Editor, Line};

fn exam() -> Editor {
    Editor::open(crate::samples::EXAM).unwrap()
}
fn stroke(n: usize) -> Line {
    let y = 40. + n as f64 * 3.;
    Line::new(
        (0..40)
            .map(|i| [20. + i as f64 * 4., y + (i % 3) as f64])
            .collect(),
        2.,
        [0., 0., 1., 1.],
    )
}
fn moved(dx: f64) -> Adjustment {
    Adjustment {
        translation: [dx, 0.],
        ..Default::default()
    }
}
/// Every page's drawing, without item names (compacting renumbers them).
fn pages(e: &Editor) -> Vec<String> {
    e.page_order()
        .into_iter()
        .map(|slot| {
            let svg = e.view(slot).unwrap()["svg"].as_str().unwrap().to_owned();
            let mut out = String::new();
            let mut rest = svg.as_str();
            while let Some(at) = rest.find(" data-item=\"") {
                out.push_str(&rest[..at]);
                let tail = &rest[at + 12..];
                rest = &tail[tail.find('"').unwrap() + 1..];
            }
            out + rest
        })
        .collect()
}
fn can_undo(e: &Editor) -> bool {
    e.view(0).unwrap()["can_undo"].as_bool().unwrap()
}
/// A long session: strokes drawn and erased, items moved again and again, locked and
/// unlocked, an imported stroke erased.
fn busy() -> Editor {
    let mut e = exam();
    for n in 0..60 {
        e.add_line(0, stroke(n)).unwrap();
    }
    for n in 0..40 {
        e.remove_item(0, &format!("new:{n}")).unwrap();
    }
    for step in 1..=10 {
        e.adjust_item(0, "new:50", moved(step as f64)).unwrap();
    }
    e.adjust_item(0, "new:51", moved(5.)).unwrap();
    e.adjust_item(
        0,
        "new:51",
        Adjustment {
            locked: Some(true),
            ..moved(5.)
        },
    )
    .unwrap();
    e.adjust_item(
        0,
        "new:51",
        Adjustment {
            locked: Some(false),
            ..moved(5.)
        },
    )
    .unwrap();
    e.adjust_item(0, "new:51", moved(9.)).unwrap();
    e.remove_item(0, "stroke:3").unwrap();
    e
}

#[test]
fn compacting_to_the_present_keeps_the_note_and_shrinks_the_history() {
    let mut e = busy();
    let before = pages(&e);
    let edits = e.view(0).unwrap()["edit_count"].as_u64().unwrap() as usize;
    let done = e.compact_history(edits).unwrap();
    assert_eq!(pages(&e), before, "every page draws the same");
    // 60 strokes - 40 erased = 20 kept; the 40 erasures go; 10 moves → 1; new:51 keeps
    // the lock and unlock (and the move before them goes, the one after stays); stroke:3's erasure stays.
    assert!(done.edits_after < done.edits_before / 3, "{done:?}");
    // The history's part of the file (beyond the original note it starts from) halves at least.
    let base = exam().save_project().unwrap().len();
    assert!(
        done.bytes_after - base < (done.bytes_before - base) / 2,
        "{done:?}, base {base}"
    );
    assert!(!can_undo(&e), "the history before is gone");
    // A new edit can be undone, back to where the history was compacted.
    e.add_line(1, stroke(1)).unwrap();
    assert!(can_undo(&e));
    e.undo();
    assert!(!can_undo(&e));
    assert_eq!(pages(&e), before);
    // Saved and opened again: the same note, still no undo past the compacted point.
    let again = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(pages(&again), before);
    assert!(!can_undo(&again));
    // Items keep working under their new names: a kept stroke moves and erases.
    let mut again = again;
    let shapes: Vec<String> = again.view(0).unwrap()["svg"]
        .as_str()
        .unwrap()
        .split("data-item=\"new:")
        .skip(1)
        .map(|s| format!("new:{}", &s[..s.find('"').unwrap()]))
        .collect();
    assert_eq!(shapes.len(), 20, "the 20 strokes not erased");
    again.adjust_item(0, &shapes[0], moved(3.)).unwrap();
    again.remove_item(0, &shapes[1]).unwrap();
}

#[test]
fn compacting_to_an_earlier_point_keeps_what_came_after_undoable() {
    let mut e = busy();
    let (mark, digest) = e.history_mark().unwrap();
    // After the point: more strokes, a move of a stroke from before it, an erasure.
    for n in 0..5 {
        e.add_line(1, stroke(n)).unwrap();
    }
    e.adjust_item(0, "new:55", moved(30.)).unwrap();
    e.remove_item(0, "new:56").unwrap();
    assert_eq!(
        e.prefix_digest(mark).unwrap(),
        digest,
        "the point is still part of this history"
    );
    let now = pages(&e);
    // What undoing the edits after the point shows, before compacting.
    let mut reference = Editor::open_project(&e.save_project().unwrap()).unwrap();
    for _ in 0..7 {
        reference.undo();
    }
    let at_mark = pages(&reference);

    e.compact_history(mark).unwrap();
    assert_eq!(pages(&e), now, "the note is the same");
    for _ in 0..7 {
        assert!(can_undo(&e));
        e.undo();
    }
    assert!(!can_undo(&e), "undo stops at the point");
    assert_eq!(
        pages(&e),
        at_mark,
        "undoing the later edits shows the note as it was at the point"
    );
    for _ in 0..7 {
        e.redo();
    }
    assert_eq!(pages(&e), now, "and redo brings them back");
}

#[test]
fn compacting_keeps_redo_steps_after_an_earlier_point_but_not_to_the_present() {
    let mut e = busy();
    let (mark, _) = e.history_mark().unwrap();
    e.add_line(1, stroke(1)).unwrap();
    e.add_line(1, stroke(2)).unwrap();
    e.undo();
    let mut kept = Editor::open_project(&e.save_project().unwrap()).unwrap();
    kept.compact_history(mark).unwrap();
    let before = pages(&kept);
    kept.redo();
    assert_ne!(pages(&kept), before, "an earlier point keeps the redo step");
    let present = e.view(0).unwrap()["edit_count"].as_u64().unwrap() as usize;
    e.compact_history(present).unwrap();
    assert!(
        !e.view(0).unwrap()["can_redo"].as_bool().unwrap(),
        "the present drops what was undone"
    );
}

#[test]
fn a_point_outside_the_history_is_refused() {
    let mut e = busy();
    let edits = e.view(0).unwrap()["edit_count"].as_u64().unwrap() as usize;
    assert!(e.compact_history(edits + 1).is_err());
    e.compact_history(10).unwrap();
    assert!(e.compact_history(0).is_err(), "before the compacted point");
}

#[test]
fn a_preview_reports_the_cut_without_making_it() {
    let mut e = busy();
    let edits = e.view(0).unwrap()["edit_count"].as_u64().unwrap() as usize;
    let before = pages(&e);
    let preview = e.compact_preview(edits).unwrap();
    assert_eq!(pages(&e), before);
    assert!(can_undo(&e), "the history is still there");
    let done = e.compact_history(edits).unwrap();
    assert_eq!(
        (
            preview.bytes_before,
            preview.bytes_after,
            preview.edits_after
        ),
        (done.bytes_before, done.bytes_after, done.edits_after)
    );
}

#[test]
fn the_lines_of_one_gesture_are_one_undo_step() {
    let mut e = exam();
    let band = |y: f64, joined: bool| Line {
        square: true,
        tool: 1,
        joined,
        ..Line::new(vec![[20., y], [200., y]], 12., [1., 0.9, 0.2, 0.5])
    };
    let before = pages(&e);
    // A highlight over three lines of text: the first line starts the step, the others join it.
    e.add_line(0, band(100., false)).unwrap();
    e.add_line(0, band(116., true)).unwrap();
    e.add_line(0, band(132., true)).unwrap();
    let three = pages(&e);
    assert_ne!(three, before);
    e.undo();
    assert_eq!(pages(&e), before, "one undo takes all three lines");
    assert!(!can_undo(&e));
    e.redo();
    assert_eq!(pages(&e), three, "one redo brings them back");
    // A line drawn after it is a step of its own.
    e.add_line(0, band(200., false)).unwrap();
    e.undo();
    assert_eq!(pages(&e), three);
    e.undo();
    assert_eq!(pages(&e), before);
    // The flag survives saving and opening the project, and is not written when unset: the
    // reopened group still undoes and redoes as one step.
    e.redo();
    assert_eq!(pages(&e), three);
    let project = e.save_project().unwrap();
    assert_eq!(project.matches("\"joined\":true").count(), 2);
    let mut back = Editor::open_project(&project).unwrap();
    assert_eq!(pages(&back), three);
    back.undo();
    assert_eq!(
        pages(&back),
        before,
        "the reopened group undoes as one step"
    );
    back.redo();
    assert_eq!(pages(&back), three);
}
