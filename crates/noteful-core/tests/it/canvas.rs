//! Infinite canvas: one page that grows; never a .noteful file.
use noteful_core::{canvas::GROW_MARGIN, Editor, Line};

fn canvas(size: [f64; 2]) -> Editor {
    let mut e = Editor::create_document_with("Board", &[(size, None)], &[], "x", 1.).unwrap();
    e.set_canvas(true).unwrap();
    e
}
fn stroke(points: Vec<[f64; 2]>) -> Line {
    Line::new(points, 3., [0.1, 0.2, 0.7, 1.])
}
#[test]
fn only_one_page_notes_are_canvases_and_the_flag_is_kept() {
    let mut two = Editor::create_document_with(
        "x",
        &[([500., 500.], None), ([500., 500.], None)],
        &[],
        "x",
        1.,
    )
    .unwrap();
    assert!(two.set_canvas(true).is_err());
    // Nor does a canvas take new pages.
    let mut board = canvas([800., 600.]);
    let page = serde_json::from_value(serde_json::json!({"size": [800., 600.]})).unwrap();
    assert!(board.insert_pages(1, vec![page], None).is_err());
    let mut e = canvas([2000., 2000.]);
    e.add_line(0, stroke(vec![[100., 100.], [200., 150.]]))
        .unwrap();
    assert_eq!(e.view(0).unwrap()["canvas"], true);
    let project = e.save_project().unwrap();
    assert!(project.contains("\"version\":7"));
    assert!(Editor::open_project(&project).unwrap().is_canvas());
    assert!(Editor::open_notecomplete(&e.export_notecomplete().unwrap())
        .unwrap()
        .is_canvas());
    assert!(!Editor::open(crate::samples::BLANK).unwrap().is_canvas());
}

#[test]
fn the_canvas_grows_when_ink_comes_near_its_edge() {
    let mut e = canvas([2000., 1500.]);
    assert_eq!(e.canvas_growth([100., 100., 50., 50.]).unwrap(), None);
    let grown = e.canvas_growth([1900., 100., 50., 50.]).unwrap().unwrap();
    assert!(grown[0] >= 1950. + GROW_MARGIN && grown[1] == 1500.);
    e.resize_page(0, grown, None).unwrap();
    assert_eq!(e.canvas_growth([1900., 100., 50., 50.]).unwrap(), None);
    // Undo shrinks it back, like any page size change.
    e.undo();
    assert_eq!(e.view(0).unwrap()["size"][0].as_f64().unwrap(), 2000.);
}

#[test]
fn a_canvas_is_never_a_noteful_file() {
    let mut e = canvas([2000., 1500.]);
    e.add_line(0, stroke(vec![[100., 100.], [200., 150.]]))
        .unwrap();
    let refused = e.export_noteful().unwrap_err().to_string();
    assert!(refused.contains(".notecomp"), "{refused}");
    // Its own formats keep it whole, ink included.
    let archive = Editor::open_notecomplete(&e.export_notecomplete().unwrap()).unwrap();
    assert!(archive.is_canvas());
    assert_eq!(archive.view(0).unwrap()["visible_imported"], 1);
    assert!(archive.export_noteful().is_err());
    // Back to plain pages, it is an ordinary note again.
    e.set_canvas(false).unwrap();
    assert!(Editor::open(&e.export_noteful().unwrap()).is_ok());
}

#[test]
fn new_ink_near_the_edge_grows_the_canvas_in_one_undo_step() {
    let mut e = canvas([2000., 1500.]);
    assert!(!e.grow_canvas_for([10., 10., 10., 10.]).unwrap());
    assert!(e.grow_canvas_for([10., 1400., 10., 10.]).unwrap());
    assert!(e.view(0).unwrap()["size"][1].as_f64().unwrap() > 1500.);
    e.undo();
    assert_eq!(e.view(0).unwrap()["size"][1].as_f64().unwrap(), 1500.);
    // Other notes never grow.
    let mut plain = Editor::open(crate::samples::BLANK).unwrap();
    assert!(!plain.grow_canvas_for([10., 1e5, 10., 10.]).unwrap());
}
