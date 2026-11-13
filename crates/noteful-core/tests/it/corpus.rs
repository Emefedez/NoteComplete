use noteful_core::{decode_fields, decode_strokes, Package};
use std::path::Path;

fn samples() -> Vec<std::path::PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples");
    let mut files: Vec<_> = std::fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "noteful"))
        .collect();
    files.sort();
    files
}
#[test]
fn entire_corpus_round_trips_and_decodes_ink() {
    let files = samples();
    assert_eq!(files.len(), 10);
    for path in files {
        let data = std::fs::read(&path).unwrap();
        let p = Package::parse(&data).unwrap();
        assert_eq!(p.rebuild().unwrap(), data, "{}", path.display());
        assert!(p.blocks.iter().all(|b| b.stroke_error.is_none()));
        if path.file_stem().unwrap() == "Examen wuolah" {
            let strokes: Vec<_> = p
                .blocks
                .iter()
                .flat_map(|b| b.strokes.iter().flatten())
                .collect();
            assert_eq!(strokes.len(), 2008);
            assert_eq!(strokes.iter().filter(|s| !s.radii.is_empty()).count(), 23);
            assert_eq!(
                strokes.iter().filter(|s| !s.auxiliary.is_empty()).count(),
                12
            );
        }
    }
}
#[test]
fn truncated_and_forged_extents_fail_without_panics() {
    let data = std::fs::read(samples().remove(0)).unwrap();
    for cut in [0, 1, 4, 19, 20, 509, data.len() - 1] {
        assert!(Package::parse(&data[..cut]).is_err());
    }
    let mut bad = data.clone();
    let n = bad.len();
    bad[n - 12..n - 4].copy_from_slice(&u64::MAX.to_be_bytes());
    assert!(Package::parse(&bad).is_err());
    for n in 0..1024 {
        let noise: Vec<u8> = (0..n).map(|i| ((i * 37 + n * 19) % 256) as u8).collect();
        assert!(Package::parse(&noise).is_err());
        let _ = decode_fields(&noise, 0);
        let _ = decode_strokes(&noise);
    }
}
#[test]
fn field_nesting_and_unknown_types_are_bounded() {
    for bytes in [
        &[0u8][..],
        &[0, 1, 0, 0xff][..],
        &[0, 1, 4, 2, 0xff, 0xff, 0xff, 0xff][..],
    ] {
        assert!(decode_fields(bytes, 0).is_err());
    }
    let mut bytes = vec![0, 1, 0, 1, 1];
    for _ in 0..42 {
        let mut parent = vec![0, 1, 0, 7];
        parent.extend((bytes.len() as u32).to_be_bytes());
        parent.extend(bytes);
        bytes = parent;
    }
    assert!(decode_fields(&bytes, 0).is_err());
}
#[test]
fn raw_radii_auxiliary_and_style_commands() {
    let mut bytes = vec![0xf1, 2];
    for v in [1f64, 0., 0., 0.5] {
        bytes.extend(v.to_be_bytes());
    }
    bytes.extend(1u16.to_be_bytes());
    bytes.extend([0; 8]);
    bytes.extend([0xf1, 1]);
    let mut header = [0; 38];
    header[8..10].copy_from_slice(&3u16.to_be_bytes());
    bytes.extend(header);
    bytes.extend(2f64.to_be_bytes());
    bytes.extend(0u32.to_be_bytes());
    bytes.extend(2u32.to_be_bytes());
    bytes.extend(0u8..16);
    for v in [10f32, 20., 0.25, 30., 40., 0.75] {
        bytes.extend(v.to_be_bytes());
    }
    let s = decode_strokes(&bytes).unwrap().remove(0);
    assert_eq!(s.points, vec![[10., 20.], [30., 40.]]);
    assert_eq!(s.radii, vec![0.25, 0.75]);
    assert_eq!(s.style.rgba, [1., 0., 0., 0.5]);
    assert_eq!(s.style.tool, 1);
    assert_eq!(s.auxiliary, (0u8..16).collect::<Vec<_>>());
}
