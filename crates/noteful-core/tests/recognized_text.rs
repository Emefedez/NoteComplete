//! Text recognized in the handwriting (OCR in the reader) travels with the note, so
//! tools that read the note (the MCP server) see it.
use noteful_core::{Editor, InkWord};

fn word(text: &str, x: f64) -> InkWord {
    InkWord {
        text: text.into(),
        bounds: [x, 100., 60., 20.],
    }
}

#[test]
fn recognized_text_is_kept_in_projects_and_notecomp_files() {
    let mut e = Editor::create_document_with(
        "Apuntes",
        &[([800., 600.], None), ([800., 600.], None)],
        &[],
        "x",
        1.,
    )
    .unwrap();
    e.set_recognized_words(1, vec![word("mitosis", 10.), word("fase", 80.)])
        .unwrap();
    assert!(e.set_recognized_words(9, vec![]).is_err());
    let view = e.view(1).unwrap();
    assert_eq!(view["recognized_text"][0]["text"], "mitosis");
    assert_eq!(
        e.view(0).unwrap()["recognized_text"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let project = e.save_project().unwrap();
    assert!(project.contains("\"version\":8"));
    assert_eq!(
        Editor::open_project(&project)
            .unwrap()
            .recognized_words(1)
            .len(),
        2
    );
    let archive = Editor::open_notecomplete(&e.export_notecomplete().unwrap()).unwrap();
    assert_eq!(archive.recognized_words(1)[1].text, "fase");
    assert!(archive.recognized_words(0).is_empty());
    // Clearing it.
    e.set_recognized_words(1, vec![]).unwrap();
    assert!(!e.save_project().unwrap().contains("recognized_text"));
}
