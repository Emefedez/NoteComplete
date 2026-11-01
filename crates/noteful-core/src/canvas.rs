//! Infinite canvas: a note that is one page which grows as you write on it
//! (ResizePage edits), kept as a flag in projects and `.notecomp`/`.notepart`
//! archives. Noteful has no such page, so a canvas is never written as `.noteful`.
use crate::{Editor, Error, Result};

/// Where the canvas grows when the ink comes this close to its right or bottom edge.
pub const GROW_MARGIN: f64 = 300.;
/// How much it grows each time (about half an A4 page).
pub const GROW_STEP: f64 = 800.;
impl Editor {
    pub fn is_canvas(&self) -> bool {
        self.canvas
    }
    /// Marks the note as an infinite canvas (one page that grows).
    pub fn set_canvas(&mut self, on: bool) -> Result<()> {
        if on && self.page_order().len() != 1 {
            return Err(Error::new(0, "A canvas is a note with one page"));
        }
        self.canvas = on;
        Ok(())
    }
    /// The size the canvas should have so that a box `[x, y, w, h]` of new ink
    /// keeps a margin from its right and bottom edges; None when it fits.
    pub fn canvas_growth(&self, bounds: [f64; 4]) -> Result<Option<[f64; 2]>> {
        if !self.canvas {
            return Ok(None);
        }
        let slot = self.slot(0)?;
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
    /// Grows the canvas (one undoable page resize) so that new ink in `bounds`
    /// keeps its margin; true when it grew. Nothing happens for other notes.
    pub fn grow_canvas_for(&mut self, bounds: [f64; 4]) -> Result<bool> {
        let Some(size) = self.canvas_growth(bounds)? else {
            return Ok(false);
        };
        let slot = self.slot(0)?;
        self.resize_page(slot, size, None)?;
        Ok(true)
    }
}
