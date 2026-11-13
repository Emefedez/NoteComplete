//! Filled shapes: rectangles, ellipses and triangles may have an inside colour.
use noteful_core::{Editor, Line, Package, Shape, ShapeKind};

fn shape(kind: ShapeKind, fill: Option<[f64; 4]>) -> Line {
    let s = Shape {
        kind,
        start: [100., 100.],
        end: [260., 220.],
        fill,
    };
    Line {
        points: s.points(),
        shape: Some(s),
        ..Line::new(vec![], 3., [0.1, 0.3, 0.8, 1.])
    }
}
fn blank() -> Editor {
    Editor::open(crate::samples::BLANK).unwrap()
}
fn strokes(data: &[u8]) -> usize {
    Package::parse(data)
        .unwrap()
        .blocks
        .iter()
        .map(|b| b.strokes.as_ref().map_or(0, Vec::len))
        .sum()
}

#[test]
fn a_filled_shape_draws_its_inside_under_the_outline() {
    let mut e = blank();
    e.add_line(0, shape(ShapeKind::Ellipse, Some([1., 0.8, 0., 0.25])))
        .unwrap();
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    let fill = svg.find("<polygon").expect("inside drawn");
    assert!(svg.contains("fill=\"rgb(255,204,0)\" fill-opacity=\"0.25\""));
    // The outline comes after the inside, so it stays on top.
    assert!(svg[fill..].contains("stroke="));
}

#[test]
fn only_closed_shapes_take_a_valid_fill() {
    let mut e = blank();
    assert!(e
        .add_line(0, shape(ShapeKind::Arrow, Some([1., 0., 0., 1.])))
        .is_err());
    assert!(e
        .add_line(0, shape(ShapeKind::Line, Some([1., 0., 0., 1.])))
        .is_err());
    assert!(e
        .add_line(0, shape(ShapeKind::Rectangle, Some([2., 0., 0., 1.])))
        .is_err());
    assert!(e
        .add_line(0, shape(ShapeKind::Rectangle, Some([f64::NAN, 0., 0., 1.])))
        .is_err());
    e.add_line(0, shape(ShapeKind::Triangle, Some([0., 0.6, 0.3, 1.])))
        .unwrap();
    e.add_line(0, shape(ShapeKind::Arrow, None)).unwrap();
}

#[test]
fn resizing_keeps_the_fill_and_projects_keep_it() {
    let mut e = blank();
    e.add_line(0, shape(ShapeKind::Rectangle, Some([0., 0.5, 1., 0.4])))
        .unwrap();
    let id = e.view(0).unwrap()["shapes"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // The selection handles send only the geometry.
    e.resize_shape(
        0,
        &id,
        Shape {
            kind: ShapeKind::Rectangle,
            start: [90., 90.],
            end: [300., 260.],
            fill: None,
        },
    )
    .unwrap();
    let shapes = e.view(0).unwrap()["shapes"].clone();
    assert_eq!(
        shapes[0]["line"]["shape"]["fill"],
        serde_json::json!([0., 0.5, 1., 0.4])
    );
    let reopened = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(reopened.view(0).unwrap()["svg"], e.view(0).unwrap()["svg"]);
}

#[test]
fn noteful_files_get_the_inside_as_highlighter_under_the_outline() {
    let mut outline = blank();
    outline
        .add_line(0, shape(ShapeKind::Rectangle, None))
        .unwrap();
    let mut filled = blank();
    filled
        .add_line(0, shape(ShapeKind::Rectangle, Some([1., 0.8, 0., 1.])))
        .unwrap();
    let (plain, coloured) = (
        outline.export_noteful().unwrap(),
        filled.export_noteful().unwrap(),
    );
    assert!(
        strokes(&coloured) > strokes(&plain) + 3,
        "bands of colour inside"
    );
    // The exported file opens and renders.
    let reopened = Editor::open(&coloured).unwrap();
    assert_eq!(reopened.view(0).unwrap()["warnings"], serde_json::json!([]));
}

#[test]
fn a_star_fills_its_box_point_up_and_takes_a_fill() {
    let s = Shape {
        kind: ShapeKind::Star,
        start: [100., 100.],
        end: [260., 220.],
        fill: None,
    };
    let points = s.points();
    assert_eq!(points.len(), 11);
    assert_eq!(points[0], points[10]);
    // The top point is at the middle of the top edge; the outline spans the whole box.
    assert!((points[0][0] - 180.).abs() < 1e-9 && (points[0][1] - 100.).abs() < 1e-9);
    let (xs, ys): (Vec<f64>, Vec<f64>) = points.iter().map(|p| (p[0], p[1])).unzip();
    let min = |v: &[f64]| v.iter().copied().fold(f64::INFINITY, f64::min);
    let max = |v: &[f64]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    assert!((min(&xs) - 100.).abs() < 1e-9 && (max(&xs) - 260.).abs() < 1e-9);
    assert!((min(&ys) - 100.).abs() < 1e-9 && (max(&ys) - 220.).abs() < 1e-9);
    assert!(s.closed());
    let mut e = blank();
    e.add_line(0, shape(ShapeKind::Star, Some([1., 0.8, 0., 1.])))
        .unwrap();
    assert!(e.view(0).unwrap()["svg"]
        .as_str()
        .unwrap()
        .contains("<polygon"));
    // Exported, its inside becomes highlighter bands under the outline.
    let plain = {
        let mut e = blank();
        e.add_line(0, shape(ShapeKind::Star, None)).unwrap();
        strokes(&e.export_noteful().unwrap())
    };
    assert!(strokes(&e.export_noteful().unwrap()) > plain);
}
