//! Synthetic archives shaped like the Memoria 1 and Temas1+2 backgrounds: a
//! widened page whose PDF keeps its native scale in background tag 9 (type 0x23).
use noteful_core::{encode_fields, Editor, Field, Package, WireValue as V, MAGIC};

fn f(tag: u16, wire_type: u16, value: V) -> Field {
    Field {
        tag,
        wire_type,
        offset: 0,
        size: 0,
        value,
        clock: (wire_type & 0x800 != 0).then_some(7),
    }
}

fn archive(backgrounds: Vec<Vec<Field>>) -> Vec<u8> {
    let n = backgrounds.len();
    let pages = backgrounds
        .into_iter()
        .enumerate()
        .map(|(i, bg)| {
            V::Fields(vec![
                f(1, 5, V::Text(format!("page-{i}"))),
                f(2, 7, V::Fields(vec![f(0, 5, V::Text(String::new()))])),
                f(4, 0x807, V::Fields(bg)),
                f(5, 5, V::Text(format!("{i:04}"))),
            ])
        })
        .collect();
    let records = vec![
        f(
            1,
            0x405,
            V::Array((0..n).map(|i| V::Text(format!("page-{i}"))).collect()),
        ),
        f(2, 0x402, V::Array(vec![V::UInt(0); n])),
        f(3, 0x401, V::Array(vec![V::UInt(1); n])),
        f(0, 0x407, V::Array(pages)),
    ];
    let pdf = b"%PDF-1.7\nfixture resource\n%%EOF".to_vec();
    let blocks = [
        (
            "n:doc",
            encode_fields(&[f(3, 5, V::Text("Widened".into()))]).unwrap(),
        ),
        (
            "d:doc",
            encode_fields(&[
                f(2, 7, V::Fields(records)),
                f(
                    3,
                    7,
                    V::Fields(vec![
                        f(1, 0x412, V::Array(vec![])),
                        f(2, 0x402, V::Array(vec![])),
                        f(3, 0x401, V::Array(vec![])),
                        f(0, 0x407, V::Array(vec![])),
                    ]),
                ),
            ])
            .unwrap(),
        ),
        ("slides", pdf),
    ];
    let mut out = MAGIC.to_vec();
    let (mut keys, mut offsets, mut lengths) = (vec![], vec![], vec![]);
    for (id, bytes) in blocks {
        keys.push(V::Text(id.into()));
        offsets.push(V::UInt(out.len() as u64));
        lengths.push(V::UInt(bytes.len() as u64));
        out.extend(bytes);
    }
    let index = encode_fields(&[
        f(1, 3, V::Float(1.)),
        f(3, 0x405, V::Array(vec![V::Text("slides".into())])),
        f(10, 0x405, V::Array(keys)),
        f(11, 0x402, V::Array(offsets)),
        f(12, 0x402, V::Array(lengths)),
    ])
    .unwrap();
    let at = out.len() as u64;
    let size = index.len() as u32;
    out.extend(index);
    out.extend(MAGIC);
    out.extend(at.to_be_bytes());
    out.extend(size.to_be_bytes());
    out
}

fn pdf_background(size: [f64; 2], rect: Option<[f64; 4]>) -> Vec<Field> {
    let mut bg = vec![
        f(0, 0x11, V::UInt(1)),
        f(1, 0x21, V::Pair(size)),
        f(2, 1, V::UInt(0)),
        f(3, 2, V::UInt(0)),
        f(4, 5, V::Text("slides".into())),
        f(5, 2, V::UInt(0)),
    ];
    if let Some(r) = rect {
        bg.push(f(9, 0x23, V::Rect(r)));
    }
    bg
}

#[test]
fn rect_fields_decode_and_round_trip_byte_exact() {
    let bytes = encode_fields(&[f(9, 0x23, V::Rect([0., 0., 1320., 990.]))]).unwrap();
    assert_eq!(bytes.len(), 4 + 32);
    let fields = noteful_core::decode_fields(&bytes, 0).unwrap();
    assert_eq!(fields[0].value, V::Rect([0., 0., 1320., 990.]));
    assert_eq!(encode_fields(&fields).unwrap(), bytes);
}

#[test]
fn widened_pages_place_the_pdf_in_its_rect_and_others_fill_the_page() {
    let source = archive(vec![
        // Temas1+2: 720x540 pt slides at 11/6 on a page widened to 2242.6.
        pdf_background([2242.6, 990.], Some([0., 0., 1320., 990.])),
        // Without tag 9 the PDF fills the page, as in the original corpus.
        pdf_background([1543.5, 1091.4], None),
    ]);
    let package = Package::parse(&source).unwrap();
    assert_eq!(package.rebuild().unwrap(), source);
    let editor = Editor::open(&source).unwrap();
    let wide = editor.view(0).unwrap();
    assert_eq!(wide["size"], serde_json::json!([2242.6, 990.]));
    assert_eq!(
        wide["pdf_background"]["rect"],
        serde_json::json!([0., 0., 1320., 990.])
    );
    assert_eq!(
        editor.view(1).unwrap()["pdf_background"]["rect"],
        serde_json::json!([0., 0., 1543.5, 1091.4])
    );
    assert_eq!(editor.export_noteful().unwrap(), source);
}

/// Flag 0x10 inserts `[u32][u32 len][ID]` before the width, as in Memoria 1 and Temas1+2.
#[test]
fn linked_strokes_decode_with_their_object_id() {
    let id = "1BA1CB05D47E40A12F46ACA3DC5FC0BD";
    let mut blob = vec![0xf1, 1];
    blob.extend(0x2226_f1e0_25ba_bca0u64.to_be_bytes());
    blob.extend(0x10u16.to_be_bytes());
    blob.extend([0; 24]); // three clocks
    blob.extend(0u32.to_be_bytes()); // layer
    blob.extend(0u32.to_be_bytes());
    blob.extend((id.len() as u32).to_be_bytes());
    blob.extend(id.as_bytes());
    blob.extend(3.7f64.to_be_bytes());
    blob.extend(0u32.to_be_bytes());
    blob.extend(2u32.to_be_bytes());
    for v in [2128.9f32, 772.1, 2191.2, 860.6] {
        blob.extend(v.to_be_bytes());
    }
    let strokes = noteful_core::decode_strokes(&blob).unwrap();
    assert_eq!(strokes.len(), 1);
    assert_eq!(strokes[0].link.as_ref().map(|l| l.1.as_str()), Some(id));
    assert_eq!(strokes[0].size, blob.len());
    assert!((strokes[0].points[1][0] - 2191.2).abs() < 1e-3);
    assert!((strokes[0].radius - 3.7).abs() < 1e-12);
}
