//! The core's integration tests, built as one program: Cargo compiles and links every
//! file directly under `tests/` separately, so each area is a module here instead.

/// Sample notes, embedded once for every module.
mod samples {
    pub static EXAM: &[u8] = include_bytes!("../../../../samples/Examen wuolah.noteful");
    pub static PRACTICE_BOOK: &[u8] =
        include_bytes!("../../../../samples/Practice book (vol. 1).noteful");
    pub static TEXT: &[u8] = include_bytes!("../../../../samples/texto.noteful");
    pub static BLANK: &[u8] = include_bytes!("../../../../samples/nota_vacia.noteful");
    pub static LINE_TOOL: &[u8] =
        include_bytes!("../../../../samples/nota_herramientalinea.noteful");
    pub static IMAGE: &[u8] = include_bytes!("../../../../samples/nota_imagen.noteful");
    pub static AUDIO: &[u8] = include_bytes!("../../../../tests/fixtures/audio-synthetic.noteful");
    pub static MULTI_AUDIO: &[u8] =
        include_bytes!("../../../../tests/fixtures/multi-audio-synthetic.noteful");
    pub static EDITING_DEMO: &str = include_str!("../../../../tests/fixtures/editing-demo.nfedit");
}

mod audio;
mod canvas;
mod compact;
mod corpus;
mod editor;
mod export;
mod filled_shapes;
mod imports;
mod ink_text;
mod manipulation;
mod math_text;
mod page_geometry;
mod pages;
mod recognized_text;
mod tape_on_top;
mod text;
