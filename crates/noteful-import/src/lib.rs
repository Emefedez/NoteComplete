pub fn probe(b: Vec<u8>) -> usize { oblyx::doc::Document::from_bytes(b).map(|d| d.pages.len()).unwrap_or(0) + noteful_core::MAGIC.len() }
