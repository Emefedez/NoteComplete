use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind {
    Line,
    Rectangle,
    Ellipse,
    Triangle,
    Arrow,
    /// A five-pointed star, point up, filling the box from start to end.
    Star,
}
/// A five-pointed star's outline on a unit circle (outer points radius 1, inner ones
/// the regular pentagram's 0.382), point up, closed: 11 points.
fn unit_star() -> Vec<[f64; 2]> {
    (0..=10)
        .map(|i| {
            let r = if i % 2 == 0 { 1. } else { 0.381_966 };
            let a = (-90. + 36. * f64::from(i)).to_radians();
            [r * a.cos(), r * a.sin()]
        })
        .collect()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shape {
    pub kind: ShapeKind,
    pub start: [f64; 2],
    pub end: [f64; 2],
    /// Inside colour of a rectangle, ellipse or triangle (RGBA 0–1); none is an outline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<[f64; 4]>,
}
impl Shape {
    /// Shapes with an inside: only these take a fill.
    pub fn closed(&self) -> bool {
        matches!(
            self.kind,
            ShapeKind::Rectangle | ShapeKind::Ellipse | ShapeKind::Triangle | ShapeKind::Star
        )
    }
    pub(crate) fn fill_valid(&self) -> bool {
        self.fill.is_none_or(|f| {
            self.closed() && f.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        })
    }
    pub fn points(&self) -> Vec<[f64; 2]> {
        let [x, y] = self.start;
        let [u, v] = self.end;
        match self.kind {
            ShapeKind::Line => vec![self.start, self.end],
            ShapeKind::Rectangle => vec![[x, y], [u, y], [u, v], [x, v], [x, y]],
            ShapeKind::Triangle => vec![[(x + u) / 2., y], [u, v], [x, v], [(x + u) / 2., y]],
            ShapeKind::Ellipse => (0..=64)
                .map(|i| {
                    let a = f64::from(i) * std::f64::consts::PI / 32.;
                    [
                        (x + u) / 2. + (u - x).abs() / 2. * a.cos(),
                        (y + v) / 2. + (v - y).abs() / 2. * a.sin(),
                    ]
                })
                .collect(),
            ShapeKind::Star => {
                // The star's own box (x ±sin 72°, y from -1 to cos 36°) mapped onto start–end.
                let (sx, top, bottom) = (72f64.to_radians().sin(), -1., 36f64.to_radians().cos());
                unit_star()
                    .into_iter()
                    .map(|[px, py]| {
                        [
                            x + (px + sx) / (2. * sx) * (u - x),
                            y + (py - top) / (bottom - top) * (v - y),
                        ]
                    })
                    .collect()
            }
            ShapeKind::Arrow => {
                let a = (v - y).atan2(u - x);
                let d = 24f64.min((u - x).hypot(v - y) / 3.);
                vec![
                    self.start,
                    self.end,
                    [u - d * (a - 0.5).cos(), v - d * (a - 0.5).sin()],
                    self.end,
                    [u - d * (a + 0.5).cos(), v - d * (a + 0.5).sin()],
                ]
            }
        }
    }
}
