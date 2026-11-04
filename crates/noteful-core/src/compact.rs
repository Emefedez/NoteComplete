//! Compacting a project's edit history, so a note edited for a long time does not grow
//! without end. The edits up to a point (an automatic save, or the present) are kept only
//! as far as they shape the note now:
//! - strokes, pictures and text boxes added and later erased go, with every edit of theirs;
//! - of the moves and restyles of one item, only the last of a run that does not lock or
//!   unlock it stays (each is the whole adjustment, not a step); likewise the last
//!   reshaping of a shape and the last text of a text box;
//! - compacting to the present also drops what was undone (the redo steps).
//!
//! Undo then stops at that point (`floor`). Later edits stay as they were. Added items are
//! named by the position of the edit that added them (`new:12`, `image:7`), so every
//! reference is renumbered. The result is opened again from its project and every page
//! compared with the note before; if anything differs, nothing changes.
use crate::editor::{Edit, Editor};
use crate::{Error, Result};
use std::collections::{HashMap, HashSet};

/// What compacting did: edits before and after, and the project's size before and after.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Compacted {
    pub edits_before: usize,
    pub edits_after: usize,
    pub bytes_before: usize,
    pub bytes_after: usize,
}

/// The index of an added item's id (`new:12` → 12), for ids the history names by position.
fn added_index(id: &str) -> Option<usize> {
    id.strip_prefix("new:")
        .or_else(|| id.strip_prefix("image:"))?
        .parse()
        .ok()
}
fn renamed(id: &str, map: &HashMap<usize, usize>) -> Result<String> {
    match added_index(id) {
        None => Ok(id.to_owned()),
        Some(i) => {
            let to = map
                .get(&i)
                .ok_or_else(|| Error::new(0, "Compacting lost an item another edit names"))?;
            Ok(format!(
                "{}{to}",
                if id.starts_with("new:") {
                    "new:"
                } else {
                    "image:"
                }
            ))
        }
    }
}
/// A page's drawing without item names (they are renumbered), for comparing pages.
fn unnamed(svg: &str) -> String {
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg;
    while let Some(at) = rest.find(" data-item=\"") {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 12..];
        rest = tail.find('"').map_or("", |end| &tail[end + 1..]);
    }
    out.push_str(rest);
    out
}

/// A list of items without their ids (renumbered), for comparing.
fn without_ids(list: &serde_json::Value) -> serde_json::Value {
    let mut list = list.clone();
    if let Some(items) = list.as_array_mut() {
        for item in items {
            if let Some(o) = item.as_object_mut() {
                o.remove("id");
            }
        }
    }
    list
}

impl Editor {
    /// Where the history is now: the edits applied, and a digest of them. An automatic
    /// save keeps both, so it can later be offered as a point to compact the history to.
    pub fn history_mark(&self) -> Result<(usize, String)> {
        Ok((self.cursor, self.prefix_digest(self.cursor)?))
    }
    /// A digest of the first `edits` edits.
    pub fn prefix_digest(&self, edits: usize) -> Result<String> {
        let prefix = self
            .history
            .get(..edits)
            .ok_or_else(|| Error::new(0, "Past the history"))?;
        let bytes = serde_json::to_vec(prefix).map_err(|e| Error::new(0, e.to_string()))?;
        Ok(crate::md5_hex(&bytes))
    }
    /// The first edit that can still be undone.
    pub fn history_floor(&self) -> usize {
        self.floor
    }

    /// Compacts the edits before `upto` (at most the edits applied now; the present when
    /// it is the cursor), after which undo stops there. Fails, leaving the note as it was,
    /// when the result would not draw every page the same.
    pub fn compact_history(&mut self, upto: usize) -> Result<Compacted> {
        let (next, done) = self.compacted(upto)?;
        *self = next;
        Ok(done)
    }

    /// What `compact_history(upto)` would do, without changing the note: the sizes it would
    /// give (for showing how much space a cut frees).
    pub fn compact_preview(&self, upto: usize) -> Result<Compacted> {
        Ok(self.compacted(upto)?.1)
    }

    fn compacted(&self, upto: usize) -> Result<(Editor, Compacted)> {
        if upto < self.floor || upto > self.cursor {
            return Err(Error::new(
                0,
                "That point is outside the history that can be compacted",
            ));
        }
        let bytes_before = self.save_project()?.len();
        let edits_before = self.history.len();
        let end = if upto == self.cursor {
            self.cursor
        } else {
            self.history.len()
        };
        let history = &self.history[..end];

        // Added items erased within the compacted part, and the edits that erased them.
        let mut erased: HashSet<usize> = HashSet::new();
        for edit in &history[..upto] {
            if let Edit::Erase { ids, .. } = edit {
                erased.extend(
                    ids.iter()
                        .filter_map(|id| added_index(id))
                        .filter(|i| *i < upto),
                );
            }
        }
        let mut keep = vec![true; history.len()];
        // Per item: the last reshaping and the last text in the compacted part.
        let mut last_replace: HashMap<(usize, &str), usize> = HashMap::new();
        let mut last_retext: HashMap<(usize, &str), usize> = HashMap::new();
        // Per item: its moves and restyles in the compacted part, in order.
        let mut adjusts: HashMap<(usize, &str), Vec<usize>> = HashMap::new();
        for (i, edit) in history[..upto].iter().enumerate() {
            let named = |id: &str| added_index(id).is_some_and(|n| erased.contains(&n));
            match edit {
                Edit::Add { .. } | Edit::Image { .. } if erased.contains(&i) => keep[i] = false,
                Edit::Adjust { id, .. } | Edit::Replace { id, .. } | Edit::Retext { id, .. }
                    if named(id) =>
                {
                    keep[i] = false
                }
                Edit::Replace { page, id, .. } => {
                    if let Some(before) = last_replace.insert((*page, id), i) {
                        keep[before] = false;
                    }
                }
                Edit::Retext { page, id, .. } => {
                    if let Some(before) = last_retext.insert((*page, id), i) {
                        keep[before] = false;
                    }
                }
                Edit::Adjust { page, id, .. } => adjusts.entry((*page, id)).or_default().push(i),
                _ => {}
            }
        }
        // A move or restyle goes when the next one of the same item replaces it and neither
        // it nor the next changes the lock (a lock change must stay its own edit).
        let locked = |i: usize| match &history[i] {
            Edit::Adjust { adjustment, .. } => adjustment.locked,
            _ => None,
        };
        for run in adjusts.values() {
            let mut before = None;
            for (k, &i) in run.iter().enumerate() {
                if let Some(&next) = run.get(k + 1) {
                    if locked(i) == before && locked(next) == locked(i) {
                        keep[i] = false;
                        continue;
                    }
                }
                before = locked(i);
            }
        }

        // Erasures left with nothing to erase go too.
        let gone = |id: &str| added_index(id).is_some_and(|n| erased.contains(&n));
        for (i, edit) in history[..upto].iter().enumerate() {
            if let Edit::Erase { ids, .. } = edit {
                if ids.iter().all(|id| gone(id)) {
                    keep[i] = false;
                }
            }
        }
        // The kept edits, numbered again; erase lists without the items that went.
        let map: HashMap<usize, usize> = (0..history.len())
            .filter(|i| keep[*i])
            .enumerate()
            .map(|(n, i)| (i, n))
            .collect();
        let mut compacted = Vec::with_capacity(map.len());
        for (i, edit) in history.iter().enumerate().filter(|(i, _)| keep[*i]) {
            let mut edit = edit.clone();
            match &mut edit {
                Edit::Erase { ids, .. } => {
                    if i < upto {
                        ids.retain(|id| !gone(id));
                    }
                    for id in ids.iter_mut() {
                        *id = renamed(id, &map)?;
                    }
                }
                Edit::Adjust { id, joined, .. } => {
                    *id = renamed(id, &map)?;
                    if i < upto {
                        *joined = false;
                    }
                }
                Edit::Replace { id, .. } | Edit::Retext { id, .. } => *id = renamed(id, &map)?,
                // What is compacted can no longer be undone: no step starts inside it.
                Edit::Add { line, .. } if i < upto => line.joined = false,
                _ => {}
            }
            compacted.push((i, edit));
        }
        let floor = compacted.iter().filter(|(i, _)| *i < upto).count();
        let cursor = compacted.iter().filter(|(i, _)| *i < self.cursor).count();

        // Open the result as a project, and check every page draws the same.
        let mut project: serde_json::Value = serde_json::from_str(&self.save_project()?)
            .map_err(|e| Error::new(0, e.to_string()))?;
        project["history"] =
            serde_json::to_value(compacted.into_iter().map(|(_, e)| e).collect::<Vec<_>>())
                .map_err(|e| Error::new(0, e.to_string()))?;
        project["cursor"] = cursor.into();
        project["floor"] = floor.into();
        project["version"] = 9.into();
        let next = Editor::open_project(&project.to_string())?;
        let order = self.page_order();
        if next.page_order() != order {
            return Err(Error::new(
                0,
                "Compacting would change the pages; nothing was changed",
            ));
        }
        for slot in order {
            let a = self.view(slot)?;
            let b = next.view(slot)?;
            if unnamed(a["svg"].as_str().unwrap_or("")) != unnamed(b["svg"].as_str().unwrap_or(""))
                || without_ids(&a["texts"]) != without_ids(&b["texts"])
            {
                return Err(Error::new(
                    0,
                    "Compacting would change a page; nothing was changed",
                ));
            }
        }
        let edits_after = next.history.len();
        let bytes_after = next.save_project()?.len();
        Ok((
            next,
            Compacted {
                edits_before,
                edits_after,
                bytes_before,
                bytes_after,
            },
        ))
    }
}
