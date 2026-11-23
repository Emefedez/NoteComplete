use crate::{
    decode_fields, decode_strokes, encode_fields, wire::field, Cursor, Error, Field, Result,
    Stroke, WireValue, MAGIC,
};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug)]
pub struct Block {
    pub id: String,
    pub offset: usize,
    pub size: usize,
    pub kind: &'static str,
    pub fields: Option<Vec<Field>>,
    pub strokes: Option<Vec<Stroke>>,
    pub stroke_error: Option<Error>,
}
/// Borrowed archive bytes; raw resources and unsupported ink remain available.
#[derive(Debug)]
pub struct Package<'a> {
    data: &'a [u8],
    pub index_offset: usize,
    pub index_size: usize,
    pub index: Vec<Field>,
    pub blocks: Vec<Block>,
}
fn required(fields: &[Field], tag: u16) -> Result<&WireValue> {
    field(fields, tag).ok_or_else(|| Error::new(0, format!("Missing tag {tag}")))
}
fn array(fields: &[Field], tag: u16) -> Result<&[WireValue]> {
    required(fields, tag)?
        .as_array()
        .ok_or_else(|| Error::new(0, "Expected array"))
}
fn address(value: u64) -> Result<usize> {
    usize::try_from(value).map_err(|_| Error::new(0, "Offset exceeds target address space"))
}
impl<'a> Package<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self> {
        if data.len() < 20 || data[..4] != MAGIC || data[data.len() - 16..data.len() - 12] != MAGIC
        {
            return Err(Error::new(0, "Noteful start/end magic missing"));
        }
        let mut trailer = Cursor::new(&data[data.len() - 12..], data.len() - 12);
        let index_offset = address(trailer.uint(8)?)?;
        let index_size = trailer.uint(4)? as usize;
        if index_offset < 4 || index_offset.checked_add(index_size) != Some(data.len() - 16) {
            return Err(Error::new(data.len() - 16, "Invalid index extent"));
        }
        let index = decode_fields(&data[index_offset..data.len() - 16], index_offset)?;
        required(&index, 1)?;
        let keys = array(&index, 10)?;
        let offsets = array(&index, 11)?;
        let sizes = array(&index, 12)?;
        if keys.len() != offsets.len() || keys.len() != sizes.len() {
            return Err(Error::new(index_offset, "Inconsistent index arrays"));
        }
        let mut editable = HashSet::new();
        let resources: HashSet<&str> = array(&index, 3)?
            .iter()
            .map(|v| {
                v.as_text()
                    .ok_or_else(|| Error::new(index_offset, "Invalid resource ID"))
            })
            .collect::<Result<_>>()?;
        if field(&index, 4).is_some() {
            for item in array(&index, 4)? {
                editable.insert(
                    item.as_text()
                        .ok_or_else(|| Error::new(index_offset, "Invalid editable ID"))?,
                );
            }
        }
        let mut ids = HashSet::new();
        let mut blocks = Vec::new();
        for ((key, offset), size) in keys.iter().zip(offsets).zip(sizes) {
            let id = key
                .as_text()
                .ok_or_else(|| Error::new(index_offset, "Invalid block ID"))?;
            if !ids.insert(id) {
                return Err(Error::new(index_offset, "Duplicate block ID"));
            }
            let offset = address(
                offset
                    .as_uint()
                    .ok_or_else(|| Error::new(index_offset, "Invalid offset"))?,
            )?;
            let size = address(
                size.as_uint()
                    .ok_or_else(|| Error::new(index_offset, "Invalid size"))?,
            )?;
            if offset < 4
                || size == 0
                || offset
                    .checked_add(size)
                    .is_none_or(|end| end > index_offset)
            {
                return Err(Error::new(offset, "Invalid block extent"));
            }
            let raw = &data[offset..offset + size];
            let kind = if raw.starts_with(b"%PDF-") {
                "pdf"
            } else if raw.starts_with(b"\xff\xd8\xff") {
                "jpeg"
            } else if raw.starts_with(b"\x89PNG\r\n\x1a\n") {
                "png"
            } else if let Some(kind) = picture_kind(raw) {
                kind
            } else if let Some(kind) = crate::audio_kind(raw) {
                kind
            } else if id.starts_with("n:") {
                "note_metadata"
            } else if id.starts_with("d:") {
                "drawing_metadata"
            } else if resources.contains(id) {
                "binary"
            } else {
                "structured"
            };
            blocks.push(Block {
                id: id.to_owned(),
                offset,
                size,
                kind,
                fields: None,
                strokes: None,
                stroke_error: None,
            });
        }
        // Validate all extents before spending memory decoding overlapping ranges.
        let mut sorted: Vec<_> = blocks.iter().collect();
        sorted.sort_by_key(|b| b.offset);
        let mut end = 4;
        for b in sorted {
            if b.offset != end {
                return Err(Error::new(end, "Gap or overlap"));
            }
            end += b.size;
        }
        if end != index_offset {
            return Err(Error::new(end, "Incomplete block coverage"));
        }
        for block in &mut blocks {
            if matches!(
                block.kind,
                "note_metadata" | "drawing_metadata" | "structured"
            ) {
                let fields =
                    decode_fields(&data[block.offset..block.offset + block.size], block.offset)?;
                if editable.contains(block.id.as_str()) {
                    block.kind = "stroke_object_set";
                    if let Some(WireValue::Blob { bytes, .. }) = field(&fields, 2) {
                        match decode_strokes(bytes) {
                            Ok(s) => block.strokes = Some(s),
                            Err(e) => block.stroke_error = Some(e),
                        }
                    }
                }
                block.fields = Some(fields);
            }
        }
        Ok(Self {
            data,
            index_offset,
            index_size,
            index,
            blocks,
        })
    }
    pub fn resource(&self, id: &str) -> Option<&'a [u8]> {
        self.blocks
            .iter()
            .find(|b| b.id == id)
            .map(|b| &self.data[b.offset..b.offset + b.size])
    }
    /// Re-encode all decoded fields, preserving resource/ink bytes and physical order.
    pub fn rebuild(&self) -> Result<Vec<u8>> {
        let mut out = MAGIC.to_vec();
        let mut sorted: Vec<_> = self.blocks.iter().collect();
        sorted.sort_by_key(|b| b.offset);
        for b in sorted {
            if out.len() != b.offset {
                return Err(Error::new(out.len(), "Rebuild offset mismatch"));
            }
            if let Some(fields) = &b.fields {
                out.extend(encode_fields(fields)?);
            } else {
                out.extend(&self.data[b.offset..b.offset + b.size]);
            }
        }
        if out.len() != self.index_offset {
            return Err(Error::new(out.len(), "Rebuild index mismatch"));
        }
        out.extend(encode_fields(&self.index)?);
        out.extend(&self.data[self.data.len() - 16..]);
        Ok(out)
    }
    /// Diagnostics for migration parity. Not a JavaScript-safe public document DTO.
    pub fn to_json(&self) -> Value {
        let blocks: Vec<_> = self
            .blocks
            .iter()
            .map(|b| {
                let mut v = json!({"id":b.id,"offset":b.offset,"size":b.size,"kind":b.kind});
                if let Some(fs) = &b.fields {
                    v["fields"] = json!(fs.iter().map(Field::to_json).collect::<Vec<_>>());
                }
                if let Some(strokes) = &b.strokes {
                    v["strokes"] = json!(strokes.iter().map(Stroke::to_json).collect::<Vec<_>>());
                }
                if let Some(e) = &b.stroke_error {
                    v["stroke_decode_error"] = json!(e.to_string());
                }
                v
            })
            .collect();
        json!({"magic":"aabbccde","byte_order":"big-endian","size":self.data.len(),
            "index_offset":self.index_offset,"index_size":self.index_size,"coverage":"exact",
            "index_fields":self.index.iter().map(Field::to_json).collect::<Vec<_>>(),"blocks":blocks})
    }
}

/// Pictures other than JPEG and PNG that an iPad note may hold: HEIC/HEIF photos (an
/// iPhone's camera), AVIF, WebP and GIF. M4A audio is also an ISO "ftyp" file: only the
/// picture brands count here.
pub(crate) fn picture_kind(raw: &[u8]) -> Option<&'static str> {
    if raw.len() >= 12 && &raw[4..8] == b"ftyp" {
        return match &raw[8..12] {
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" | b"mif1" | b"msf1" => Some("heic"),
            b"avif" | b"avis" => Some("avif"),
            _ => None,
        };
    }
    if raw.starts_with(b"GIF87a") || raw.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if raw.len() >= 12 && raw.starts_with(b"RIFF") && &raw[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

#[cfg(test)]
mod picture_kind_tests {
    use super::picture_kind;
    #[test]
    fn photos_from_an_iphone_and_other_pictures_are_told_apart_from_audio() {
        assert_eq!(picture_kind(b"\0\0\0\x24ftypheic\0\0\0\0mif1"), Some("heic"));
        assert_eq!(picture_kind(b"\0\0\0\x1cftypmif1\0\0\0\0heic"), Some("heic"));
        assert_eq!(picture_kind(b"\0\0\0\x1cftypavif\0\0\0\0"), Some("avif"));
        assert_eq!(picture_kind(b"GIF89a\x01\0\x01\0"), Some("gif"));
        assert_eq!(picture_kind(b"RIFF\x10\0\0\0WEBPVP8 "), Some("webp"));
        // M4A audio is an ftyp file too: not a picture.
        assert_eq!(picture_kind(b"\0\0\0\x20ftypM4A \0\0\0\0"), None);
        assert_eq!(picture_kind(b"\xff\xd8\xff"), None);
    }
}
