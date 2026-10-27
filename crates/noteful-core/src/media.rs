//! Embedded media and recording-relative whole-stroke timing.
pub fn audio_kind(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"caff") {
        Some("caf")
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WAVE" {
        Some("wav")
    } else if data.len() >= 12
        && &data[4..8] == b"ftyp"
        && matches!(&data[8..12], b"M4A " | b"M4B ")
    {
        Some("m4a")
    } else if data.starts_with(b"ID3") {
        Some("mp3")
    } else if data.starts_with(b"fLaC") {
        Some("flac")
    } else if data.starts_with(b"OggS") {
        Some("ogg")
    } else {
        None
    }
}
pub fn audio_mime(kind: &str) -> Option<&'static str> {
    match kind {
        "caf" => Some("audio/x-caf"),
        "wav" => Some("audio/wav"),
        "m4a" => Some("audio/mp4"),
        "mp3" => Some("audio/mpeg"),
        "flac" => Some("audio/flac"),
        "ogg" => Some("audio/ogg"),
        _ => None,
    }
}
#[derive(serde::Serialize)]
pub struct AudioAsset {
    pub id: String,
    pub kind: String,
    pub mime: &'static str,
    pub bytes: usize,
    #[serde(skip)]
    pub(crate) offset: usize,
}

#[derive(Clone, serde::Serialize)]
pub struct PdfBackground {
    pub resource_id: String,
    pub page_index: u64,
    /// `[x, y, width, height]` in page units; background tag 9 when present,
    /// otherwise the whole page. Widened pages keep the PDF at native scale.
    pub rect: [f64; 4],
}
pub(crate) struct PdfAsset {
    pub id: String,
    pub offset: usize,
    pub bytes: usize,
}
#[derive(Clone, serde::Serialize)]
pub struct Recording {
    pub id: String,
    pub name: String,
    pub asset_id: String,
    // Decimal string keeps the original integer exact in every JSON consumer.
    pub start_us: String,
    pub duration: f64,
    pub pages: Vec<usize>,
}
#[derive(Clone, serde::Serialize)]
pub struct InkTiming {
    pub item_id: String,
    pub recording_id: String,
    pub start: f64,
    pub end: f64,
}
impl InkTiming {
    /// Whole-stroke reveal at pen-down. No per-point timestamps are inferred.
    pub fn opacity(&self, time: f64) -> f64 {
        if time < self.start {
            0.2
        } else {
            1.0
        }
    }
}
