//! `.nfedit` version 13: the project as a tar archive (the container `.notecomp` uses) instead of
//! one JSON text. `manifest.json` is the project JSON of versions 1–12 with format
//! `notecomplete-project`, without the files it would carry as Base64; those are members:
//! `note.noteful` (the Noteful archive the history applies to), `origin` (the file an imported
//! note came from, unchanged) and `audio/N` (the Nth added recording). Versions 1–12 still open:
//! both forms fill the same project (editor.rs `from_project`).
use crate::editor::{Project, ProjectExportOptions};
use crate::{Editor, Error, Result};
use std::io::Read;

pub(crate) const FORMAT: &str = "notecomplete-project";
pub(crate) const VERSION: u32 = 13;
const MANIFEST: &str = "manifest.json";
const NOTE: &str = "note.noteful";
const ORIGIN: &str = "origin";

/// Whether `data` is a v13 project archive (a tar whose manifest says so).
pub fn is_project_archive(data: &[u8]) -> bool {
    crate::is_notecomplete(data)
        && manifest(data).is_some_and(|m| m["format"].as_str() == Some(FORMAT))
}

fn manifest(data: &[u8]) -> Option<serde_json::Value> {
    let mut archive = tar::Archive::new(data);
    for entry in archive.entries().ok()? {
        let mut entry = entry.ok()?;
        if entry.path().ok()?.to_str()? == MANIFEST {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).ok()?;
            return serde_json::from_slice(&bytes).ok();
        }
    }
    None
}

fn pack(
    mut project: Project,
    source: &[u8],
    origin: Option<&[u8]>,
    audio: &[&[u8]],
) -> Result<Vec<u8>> {
    project.format = FORMAT.to_owned();
    // With Chinese settings 14, so an app that cannot keep them says so instead of failing.
    project.version = if project.chinese.is_empty() {
        VERSION
    } else {
        14
    };
    let manifest = serde_json::to_vec(&project).map_err(|e| Error::new(0, e.to_string()))?;
    let mut builder = tar::Builder::new(Vec::new());
    crate::markdown::add(&mut builder, MANIFEST, &manifest)?;
    crate::markdown::add(&mut builder, NOTE, source)?;
    if let Some(origin) = origin {
        crate::markdown::add(&mut builder, ORIGIN, origin)?;
    }
    for (i, bytes) in audio.iter().enumerate() {
        crate::markdown::add(&mut builder, &format!("audio/{i}"), bytes)?;
    }
    builder
        .into_inner()
        .map_err(|e| Error::new(0, e.to_string()))
}

impl Editor {
    /// The project as a v13 archive: what a `.nfedit` file holds.
    pub fn save_project_archive(&self) -> Result<Vec<u8>> {
        let audio: Vec<&[u8]> = self.added_audio.iter().map(|(_, b)| b.as_slice()).collect();
        pack(
            self.project(false),
            &self.source,
            self.origin.as_ref().map(|o| o.bytes.as_slice()),
            &audio,
        )
    }
    /// `export_filtered_project` as a v13 archive.
    pub fn export_filtered_project_archive(
        &self,
        options: ProjectExportOptions,
    ) -> Result<Vec<u8>> {
        let (project, source) = self.filtered_project(options, false)?;
        let audio: Vec<&[u8]> = if options.include_added_audio {
            self.added_audio.iter().map(|(_, b)| b.as_slice()).collect()
        } else {
            Vec::new()
        };
        pack(
            project,
            &source,
            self.origin.as_ref().map(|o| o.bytes.as_slice()),
            &audio,
        )
    }
    /// Opens a v13 archive.
    pub fn open_project_archive(data: &[u8]) -> Result<Self> {
        let invalid = |e: std::io::Error| Error::new(0, format!("Not a NoteComplete project: {e}"));
        let mut project: Option<Project> = None;
        let (mut source, mut origin) = (None, None);
        let mut audio = std::collections::HashMap::new();
        let mut archive = tar::Archive::new(data);
        for entry in archive.entries().map_err(invalid)? {
            let mut entry = entry.map_err(invalid)?;
            let name = entry
                .path()
                .map_err(invalid)?
                .to_string_lossy()
                .into_owned();
            let mut bytes = Vec::with_capacity(entry.header().size().map_err(invalid)? as usize);
            entry.read_to_end(&mut bytes).map_err(invalid)?;
            match name.as_str() {
                MANIFEST => {
                    project = Some(
                        serde_json::from_slice(&bytes).map_err(|e| Error::new(0, e.to_string()))?,
                    )
                }
                NOTE => source = Some(bytes),
                ORIGIN => origin = Some(bytes),
                _ => {
                    if let Some(i) = name
                        .strip_prefix("audio/")
                        .and_then(|n| n.parse::<usize>().ok())
                    {
                        audio.insert(i, bytes);
                    }
                }
            }
        }
        let project = project
            .filter(|p| p.format == FORMAT && matches!(p.version, VERSION | 14))
            .ok_or_else(|| Error::new(0, "Unsupported or invalid project"))?;
        let source = source.ok_or_else(|| Error::new(0, "The project has no note"))?;
        let origin = match (&project.origin, origin) {
            (Some(o), Some(bytes)) => Some(crate::editor::Origin {
                format: o.format.clone(),
                name: o.name.clone(),
                bytes,
            }),
            (None, None) => None,
            _ => return Err(Error::new(0, "The project's original file is missing")),
        };
        let audio = (0..project.added_audio.len())
            .map(|i| {
                audio
                    .remove(&i)
                    .ok_or_else(|| Error::new(0, "A recording of the project is missing"))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut project = project;
        project.origin = None;
        Self::from_project(project, &source, origin, audio)
    }
}
