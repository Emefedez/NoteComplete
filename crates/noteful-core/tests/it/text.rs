use noteful_core::{decode_rich_text, text_svg, Editor};
use serde_json::json;
#[test]
fn real_text_note_has_content_sizes_and_font_traits() {
    let e = Editor::open(crate::samples::TEXT).unwrap();
    let v = e.view(0).unwrap();
    assert_eq!(v["visible_imported"], 3);
    assert_eq!(v["warnings"], json!([]));
    let runs: Vec<_> = v["texts"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|b| b["runs"].as_array().unwrap())
        .filter(|r| r["text"] != "\u{200b}")
        .collect();
    for (content, family, size, bold, italic) in [
        ("texto texto ", "Helvetica", 16., false, false),
        ("Bocadillo", "Gill Sans", 16., true, false),
        ("Hola", "Galvji", 12., false, true),
    ] {
        let r = runs.iter().find(|r| r["text"] == content).unwrap();
        assert_eq!(r["font_family"], family);
        assert!((r["font_size"].as_f64().unwrap() * 6. / 11. - size).abs() < 1e-10);
        assert_eq!(r["bold"], bold);
        assert_eq!(r["italic"], italic);
        assert!(v["svg"].as_str().unwrap().contains(content.trim()));
    }
}
#[test]
fn decorations_use_integer_pool_and_attributes_inherit_between_runs() {
    let t = decode_rich_text(
        &json!({"2":["A","B","C"],"3":[7,0,2],"4":[14,13,10,2,3,4,5,4,5],"5":["Helvetica-BoldOblique","Helvetica"],"6":[1,1],"7":[],"8":[1,1,0,0],"9":[],"10":[29.333333333333332]}),
    );
    assert!(t.warnings.is_empty());
    assert!(t.runs[1].bold && t.runs[1].italic);
    assert_eq!(t.runs[1].underline, 1);
    assert_eq!(t.runs[1].strikethrough, 1);
    assert_eq!(t.runs[2].underline, 0);
    assert_eq!(t.runs[2].strikethrough, 0);
    let svg = text_svg(&t, 200.);
    assert!(svg.contains("underline line-through"));
    assert!(svg.contains("font-weight=\"700\""));
}
#[test]
fn unknown_attributes_keep_text_and_svg_escapes_markup() {
    let t = decode_rich_text(&json!({"2":["<script>&\" Hola\r\n🙂"],"3":[1],"4":[999]}));
    assert!(!t.warnings.is_empty());
    let svg = text_svg(&t, 200.);
    assert!(!svg.contains("<script>"));
    assert!(svg.contains("&lt;script&gt;&amp;"));
    assert!(svg.contains('🙂'));
    assert_eq!(svg.matches("<text ").count(), 2);
}
