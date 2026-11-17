use noteful_core::{audio_kind, encode_fields, Editor, Package, WireValue, MAGIC};
#[test]
fn synthetic_audio_stays_exact_through_project_and_package() {
    let data = crate::samples::AUDIO;
    let p = Package::parse(data).unwrap();
    assert_eq!(p.rebuild().unwrap(), data);
    let e = Editor::open(data).unwrap();
    assert_eq!(e.scene.audio.len(), 1);
    assert_eq!(e.scene.audio[0].kind, "wav");
    let audio = e.audio_bytes("synthetic-audio").unwrap();
    assert_eq!(audio_kind(audio), Some("wav"));
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(restored.audio_bytes("synthetic-audio").unwrap(), audio);
}
#[test]
fn binary_resource_larger_than_previous_limit_has_no_size_ceiling() {
    let source = crate::samples::BLANK;
    let p = Package::parse(source).unwrap();
    let offset = p.index_offset;
    let size = 65 * 1024 * 1024;
    let mut data = source[..offset].to_vec();
    data.resize(offset + size, 0);
    let mut fields = p.index.clone();
    for (tag, value) in [
        (3, WireValue::Text("opaque-resource".into())),
        (10, WireValue::Text("opaque-resource".into())),
        (11, WireValue::UInt(offset as u64)),
        (12, WireValue::UInt(size as u64)),
    ] {
        let f = fields.iter_mut().find(|f| f.tag == tag).unwrap();
        if let WireValue::Array(items) = &mut f.value {
            items.push(value);
        } else {
            panic!("array expected")
        }
    }
    let index = encode_fields(&fields).unwrap();
    let end = data.len();
    data.extend(&index);
    data.extend(MAGIC);
    data.extend((end as u64).to_be_bytes());
    data.extend((index.len() as u32).to_be_bytes());
    let p = Package::parse(&data).unwrap();
    assert_eq!(p.resource("opaque-resource").unwrap().len(), size);
    assert_eq!(
        p.blocks
            .iter()
            .find(|b| b.id == "opaque-resource")
            .unwrap()
            .kind,
        "binary"
    );
}

#[test]
fn real_recording_pdf_pages_and_pen_down_times() {
    let data = crate::samples::PRACTICE_BOOK;
    let e = Editor::open(data).unwrap();
    assert_eq!(e.scene.pages.len(), 193);
    assert_eq!(e.scene.audio.len(), 1);
    assert_eq!(e.scene.recordings.len(), 1);
    let r = &e.scene.recordings[0];
    assert_eq!(r.start_us, "811003055158749");
    assert!((r.duration - 13.395676).abs() < 1e-9);
    assert_eq!(r.pages, vec![8]);
    for (i, page) in e.scene.pages.iter().enumerate() {
        let bg = page.pdf_background.as_ref().unwrap();
        assert_eq!(bg.page_index, i as u64);
        assert_eq!(bg.resource_id, "FF1EDCCAC0CE4A5383FB20FA37C48BD9");
    }
    assert!(e
        .pdf_bytes("FF1EDCCAC0CE4A5383FB20FA37C48BD9")
        .unwrap()
        .starts_with(b"%PDF-"));
    let timings = &e.scene.pages[8].timings;
    assert_eq!(timings.len(), 3);
    for (timing, (start, end)) in timings.iter().zip([
        (7.475601, 8.127483),
        (8.818385, 9.459884),
        (10.261083, 11.052481),
    ]) {
        assert_eq!(timing.recording_id, r.id);
        assert!((timing.start - start).abs() < 1e-9);
        assert!((timing.end - end).abs() < 1e-9);
        assert_eq!(timing.opacity(start - 0.000001), 0.2);
        assert_eq!(timing.opacity(start), 1.0);
        assert_eq!(timing.opacity(end), 1.0);
    }
    let text = Editor::open(crate::samples::TEXT).unwrap();
    let bg = text.scene.pages[0].pdf_background.as_ref().unwrap();
    assert_eq!(bg.resource_id, "7E4F4DC52177415AB2E508D2F46B8B09");
    assert_eq!(bg.page_index, 0);
}

#[test]
fn multiple_recordings_have_independent_clocks_and_preserve_every_asset() {
    let data = crate::samples::MULTI_AUDIO;
    let mut e = Editor::open(data).unwrap();
    assert_eq!(e.scene.audio.len(), 2);
    assert_eq!(e.scene.recordings.len(), 2);
    let timings = &e.scene.pages[8].timings;
    assert_eq!(timings.len(), 3);
    assert_eq!(
        timings
            .iter()
            .filter(|t| t.recording_id == e.scene.recordings[0].id)
            .count(),
        2
    );
    let second = timings
        .iter()
        .find(|t| t.recording_id == "synthetic-second-recording")
        .unwrap();
    assert!((second.start - 10.261083).abs() < 1e-9);
    let restored = Editor::open_project(&e.save_project().unwrap()).unwrap();
    for asset in &e.scene.audio {
        assert_eq!(
            restored.audio_bytes(&asset.id).unwrap(),
            e.audio_bytes(&asset.id).unwrap()
        );
    }
    let before = e.view(8).unwrap();
    // Erasing imported ink also removes its timeline entry; undo restores both.
    let p = Package::parse(data).unwrap();
    let point = p
        .blocks
        .iter()
        .flat_map(|b| b.strokes.iter().flatten())
        .next()
        .unwrap()
        .points[0];
    assert!(e.erase_path(8, &[point], 1.).unwrap() > 0);
    assert!(e.view(8).unwrap()["timings"].as_array().unwrap().len() < 3);
    e.undo();
    assert_eq!(e.view(8).unwrap()["svg"], before["svg"]);
    assert_eq!(e.view(8).unwrap()["timings"], before["timings"]);
}

#[test]
fn deleting_native_audio_is_undoable_and_drops_it_from_export() {
    let mut e = Editor::open(crate::samples::MULTI_AUDIO).unwrap();
    assert_eq!(e.view(8).unwrap()["audio"].as_array().unwrap().len(), 2);
    assert_eq!(
        e.view(8).unwrap()["recordings"].as_array().unwrap().len(),
        2
    );
    let victim = e.scene.audio[0].id.clone();
    let kept = e.scene.audio[1].id.clone();
    e.delete_audio(&victim).unwrap();
    assert!(e.delete_audio(&victim).is_err());
    assert!(e.audio_bytes(&victim).is_err());
    assert_eq!(e.view(8).unwrap()["audio"].as_array().unwrap().len(), 1);
    assert_eq!(
        e.view(8).unwrap()["recordings"].as_array().unwrap().len(),
        1
    );
    // Project round-trip preserves the deletion and its undo step.
    let mut reopened = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(
        reopened.view(8).unwrap()["audio"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        reopened.view(8).unwrap()["recordings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    reopened.undo();
    assert_eq!(
        reopened.view(8).unwrap()["audio"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        reopened.view(8).unwrap()["recordings"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(reopened.audio_bytes(&victim).is_ok());
    // Native export drops the deleted asset and its recording metadata, keeping the other.
    let exported = Editor::open(&e.export_noteful().unwrap()).unwrap();
    assert_eq!(exported.scene.audio.len(), 1);
    assert_eq!(exported.scene.audio[0].id, kept);
    assert_eq!(exported.scene.recordings.len(), 1);
    assert_eq!(exported.scene.recordings[0].asset_id, kept);
}

#[test]
fn nfedit_v11_bundles_added_audio_and_filtered_export_strips_selected_resources() {
    use noteful_core::{AddedAudio, InkWord, Line, ProjectExportOptions, ProjectStudy};
    let mut e = Editor::open(crate::samples::PRACTICE_BOOK).unwrap();
    e.add_line(
        0,
        Line::new(vec![[10., 10.], [80., 80.]], 3., [0., 0., 0., 1.]),
    )
    .unwrap();
    e.set_markdown("# Notes").unwrap();
    e.set_recognized_words(
        0,
        vec![InkWord {
            text: "Hello".into(),
            bounds: [10., 10., 50., 20.],
            link: None,
        }],
    )
    .unwrap();
    e.set_study(ProjectStudy {
        decks: vec![serde_json::json!({"id": "d1", "title": "Deck"})],
        quizzes: vec![],
        scratch: vec![],
    })
    .unwrap();
    e.set_added_audio(vec![(
        AddedAudio {
            id: "rec-1".into(),
            name: "Lecture".into(),
            mime: "audio/webm".into(),
            created: 1234.0,
        },
        vec![1, 2, 3, 4, 5, 6],
    )])
    .unwrap();
    let project = e.save_project().unwrap();
    assert!(project.contains("\"version\":11"));
    let restored = Editor::open_project(&project).unwrap();
    assert_eq!(restored.added_audio().len(), 1);
    assert_eq!(restored.added_audio()[0].0.id, "rec-1");
    assert_eq!(restored.added_audio()[0].1, vec![1, 2, 3, 4, 5, 6]);

    let breakdown = e.project_breakdown().unwrap();
    assert_eq!(
        breakdown.total_bytes,
        e.save_project_archive().unwrap().len()
    );
    assert!(breakdown.pdf_bytes > 0 && breakdown.pdf_count > 0);
    assert!(breakdown.native_audio_bytes > 0 && breakdown.native_audio_count == 1);
    assert!(breakdown.added_audio_bytes > 0 && breakdown.added_audio_count == 1);
    assert!(breakdown.history_bytes > 0 && breakdown.history_count == 1);
    assert!(breakdown.markdown_bytes > 0);
    assert!(breakdown.text_bytes > 0);
    assert!(breakdown.study_bytes > 0);

    // Stripping PDFs, audio, history, markdown, text, and study produces a clean lean .nfedit
    // with zero warnings and keeps drawn ink intact.
    let stripped = e
        .export_filtered_project(ProjectExportOptions {
            include_history: true,
            include_pdfs: false,
            include_native_audio: false,
            include_added_audio: false,
            include_markdown: false,
            include_ink_text: false,
            include_recognized_text: false,
            include_study: false,
            include_exam: false,
        })
        .unwrap();
    assert!(stripped.len() < project.len());
    let lean = Editor::open_project(&stripped).unwrap();
    assert_eq!(lean.scene.pages.len(), e.scene.pages.len());
    assert!(lean.view(0).unwrap()["pdf_background"].is_null());
    assert!(lean.pdf_bytes("FF1EDCCAC0CE4A5383FB20FA37C48BD9").is_err());
    assert!(lean.scene.audio.is_empty());
    assert!(lean.scene.recordings.is_empty());
    assert!(lean.added_audio().is_empty());
    assert!(lean.markdown().is_empty());
    assert!(lean.recognized_words(0).is_empty());
    assert!(lean.study().is_empty());
    assert_eq!(lean.view(0).unwrap()["warnings"], serde_json::json!([]));
    assert!(lean.view(0).unwrap()["visible_imported"].as_u64().unwrap() > 0);

    // Stripping only history flattens edits while keeping PDFs, native audio, added audio,
    // markdown, recognized text, and study sets.
    let flat_json = e
        .export_filtered_project(ProjectExportOptions {
            include_history: false,
            ..ProjectExportOptions::default()
        })
        .unwrap();
    let flat = Editor::open_project(&flat_json).unwrap();
    assert!(!flat.view(0).unwrap()["pdf_background"].is_null());
    assert!(flat.pdf_bytes("FF1EDCCAC0CE4A5383FB20FA37C48BD9").is_ok());
    assert_eq!(flat.scene.audio.len(), 1);
    assert_eq!(flat.added_audio().len(), 1);
    assert_eq!(flat.markdown(), "# Notes");
    assert_eq!(flat.recognized_words(0).len(), 1);
    assert_eq!(flat.study().decks.len(), 1);
    assert!(!flat.view(0).unwrap()["can_undo"].as_bool().unwrap());
}

#[test]
fn strip_audio_media_turns_recording_into_animation_with_undo_and_export() {
    let mut e = Editor::open(crate::samples::PRACTICE_BOOK).unwrap();
    let asset_id = e.scene.recordings[0].asset_id.clone();
    assert!(!asset_id.is_empty());
    let before = e.project_breakdown().unwrap();
    assert!(before.native_audio_bytes > 0);
    assert_eq!(before.native_audio_count, 1);

    e.strip_audio_media(&asset_id).unwrap();
    // Stripping a second time is rejected so edit history stays clean.
    assert!(e.strip_audio_media(&asset_id).is_err());

    let after = e.project_breakdown().unwrap();
    assert_eq!(after.native_audio_bytes, 0);
    assert_eq!(after.native_audio_count, 0);

    let view = e.view(8).unwrap();
    assert!(view["audio"].as_array().unwrap().is_empty());
    let recs = view["recordings"].as_array().unwrap();
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0]["animation"], serde_json::json!(true));
    assert!(!view["timings"].as_array().unwrap().is_empty());

    // Project save/reopen and .noteful export preserve animation metadata without audio bytes.
    let reopened = Editor::open_project(&e.save_project().unwrap()).unwrap();
    assert_eq!(
        reopened.view(8).unwrap()["recordings"][0]["animation"],
        serde_json::json!(true)
    );
    assert!(reopened.view(8).unwrap()["audio"]
        .as_array()
        .unwrap()
        .is_empty());
    let exported = Editor::open(&e.export_noteful().unwrap()).unwrap();
    assert!(exported.scene.audio.is_empty());
    assert_eq!(exported.scene.recordings.len(), 1);
    assert_eq!(exported.scene.recordings[0].asset_id, asset_id);

    // Undo restores native audio bytes and removes animation flag.
    e.undo();
    let restored = e.project_breakdown().unwrap();
    assert_eq!(restored.native_audio_bytes, before.native_audio_bytes);
    assert_eq!(restored.native_audio_count, 1);
    let view_restored = e.view(8).unwrap();
    assert_eq!(view_restored["audio"].as_array().unwrap().len(), 1);
    assert!(view_restored["recordings"][0]["animation"].is_null());
}
