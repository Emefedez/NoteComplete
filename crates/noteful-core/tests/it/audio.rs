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
