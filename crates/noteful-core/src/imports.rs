//! Imported PDF pages and images use the same archive, renderer and edit history.
use crate::{
    editor::Edit,
    export::{collection, f},
    Editor, Error, Result, WireValue as V,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    pub base64: String,
    pub mime: String,
    pub bounds: [f64; 4],
    pub layer: u32,
    /// A typed text box instead of a picture (base64 and mime stay empty). It is
    /// drawn, moved, locked and exported like an added image, as a native
    /// kind-2 text object.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextBox>,
    /// Undone and redone with the edit before it (the labels of an inserted graph go with
    /// its lines). Not part of the item.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub joined: bool,
    /// One part of a graph or table (part.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<crate::Part>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TextBox {
    pub text: String,
    pub font_size: f64,
    pub rgba: [f64; 4],
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// Font family, as Noteful names it ("Helvetica", "Times New Roman", …).
    #[serde(default = "default_font")]
    pub font: String,
    /// 0 left, 1 centre, 2 right.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub align: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strikethrough: bool,
    /// LaTeX (docs/SHAPES-TABLES-MATH.md, M1): `$…$` and `$$…$$` parts among words, or the
    /// whole text one formula when it has no `$`. Readers typeset it (KaTeX); the native
    /// text box keeps the source, since Noteful has no math.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub math: bool,
    /// Distance from one baseline to the next, in page units: native key 11 (line height,
    /// pool 10). Text taken from a PDF keeps its own spacing; the usual one when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Parts of the text in their own style (a bold word in a paragraph), in order, covering
    /// the whole text by characters. Each says only what differs from the box. Written as
    /// one native run each; empty, the box is one run as before.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<Span>,
}
/// A part of a text box's text with its own style: `len` characters (Unicode scalar values),
/// and what differs from the box.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Span {
    pub len: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgba: Option<[f64; 4]>,
}
fn font_ok(font: &str) -> bool {
    !font.is_empty()
        && font.len() <= 64
        && font
            .chars()
            .all(|c| c.is_alphanumeric() || " -_.".contains(c))
}
fn rgba_ok(rgba: &[f64; 4]) -> bool {
    rgba.iter().all(|n| n.is_finite() && (0.0..=1.).contains(n))
}
/// One run of a text box as written: its text, font, bold, italic and colour.
struct Part<'a> {
    text: String,
    font: &'a str,
    bold: bool,
    italic: bool,
    rgba: [f64; 4],
}
fn default_font() -> String {
    "Helvetica".into()
}
fn is_zero(n: &u64) -> bool {
    *n == 0
}
impl TextBox {
    fn valid(&self) -> bool {
        !self.text.trim().is_empty()
            && font_ok(&self.font)
            && self.text.len() <= 20_000
            && (self.spans.is_empty()
                || self.spans.len() <= 4_000
                    && self.spans.iter().all(|s| {
                        s.len > 0
                            && s.font.as_deref().is_none_or(font_ok)
                            && s.rgba.as_ref().is_none_or(rgba_ok)
                    })
                    && self.spans.iter().map(|s| s.len).sum::<usize>() == self.text.chars().count())
            && self.align <= 2
            && self.font_size.is_finite()
            && (2.0..=400.).contains(&self.font_size)
            && self.line_height.is_none_or(|h| {
                h.is_finite() && h >= self.font_size * 0.5 && h <= self.font_size * 6.
            })
            && rgba_ok(&self.rgba)
    }
    /// The runs to write: the whole text in the box's style, or one per span.
    fn parts(&self) -> Vec<Part<'_>> {
        let base = |text: String| Part {
            text,
            font: &self.font,
            bold: self.bold,
            italic: self.italic,
            rgba: self.rgba,
        };
        if self.spans.is_empty() {
            return vec![base(self.text.clone())];
        }
        let mut chars = self.text.chars();
        self.spans
            .iter()
            .map(|s| Part {
                text: chars.by_ref().take(s.len).collect(),
                font: s.font.as_deref().unwrap_or(&self.font),
                bold: s.bold.unwrap_or(self.bold),
                italic: s.italic.unwrap_or(self.italic),
                rgba: s.rgba.unwrap_or(self.rgba),
            })
            .collect()
    }
    /// Noteful's attributed text (object payload tag 4) for one styled run.
    /// Layout follows texto.noteful: the run, then a zero-width space that
    /// carries the typing attributes; keys 13 family, 10 size, 6 color, 2 bold,
    /// 3 italic, 9 paragraph, with their values in pools 5, 10, 7, 6 and 9.
    /// Underline, strikethrough and alignment (keys 4, 5, 8; pool 8) are added
    /// only when set, so plain boxes keep the confirmed layout.
    fn rich_text(&self, clock: u64) -> Vec<crate::Field> {
        let floats = |v: &[f64]| V::Array(v.iter().map(|n| V::Float(*n)).collect());
        // Each run's keys; with spans, every run repeats them, so its values come next in
        // each pool. One run gives the confirmed layout exactly.
        let mut run_keys = vec![13, 10, 6, 2, 3];
        let mut decoration = vec![];
        for (key, value) in [
            (4, u64::from(self.underline)),
            (5, u64::from(self.strikethrough)),
            (8, self.align),
        ] {
            if value != 0 {
                run_keys.push(key);
                decoration.push(V::UInt(value));
            }
        }
        if self.line_height.is_some() {
            run_keys.push(11);
        }
        run_keys.push(9);
        let parts = self.parts();
        let (mut strings, mut counts, mut keys) = (vec![], vec![], vec![]);
        let (mut fonts, mut flags, mut colors, mut decorations, mut paragraphs, mut numbers) =
            (vec![], vec![], vec![], vec![], vec![], vec![]);
        for part in &parts {
            strings.push(V::Text(part.text.clone()));
            counts.push(V::UInt(run_keys.len() as u64));
            keys.extend(run_keys.iter().map(|k| V::UInt(*k)));
            fonts.push(V::Text(part.font.to_owned()));
            flags.extend([
                V::UInt(u64::from(part.bold)),
                V::UInt(u64::from(part.italic)),
            ]);
            colors.push(V::Fields(vec![f(0, 0x420, floats(&part.rgba))]));
            decorations.extend(decoration.iter().cloned());
            paragraphs.push(V::Fields(vec![f(1, 0x407, V::Array(vec![]))]));
            numbers.push(self.font_size);
            if let Some(h) = self.line_height {
                numbers.push(h);
            }
        }
        // The zero-width space after the text, with the typing size (key 10).
        strings.push(V::Text("\u{200b}".into()));
        counts.push(V::UInt(1));
        keys.push(V::UInt(10));
        numbers.push(self.font_size);
        vec![
            f(1, 2, V::UInt(clock)),
            f(2, 0x405, V::Array(strings)),
            f(3, 0x402, V::Array(counts)),
            f(4, 0x414, V::Array(keys)),
            f(5, 0x405, V::Array(fonts)),
            f(6, 0x401, V::Array(flags)),
            f(7, 0x407, V::Array(colors)),
            f(8, 0x402, V::Array(decorations)),
            f(9, 0x407, V::Array(paragraphs)),
            f(10, 0x420, floats(&numbers)),
        ]
    }
}
impl Image {
    pub(crate) fn bytes(&self) -> Result<Vec<u8>> {
        let bytes = STANDARD
            .decode(&self.base64)
            .map_err(|e| Error::new(0, e.to_string()))?;
        let valid = match self.mime.as_str() {
            "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
            _ => false,
        };
        if !valid {
            return Err(Error::new(0, "Unsupported image data; use PNG or JPEG"));
        }
        Ok(bytes)
    }
    /// The text box as the scene's JSON form of a native text object.
    fn text_json(&self, text: &TextBox) -> serde_json::Value {
        let [x, y, w, h] = self.bounds;
        let rich: Vec<_> = text.rich_text(0);
        json!({"2":{"1":[x+w/2.,y+h/2.,w,h,0.]},"4":self.layer,"6":{"1":2,"2":[w,h],"4":crate::scene::fields_json(&rich)}})
    }
    pub(crate) fn item(&self, id: String) -> crate::scene::Item {
        let [x, y, w, h] = self.bounds;
        if let Some(text) = &self.text {
            let object = self.text_json(text);
            if let Ok(mut item) = crate::scene::object(&object, None, 0) {
                item.id = id;
                item.layer = self.layer;
                return item;
            }
        }
        crate::scene::Item {
            id: id.clone(), stroke: None,
            object: Some(json!({"1":id,"2":{"1":[x+w/2.,y+h/2.,w,h,0.]},"4":self.layer,"6":{"1":1,"2":[w,h]}})),
            bounds:self.bounds, hit:vec![], radius:0., z:0, layer:self.layer, text:None,
            svg:format!("<image x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" preserveAspectRatio=\"none\" href=\"data:{};base64,{}\"/>",self.mime,self.base64),
        }
    }
    pub(crate) fn native_object(
        &self,
        id: &str,
        resource: &str,
        z: u64,
        adjustment: Option<&crate::Adjustment>,
        time: u64,
    ) -> Vec<crate::Field> {
        let a = adjustment.cloned().unwrap_or_default();
        let [x, y, w, h] = self.bounds;
        if let Some(text) = &self.text {
            // Field layout and types of a native text box (samples/texto.noteful).
            let clocked = |tag, ty, value| {
                let mut field = f(tag, ty, value);
                field.clock = Some(time);
                field
            };
            let rect = [
                x + w / 2. + a.translation[0],
                y + h / 2. + a.translation[1],
                w * a.scale[0],
                h * a.scale[1],
                a.rotation.to_radians(),
            ];
            return vec![
                f(1, 5, V::Text(id.into())),
                clocked(
                    2,
                    0x807,
                    V::Fields(vec![f(
                        1,
                        0x420,
                        V::Array(rect.into_iter().map(V::Float).collect()),
                    )]),
                ),
                clocked(4, 0x812, V::UInt(self.layer as u64)),
                clocked(5, 0x802, V::UInt(z)),
                f(
                    6,
                    7,
                    V::Fields(vec![
                        f(22, 2, V::UInt(288)),
                        f(1, 2, V::UInt(2)),
                        clocked(2, 0x821, V::Pair([w, h])),
                        f(4, 7, V::Fields(text.rich_text(time))),
                        clocked(9, 0x807, V::Fields(vec![f(0, 2, V::UInt(0))])),
                        clocked(19, 0x807, V::Fields(vec![f(0, 2, V::UInt(1))])),
                        clocked(20, 0x820, V::Float(0.)),
                        clocked(21, 0x820, V::Float(0.)),
                    ]),
                ),
                clocked(7, 0x805, V::Text(String::new())),
                clocked(8, 0x820, V::Float(1.)),
                clocked(9, 0x811, V::UInt(0)),
                f(10, 2, V::UInt(time)),
            ];
        }
        vec![
            f(1, 5, V::Text(id.into())),
            f(
                2,
                7,
                V::Fields(vec![f(
                    1,
                    0x404,
                    V::Array(
                        [
                            x + w / 2. + a.translation[0],
                            y + h / 2. + a.translation[1],
                            w * a.scale[0],
                            h * a.scale[1],
                            a.rotation.to_radians(),
                        ]
                        .into_iter()
                        .map(V::Float)
                        .collect(),
                    ),
                )]),
            ),
            f(4, 0x12, V::UInt(self.layer as u64)),
            f(5, 2, V::UInt(z)),
            f(
                6,
                7,
                V::Fields(
                    vec![
                        f(1, 1, V::UInt(1)),
                        f(2, 0x21, V::Pair([w, h])),
                        f(10, 5, V::Text(resource.into())),
                    ]
                    .into_iter()
                    .chain(a.locked.filter(|l| *l).map(|_| f(21, 0x801, V::UInt(1))))
                    .chain(a.crop.map(|c| f(12, 7, crate::export::crop_outline(c))))
                    .collect(),
                ),
            ),
            f(8, 4, V::Float(1.)),
            f(9, 1, V::UInt(0)),
        ]
    }
}
impl Editor {
    pub fn add_image(&mut self, page: usize, image: Image) -> Result<()> {
        self.page(page)?;
        if image.part.as_ref().is_some_and(|p| !p.valid()) {
            return Err(Error::new(0, "Invalid graph, table or prefab part"));
        }
        match &image.text {
            Some(text) if text.valid() && image.base64.is_empty() && image.mime.is_empty() => {}
            Some(_) => return Err(Error::new(0, "Invalid text box")),
            None => {
                image.bytes()?;
            }
        }
        if image.bounds.iter().any(|v| !v.is_finite() || v.abs() > 1e6)
            || image.bounds[2] <= 0.
            || image.bounds[3] <= 0.
            || !self
                .layers()
                .iter()
                .any(|l| l.id == image.layer && l.visible && !l.locked)
        {
            return Err(Error::new(0, "Invalid image geometry or locked layer"));
        }
        self.commit(Edit::Image { page, image })
    }
    pub(crate) fn images(&self, page: usize) -> impl Iterator<Item = (String, &Image)> {
        // Later Retext edits replace a text box's content and size.
        let mut edited = std::collections::HashMap::new();
        for edit in &self.history[..self.cursor] {
            if let Edit::Retext { page: p, id, image } = edit {
                if *p == page {
                    edited.insert(id.as_str(), image);
                }
            }
        }
        self.history[..self.cursor]
            .iter()
            .enumerate()
            .filter_map(move |(i, edit)| match edit {
                Edit::Image { page: p, image } if *p == page => {
                    let id = format!("image:{i}");
                    let image = edited.get(id.as_str()).copied().unwrap_or(image);
                    Some((id, image))
                }
                _ => None,
            })
    }
    /// Change a text box's text, size or style (one undo step). Its position
    /// stays; the box grows or shrinks from its top-left corner.
    pub fn edit_text(
        &mut self,
        page: usize,
        id: &str,
        text: TextBox,
        size: [f64; 2],
    ) -> Result<()> {
        self.editable_layer(page, id)?;
        let mut image = self
            .images(page)
            .find(|(key, _)| key == id)
            .map(|(_, image)| image.clone())
            .filter(|image| image.text.is_some())
            .ok_or_else(|| Error::new(0, "Not a text box"))?;
        if !text.valid() || size.iter().any(|v| !v.is_finite() || *v <= 0. || *v > 1e6) {
            return Err(Error::new(0, "Invalid text box"));
        }
        if image.text.as_ref() == Some(&text) && [image.bounds[2], image.bounds[3]] == size {
            return Ok(());
        }
        image.text = Some(text);
        image.bounds[2] = size[0];
        image.bounds[3] = size[1];
        self.commit(Edit::Retext {
            page,
            id: id.to_owned(),
            image,
        })
    }
    /// A blank document, or a PDF whose dimensions were read by the host PDF parser.
    pub fn create_document(title: &str, sizes: &[[f64; 2]], pdf: &[u8]) -> Result<Self> {
        let pages: Vec<([f64; 2], Option<u64>)> = sizes
            .iter()
            .enumerate()
            .map(|(i, s)| (*s, (!pdf.is_empty()).then_some(i as u64)))
            .collect();
        Self::create_document_with(
            title,
            &pages,
            pdf,
            "imported-pdf",
            crate::native::NATIVE_VERSION,
        )
    }
    /// A new document whose pages each show a page of `pdf` (by index) or
    /// blank white pages generated as PDFs when `None`. `version` is the
    /// package format written in the index (tag 1).
    pub fn create_document_with(
        title: &str,
        pages: &[([f64; 2], Option<u64>)],
        pdf: &[u8],
        pdf_id: &str,
        version: f64,
    ) -> Result<Self> {
        let sizes: Vec<[f64; 2]> = pages.iter().map(|p| p.0).collect();
        let sizes = &sizes[..];
        if sizes.is_empty()
            || sizes.len() > 2000
            || title.len() > 512
            || !(1.0..=9.).contains(&version)
            || pdf_id.is_empty()
            || !pdf_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || pages.iter().any(|p| p.1.is_some()) && pdf.is_empty()
            || sizes
                .iter()
                .flatten()
                .any(|v| !v.is_finite() || *v <= 0. || *v > 1e6)
        {
            return Err(Error::new(0, "Invalid document page sizes"));
        }
        if !pdf.is_empty() && !pdf.starts_with(b"%PDF-") {
            return Err(Error::new(0, "Invalid PDF header"));
        }
        let clock = crate::native::APPLE_CLOCK_US;
        let mut note_seed = Vec::from(title.as_bytes());
        note_seed.extend_from_slice(&(pages.len() as u64).to_be_bytes());
        for s in sizes {
            note_seed.extend_from_slice(&s[0].to_be_bytes());
            note_seed.extend_from_slice(&s[1].to_be_bytes());
        }
        note_seed.extend_from_slice(&(pdf.len() as u64).to_be_bytes());
        let note_id = crate::native::deterministic_uuid(&note_seed);
        let cover_id = crate::native::deterministic_uuid(format!("cover:{note_id}").as_bytes());

        // Deduplicate blank page sizes into one generated white PDF when any page has pdf_page == None.
        let mut blank_sizes: Vec<[f64; 2]> = Vec::new();
        for (size, pdf_page) in pages {
            if pdf_page.is_none() && !blank_sizes.contains(size) {
                blank_sizes.push(*size);
            }
        }
        let blank_pdf =
            (!blank_sizes.is_empty()).then(|| crate::ink::paper::blank_pdf(&blank_sizes));
        let blank_pdf_id = if pdf_id == "blank-paper" {
            "blank-paper-0"
        } else {
            "blank-paper"
        };

        let mut records = collection(5);
        let mut page_records: Vec<V> = Vec::with_capacity(pages.len());
        let mut page_ids: Vec<V> = Vec::with_capacity(pages.len());
        for (i, (size, pdf_page)) in pages.iter().enumerate() {
            let (bg_res, bg_index) = match pdf_page {
                Some(index) => (pdf_id, *index),
                None => {
                    let b_idx = blank_sizes.iter().position(|s| s == size).unwrap_or(0) as u64;
                    (blank_pdf_id, b_idx)
                }
            };
            let background = crate::native::pdf_background_fields(*size, bg_res, bg_index, None);
            let page_id =
                crate::native::deterministic_uuid(format!("page:{note_id}:{i}").as_bytes());
            let link_uuid =
                crate::native::deterministic_uuid(format!("page-link:{note_id}:{i}").as_bytes());
            page_ids.push(V::Text(page_id.clone()));
            page_records.push(V::Fields(crate::native::page_record_fields(
                page_id,
                String::new(),
                background,
                format!("{i:020}"),
                link_uuid,
                clock,
            )));
        }
        for field in &mut records {
            field.value = match field.tag {
                0 => V::Array(page_records.clone()),
                1 => V::Array(page_ids.clone()),
                2 => V::Array(vec![V::UInt(clock); sizes.len()]),
                _ => V::Array(vec![V::UInt(1); sizes.len()]),
            };
        }
        let doc_uuid6 = crate::native::deterministic_uuid(format!("doc6:{note_id}").as_bytes());
        let drawing_bytes = crate::encode_fields(&crate::native::build_drawing_metadata(
            &note_id,
            records,
            crate::native::default_layers_collection(clock),
            &doc_uuid6,
            clock,
        ))?;

        let mut resource_ids = vec![cover_id.clone()];
        let mut tail_blocks: Vec<(String, Vec<u8>)> = vec![(format!("d:{note_id}"), drawing_bytes)];
        if !pdf.is_empty() {
            resource_ids.push(pdf_id.into());
            tail_blocks.push((pdf_id.into(), pdf.to_vec()));
        }
        if let Some(bpdf) = blank_pdf {
            resource_ids.push(blank_pdf_id.into());
            tail_blocks.push((blank_pdf_id.into(), bpdf));
        }

        let content_size: u64 = tail_blocks.iter().map(|(_, b)| b.len() as u64).sum();
        let note_bytes = crate::encode_fields(&crate::native::build_note_metadata(
            &note_id,
            title,
            &cover_id,
            crate::native::APPLE_EPOCH_SECS,
            clock,
            content_size,
        ))?;

        let mut blocks = Vec::with_capacity(2 + tail_blocks.len());
        blocks.push((format!("n:{note_id}"), note_bytes));
        blocks.push((cover_id, crate::native::BLANK_COVER_JPEG.to_vec()));
        blocks.extend(tail_blocks);

        let mut out = crate::MAGIC.to_vec();
        let mut keys = vec![];
        let mut offsets = vec![];
        let mut lengths = vec![];
        for (id, bytes) in blocks {
            keys.push(V::Text(id));
            offsets.push(V::UInt(out.len() as u64));
            lengths.push(V::UInt(bytes.len() as u64));
            out.extend(bytes);
        }
        let index = crate::encode_fields(&crate::native::build_index_fields(
            version,
            &note_id,
            resource_ids,
            vec![],
            keys,
            offsets,
            lengths,
        ))?;
        let at = out.len();
        let length = u32::try_from(index.len()).map_err(|_| Error::new(0, "Index too large"))?;
        out.extend(index);
        out.extend(crate::MAGIC);
        out.extend((at as u64).to_be_bytes());
        out.extend(length.to_be_bytes());
        Self::open(&out)
    }
}
