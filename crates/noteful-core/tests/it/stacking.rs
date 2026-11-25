//! Which item is on top: the Select tool picks the one drawn over the others, and Bring to
//! front, Send to back and the steps between change the order, undoably.
use noteful_core::{Adjustment, Editor, Image, Line, TextBox};

fn picture(bounds: [f64; 4]) -> Image {
    Image { base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=".into(), mime: "image/png".into(), bounds, layer: 0, text: None, joined: false, part: None, under: false }
}
fn text_box(bounds: [f64; 4]) -> Image {
    let text: TextBox = serde_json::from_value(
        serde_json::json!({"text": "Some typed text", "font_size": 16., "rgba": [0., 0., 0., 1.]}),
    )
    .unwrap();
    Image {
        base64: String::new(),
        mime: String::new(),
        text: Some(text),
        ..picture(bounds)
    }
}
/// Handwriting across the middle of the box.
fn ink() -> Line {
    Line::new(vec![[30., 60.], [180., 62.]], 3., [0., 0., 0., 1.])
}
fn picked(e: &Editor, at: [f64; 2]) -> String {
    e.pick_item(0, at, 4.).unwrap().unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}
/// The ids of the page's items in the order they are drawn.
fn drawn(e: &Editor) -> Vec<String> {
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    svg.split("data-item=\"")
        .skip(1)
        .map(|s| s[..s.find('"').unwrap()].to_owned())
        .collect()
}

#[test]
fn a_picture_laid_over_ink_and_a_text_box_is_the_one_picked() {
    let mut e = Editor::create_document("Stack", &[[600., 800.]], &[]).unwrap();
    e.add_line(0, ink()).unwrap(); // new:0
    e.add_image(0, text_box([20., 40., 200., 50.])).unwrap(); // image:1
    e.add_image(0, picture([20., 30., 200., 80.])).unwrap(); // image:2, over both
    assert_eq!(drawn(&e), ["new:0", "image:1", "image:2"]);
    // On the handwriting, inside the picture: the picture (the ink used to win).
    assert_eq!(picked(&e, [100., 61.]), "image:2");
    // Ink drawn afterwards over the picture is picked over it again.
    e.add_line(0, ink()).unwrap(); // new:3
    assert_eq!(picked(&e, [100., 61.]), "new:3");
    // Away from the new ink but inside the picture: still the picture.
    assert_eq!(picked(&e, [100., 100.]), "image:2");
}

#[test]
fn bring_to_front_send_to_back_and_steps_change_what_is_drawn_and_picked() {
    let mut e = Editor::create_document("Stack", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, picture([20., 30., 200., 80.])).unwrap(); // image:0
    e.add_image(0, text_box([20., 40., 200., 50.])).unwrap(); // image:1
    e.add_line(0, ink()).unwrap(); // new:2
    e.add_image(0, picture([400., 400., 50., 50.])).unwrap(); // image:3, apart
    assert_eq!(picked(&e, [100., 61.]), "new:2");

    e.restack_item(0, "image:0", "front").unwrap();
    assert_eq!(drawn(&e), ["image:1", "new:2", "image:3", "image:0"]);
    assert_eq!(picked(&e, [100., 61.]), "image:0");
    // A move keeps the place (the reader sends adjustments without it).
    let moved = Adjustment {
        translation: [5., 0.],
        ..Default::default()
    };
    e.adjust_item(0, "image:0", moved).unwrap();
    assert_eq!(drawn(&e), ["image:1", "new:2", "image:3", "image:0"]);
    // Already in front: nothing changes, no edit.
    let edits = e.view(0).unwrap()["edit_count"].clone();
    e.restack_item(0, "image:0", "front").unwrap();
    assert_eq!(e.view(0).unwrap()["edit_count"], edits);

    // One step back passes the next item below that it overlaps (the ink), not the
    // picture apart from it.
    e.restack_item(0, "image:0", "backward").unwrap();
    assert_eq!(drawn(&e), ["image:1", "image:0", "new:2", "image:3"]);
    e.restack_item(0, "image:0", "backward").unwrap();
    assert_eq!(drawn(&e), ["image:0", "image:1", "new:2", "image:3"]);
    e.restack_item(0, "image:0", "forward").unwrap();
    assert_eq!(drawn(&e), ["image:1", "image:0", "new:2", "image:3"]);
    e.restack_item(0, "new:2", "back").unwrap();
    assert_eq!(drawn(&e), ["new:2", "image:1", "image:0", "image:3"]);
    assert_eq!(picked(&e, [100., 61.]), "image:0");

    // Each change is one undo step, and the order survives saving the project.
    e.undo();
    assert_eq!(drawn(&e), ["image:1", "image:0", "new:2", "image:3"]);
    e.redo();
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(drawn(&restored), drawn(&e));
    assert!(e.restack_item(0, "image:0", "sideways").is_err());

    // New items still go on top.
    let made = e.view(0).unwrap()["edit_count"].as_u64().unwrap();
    e.add_line(0, ink()).unwrap();
    assert_eq!(drawn(&e).last().unwrap(), &format!("new:{made}"));
}

#[test]
fn imported_items_can_be_sent_behind_and_brought_over_added_ones() {
    let mut e = Editor::open(crate::samples::IMAGE).unwrap();
    let imported: Vec<String> = drawn(&e);
    assert!(!imported.is_empty());
    e.add_image(0, picture([0., 0., 2000., 2000.])).unwrap();
    let id = format!("image:{}", 0);
    assert_eq!(drawn(&e).last().unwrap(), &id);
    e.restack_item(0, &id, "back").unwrap();
    assert_eq!(drawn(&e)[0], id);
    let first = imported[0].clone();
    if e.restack_item(0, &first, "front").is_ok() {
        assert_eq!(drawn(&e).last().unwrap(), &first);
    }
}

#[test]
fn compacting_keeps_the_order() {
    let mut e = Editor::create_document("Stack", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, picture([20., 30., 200., 80.])).unwrap(); // image:0
    e.add_line(0, ink()).unwrap(); // new:1, erased below
    e.add_image(0, text_box([20., 40., 200., 50.])).unwrap(); // image:2
    e.add_line(0, ink()).unwrap(); // new:3
    e.remove_item(0, "new:1").unwrap();
    e.restack_item(0, "image:0", "front").unwrap();
    e.restack_item(0, "image:2", "backward").unwrap();
    e.restack_item(0, "image:2", "backward").unwrap();
    let before = drawn(&e).len();
    let cursor = e.view(0).unwrap()["edit_count"].as_u64().unwrap() as usize;
    // Compacting compares every page with the note before it and refuses on a difference,
    // so it succeeding means the order is the same.
    let done = e.compact_history(cursor).unwrap();
    assert!(done.edits_after < done.edits_before);
    assert_eq!(drawn(&e).len(), before);
    assert_eq!(picked(&e, [100., 61.]), drawn(&e).last().unwrap().clone());
}

#[test]
fn native_export_writes_added_items_in_their_new_order() {
    let mut e = Editor::create_document("Stack", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, picture([20., 30., 200., 80.])).unwrap(); // image:0
    e.add_image(0, text_box([20., 40., 200., 50.])).unwrap(); // image:1
    let top = |e: &Editor| {
        let exported = Editor::open(&e.export_noteful().unwrap()).unwrap();
        exported.pick_item(0, [100., 60.], 0.).unwrap().unwrap()["kind"].clone()
    };
    // Both come back as the page's own objects: the text box on top, then the picture.
    assert_eq!(top(&e), "text");
    e.restack_item(0, "image:0", "front").unwrap();
    assert_eq!(top(&e), "image");
}

#[test]
fn a_group_goes_to_the_front_or_back_in_one_step_keeping_its_order() {
    let mut e = Editor::create_document("Stack", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, picture([20., 30., 200., 80.])).unwrap(); // image:0
    e.add_image(0, text_box([20., 40., 200., 50.])).unwrap(); // image:1
    e.add_line(0, ink()).unwrap(); // new:2
    e.add_image(0, picture([30., 30., 50., 50.])).unwrap(); // image:3
    let group = ["image:1".to_owned(), "image:0".to_owned()];
    e.restack_items(0, &group, "front").unwrap();
    assert_eq!(drawn(&e), ["new:2", "image:3", "image:0", "image:1"]);
    e.undo();
    assert_eq!(drawn(&e), ["image:0", "image:1", "new:2", "image:3"]);
    e.redo();
    let both = ["image:3".to_owned(), "image:1".to_owned()];
    e.restack_items(0, &both, "back").unwrap();
    assert_eq!(drawn(&e), ["image:3", "image:1", "new:2", "image:0"]);
    e.undo();
    assert_eq!(drawn(&e), ["new:2", "image:3", "image:0", "image:1"]);
    assert!(e.restack_items(0, &both, "forward").is_err());
    assert!(e
        .restack_items(0, &["image:0".to_owned(), "nothing".to_owned()], "front")
        .is_err());
}
