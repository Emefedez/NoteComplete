//! How opening, saving and drawing a page cost as the edit history grows. Not run by default:
//! `cargo test --release -p noteful-core --test it -- --ignored history_timing --nocapture`
use noteful_core::{Editor, Line};
use std::time::Instant;
#[test]
#[ignore]
fn history_timing() {
    let data = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../samples/Examen wuolah.noteful"
    ))
    .unwrap();
    let mut e = Editor::open(&data).unwrap();
    let mut k = 0usize;
    let mut added: std::collections::VecDeque<(usize, String)> = Default::default();
    for n in [0usize, 2000, 10000, 30000] {
        while k < n {
            k += 1;
            let i = k as f64;
            let pts: Vec<[f64; 2]> = (0..40)
                .map(|j| [50. + j as f64 * 3., 50. + (i % 500.)])
                .collect();
            if k.is_multiple_of(10) {
                let (pg, id) = added.pop_front().unwrap();
                e.remove_item(pg, &id).unwrap();
            } else {
                let pg = 1 + k % 2;
                e.add_line(pg, Line::new(pts, 2., [0., 0., 0., 1.]))
                    .unwrap();
                added.push_back((pg, format!("new:{}", k - 1)));
            }
        }
        let t = Instant::now();
        for _ in 0..10 {
            e.view(0).unwrap();
        }
        let view = t.elapsed() / 10;
        let t = Instant::now();
        e.undo();
        e.redo();
        let ur = t.elapsed();
        let t = Instant::now();
        let s = e.save_project().unwrap();
        let save = t.elapsed();
        let t = Instant::now();
        let _ = Editor::open_project(&s).unwrap();
        let open = t.elapsed();
        println!(
            "edits {n}: view {view:?}, undo+redo {ur:?}, save {save:?} ({} MB), reopen {open:?}",
            s.len() / 1_000_000
        );
    }
}
