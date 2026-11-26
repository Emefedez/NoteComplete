//! Infinite canvas: a note whose pages each grow as you write on them (ResizePage
//! edits), so a note can hold several canvases you turn like pages (an Rnote note is
//! one). Kept as a flag in projects and `.notecomp`/`.notepart` archives. Noteful has no
//! such page, so a canvas is never written as `.noteful`.
use crate::{Editor, Error, Result};

/// Where the canvas grows when the ink comes this close to its right or bottom edge.
pub const GROW_MARGIN: f64 = 300.;
/// How much it grows each time (about half an A4 page).
pub const GROW_STEP: f64 = 800.;
impl Editor {
    pub fn is_canvas(&self) -> bool {
        self.canvas
    }
    /// Marks the note as infinite canvases (each page grows as you write on it).
    pub fn set_canvas(&mut self, on: bool) -> Result<()> {
        if on && self.page_order().is_empty() {
            return Err(Error::new(0, "A canvas needs a page"));
        }
        self.canvas = on;
        Ok(())
    }
    /// The size the canvas page in `slot` should have so that a box `[x, y, w, h]` of new
    /// ink keeps a margin from its right and bottom edges; None when it fits.
    pub fn canvas_growth(&self, slot: usize, bounds: [f64; 4]) -> Result<Option<[f64; 2]>> {
        if !self.canvas {
            return Ok(None);
        }
        let size = self.page_geometry(slot)?.0;
        let need = |edge: f64, size: f64| {
            if edge + GROW_MARGIN <= size {
                size
            } else {
                size + ((edge + GROW_MARGIN - size) / GROW_STEP).ceil() * GROW_STEP
            }
        };
        let next = [
            need(bounds[0] + bounds[2], size[0]),
            need(bounds[1] + bounds[3], size[1]),
        ];
        Ok((next != size).then_some(next))
    }
    /// Grows the canvas page in `slot` (one undoable page resize) so that new ink in
    /// `bounds` keeps its margin; true when it grew. Nothing happens for other notes.
    pub fn grow_canvas_for(&mut self, slot: usize, bounds: [f64; 4]) -> Result<bool> {
        let Some(size) = self.canvas_growth(slot, bounds)? else {
            return Ok(false);
        };
        self.resize_page(slot, size, None)?;
        Ok(true)
    }
}
