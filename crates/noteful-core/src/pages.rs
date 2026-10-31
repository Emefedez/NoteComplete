//! Inserted pages. Every page has a stable slot: original pages keep 0..n and
//! inserted pages take n.. in history order, so edits addressed to a slot stay
//! on their page when pages are inserted before it. The display order is the
//! applied history replayed over the original order. Hosts convert display
//! positions to slots with `Editor::slot`.
use crate::{
    editor::Edit,
    export::f,
    scene::{color, Page},
    Editor, Error, PdfBackground, Result, WireValue as V,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewPage {
    /// Page size in Noteful page units.
    pub size: [f64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf: Option<PdfPlacement>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PdfPlacement {
    /// An existing PDF resource of the note, or the `id` of the inserted PDF.
    pub resource: String,
    pub page_index: u64,
    /// Where the PDF page sits on the page (background tag 9); the whole page when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rect: Option<[f64; 4]>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewPdf {
    pub id: String,
    pub base64: String,
}

fn finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite() && v.abs() <= 1e6)
}

/// A sort key strictly between `a` and `b` (bytewise), using printable ASCII.
/// `None` when no such key exists in that alphabet.
pub(crate) fn order_between(a: &str, b: Option<&str>) -> Option<String> {
    const LO: u8 = b'!';
    const HI: u8 = b'~';
    let (a, b) = (a.as_bytes(), b.map(str::as_bytes));
    if b.is_some_and(|b| b <= a) {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 0;
    // Shared prefix with the upper bound.
    while let Some(&y) = b.and_then(|b| b.get(i)) {
        let x = a.get(i).copied();
        if x == Some(y) {
            out.push(y);
            i += 1;
            continue;
        }
        let low = x.map_or(LO as u16, |x| x as u16 + 1);
        if (y as u16) > low && low <= HI as u16 {
            out.push(((low + y as u16) / 2).max(low) as u8);
            return String::from_utf8(out).ok();
        }
        // Adjacent characters: keep a's character and only stay above a from here on.
        out.push(x?);
        i += 1;
        break;
    }
    // No upper bound left: extend past a.
    loop {
        match a.get(i).copied() {
            Some(x) if x < HI => {
                out.push((x + 1).max(LO));
                return String::from_utf8(out).ok();
            }
            Some(x) => {
                out.push(x);
                i += 1;
            }
            None => {
                out.push((LO + HI) / 2);
                return String::from_utf8(out).ok();
            }
        }
    }
}

impl Editor {
    fn original_pages(&self) -> usize {
        self.scene.pages.len()
    }
    /// Display order of slots under the applied history.
    pub fn page_order(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.original_pages()).collect();
        let mut next = self.original_pages();
        for edit in &self.history[..self.cursor] {
            if let Edit::InsertPages { at, pages, .. } = edit {
                let at = (*at).min(order.len());
                let slots: Vec<usize> = (next..next + pages.len()).collect();
                order.splice(at..at, slots);
                next += pages.len();
            }
        }
        order
    }
    /// The slot shown at a display position.
    pub fn slot(&self, display: usize) -> Result<usize> {
        self.page_order()
            .get(display)
            .copied()
            .ok_or_else(|| Error::new(0, "Page outside document"))
    }
    pub fn display_index(&self, slot: usize) -> Option<usize> {
        self.page_order().iter().position(|s| *s == slot)
    }
    /// Rebuild inserted pages and PDFs from the whole history (undone entries
    /// included, so redo finds them), after any change to the history.
    pub(crate) fn sync_inserted(&mut self) -> Result<()> {
        let mut pages = Vec::new();
        let mut pdfs = Vec::new();
        let mut slot = self.original_pages();
        for edit in &self.history {
            if let Edit::InsertPages {
                pages: added, pdf, ..
            } = edit
            {
                if let Some(pdf) = pdf {
                    let bytes = STANDARD
                        .decode(&pdf.base64)
                        .map_err(|e| Error::new(0, e.to_string()))?;
                    pdfs.push((pdf.id.clone(), bytes));
                }
                for page in added {
                    pages.push(blank_page(slot, self.source.len(), page));
                    slot += 1;
                }
            }
        }
        self.inserted = pages;
        self.added_pdfs = pdfs;
        Ok(())
    }
    pub(crate) fn has_pdf(&self, id: &str) -> bool {
        self.scene.pdf_assets.iter().any(|a| a.id == id)
            || self.added_pdfs.iter().any(|(key, _)| key == id)
    }
    /// Insert pages before display position `at` (the page count appends).
    pub fn insert_pages(
        &mut self,
        at: usize,
        pages: Vec<NewPage>,
        pdf: Option<NewPdf>,
    ) -> Result<()> {
        if pages.is_empty() || pages.len() > 2000 || at > self.page_order().len() {
            return Err(Error::new(0, "Invalid page insertion"));
        }
        if let Some(pdf) = &pdf {
            let bytes = STANDARD
                .decode(&pdf.base64)
                .map_err(|e| Error::new(0, e.to_string()))?;
            if !bytes.starts_with(b"%PDF-")
                || pdf.id.is_empty()
                || pdf.id.len() > 64
                || !pdf
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || self.has_pdf(&pdf.id)
            {
                return Err(Error::new(0, "Invalid inserted PDF"));
            }
        }
        for page in &pages {
            if !finite(&page.size) || page.size.iter().any(|v| *v < 10.) {
                return Err(Error::new(0, "Invalid page size"));
            }
            if let Some(p) = &page.pdf {
                let known =
                    self.has_pdf(&p.resource) || pdf.as_ref().is_some_and(|n| n.id == p.resource);
                let rect_ok = p.rect.is_none_or(|r| finite(&r) && r[2] > 0. && r[3] > 0.);
                if !known || !rect_ok || p.page_index > 100_000 {
                    return Err(Error::new(0, "Invalid PDF placement"));
                }
            }
        }
        self.commit(Edit::InsertPages { at, pages, pdf })
    }
    /// A slot's size and PDF placement after the applied resizes.
    pub(crate) fn page_geometry(&self, slot: usize) -> Result<([f64; 2], Option<PdfBackground>)> {
        let p = self.page(slot)?;
        let (mut size, mut background) = (p.size, p.pdf_background.clone());
        for edit in &self.history[..self.cursor] {
            if let Edit::ResizePage {
                page,
                size: s,
                pdf_rect,
            } = edit
            {
                if *page == slot {
                    size = *s;
                    if let (Some(b), Some(r)) = (background.as_mut(), pdf_rect) {
                        b.rect = *r;
                    }
                }
            }
        }
        Ok((size, background))
    }
    /// Resize one page (a slot), as one undoable edit.
    pub fn resize_page(
        &mut self,
        slot: usize,
        size: [f64; 2],
        pdf_rect: Option<[f64; 4]>,
    ) -> Result<()> {
        let (current, background) = self.page_geometry(slot)?;
        if !finite(&size)
            || size.iter().any(|v| *v < 10.)
            || pdf_rect
                .is_some_and(|r| !finite(&r) || r[2] <= 0. || r[3] <= 0. || background.is_none())
        {
            return Err(Error::new(0, "Invalid page size"));
        }
        if size == current && pdf_rect.is_none_or(|r| background.is_some_and(|b| b.rect == r)) {
            return Ok(());
        }
        self.commit(Edit::ResizePage {
            page: slot,
            size,
            pdf_rect,
        })
    }
    pub(crate) fn added_pdf(&self, id: &str) -> Option<&[u8]> {
        self.added_pdfs
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, bytes)| bytes.as_slice())
    }
    /// Native background record for an inserted page (see the spec's background table).
    pub(crate) fn inserted_background(page: &NewPage) -> Vec<crate::Field> {
        match &page.pdf {
            Some(p) => {
                let mut bg = vec![
                    f(0, 0x11, V::UInt(1)),
                    f(1, 0x21, V::Pair(page.size)),
                    f(2, 1, V::UInt(0)),
                    f(3, 2, V::UInt(p.page_index)),
                    f(4, 5, V::Text(p.resource.clone())),
                    f(5, 2, V::UInt(0)),
                ];
                if let Some(r) = p.rect {
                    bg.push(f(9, 0x23, V::Rect(r)));
                }
                bg
            }
            None => vec![
                f(0, 1, V::UInt(0)),
                f(1, 0x21, V::Pair(page.size)),
                f(6, 5, V::Text("{\"pc\":16777215}".into())),
            ],
        }
    }
    /// The NewPage behind an inserted slot.
    pub(crate) fn inserted_spec(&self, slot: usize) -> Option<&NewPage> {
        let mut next = self.original_pages();
        for edit in &self.history {
            if let Edit::InsertPages { pages, .. } = edit {
                if slot < next + pages.len() {
                    return pages.get(slot - next);
                }
                next += pages.len();
            }
        }
        None
    }
}

/// Page IDs are derived from the slot and source so projects reopen with the same IDs.
pub(crate) fn inserted_page_id(slot: usize, source_len: usize) -> String {
    format!("{:016X}{:016X}", source_len as u64, slot as u64 | 1 << 62)
}

fn blank_page(slot: usize, source_len: usize, page: &NewPage) -> Page {
    let [w, h] = page.size;
    let pdf_background = page.pdf.as_ref().map(|p| PdfBackground {
        resource_id: p.resource.clone(),
        page_index: p.page_index,
        rect: p.rect.unwrap_or([0., 0., w, h]),
    });
    Page {
        id: inserted_page_id(slot, source_len),
        size: page.size,
        warnings: Vec::new(),
        pdf_background,
        timings: Vec::new(),
        background: format!(
            "<g data-background=\"true\"><rect width=\"100%\" height=\"100%\" fill=\"{}\"/></g>",
            color(&[1., 1., 1., 1.])
        ),
        editable_id: String::new(),
        items: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::order_between;
    #[test]
    fn order_keys_fall_strictly_between_neighbours() {
        let cases = [
            ("", Some("+FP1Upg")),
            ("+FP1Upg", Some("+FP1Uph")),
            ("+FP1Upg", None),
            ("00000000000000000001", Some("00000000000000000002")),
            ("a", Some("b")),
            ("a~", Some("b")),
            ("ab", Some("abc")),
            ("~~", None),
        ];
        for (a, b) in cases {
            let k = order_between(a, b).unwrap();
            assert!(k.as_str() > a, "{k} > {a}");
            if let Some(b) = b {
                assert!(k.as_str() < b, "{k} < {b}");
            }
            assert!(k.bytes().all(|c| (b'!'..=b'~').contains(&c)));
        }
        assert_eq!(order_between("b", Some("a")), None);
        assert_eq!(order_between("ab", Some("ab!")), None);
    }
}
