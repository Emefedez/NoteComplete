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

#[test]
fn tape_covering_exam_content_stays_opaque_and_tappable_through_noteful_export() {
    let mut e =
        Editor::create_document_with("Exam Tape", &[([800., 600.], None)], &[], "x", 1.).unwrap();
    // Draw ink text/answer at y=150, then censor a horizontal band over it with tool=2 tape.
    e.add_line(
        0,
        Line::new(vec![[80., 150.], [420., 150.]], 4., [0., 0., 0., 1.]),
    )
    .unwrap();
    let strip = noteful_core::ink::tape(70., 120., 360., 60., 0., [0.95, 0.77, 0.28, 1.]);
    e.add_line(0, strip).unwrap();

    let added_view = e.view(0).unwrap();
    let added_tapes = added_view["tapes"].as_array().unwrap();
    assert_eq!(added_tapes.len(), 1);
    let added_bounds = added_tapes[0]["bounds"].as_array().unwrap();
    assert!((added_bounds[2].as_f64().unwrap() - 420.).abs() < 1.);
    assert!((added_bounds[3].as_f64().unwrap() - 60.).abs() < 1.);

    let noteful_bytes = e.export_noteful().unwrap();
    let reopened = Editor::open(&noteful_bytes).unwrap();
    let view = reopened.view(0).unwrap();
    let tapes = view["tapes"].as_array().unwrap();
    assert_eq!(tapes.len(), 1);
    let tape_id = tapes[0]["id"].as_str().unwrap();
    assert_eq!(tape_id, "stroke:1");
    assert_eq!(tapes[0]["revealed"], false);
    let svg = view["svg"].as_str().unwrap();
    let expected_attr = format!("data-tape=\"{tape_id}\" data-revealed=\"0\" opacity=\"1\"");
    assert!(svg.contains(&expected_attr));
    assert!(
        svg.find(&format!("data-tape=\"{tape_id}\"")).unwrap()
            > svg.find("data-item=\"stroke:0\"").unwrap(),
        "exported tape must remain above page ink/content"
    );
    let bounds = tapes[0]["bounds"].as_array().unwrap();
    assert!((bounds[2].as_f64().unwrap() - 420.).abs() < 1.);
    assert!(
        (bounds[3].as_f64().unwrap() - 60.).abs() < 1.,
        "exported tape strip must keep full height bounds for tap-to-peel: {bounds:?}"
    );
}
