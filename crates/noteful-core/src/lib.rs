//! Pure byte-oriented core. No filesystem, UI, network, or platform APIs.
//! Wire grammar and evidence: spec/noteful-v0.1.md and DEVELOPMENT.md.
#![forbid(unsafe_code)]

mod editor;
mod imports;
pub use imports::Image;
mod manipulation;
pub use manipulation::Adjustment;
mod export;
mod layer;
mod pages;
pub use pages::{NewPage, NewPdf, PdfPlacement};
mod shape;
pub use layer::Layer;
pub use shape::{Shape, ShapeKind};
mod media;
mod package;
mod scene;
mod stroke;
mod text;
pub use media::{audio_kind, audio_mime, AudioAsset, InkTiming, PdfBackground, Recording};
mod wire;
pub use text::{decode_rich_text, text_svg, RichText, TextRun};

pub use editor::{Editor, Line};
pub use scene::{Page, Scene, TAPE_OPEN};

pub use package::{Block, Package};
pub use stroke::{decode_strokes, Stroke, Style};
pub use wire::{decode_fields, encode_fields, Field, WireValue};

pub const MAGIC: [u8; 4] = [0xaa, 0xbb, 0xcc, 0xde];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub offset: usize,
    pub message: String,
}
impl Error {
    pub(crate) fn new(offset: usize, message: impl Into<String>) -> Self {
        Self {
            offset,
            message: message.into(),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} at 0x{:x}", self.message, self.offset)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

pub(crate) struct Cursor<'a> {
    pub data: &'a [u8],
    pub pos: usize,
    pub origin: usize,
}
impl<'a> Cursor<'a> {
    pub fn new(data: &'a [u8], origin: usize) -> Self {
        Self {
            data,
            pos: 0,
            origin,
        }
    }
    pub fn at(&self) -> usize {
        self.origin + self.pos
    }
    pub fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }
    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.remaining() {
            return Err(Error::new(self.at(), "Read outside buffer"));
        }
        let start = self.pos;
        self.pos += n;
        Ok(&self.data[start..self.pos])
    }
    pub fn uint(&mut self, n: usize) -> Result<u64> {
        Ok(self
            .take(n)?
            .iter()
            .fold(0, |a, b| (a << 8) | u64::from(*b)))
    }
    pub fn float(&mut self, n: usize) -> Result<f64> {
        let bits = self.uint(n)?;
        let value = if n == 4 {
            f32::from_bits(bits as u32) as f64
        } else {
            f64::from_bits(bits)
        };
        if !value.is_finite() {
            return Err(Error::new(self.at() - n, "Non-finite float"));
        }
        Ok(value)
    }
}
