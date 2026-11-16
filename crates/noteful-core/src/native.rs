//! Helpers for building and repairing real-Noteful-compatible metadata and containers.
use crate::{encode_fields, wire::field, Error, Field, Package, Result, WireValue as V};
use md5::{Digest, Md5};
use std::borrow::Cow;
use std::collections::HashSet;

pub(crate) const APPLE_EPOCH_SECS: f64 = 800_000_000.0;
pub(crate) const APPLE_CLOCK_US: u64 = 800_000_000_000_000;
pub(crate) const NATIVE_VERSION: f64 = 1.21_f32 as f64;

/// 16x16 white baseline JFIF JPEG used as a lightweight cover block when a note has none.
pub(crate) const BLANK_COVER_JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x05, 0x03, 0x04, 0x04, 0x04, 0x03, 0x05,
    0x04, 0x04, 0x04, 0x05, 0x05, 0x05, 0x06, 0x07, 0x0c, 0x08, 0x07, 0x07, 0x07, 0x07, 0x0f, 0x0b,
    0x0b, 0x09, 0x0c, 0x11, 0x0f, 0x12, 0x12, 0x11, 0x0f, 0x11, 0x11, 0x13, 0x16, 0x1c, 0x17, 0x13,
    0x14, 0x1a, 0x15, 0x11, 0x11, 0x18, 0x21, 0x18, 0x1a, 0x1d, 0x1d, 0x1f, 0x1f, 0x1f, 0x13, 0x17,
    0x22, 0x24, 0x22, 0x1e, 0x24, 0x1c, 0x1e, 0x1f, 0x1e, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x05, 0x05,
    0x05, 0x07, 0x06, 0x07, 0x0e, 0x08, 0x08, 0x0e, 0x1e, 0x14, 0x11, 0x14, 0x1e, 0x1e, 0x1e, 0x1e,
    0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e,
    0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e,
    0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0x1e, 0xff, 0xc0,
    0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
    0x01, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05,
    0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21,
    0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23,
    0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17,
    0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
    0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a,
    0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a,
    0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99,
    0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7,
    0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5,
    0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1,
    0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xc4, 0x00, 0x1f, 0x01, 0x00, 0x03,
    0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x11, 0x00,
    0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04, 0x04, 0x00, 0x01, 0x02, 0x77, 0x00,
    0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13,
    0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15,
    0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27,
    0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88,
    0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6,
    0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4,
    0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
    0xfa, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0xfb,
    0x2e, 0x8a, 0x28, 0xa0, 0x0f, 0xff, 0xd9,
];

pub(crate) fn f(tag: u16, wire_type: u16, value: V) -> Field {
    Field {
        tag,
        wire_type,
        value,
        offset: 0,
        size: 0,
        clock: (wire_type & 0x800 != 0).then_some(0),
    }
}

pub(crate) fn clocked(tag: u16, wire_type: u16, value: V, clock: u64) -> Field {
    Field {
        tag,
        wire_type,
        value,
        offset: 0,
        size: 0,
        clock: Some(clock),
    }
}

pub(crate) fn is_uuid32(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'A'..=b'F'))
}

pub(crate) fn deterministic_uuid(seed: &[u8]) -> String {
    let mut b: [u8; 16] = Md5::digest(seed).into();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    b.iter().map(|v| format!("{v:02X}")).collect()
}

pub(crate) fn collection(id_type: u16) -> Vec<Field> {
    vec![
        f(1, 0x400 | id_type, V::Array(vec![])),
        f(2, 0x402, V::Array(vec![])),
        f(3, 0x401, V::Array(vec![])),
        f(0, 0x407, V::Array(vec![])),
    ]
}

pub(crate) fn pdf_background_fields(
    size: [f64; 2],
    resource: &str,
    page_index: u64,
    rect: Option<[f64; 4]>,
) -> Vec<Field> {
    let mut bg = vec![
        f(0, 0x11, V::UInt(1)),
        f(1, 0x21, V::Pair(size)),
        f(2, 1, V::UInt(0)),
        f(3, 2, V::UInt(page_index)),
        f(4, 5, V::Text(resource.to_owned())),
        f(5, 2, V::UInt(0)),
    ];
    if let Some(r) = rect {
        bg.push(f(9, 0x23, V::Rect(r)));
    }
    bg
}

pub(crate) fn blank_background_fields(size: [f64; 2]) -> Vec<Field> {
    vec![
        f(0, 0x11, V::UInt(0)),
        f(1, 0x21, V::Pair(size)),
        f(2, 1, V::UInt(0)),
        f(6, 5, V::Text("{\"pc\":16777215}".into())),
    ]
}

pub(crate) fn page_record_fields(
    id: String,
    editable_id: String,
    bg: Vec<Field>,
    order_key: String,
    link_uuid: String,
    clock: u64,
) -> Vec<Field> {
    vec![
        f(1, 5, V::Text(id)),
        f(
            2,
            7,
            V::Fields(vec![
                f(0, 5, V::Text(editable_id)),
                f(2, 0x405, V::Array(vec![])),
                f(3, 0x405, V::Array(vec![])),
            ]),
        ),
        clocked(4, 0x807, V::Fields(bg), clock),
        clocked(5, 0x805, V::Text(order_key), clock),
        f(6, 5, V::Text(link_uuid)),
        clocked(7, 0x801, V::UInt(0), clock),
        clocked(9, 0x801, V::UInt(0), clock),
    ]
}

pub(crate) fn default_layers_collection(clock: u64) -> Vec<Field> {
    let layer = V::Fields(vec![
        clocked(1, 0x805, V::Text("Layer 1".into()), clock),
        f(2, 0x12, V::UInt(0)),
        clocked(3, 0x805, V::Text("0".into()), clock),
        clocked(4, 0x801, V::UInt(0), 0),
        clocked(5, 0x801, V::UInt(0), 0),
        clocked(6, 0x803, V::Float(1.0), clock),
        clocked(7, 0x801, V::UInt(0), clock),
    ]);
    vec![
        f(1, 0x412, V::Array(vec![V::UInt(0)])),
        f(2, 0x402, V::Array(vec![V::UInt(clock)])),
        f(3, 0x401, V::Array(vec![V::UInt(1)])),
        f(0, 0x407, V::Array(vec![layer])),
    ]
}

pub(crate) fn build_note_metadata(
    note_id: &str,
    title: &str,
    cover_id: &str,
    ts_secs: f64,
    clock: u64,
    content_size: u64,
) -> Vec<Field> {
    let cover_uuid = deterministic_uuid(format!("cover-u:{note_id}").as_bytes());
    let note_uuid10 = deterministic_uuid(format!("note10:{note_id}").as_bytes());
    let tag6 = (1u16..=6)
        .map(|t| clocked(t, 0x801, V::UInt(0), 0))
        .collect();
    vec![
        f(1, 5, V::Text(note_id.to_owned())),
        f(2, 2, V::UInt(0)),
        clocked(3, 0x805, V::Text(title.to_owned()), clock),
        clocked(4, 0x805, V::Text(String::new()), clock),
        f(5, 4, V::Float(ts_secs)),
        f(6, 7, V::Fields(tag6)),
        clocked(
            7,
            0x807,
            V::Fields(vec![
                f(1, 5, V::Text(cover_id.to_owned())),
                f(2, 5, V::Text(cover_uuid)),
            ]),
            clock,
        ),
        clocked(8, 0x805, V::Text(String::new()), clock),
        clocked(9, 0x805, V::Text(String::new()), clock),
        f(10, 5, V::Text(note_uuid10)),
        clocked(
            11,
            0x807,
            V::Fields(vec![
                f(0, 2, V::UInt(0)),
                f(
                    1,
                    7,
                    V::Fields(vec![f(0, 0x403, V::Array(vec![V::Float(0.); 4]))]),
                ),
            ]),
            clock,
        ),
        f(12, 4, V::Float(ts_secs)),
        f(13, 0x13, V::UInt(content_size)),
        f(14, 2, V::UInt(0)),
        clocked(15, 0x805, V::Text(String::new()), clock),
    ]
}

pub(crate) fn build_drawing_metadata(
    note_id: &str,
    pages_collection: Vec<Field>,
    layers_collection: Vec<Field>,
    doc_uuid6: &str,
    clock: u64,
) -> Vec<Field> {
    vec![
        f(1, 5, V::Text(note_id.to_owned())),
        f(2, 7, V::Fields(pages_collection)),
        f(3, 7, V::Fields(layers_collection)),
        f(7, 7, V::Fields(collection(5))),
        f(4, 7, V::Fields(collection(5))),
        f(5, 7, V::Fields(collection(5))),
        f(6, 5, V::Text(doc_uuid6.to_owned())),
        clocked(8, 0x812, V::UInt(0), clock),
        f(9, 2, V::UInt(0)),
        f(10, 7, V::Fields(collection(5))),
    ]
}

pub(crate) fn build_index_fields(
    version: f64,
    note_id: &str,
    resource_ids: Vec<String>,
    editable_ids: Vec<String>,
    keys: Vec<V>,
    offsets: Vec<V>,
    lengths: Vec<V>,
) -> Vec<Field> {
    let mut fields = vec![
        f(1, 3, V::Float(version)),
        f(2, 0x405, V::Array(vec![V::Text(note_id.to_owned())])),
        f(
            3,
            0x405,
            V::Array(resource_ids.into_iter().map(V::Text).collect()),
        ),
    ];
    if !editable_ids.is_empty() {
        fields.push(f(
            4,
            0x405,
            V::Array(editable_ids.into_iter().map(V::Text).collect()),
        ));
    }
    fields.extend([
        f(10, 0x405, V::Array(keys)),
        f(11, 0x402, V::Array(offsets)),
        f(12, 0x402, V::Array(lengths)),
    ]);
    fields
}

/// Identifies archives produced by earlier versions of NoteComplete (`n:imported` / `d:imported`)
/// whose headers and metadata need to be upgraded for real Noteful compatibility.
pub(crate) fn is_legacy_notecomplete_package(package: &Package) -> bool {
    package
        .blocks
        .iter()
        .any(|b| b.id == "n:imported" || b.id == "d:imported")
}

/// True when any `.noteful` package lacks required real-Noteful metadata (legacy `n:imported`,
/// missing index note IDs, unclocked `n:/3`, empty layers, or legacy page background encoding).
pub(crate) fn needs_explicit_repair(package: &Package) -> bool {
    if is_legacy_notecomplete_package(package) {
        return true;
    }
    let has_note_ids = field(&package.index, 2)
        .and_then(V::as_array)
        .is_some_and(|a| !a.is_empty());
    if !has_note_ids {
        return true;
    }
    let Some(note) = package.blocks.iter().find(|b| b.kind == "note_metadata") else {
        return true;
    };
    if note.fields.as_deref().is_none_or(|fs| {
        fs.iter()
            .find(|f| f.tag == 3)
            .is_none_or(|f| f.clock.is_none())
    }) {
        return true;
    }
    let Some(drawing) = package.blocks.iter().find(|b| b.kind == "drawing_metadata") else {
        return true;
    };
    let Some(dfs) = drawing.fields.as_deref() else {
        return true;
    };
    let empty_layers = field(dfs, 3)
        .and_then(V::as_fields)
        .and_then(|fs| field(fs, 0))
        .and_then(V::as_array)
        .is_none_or(|a| a.is_empty());
    empty_layers
}

/// Upgrades an already-assembled list of blocks and index fields in-place so legacy
/// NoteComplete archives (`n:imported`/`d:imported` or incomplete packages) open in real Noteful.
pub(crate) fn upgrade_package_parts(
    blocks: &mut Vec<(String, Cow<'_, [u8]>)>,
    index: &mut Vec<Field>,
    clock: u64,
    strip_pdfs: bool,
) -> Result<()> {
    let old_note_block = blocks
        .iter()
        .position(|(id, _)| id.starts_with("n:"))
        .ok_or_else(|| Error::new(0, "Missing note metadata"))?;
    let old_draw_block = blocks
        .iter()
        .position(|(id, _)| id.starts_with("d:"))
        .ok_or_else(|| Error::new(0, "Missing drawing metadata"))?;

    let old_note_id = blocks[old_note_block].0[2..].to_owned();
    let old_note_fields = crate::decode_fields(&blocks[old_note_block].1, 0)?;
    let old_draw_fields = crate::decode_fields(&blocks[old_draw_block].1, 0)?;

    let title = field(&old_note_fields, 3)
        .and_then(V::as_text)
        .unwrap_or("Note")
        .to_owned();

    let note_id = if is_uuid32(&old_note_id) {
        old_note_id.clone()
    } else {
        let mut seed = Vec::from(title.as_bytes());
        for (id, bytes) in blocks.iter() {
            seed.extend_from_slice(id.as_bytes());
            seed.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        }
        deterministic_uuid(&seed)
    };

    let clock = clock.max(APPLE_CLOCK_US);

    // Inspect drawing metadata pages + layers
    let mut page_col = field(&old_draw_fields, 2)
        .and_then(V::as_fields)
        .map(|v| v.to_vec())
        .unwrap_or_else(|| collection(5));
    let raw_pages = field(&page_col, 0)
        .and_then(V::as_array)
        .map(|a| a.to_vec())
        .unwrap_or_default();

    // Collect any blank-paper sizes needed if repairing legacy bg/0 == 0 pages.
    let mut blank_sizes: Vec<[f64; 2]> = Vec::new();
    let mut normalized_pages: Vec<(V, String)> = Vec::with_capacity(raw_pages.len());

    // First pass: see which legacy pages have bg/0 == 0 without PDF
    if !strip_pdfs {
        for p in &raw_pages {
            if let Some(pfs) = p.as_fields() {
                if let Some(bg) = field(pfs, 4).and_then(V::as_fields) {
                    if field(bg, 0).and_then(V::as_uint) == Some(0) {
                        if let Some(V::Pair(sz)) = field(bg, 1) {
                            if !blank_sizes.contains(sz) {
                                blank_sizes.push(*sz);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut blank_pdf_id: Option<String> = None;
    if !blank_sizes.is_empty() {
        let mut candidate = "blank-paper".to_owned();
        let mut suffix = 0usize;
        while blocks.iter().any(|(id, _)| id == &candidate) {
            candidate = format!("blank-paper-{suffix}");
            suffix += 1;
        }
        let pdf_bytes = crate::ink::paper::blank_pdf(&blank_sizes);
        blocks.push((candidate.clone(), Cow::Owned(pdf_bytes)));
        blank_pdf_id = Some(candidate);
    }

    for (idx, p) in raw_pages.into_iter().enumerate() {
        let Some(pfs) = p.as_fields() else {
            continue;
        };
        let old_pid = field(pfs, 1).and_then(V::as_text).unwrap_or("");
        let pid = if is_uuid32(old_pid) {
            old_pid.to_owned()
        } else {
            deterministic_uuid(format!("page:{note_id}:{idx}:{old_pid}").as_bytes())
        };
        let editable_id = field(pfs, 2)
            .and_then(V::as_fields)
            .and_then(|fs| field(fs, 0))
            .and_then(V::as_text)
            .unwrap_or("")
            .to_owned();
        let order_key = field(pfs, 5)
            .and_then(V::as_text)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{idx:020}"));
        let link_uuid = field(pfs, 6)
            .and_then(V::as_text)
            .filter(|s| is_uuid32(s))
            .map(str::to_owned)
            .unwrap_or_else(|| deterministic_uuid(format!("page-link:{note_id}:{pid}").as_bytes()));

        let bg_fields = if let Some(bg) = field(pfs, 4).and_then(V::as_fields) {
            let kind = field(bg, 0).and_then(V::as_uint).unwrap_or(0);
            let size = match field(bg, 1) {
                Some(V::Pair(sz)) => *sz,
                _ => crate::ink::A4,
            };
            if kind == 1 {
                let res = field(bg, 4).and_then(V::as_text).unwrap_or("");
                let page_index = field(bg, 3).and_then(V::as_uint).unwrap_or(0);
                let rect = match field(bg, 9) {
                    Some(V::Rect(r)) => Some(*r),
                    _ => None,
                };
                pdf_background_fields(size, res, page_index, rect)
            } else if kind == 0 {
                if let (false, Some(bpid)) = (strip_pdfs, blank_pdf_id.as_deref()) {
                    let b_idx = blank_sizes.iter().position(|s| *s == size).unwrap_or(0) as u64;
                    pdf_background_fields(size, bpid, b_idx, None)
                } else {
                    blank_background_fields(size)
                }
            } else {
                bg.to_vec()
            }
        } else {
            blank_background_fields(crate::ink::A4)
        };

        let record = V::Fields(page_record_fields(
            pid.clone(),
            editable_id,
            bg_fields,
            order_key,
            link_uuid,
            clock,
        ));
        normalized_pages.push((record, pid));
    }

    let n_pages = normalized_pages.len();
    for field in &mut page_col {
        match field.tag {
            0 => field.value = V::Array(normalized_pages.iter().map(|(r, _)| r.clone()).collect()),
            1 => {
                field.value = V::Array(
                    normalized_pages
                        .iter()
                        .map(|(_, id)| V::Text(id.clone()))
                        .collect(),
                )
            }
            2 => field.value = V::Array(vec![V::UInt(clock); n_pages]),
            3 => field.value = V::Array(vec![V::UInt(1); n_pages]),
            _ => {}
        }
    }

    let mut layers_col = field(&old_draw_fields, 3)
        .and_then(V::as_fields)
        .map(|v| v.to_vec())
        .unwrap_or_else(|| collection(0x12));
    if field(&layers_col, 0)
        .and_then(V::as_array)
        .is_none_or(|a| a.is_empty())
    {
        layers_col = default_layers_collection(clock);
    }

    let doc_uuid6 = field(&old_draw_fields, 6)
        .and_then(V::as_text)
        .filter(|s| is_uuid32(s))
        .map(str::to_owned)
        .unwrap_or_else(|| deterministic_uuid(format!("doc6:{note_id}").as_bytes()));
    let existing_rec = field(&old_draw_fields, 7)
        .and_then(V::as_fields)
        .map(|v| v.to_vec());
    let mut draw_fields = build_drawing_metadata(&note_id, page_col, layers_col, &doc_uuid6, clock);
    if let Some(rec) = existing_rec {
        if let Some(f) = draw_fields.iter_mut().find(|f| f.tag == 7) {
            f.value = V::Fields(rec);
        }
    }
    let new_draw_bytes = encode_fields(&draw_fields)?;

    blocks[old_draw_block].0 = format!("d:{note_id}");
    blocks[old_draw_block].1 = Cow::Owned(new_draw_bytes);

    // Ensure cover JPEG exists
    let existing_cover = field(&old_note_fields, 7)
        .and_then(V::as_fields)
        .and_then(|fs| field(fs, 1))
        .and_then(V::as_text)
        .filter(|id| blocks.iter().any(|(bid, _)| bid == id))
        .map(str::to_owned);
    let cover_id = if let Some(cid) = existing_cover {
        cid
    } else {
        let cid = deterministic_uuid(format!("cover:{note_id}").as_bytes());
        // Insert right after old_note_block so range-read cover fetch finds it in head chunk.
        let insert_at = old_note_block + 1;
        blocks.insert(insert_at, (cid.clone(), Cow::Borrowed(BLANK_COVER_JPEG)));
        cid
    };

    // Recompute content size (non-cover resource + metadata blocks)
    let content_size: u64 = blocks
        .iter()
        .filter(|(id, _)| id != &cover_id && !id.starts_with("n:"))
        .map(|(_, b)| b.len() as u64)
        .sum();

    let new_note_bytes = encode_fields(&build_note_metadata(
        &note_id,
        &title,
        &cover_id,
        APPLE_EPOCH_SECS,
        clock,
        content_size,
    ))?;
    blocks[old_note_block].0 = format!("n:{note_id}");
    blocks[old_note_block].1 = Cow::Owned(new_note_bytes);

    // Update index fields
    let mut resource_ids: Vec<String> = field(index, 3)
        .and_then(V::as_array)
        .map(|a| a.iter().filter_map(V::as_text).map(str::to_owned).collect())
        .unwrap_or_default();
    if !resource_ids.contains(&cover_id) {
        resource_ids.insert(0, cover_id);
    }
    if let Some(ref bpid) = blank_pdf_id {
        if !resource_ids.contains(bpid) {
            resource_ids.push(bpid.clone());
        }
    }
    // Dedup resource_ids while keeping order
    let mut seen_res = HashSet::new();
    resource_ids.retain(|id| seen_res.insert(id.clone()));

    let editable_ids: Vec<String> = field(index, 4)
        .and_then(V::as_array)
        .map(|a| a.iter().filter_map(V::as_text).map(str::to_owned).collect())
        .unwrap_or_default();

    let existing_version = field(index, 1)
        .and_then(|v| match v {
            V::Float(f) => Some(*f),
            _ => None,
        })
        .unwrap_or(NATIVE_VERSION);
    let version = if !(1.2..=NATIVE_VERSION).contains(&existing_version) {
        NATIVE_VERSION
    } else {
        existing_version
    };

    let keys = field(index, 10)
        .and_then(V::as_array)
        .map(|a| a.to_vec())
        .unwrap_or_default();
    let offsets = field(index, 11)
        .and_then(V::as_array)
        .map(|a| a.to_vec())
        .unwrap_or_default();
    let lengths = field(index, 12)
        .and_then(V::as_array)
        .map(|a| a.to_vec())
        .unwrap_or_default();

    *index = build_index_fields(
        version,
        &note_id,
        resource_ids,
        editable_ids,
        keys,
        offsets,
        lengths,
    );
    Ok(())
}

/// Repairs raw `.noteful` package bytes (e.g. files exported by older NoteComplete versions)
/// so they conform to real Noteful's index, metadata, layer, and page structures.
pub fn repair_noteful(data: &[u8]) -> Result<Vec<u8>> {
    let package = Package::parse(data)?;
    if !needs_explicit_repair(&package) {
        return Ok(data.to_vec());
    }
    let mut blocks: Vec<(String, Cow<'_, [u8]>)> = package
        .blocks
        .iter()
        .map(|b| {
            (
                b.id.clone(),
                Cow::Borrowed(package.resource(&b.id).unwrap()),
            )
        })
        .collect();
    let mut index = package.index.clone();
    upgrade_package_parts(&mut blocks, &mut index, APPLE_CLOCK_US, false)?;
    let trailer = crate::export::build_canonical_trailer(
        index,
        blocks.iter().map(|(id, bytes)| (id.clone(), bytes.len())),
    )?;
    let body: usize = blocks.iter().map(|(_, b)| b.len()).sum();
    let mut out = Vec::with_capacity(crate::MAGIC.len() + body + trailer.len());
    out.extend_from_slice(&crate::MAGIC);
    for (_, bytes) in blocks {
        out.extend_from_slice(&bytes);
    }
    out.extend_from_slice(&trailer);
    Package::parse(&out)?;
    Ok(out)
}
