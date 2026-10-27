use crate::{hex, Cursor, Error, Result};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Type/flags remain on Field so equal-width encodings never lose wire identity.
#[derive(Debug, Clone, PartialEq)]
pub enum WireValue {
    UInt(u64),
    Float(f64),
    Pair([f64; 2]),
    /// Type 0x23: four float64 values, observed as a CGRect (origin, size).
    Rect([f64; 4]),
    Text(String),
    Blob {
        offset: usize,
        bytes: Vec<u8>,
    },
    Fields(Vec<Field>),
    Array(Vec<WireValue>),
}
#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub tag: u16,
    pub wire_type: u16,
    pub offset: usize,
    pub size: usize,
    pub value: WireValue,
    pub clock: Option<u64>,
}
impl WireValue {
    pub fn as_uint(&self) -> Option<u64> {
        if let Self::UInt(v) = self {
            Some(*v)
        } else {
            None
        }
    }
    pub fn as_array(&self) -> Option<&[Self]> {
        if let Self::Array(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn as_text(&self) -> Option<&str> {
        if let Self::Text(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn as_fields(&self) -> Option<&[Field]> {
        if let Self::Fields(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn to_json(&self) -> Value {
        match self {
            Self::UInt(v) => json!(v),
            Self::Float(v) => json!(v),
            Self::Pair(v) => json!(v),
            Self::Rect(v) => json!(v),
            Self::Text(v) => json!(v),
            Self::Blob { offset, bytes } => {
                json!({"offset":offset,"size":bytes.len(),"hex":hex(bytes)})
            }
            Self::Fields(v) => json!(v.iter().map(Field::to_json).collect::<Vec<_>>()),
            Self::Array(v) => json!(v.iter().map(Self::to_json).collect::<Vec<_>>()),
        }
    }
}
impl Field {
    /// Diagnostic/oracle JSON, not the future JavaScript bridge DTO (u64 values).
    pub fn to_json(&self) -> Value {
        let mut v = json!({"tag":self.tag,"type":format!("0x{:04x}",self.wire_type),
            "offset":self.offset,"size":self.size,"value":self.value.to_json()});
        if let Some(c) = self.clock {
            v["clock_raw"] = json!(c);
        }
        v
    }
}
pub(crate) fn field(fields: &[Field], tag: u16) -> Option<&WireValue> {
    fields.iter().find(|f| f.tag == tag).map(|f| &f.value)
}
pub fn decode_fields(data: &[u8], origin: usize) -> Result<Vec<Field>> {
    origin
        .checked_add(data.len())
        .ok_or_else(|| Error::new(origin, "Offset overflow"))?;
    let mut budget = data.len();
    fields_inner(data, origin, 0, &mut budget)
}
fn spend(budget: &mut usize, at: usize) -> Result<()> {
    if *budget == 0 {
        return Err(Error::new(at, "Field/item budget exceeded"));
    }
    *budget -= 1;
    Ok(())
}
fn fields_inner(
    data: &[u8],
    origin: usize,
    depth: usize,
    budget: &mut usize,
) -> Result<Vec<Field>> {
    if depth > 40 {
        return Err(Error::new(origin, "Nesting limit exceeded"));
    }
    let mut r = Cursor::new(data, origin);
    let mut out = Vec::new();
    let mut tags = HashSet::new();
    while r.remaining() > 0 {
        spend(budget, r.at())?;
        let start = r.at();
        let tag = r.uint(2)? as u16;
        let typ = r.uint(2)? as u16;
        if !tags.insert(tag) {
            return Err(Error::new(start, "Duplicate tag"));
        }
        if typ & !0x0cff != 0 {
            return Err(Error::new(start, "Unknown type flags"));
        }
        let value = if typ & 0x400 != 0 {
            let count = r.uint(4)? as usize;
            if count > r.remaining() || count > *budget {
                return Err(Error::new(r.at(), "Array exceeds budget/buffer"));
            }
            let mut items = Vec::new();
            for _ in 0..count {
                spend(budget, r.at())?;
                items.push(scalar(&mut r, typ as u8, depth, budget)?);
            }
            WireValue::Array(items)
        } else {
            scalar(&mut r, typ as u8, depth, budget)?
        };
        let clock = if typ & 0x800 != 0 {
            Some(r.uint(8)?)
        } else {
            None
        };
        out.push(Field {
            tag,
            wire_type: typ,
            offset: start,
            size: r.at() - start,
            value,
            clock,
        });
    }
    Ok(out)
}
fn scalar(r: &mut Cursor<'_>, kind: u8, depth: usize, budget: &mut usize) -> Result<WireValue> {
    Ok(match kind {
        1 => WireValue::UInt(r.uint(1)?),
        2 | 0x13 => WireValue::UInt(r.uint(8)?),
        0x11 => WireValue::UInt(r.uint(2)?),
        0x12 | 0x14 => WireValue::UInt(r.uint(4)?),
        3 => WireValue::Float(r.float(4)?),
        4 | 0x20 => WireValue::Float(r.float(8)?),
        0x21 => WireValue::Pair([r.float(8)?, r.float(8)?]),
        0x23 => WireValue::Rect([r.float(8)?, r.float(8)?, r.float(8)?, r.float(8)?]),
        5..=7 => {
            let n = r.uint(4)? as usize;
            let origin = r.at();
            let bytes = r.take(n)?;
            match kind {
                5 => WireValue::Text(
                    std::str::from_utf8(bytes)
                        .map_err(|_| Error::new(origin, "Invalid UTF-8"))?
                        .to_owned(),
                ),
                6 => WireValue::Blob {
                    offset: origin,
                    bytes: bytes.to_vec(),
                },
                _ => WireValue::Fields(fields_inner(bytes, origin, depth + 1, budget)?),
            }
        }
        _ => return Err(Error::new(r.at(), format!("Unknown type {kind:#x}"))),
    })
}

/// Re-encode decoded wire values. This is not a document editing API.
pub fn encode_fields(fields: &[Field]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    for f in fields {
        out.extend(f.tag.to_be_bytes());
        out.extend(f.wire_type.to_be_bytes());
        if f.wire_type & 0x400 != 0 {
            let items = f
                .value
                .as_array()
                .ok_or_else(|| Error::new(f.offset, "Array type mismatch"))?;
            length(&mut out, items.len())?;
            for value in items {
                encode_scalar(&mut out, f.wire_type as u8, value)?;
            }
        } else {
            encode_scalar(&mut out, f.wire_type as u8, &f.value)?;
        }
        if f.wire_type & 0x800 != 0 {
            out.extend(
                f.clock
                    .ok_or_else(|| Error::new(f.offset, "Missing clock"))?
                    .to_be_bytes(),
            );
        }
    }
    Ok(out)
}
fn length(out: &mut Vec<u8>, n: usize) -> Result<()> {
    out.extend(
        u32::try_from(n)
            .map_err(|_| Error::new(0, "Length overflow"))?
            .to_be_bytes(),
    );
    Ok(())
}
fn encode_scalar(out: &mut Vec<u8>, kind: u8, value: &WireValue) -> Result<()> {
    match (kind, value) {
        (1 | 2 | 0x11..=0x14, WireValue::UInt(v)) => {
            let n = match kind {
                1 => 1,
                0x11 => 2,
                0x12 | 0x14 => 4,
                _ => 8,
            };
            if n < 8 && *v >= (1u64 << (n * 8)) {
                return Err(Error::new(0, "Integer overflow"));
            }
            out.extend(&v.to_be_bytes()[8 - n..]);
        }
        (3, WireValue::Float(v)) => out.extend((*v as f32).to_be_bytes()),
        (4 | 0x20, WireValue::Float(v)) => out.extend(v.to_be_bytes()),
        (0x21, WireValue::Pair(v)) => {
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
        (0x23, WireValue::Rect(v)) => {
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
        (5, WireValue::Text(v)) => {
            length(out, v.len())?;
            out.extend(v.as_bytes());
        }
        (6, WireValue::Blob { bytes, .. }) => {
            length(out, bytes.len())?;
            out.extend(bytes);
        }
        (7, WireValue::Fields(v)) => {
            let b = encode_fields(v)?;
            length(out, b.len())?;
            out.extend(b);
        }
        _ => return Err(Error::new(0, "Wire type/value mismatch")),
    }
    Ok(())
}
