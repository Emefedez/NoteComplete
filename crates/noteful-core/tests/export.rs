use noteful_core::{Editor, Layer, Line, Package};
fn line(layer: u32, tool: u16) -> Line {
    Line {
        points: vec![[10., 10.], [30., 20.], [45., 60.], [66., 80.], [90., 15.]],
        width: 8.,
        rgba: [1., 0.8, 0., 1.],
        layer,
        shape: None,
        square: false,
        tool,
    }
}
#[test]
fn native_export_preserves_resources_and_applies_visible_history() {
    let source = include_bytes!("../../../samples/Practice book (vol. 1).noteful");
    let original = Package::parse(source).unwrap();
    let mut editor = Editor::open(source).unwrap();
    assert_eq!(editor.export_noteful().unwrap(), source);
    editor.add_line(0, line(0, 1)).unwrap();
    let ink = original
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    editor.erase_path(8, &[ink.points[0]], 1.).unwrap();
    let data = editor.export_noteful().unwrap();
    let package = Package::parse(&data).unwrap();
    let read = Editor::open(&data).unwrap();
    for block in original
        .blocks
        .iter()
        .filter(|b| ["pdf", "m4a", "jpeg"].contains(&b.kind))
    {
        assert_eq!(original.resource(&block.id), package.resource(&block.id));
    }
    assert_eq!(read.view(0).unwrap()["visible_imported"], 1);
    assert_eq!(read.view(8).unwrap()["visible_imported"], 2);
    let new = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .find(|s| s.style.tool == 1)
        .unwrap();
    assert_eq!(new.radius, 4.);
    assert_eq!(new.points.len(), 5);
    for (a, b) in new.points.iter().zip(line(0, 1).points) {
        assert!((a[0] - b[0]).abs() < 0.002);
        assert!((a[1] - b[1]).abs() < 0.002);
    }
    assert!(read.scene.pages[0].timings.is_empty());
    editor.undo();
    assert_eq!(
        Editor::open(&editor.export_noteful().unwrap())
            .unwrap()
            .view(8)
            .unwrap()["visible_imported"],
        3
    );
}
#[test]
fn layers_export_lock_visibility_and_old_projects() {
    let mut e = Editor::open(include_bytes!("../../../samples/texto.noteful")).unwrap();
    let layer = Layer {
        id: 1,
        name: "Highlights".into(),
        ..Default::default()
    };
    e.set_layer(layer.clone()).unwrap();
    e.add_line(0, line(1, 1)).unwrap();
    let mut hidden = layer.clone();
    hidden.visible = false;
    e.set_layer(hidden).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    assert!(e.add_line(0, line(1, 0)).is_err());
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.layers().len(), 2);
    assert!(!read.layers()[1].visible);
    assert_eq!(read.view(0).unwrap()["texts"].as_array().unwrap().len(), 3);
    e.undo();
    assert_eq!(e.view(0).unwrap()["visible_added"], 1);
    let mut locked = layer;
    locked.locked = true;
    e.set_layer(locked).unwrap();
    assert_eq!(e.erase_path(0, &[[10., 10.]], 1.).unwrap(), 0);
    let old = include_str!("../../../tests/fixtures/editing-demo.nfedit");
    assert!(Editor::open_project(old).is_ok());
}
#[test]
fn native_export_removes_straight_line_object_and_keeps_unknown_metadata() {
    let mut e = Editor::open(include_bytes!(
        "../../../samples/nota_herramientalinea.noteful"
    ))
    .unwrap();
    e.erase_path(0, &[[299.6000737915465, 439.85772508134784]], 1.)
        .unwrap();
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.view(0).unwrap()["visible_imported"], 0);
    assert_eq!(Package::parse(&data).unwrap().rebuild().unwrap(), data);
}
#[test]
fn empty_note_gets_a_new_editable_block_and_index_entry() {
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    e.add_line(0, line(0, 0)).unwrap();
    let data = e.export_noteful().unwrap();
    let read = Editor::open(&data).unwrap();
    assert_eq!(read.view(0).unwrap()["visible_imported"], 1);
    assert!(read.scene.pages[0].pdf_background.is_some());
}
#[test]
fn shape_corners_resize_undo_project_reload_and_native_geometry() {
    use noteful_core::{Shape, ShapeKind};
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    let mut l = line(0, 0);
    l.shape = Some(Shape {
        kind: ShapeKind::Rectangle,
        start: [100., 100.],
        end: [200., 200.],
    });
    e.add_line(0, l).unwrap();
    let before = e.view(0).unwrap()["svg"].clone();
    e.resize_shape(
        0,
        "new:0",
        Shape {
            kind: ShapeKind::Rectangle,
            start: [80., 90.],
            end: [250., 280.],
        },
    )
    .unwrap();
    let saved = e.save_project().unwrap();
    let loaded = Editor::open_project(&saved).unwrap();
    assert_eq!(loaded.view(0).unwrap(), e.view(0).unwrap());
    let data = e.export_noteful().unwrap();
    let package = Package::parse(&data).unwrap();
    let stroke = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    assert_eq!(stroke.points[0], [80., 90.]);
    assert_eq!(stroke.points[2], [250., 280.]);
    e.undo();
    assert_eq!(e.view(0).unwrap()["svg"], before);
    e.redo();
    assert!(e
        .resize_shape(
            0,
            "new:0",
            Shape {
                kind: ShapeKind::Ellipse,
                start: [0., 0.],
                end: [1., 1.]
            }
        )
        .is_err());
    e.erase_path(0, &[[80., 90.]], 1.).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 0);
    assert!(e
        .resize_shape(
            0,
            "new:0",
            Shape {
                kind: ShapeKind::Rectangle,
                start: [0., 0.],
                end: [1., 1.]
            }
        )
        .is_err());
}

#[test]
fn square_highlight_bands_have_square_ends_and_stay_inside_their_box_in_noteful() {
    let mut e = Editor::open(include_bytes!("../../../samples/nota_vacia.noteful")).unwrap();
    let band = Line {
        points: vec![[100., 200.], [300., 200.]],
        width: 120.,
        rgba: [1., 0.9, 0., 1.],
        tool: 1,
        layer: 0,
        shape: None,
        square: true,
    };
    assert!(
        e.add_line(
            0,
            Line {
                square: false,
                ..band.clone()
            }
        )
        .is_err(),
        "round highlighter is limited to 100"
    );
    e.add_line(0, band).unwrap();
    let svg = e.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
    assert!(svg.contains("stroke-linecap=\"butt\"") && svg.contains("mix-blend-mode:multiply"));
    let bytes = e.export_noteful().unwrap();
    let native = Editor::open(&bytes).unwrap();
    assert_eq!(native.view(0).unwrap()["visible_imported"], 1);
    // Noteful's round ends (radius 60) now reach exactly x = 100 and 300.
    let package = noteful_core::Package::parse(&bytes).unwrap();
    let stroke = package
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap();
    let xs: Vec<f64> = stroke.points.iter().map(|p| p[0]).collect();
    assert!(
        (xs[0] - 160.).abs() < 0.5 && (xs.last().unwrap() - 240.).abs() < 0.5,
        "{xs:?}"
    );
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(restored.view(0).unwrap(), e.view(0).unwrap());
}
