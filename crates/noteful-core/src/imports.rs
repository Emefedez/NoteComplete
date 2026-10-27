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
}
fn default_font() -> String {
    "Helvetica".into()
}
impl TextBox {
    fn valid(&self) -> bool {
        !self.text.trim().is_empty()
            && !self.font.is_empty()
            && self.font.len() <= 64
            && self
                .font
                .chars()
                .all(|c| c.is_alphanumeric() || " -_.".contains(c))
            && self.text.len() <= 20_000
            && self.font_size.is_finite()
            && (2.0..=400.).contains(&self.font_size)
            && self
                .rgba
                .iter()
                .all(|n| n.is_finite() && (0.0..=1.).contains(n))
    }
    /// Noteful's attributed text (object payload tag 4) for one styled run.
    /// Layout follows texto.noteful: the run, then a zero-width space that
    /// carries the typing attributes; keys 13 family, 10 size, 6 color, 2 bold,
    /// 3 italic, 9 paragraph, with their values in pools 5, 10, 7, 6 and 9.
    fn rich_text(&self, clock: u64) -> Vec<crate::Field> {
        let floats = |v: &[f64]| V::Array(v.iter().map(|n| V::Float(*n)).collect());
        vec![
            f(1, 2, V::UInt(clock)),
            f(
                2,
                0x405,
                V::Array(vec![V::Text(self.text.clone()), V::Text("\u{200b}".into())]),
            ),
            f(3, 0x402, V::Array(vec![V::UInt(6), V::UInt(1)])),
            f(
                4,
                0x414,
                V::Array([13, 10, 6, 2, 3, 9, 10].map(V::UInt).to_vec()),
            ),
            f(5, 0x405, V::Array(vec![V::Text(self.font.clone())])),
            f(
                6,
                0x401,
                V::Array(vec![
                    V::UInt(u64::from(self.bold)),
                    V::UInt(u64::from(self.italic)),
                ]),
            ),
            f(
                7,
                0x407,
                V::Array(vec![V::Fields(vec![f(0, 0x420, floats(&self.rgba))])]),
            ),
            f(8, 0x402, V::Array(vec![])),
            f(
                9,
                0x407,
                V::Array(vec![V::Fields(vec![f(1, 0x407, V::Array(vec![]))])]),
            ),
            f(10, 0x420, floats(&[self.font_size, self.font_size])),
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
            id, stroke: None,
            object: Some(json!({"2":{"1":[x+w/2.,y+h/2.,w,h,0.]},"4":self.layer,"6":{"1":1,"2":[w,h]}})),
            bounds:self.bounds, hit:vec![], radius:0., z:0, layer:self.layer, text:None,
            svg:format!("<image x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" href=\"data:{};base64,{}\"/>",self.mime,self.base64),
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
        if sizes.is_empty()
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
        let mut records = collection(5);
        let mut pages = vec![];
        for (i, size) in sizes.iter().enumerate() {
            let mut background = vec![
                f(0, 1, V::UInt(u64::from(!pdf.is_empty()))),
                f(1, 0x21, V::Pair(*size)),
            ];
            if pdf.is_empty() {
                background.push(f(6, 5, V::Text("{\"pc\":16777215}".into())));
            } else {
                background.extend([
                    f(3, 2, V::UInt(i as u64)),
                    f(4, 5, V::Text("imported-pdf".into())),
                ]);
            }
            pages.push(V::Fields(vec![
                f(1, 5, V::Text(format!("page-{i}"))),
                f(2, 7, V::Fields(vec![f(0, 5, V::Text(String::new()))])),
                f(4, 7, V::Fields(background)),
                f(5, 5, V::Text(format!("{i:020}"))),
            ]));
        }
        for field in &mut records {
            field.value = match field.tag {
                0 => V::Array(pages.clone()),
                1 => V::Array(
                    (0..sizes.len())
                        .map(|i| V::Text(format!("page-{i}")))
                        .collect(),
                ),
                2 => V::Array(vec![V::UInt(0); sizes.len()]),
                _ => V::Array(vec![V::UInt(1); sizes.len()]),
            };
        }
        let mut blocks = vec![
            (
                "n:imported".to_owned(),
                crate::encode_fields(&[f(3, 5, V::Text(title.into()))])?,
            ),
            (
                "d:imported".to_owned(),
                crate::encode_fields(&[
                    f(2, 7, V::Fields(records)),
                    f(3, 7, V::Fields(collection(0x12))),
                ])?,
            ),
        ];
        if !pdf.is_empty() {
            blocks.push(("imported-pdf".into(), pdf.to_vec()));
        }
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
        let index = crate::encode_fields(&[
            f(1, 3, V::Float(1.)),
            f(
                3,
                0x405,
                V::Array(if pdf.is_empty() {
                    vec![]
                } else {
                    vec![V::Text("imported-pdf".into())]
                }),
            ),
            f(4, 0x405, V::Array(vec![])),
            f(10, 0x405, V::Array(keys)),
            f(11, 0x402, V::Array(offsets)),
            f(12, 0x402, V::Array(lengths)),
        ])?;
        let at = out.len();
        let length = u32::try_from(index.len()).map_err(|_| Error::new(0, "Index too large"))?;
        out.extend(index);
        out.extend(crate::MAGIC);
        out.extend((at as u64).to_be_bytes());
        out.extend(length.to_be_bytes());
        Self::open(&out)
    }
}
