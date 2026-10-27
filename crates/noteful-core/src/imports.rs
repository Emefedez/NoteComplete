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
    pub(crate) fn item(&self, id: String) -> crate::scene::Item {
        let [x, y, w, h] = self.bounds;
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
    ) -> Vec<crate::Field> {
        let a = adjustment.cloned().unwrap_or_default();
        let [x, y, w, h] = self.bounds;
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
        image.bytes()?;
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
        self.history[..self.cursor]
            .iter()
            .enumerate()
            .filter_map(move |(i, edit)| match edit {
                Edit::Image { page: p, image } if *p == page => Some((format!("image:{i}"), image)),
                _ => None,
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
