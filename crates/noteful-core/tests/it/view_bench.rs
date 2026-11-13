//! How long `Editor::view` takes as strokes are added to a page. Not run by default:
//! `cargo test --release -p noteful-core --test it -- --ignored view_bench --nocapture`
use noteful_core::{Editor, Line};
use std::time::Instant;

/// A handwritten-looking stroke of 60 points, different for every `n`.
fn stroke(n: usize) -> Line {
    let (x, y) = (40. + (n % 50) as f64 * 14., 60. + (n / 50) as f64 * 12.);
    Line::new(
        (0..60)
            .map(|i| {
                let t = i as f64;
                [
                    x + t * 0.21 + (t * 0.7).sin() * 3.,
                    y + (t * 0.45).cos() * 4.,
                ]
            })
            .collect(),
        2.,
        [0.1, 0.1, 0.6, 1.],
    )
}
/// The median time of `runs` calls, in milliseconds.
fn median_ms(runs: usize, mut call: impl FnMut()) -> f64 {
    let mut times: Vec<f64> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            call();
            start.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    times.sort_by(f64::total_cmp);
    times[runs / 2]
}

#[test]
#[ignore = "a benchmark; run it in release mode"]
fn view_bench() {
    let mut e = Editor::open(crate::samples::EXAM).unwrap();
    let mut added = 0;
    println!("strokes added | view after one more stroke (ms) | view again (ms) | with JSON text (ms) | JSON text (MB)");
    for target in [0, 1, 500, 1000, 4000] {
        while added < target {
            e.add_line(0, stroke(added)).unwrap();
            added += 1;
        }
        let first = e.view(0).unwrap();
        assert_eq!(first["visible_added"], target);
        // What drawing costs: the view after a new stroke on a page already viewed.
        let mut drawn = Vec::new();
        for _ in 0..9 {
            e.add_line(0, stroke(added)).unwrap();
            let start = Instant::now();
            std::hint::black_box(e.view(0).unwrap());
            drawn.push(start.elapsed().as_secs_f64() * 1e3);
            e.undo();
        }
        drawn.sort_by(f64::total_cmp);
        let drawn = drawn[4];
        let view = median_ms(9, || {
            std::hint::black_box(e.view(0).unwrap());
        });
        let text = median_ms(9, || {
            std::hint::black_box(e.view(0).unwrap().to_string());
        });
        let mb = first.to_string().len() as f64 / 1e6;
        println!("{target:>13} | {drawn:>31.2} | {view:>15.2} | {text:>19.2} | {mb:>14.2}");
    }
}
