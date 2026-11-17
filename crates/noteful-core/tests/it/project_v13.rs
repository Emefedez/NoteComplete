//! `.nfedit` version 13: the project as an archive (project_archive.rs). Every note and every
//! older project must come back the same through it, with all that a project keeps.
use crate::samples::*;
use noteful_core::{AddedAudio, Editor, InkWord, Line, Origin, ProjectExportOptions, ProjectStudy};

/// Every page as the reader sees it, in display order.
fn pages(e: &Editor) -> Vec<String> {
    e.page_order()
        .iter()
        .map(|&s| e.view(s).unwrap().to_string())
        .collect()
}

fn same(a: &Editor, b: &Editor) {
    assert_eq!(pages(a), pages(b));
    assert_eq!(a.history_digest().unwrap(), b.history_digest().unwrap());
    assert_eq!(a.save_project().unwrap(), b.save_project().unwrap());
}

#[test]
fn every_sample_round_trips_through_the_archive() {
    for note in [
        EXAM,
        PRACTICE_BOOK,
        TEXT,
        BLANK,
        LINE_TOOL,
        IMAGE,
        AUDIO,
        MULTI_AUDIO,
    ] {
        let mut e = Editor::open(note).unwrap();
        e.add_line(
            0,
            Line::new(vec![[10., 10.], [80., 40.]], 2., [0., 0., 1., 1.]),
        )
        .unwrap();
        let archive = e.save_project_archive().unwrap();
        assert!(noteful_core::is_project_archive(&archive));
        let back = Editor::open_project_bytes(&archive).unwrap();
        same(&e, &back);
        // Without Base64 the file is smaller than the JSON form.
        assert!(archive.len() < e.save_project().unwrap().len() + 4096);
    }
}

#[test]
fn older_projects_open_and_save_as_v13() {
    let old = Editor::open_project(EDITING_DEMO).unwrap();
    let through_bytes = Editor::open_project_bytes(EDITING_DEMO.as_bytes()).unwrap();
    same(&old, &through_bytes);
    let archive = old.save_project_archive().unwrap();
    same(&old, &Editor::open_project_bytes(&archive).unwrap());
    // The JSON form of a Noteful project keeps the version its features need.
    let json: serde_json::Value = serde_json::from_str(&old.save_project().unwrap()).unwrap();
    assert!(json["version"].as_u64().unwrap() <= 12);
    // Hosts that route tar files to the .notecomp opener get the project too.
    same(&old, &Editor::open_notecomplete(&archive).unwrap());
    assert!(noteful_core::notecomplete_audio(&archive)
        .unwrap()
        .is_empty());
}

#[test]
fn everything_a_project_keeps_survives_the_archive() {
    let mut e = Editor::open(AUDIO).unwrap();
    e.add_line(
        0,
        Line::new(vec![[5., 5.], [60., 60.]], 3., [1., 0., 0., 1.]),
    )
    .unwrap();
    e.set_markdown("# Notes\n\n<!-- page 1 -->\nHello").unwrap();
    let word = InkWord {
        text: "Hello".into(),
        bounds: [10., 10., 50., 20.],
        link: None,
    };
    e.set_recognized_words(0, vec![word.clone()]).unwrap();
    e.set_ink_words(0, vec![word]).unwrap();
    e.set_study(ProjectStudy {
        decks: vec![serde_json::json!({"id": "d1"})],
        quizzes: vec![],
        scratch: vec![],
    })
    .unwrap();
    e.set_exam(noteful_core::ProjectExam {
        html: "<p>exam</p>".into(),
        ..Default::default()
    })
    .unwrap();
    e.set_added_audio(vec![
        (
            AddedAudio {
                id: "a".into(),
                name: "One".into(),
                mime: "audio/webm".into(),
                created: 1.,
            },
            vec![1, 2, 3],
        ),
        (
            AddedAudio {
                id: "b".into(),
                name: "Two".into(),
                mime: "audio/mp4".into(),
                created: 2.,
            },
            vec![9; 5000],
        ),
    ])
    .unwrap();
    e.set_origin(Some(Origin {
        format: "goodnotes".into(),
        name: "Lecture.goodnotes".into(),
        bytes: vec![7; 300],
    }));
    e.undo();
    let back = Editor::open_project_bytes(&e.save_project_archive().unwrap()).unwrap();
    same(&e, &back);
    assert_eq!(back.added_audio(), e.added_audio());
    assert_eq!(back.origin(), e.origin());
    assert_eq!(back.exam(), e.exam());
    assert_eq!(back.study(), e.study());
    // The JSON form (auto-save copies, sharing) carries the original too, as version 13.
    let json = e.save_project().unwrap();
    assert!(json.contains("\"version\":13"));
    assert_eq!(Editor::open_project(&json).unwrap().origin(), e.origin());
    // Redo still works after the round trip.
    let mut back = back;
    back.redo();
    e.redo();
    same(&e, &back);
}

#[test]
fn filtered_archives_leave_out_what_was_not_chosen() {
    let mut e = Editor::open(AUDIO).unwrap();
    e.set_added_audio(vec![(
        AddedAudio {
            id: "a".into(),
            name: "One".into(),
            mime: "audio/webm".into(),
            created: 1.,
        },
        vec![1, 2, 3],
    )])
    .unwrap();
    e.set_markdown("kept?").unwrap();
    let options = ProjectExportOptions {
        include_added_audio: false,
        include_markdown: false,
        ..Default::default()
    };
    let back =
        Editor::open_project_bytes(&e.export_filtered_project_archive(options).unwrap()).unwrap();
    assert!(back.added_audio().is_empty());
    assert_eq!(back.markdown(), "");
    let all = Editor::open_project_bytes(
        &e.export_filtered_project_archive(ProjectExportOptions::default())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(all.added_audio(), e.added_audio());
}

#[test]
fn broken_archives_are_refused() {
    let e = Editor::open(BLANK).unwrap();
    let archive = e.save_project_archive().unwrap();
    assert!(Editor::open_project_bytes(&archive[..archive.len() / 2]).is_err());
    assert!(!noteful_core::is_project_archive(
        &e.export_notecomplete().unwrap()
    ));
    assert!(!noteful_core::is_project_archive(
        e.save_project().unwrap().as_bytes()
    ));
}
