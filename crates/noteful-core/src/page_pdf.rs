//! Pages drawn by the reader, as JPEG images, bound into one PDF (File → Export
//! pages as PDF). Each page keeps its own size in points.
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, TextStr};
use serde::Deserialize;

/// Where one page's JPEG sits in the packed bytes, and the page's sizes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedPage {
    pub offset: usize,
    pub length: usize,
    pub width_px: u32,
    pub height_px: u32,
    pub width_pt: f32,
    pub height_pt: f32,
}

/// One PDF from JPEG pages packed one after another in `data`, laid out by `layout` (JSON list of PackedPage).
pub fn jpeg_pages_pdf(data: &[u8], layout: &str, title: &str) -> Result<Vec<u8>, String> {
    let pages: Vec<PackedPage> = serde_json::from_str(layout).map_err(|e| format!("Bad page layout: {e}"))?;
    if pages.is_empty() {
        return Err("No pages to export.".into());
    }
    let mut pdf = Pdf::new();
    let (catalog, tree, info) = (Ref::new(1), Ref::new(2), Ref::new(3));
    let mut kids = Vec::with_capacity(pages.len());
    for (i, page) in pages.iter().enumerate() {
        let jpeg = data
            .get(page.offset..page.offset.saturating_add(page.length))
            .ok_or_else(|| format!("Page {} is outside the data.", i + 1))?;
        if !jpeg.starts_with(&[0xFF, 0xD8]) {
            return Err(format!("Page {} is not a JPEG image.", i + 1));
        }
        let sizes_ok = page.width_px > 0 && page.height_px > 0 && [page.width_pt, page.height_pt].iter().all(|v| v.is_finite() && *v > 0.0 && *v < 14_400.0);
        if !sizes_ok {
            return Err(format!("Page {} has no usable size.", i + 1));
        }
        let base = 4 + i as i32 * 3;
        let (page_id, image_id, content_id) = (Ref::new(base), Ref::new(base + 1), Ref::new(base + 2));
        kids.push(page_id);
        let mut p = pdf.page(page_id);
        p.media_box(Rect::new(0.0, 0.0, page.width_pt, page.height_pt));
        p.parent(tree);
        p.contents(content_id);
        p.resources().x_objects().pair(Name(b"Im0"), image_id);
        p.finish();
        let mut image = pdf.image_xobject(image_id, jpeg);
        image.filter(Filter::DctDecode);
        image.width(page.width_px as i32);
        image.height(page.height_px as i32);
        image.color_space().device_rgb();
        image.bits_per_component(8);
        image.finish();
        let mut content = Content::new();
        content.save_state();
        content.transform([page.width_pt, 0.0, 0.0, page.height_pt, 0.0, 0.0]);
        content.x_object(Name(b"Im0"));
        content.restore_state();
        pdf.stream(content_id, &content.finish());
    }
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree).kids(kids.iter().copied()).count(pages.len() as i32);
    pdf.document_info(info).title(TextStr(title)).producer(TextStr("NoteComplete"));
    Ok(pdf.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Smallest valid baseline JPEG header start is enough: the PDF only embeds the bytes.
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9];

    #[test]
    fn binds_pages_with_their_own_sizes() {
        let data = [JPEG, JPEG].concat();
        let layout = format!(
            r#"[{{"offset":0,"length":{n},"widthPx":1800,"heightPx":2546,"widthPt":595.0,"heightPt":842.0}},
               {{"offset":{n},"length":{n},"widthPx":1800,"heightPx":1273,"widthPt":842.0,"heightPt":595.0}}]"#,
            n = JPEG.len()
        );
        let pdf = jpeg_pages_pdf(&data, &layout, "Memoria 1").unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/MediaBox [0 0 595 842]"));
        assert!(text.contains("/MediaBox [0 0 842 595]"));
        assert_eq!(text.matches("/DCTDecode").count(), 2);
        assert!(text.contains("(Memoria 1)"));
    }

    #[test]
    fn refuses_bad_input() {
        let layout = |len: usize| format!(r#"[{{"offset":0,"length":{len},"widthPx":10,"heightPx":10,"widthPt":10.0,"heightPt":10.0}}]"#);
        assert!(jpeg_pages_pdf(JPEG, "[]", "x").unwrap_err().contains("No pages"));
        assert!(jpeg_pages_pdf(JPEG, &layout(JPEG.len() + 5), "x").unwrap_err().contains("outside"));
        assert!(jpeg_pages_pdf(b"\x89PNG....", &layout(8), "x").unwrap_err().contains("not a JPEG"));
        assert!(jpeg_pages_pdf(JPEG, &layout(JPEG.len()).replace("10.0", "0.0"), "x").unwrap_err().contains("no usable size"));
    }
}
