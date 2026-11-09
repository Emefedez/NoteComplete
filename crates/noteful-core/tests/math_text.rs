//! Math text boxes (docs/SHAPES-TABLES-MATH.md, M1): LaTeX kept as the box's text, flagged
//! for readers to typeset, kept by projects, and exported to Noteful as its source.
use noteful_core::{Editor, Image, TextBox};

fn math_box(text: &str, math: bool) -> Image {
    Image {
        base64: String::new(),
        mime: String::new(),
        bounds: [100., 100., 240., 60.],
        layer: 0,
        joined: false,
        text: Some(TextBox {
            text: text.into(),
            font_size: 20.,
            rgba: [0.1, 0.1, 0.2, 1.],
            bold: false,
            italic: false,
            font: "Helvetica".into(),
            align: 0,
            underline: false,
            strikethrough: false,
            math,
        }),
    }
}

#[test]
fn a_math_box_is_flagged_for_readers_and_marks_where_to_typeset() {
    let mut e = Editor::create_document("Math", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, math_box(r"\frac{a}{b} = x^2", true)).unwrap();
    e.add_image(0, math_box("Plain $5 price", false)).unwrap();
    let view = e.view(0).unwrap();
    let texts = view["texts"].as_array().unwrap();
    assert_eq!(texts[0]["math"], true);
    assert!(texts[1].get("math").is_none(), "plain boxes say nothing");
    // The text's own box, for a reader to lay the formula over (moves and turns included).
    let svg = view["svg"].as_str().unwrap();
    assert!(svg.contains("data-box=\"240 60\""), "{svg}");
    assert!(svg.contains(r"\frac{a}{b} = x^2"), "the source stays as text underneath");
}

#[test]
fn projects_keep_the_flag_and_noteful_gets_the_source() {
    let mut e = Editor::create_document("Math", &[[600., 800.]], &[]).unwrap();
    e.add_image(0, math_box(r"Area: $\pi r^2$", true)).unwrap();
    let project = e.save_project().unwrap();
    assert!(project.contains("\"math\":true"));
    let reopened = Editor::open_project(&project).unwrap();
    assert_eq!(reopened.view(0).unwrap()["texts"][0]["math"], true);
    // Noteful has no math: its text box gets the LaTeX as written.
    let exported = Editor::open(&e.export_noteful().unwrap()).unwrap();
    let texts = exported.view(0).unwrap()["texts"].clone();
    let text: String = texts[0]["runs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["text"].as_str().unwrap())
        .collect();
    assert!(text.contains(r"Area: $\pi r^2$"), "{text}");
    // Older projects (no flag) still open: the field is optional.
    assert!(!e.save_project().unwrap().contains("\"math\":false"));
}

#[test]
fn a_joined_text_box_is_undone_with_the_lines_before_it() {
    use noteful_core::Line;
    let mut e = Editor::create_document("Graph", &[[600., 800.]], &[]).unwrap();
    e.add_line(0, Line::new(vec![[0., 0.], [100., 0.]], 1., [0., 0., 0., 1.]))
        .unwrap();
    e.add_line(
        0,
        Line {
            joined: true,
            ..Line::new(vec![[0., 10.], [100., 10.]], 1., [0., 0., 0., 1.])
        },
    )
    .unwrap();
    e.add_image(0, Image { joined: true, ..math_box("x", false) }).unwrap();
    assert_eq!(e.view(0).unwrap()["visible_added"], 3);
    e.undo();
    assert_eq!(e.view(0).unwrap()["visible_added"], 0, "one undo for the whole graph");
    e.redo();
    assert_eq!(e.view(0).unwrap()["visible_added"], 3);
}
