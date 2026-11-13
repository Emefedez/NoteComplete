//! Tape covers what is under it: it is drawn after every other item, whatever the order.
use noteful_core::{Editor, Line};

#[test]
fn tape_is_drawn_over_ink_added_after_it() {
    let mut e = Editor::create_document_with("t", &[([800., 600.], None)], &[], "x", 1.).unwrap();
    let mut tape = Line::new(vec![[100., 100.], [300., 100.]], 30., [0.9, 0.8, 0.3, 1.]);
    tape.tool = 2;
    e.add_line(0, tape).unwrap();
    e.add_line(
        0,
        Line::new(vec![[50., 100.], [350., 110.]], 3., [0., 0., 0., 1.]),
    )
    .unwrap();
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_string();
    let tape_at = svg.find("data-tape=\"new:0\"").unwrap();
    let ink_at = svg.find("data-item=\"new:1\"").unwrap();
    assert!(tape_at > ink_at, "the tape comes last, over the ink");
    assert!(svg.contains("data-tapes="));
}
