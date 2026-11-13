//! Handwriting written from Markdown keeps its text (`Editor::ink_words`), so the
//! reader can search it at once, and the text travels with projects and .notecomp files.
use noteful_core::{
    ink::{compose, insert_pages, new_notebook, ComposeOptions, A4},
    Editor,
};

fn words(e: &Editor, slot: usize) -> Vec<String> {
    e.ink_words(slot).iter().map(|w| w.text.clone()).collect()
}

#[test]
fn composed_pages_carry_their_words_with_boxes() {
    let (pages, _) = compose(
        "# Factorización LU\n\nLa matriz se puede factorizar.\n\n- primer punto\n- segundo punto",
        &ComposeOptions::default(),
    )
    .unwrap();
    let all: Vec<&str> = pages[0].words.iter().map(|w| w.text.as_str()).collect();
    for want in [
        "FACTORIZACIÓN",
        "matriz",
        "factorizar.",
        "primer",
        "segundo",
    ] {
        assert!(all.iter().any(|w| w.contains(want)), "{want} in {all:?}");
    }
    for w in &pages[0].words {
        let [x, y, width, height] = w.bounds;
        assert!(
            x >= 0.
                && y >= 0.
                && width > 0.
                && height > 0.
                && x + width <= A4[0]
                && y + height <= A4[1],
            "{w:?}"
        );
    }
    // Reading order: the heading comes before the list.
    let heading = all
        .iter()
        .position(|w| w.contains("FACTORIZACIÓN"))
        .unwrap();
    let item = all.iter().position(|w| *w == "segundo").unwrap();
    assert!(heading < item);
}

#[test]
fn a_new_notebook_keeps_its_text_through_projects_and_notecomp_files() {
    let (pages, _) = compose(
        "# Tema 2\n\nEl determinante no es cero.",
        &ComposeOptions::default(),
    )
    .unwrap();
    let editor = new_notebook("Tema 2", &pages).unwrap();
    assert!(words(&editor, 0).contains(&"determinante".to_owned()));
    let view = editor.view(0).unwrap();
    assert!(view["ink_text"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w["text"] == "determinante"));

    let project = editor.save_project().unwrap();
    assert!(project.contains("\"version\":6"));
    let reopened = Editor::open_project(&project).unwrap();
    assert_eq!(words(&reopened, 0), words(&editor, 0));

    let packed = editor.export_notecomplete().unwrap();
    let unpacked = Editor::open_notecomplete(&packed).unwrap();
    assert_eq!(words(&unpacked, 0), words(&editor, 0));
    // Notes without written text stay version 5 or lower and have no page text.
    let plain = Editor::open(crate::samples::EXAM).unwrap();
    assert!(plain.ink_words(0).is_empty());
    assert!(!plain.save_project().unwrap().contains("ink_text"));
}

#[test]
fn inserted_handwritten_pages_follow_undo_redo_and_flattening() {
    let mut editor = Editor::open(crate::samples::EXAM).unwrap();
    let (pages, _) = compose(
        "## Repaso\n\nVectores propios y valores propios.",
        &ComposeOptions::default(),
    )
    .unwrap();
    let shown = insert_pages(&mut editor, 1, &pages).unwrap();
    let slot = editor.slot(shown[0]).unwrap();
    assert!(words(&editor, slot).contains(&"Vectores".to_owned()));
    // The page under it keeps no text.
    assert!(editor.ink_words(editor.slot(0).unwrap()).is_empty());
    // Undo removes the page; redo brings it back with its words.
    editor.undo();
    editor.redo();
    assert!(words(&editor, slot).contains(&"Vectores".to_owned()));
    // A project keeps them in the insert edit.
    let reopened = Editor::open_project(&editor.save_project().unwrap()).unwrap();
    assert_eq!(words(&reopened, slot), words(&editor, slot));
    // A .notecomp file flattens the note: the words follow the page to its display position.
    let unpacked = Editor::open_notecomplete(&editor.export_notecomplete().unwrap()).unwrap();
    assert_eq!(
        words(&unpacked, unpacked.slot(1).unwrap()),
        words(&editor, slot)
    );
    assert!(unpacked.ink_words(unpacked.slot(0).unwrap()).is_empty());
}
