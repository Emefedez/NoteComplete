//! Parts of a compound object drawn as ordinary items (docs/SHAPES-TABLES-MATH.md): a graph or
//! a table is grid lines, ink and text boxes, each carrying the object's id and kind, and the
//! first one its spec (the function and ranges, the cells), so a reader can select the whole
//! object and edit it again. Readers that ignore it see ordinary items; Noteful exports the
//! items as they look.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Part {
    /// The object's id, the same on all its parts.
    pub id: String,
    /// "graph" or "table".
    pub kind: String,
    /// The object's description (JSON, written by the reader), on one of its parts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
}
impl Part {
    pub(crate) fn valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 64
            && self
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_:".contains(c))
            && matches!(self.kind.as_str(), "graph" | "table")
            && self.spec.as_ref().is_none_or(|s| s.len() <= 256 * 1024)
    }
}
