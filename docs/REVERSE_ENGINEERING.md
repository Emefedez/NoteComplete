# Reverse Engineering & Format Interoperability

NoteComplete started from an independent reverse-engineering project (`noteful-re`) aimed at reading and writing Noteful (`.noteful`) notebooks outside iPadOS. Over time it grew into a standalone cross-platform notebook and study environment, while retaining a clean Rust core that imports and round-trips third-party notebook formats locally.

> NoteComplete is not affiliated with or endorsed by Noteful, Goodnotes, or Notability.

## How `.noteful` was reverse engineered

Noteful's `.noteful` format is undocumented. The research artifacts—Ghidra analysis scripts, an independent Python oracle, the legacy viewer, and parity verification suites—are archived on the [`reverse-engineering`](https://github.com/Emefedez/noteful-re/tree/reverse-engineering) branch, and the documented schema lives in [`spec/noteful-v0.1.md`](../spec/noteful-v0.1.md).

In short, the format was worked out by:
1. Inspecting sample `.noteful` archives (pages, SQLite/plist metadata, stroke blobs, PDF/paper backgrounds, images, text boxes, shapes, tape, layers, tags, and audio recordings).
2. Reconstructing coordinate transforms, pressure curves, highlighter blending, and text/shape geometry in a reference Python implementation.
3. Cross-checking rendered SVG/raster output and round-tripped archives against real Noteful exports via automated parity tests.

## Goodnotes (`.goodnotes`) & Notability (`.ntb`)

Both formats are imported locally in `crates/noteful-import` without cloud services:

- **Goodnotes (`.goodnotes`, including unpacked folder exports):** parses the archive's protobuf page/note tables (`index.notes.pb`, `schema.pb`, `notes/`), converts ink strokes, text, images, shapes, and PDF backgrounds into editable NoteComplete items, and preserves the original file inside the saved `.nfedit` project.
- **Notability (`.ntb`):** unpacks the bundle's property lists and stroke/media payloads into editable NoteComplete pages, strokes, text, and backgrounds.

## What is reused in NoteComplete

| Layer | Reused from format work | Original NoteComplete architecture |
| --- | --- | --- |
| **Core engine (`crates/noteful-core`, `noteful-wasm`)** | `.noteful` binary/archive reader & writer, stroke/shape/text/layer scene model, SVG renderer, native export | `.nfedit` non-destructive project container (`spec/nfedit-v1.md`), infinite canvas, handwriting synthesis from Markdown, full undo/redo compaction |
| **Importers (`crates/noteful-import`)** | `.goodnotes` and `.ntb` converters | PDF/image page notes, Word/ODT/Excel/CSV-to-Markdown conversion, ZIP/TAR archive inspector |
| **Application (`apps/reader`, `desktop`, `mobile`)** | — | Markdown split editor, Chinese IME/Pinyin/Lookup/Stroke order/Translator, interactive prefabs & UML/charts, global MP3 player, AI study tools & MCP server, live collaboration & drawing tablet mode |
