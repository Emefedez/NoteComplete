//! A raster drawing into ink, for copying a drawing out of a page mockup:
//! dark outlines become pen strokes along their centre line, coloured areas
//! become highlighter colouring (or opaque pen colouring where translucent
//! highlighter cannot show the colour), thin coloured marks (arrows, leader
//! lines) become pen strokes in their colour. Ported from noteful-mcp's
//! trace.py (MIT), with the image operations it took from NumPy, SciPy and
//! scikit-image written out here.
use super::{
    font::Pt,
    hand::{highlight_line, Pen, Rgba},
    rng::Rng,
};
use crate::Line;

/// An RGB image, row-major, 3 bytes per pixel.
#[derive(Clone, Debug)]
pub struct Raster {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}
impl Raster {
    pub fn new(width: usize, height: usize, rgb: Vec<u8>) -> Option<Self> {
        (width > 0 && height > 0 && rgb.len() == width * height * 3).then_some(Self {
            width,
            height,
            rgb,
        })
    }
    pub fn pixel(&self, x: usize, y: usize) -> [u8; 3] {
        let i = (y * self.width + x) * 3;
        [self.rgb[i], self.rgb[i + 1], self.rgb[i + 2]]
    }
    /// Per-channel median of a box (clipped to the image).
    pub fn median(&self, x: i64, y: i64, w: i64, h: i64) -> Option<[u8; 3]> {
        let (x0, y0) = (x.max(0) as usize, y.max(0) as usize);
        let x1 = ((x + w.max(1)) as usize).min(self.width);
        let y1 = ((y + h.max(1)) as usize).min(self.height);
        if x0 >= x1 || y0 >= y1 {
            return None;
        }
        let mut ch: [Vec<u8>; 3] = Default::default();
        for yy in y0..y1 {
            for xx in x0..x1 {
                let p = self.pixel(xx, yy);
                for c in 0..3 {
                    ch[c].push(p[c]);
                }
            }
        }
        Some(ch.map(|mut v| {
            v.sort_unstable();
            v[v.len() / 2]
        }))
    }
    pub fn crop(&self, x: i64, y: i64, w: i64, h: i64) -> Option<Raster> {
        let (x0, y0) = (x.max(0) as usize, y.max(0) as usize);
        let x1 = ((x + w) as usize).min(self.width);
        let y1 = ((y + h) as usize).min(self.height);
        if x0 >= x1 || y0 >= y1 {
            return None;
        }
        let mut rgb = Vec::with_capacity((x1 - x0) * (y1 - y0) * 3);
        for yy in y0..y1 {
            let i = (yy * self.width + x0) * 3;
            rgb.extend_from_slice(&self.rgb[i..i + (x1 - x0) * 3]);
        }
        Raster::new(x1 - x0, y1 - y0, rgb)
    }
}

/// How opaque Noteful draws highlighter, and the ivory of generated paper.
const HIGHLIGHT_ALPHA: f64 = 0.42;
const PAPER: [f64; 3] = [0.984, 0.969, 0.937];

/// Can translucent highlighter on ivory paper show this colour? Deep,
/// saturated colours cannot: they need opaque pen colouring.
pub fn reachable(rgb: [f64; 3]) -> bool {
    rgb.iter().zip(PAPER).all(|(v, p)| {
        (-0.08..=1.05).contains(&((v - (1. - HIGHLIGHT_ALPHA) * p) / HIGHLIGHT_ALPHA))
    })
}
/// The highlighter colour that shows as `rgb` once laid translucent on paper.
pub fn solid(rgb: [f64; 3]) -> Rgba {
    let c =
        |i: usize| ((rgb[i] - (1. - HIGHLIGHT_ALPHA) * PAPER[i]) / HIGHLIGHT_ALPHA).clamp(0., 1.);
    [c(0), c(1), c(2), 1.]
}

/// A boolean image.
#[derive(Clone)]
struct Mask {
    w: usize,
    h: usize,
    v: Vec<bool>,
}
impl Mask {
    fn new(w: usize, h: usize) -> Self {
        Self {
            w,
            h,
            v: vec![false; w * h],
        }
    }
    fn get(&self, x: i64, y: i64) -> bool {
        x >= 0
            && y >= 0
            && (x as usize) < self.w
            && (y as usize) < self.h
            && self.v[y as usize * self.w + x as usize]
    }
    fn count(&self) -> usize {
        self.v.iter().filter(|b| **b).count()
    }
    fn any(&self) -> bool {
        self.v.iter().any(|b| *b)
    }
    fn and_not(&self, o: &Mask) -> Mask {
        Mask {
            v: self.v.iter().zip(&o.v).map(|(a, b)| *a && !b).collect(),
            ..*self
        }
    }
    fn or(&self, o: &Mask) -> Mask {
        Mask {
            v: self.v.iter().zip(&o.v).map(|(a, b)| *a || *b).collect(),
            ..*self
        }
    }
    fn and(&self, o: &Mask) -> Mask {
        Mask {
            v: self.v.iter().zip(&o.v).map(|(a, b)| *a && *b).collect(),
            ..*self
        }
    }
}
fn disk(r: i64) -> Vec<(i64, i64)> {
    let mut out = Vec::new();
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy <= r * r {
                out.push((dx, dy));
            }
        }
    }
    out
}
fn dilate_mask(m: &Mask, r: i64) -> Mask {
    let d = disk(r);
    let mut out = Mask::new(m.w, m.h);
    for y in 0..m.h as i64 {
        for x in 0..m.w as i64 {
            out.v[y as usize * m.w + x as usize] = d.iter().any(|(dx, dy)| m.get(x + dx, y + dy));
        }
    }
    out
}
/// Grey closing (dilation, then erosion) with a disk: fills dark lines with the
/// brightness around them.
fn closing(v: &[f64], w: usize, h: usize, r: i64) -> Vec<f64> {
    let d = disk(r);
    let pass = |src: &[f64], max: bool| -> Vec<f64> {
        let mut out = vec![0.; w * h];
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                let mut acc = if max {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                };
                for (dx, dy) in &d {
                    let (xx, yy) = (x + dx, y + dy);
                    if xx < 0 || yy < 0 || xx >= w as i64 || yy >= h as i64 {
                        continue;
                    }
                    let s = src[yy as usize * w + xx as usize];
                    acc = if max { acc.max(s) } else { acc.min(s) };
                }
                out[y as usize * w + x as usize] = acc;
            }
        }
        out
    };
    pass(&pass(v, true), false)
}
/// Connected components (8-neighbour when `diag`), as lists of pixel indices.
fn components(m: &Mask, diag: bool) -> Vec<Vec<usize>> {
    let mut seen = vec![false; m.v.len()];
    let mut out = Vec::new();
    for start in 0..m.v.len() {
        if !m.v[start] || seen[start] {
            continue;
        }
        let mut stack = vec![start];
        seen[start] = true;
        let mut comp = Vec::new();
        while let Some(i) = stack.pop() {
            comp.push(i);
            let (x, y) = ((i % m.w) as i64, (i / m.w) as i64);
            for dy in -1..=1i64 {
                for dx in -1..=1i64 {
                    if (dx == 0 && dy == 0) || (!diag && dx != 0 && dy != 0) {
                        continue;
                    }
                    if m.get(x + dx, y + dy) {
                        let j = (y + dy) as usize * m.w + (x + dx) as usize;
                        if !seen[j] {
                            seen[j] = true;
                            stack.push(j);
                        }
                    }
                }
            }
        }
        out.push(comp);
    }
    out
}
fn remove_small(m: &Mask, max_size: usize) -> Mask {
    let mut out = m.clone();
    for comp in components(m, false) {
        if comp.len() <= max_size {
            for i in comp {
                out.v[i] = false;
            }
        }
    }
    out
}
/// Zhang-Suen thinning to a one-pixel skeleton.
fn skeleton(m: &Mask) -> Mask {
    let mut s = m.clone();
    let (w, h) = (m.w as i64, m.h as i64);
    loop {
        let mut changed = false;
        for step in 0..2 {
            let mut remove = Vec::new();
            for y in 0..h {
                for x in 0..w {
                    if !s.get(x, y) {
                        continue;
                    }
                    let p = [
                        s.get(x, y - 1),
                        s.get(x + 1, y - 1),
                        s.get(x + 1, y),
                        s.get(x + 1, y + 1),
                        s.get(x, y + 1),
                        s.get(x - 1, y + 1),
                        s.get(x - 1, y),
                        s.get(x - 1, y - 1),
                    ];
                    let b = p.iter().filter(|v| **v).count();
                    let a = (0..8).filter(|&i| !p[i] && p[(i + 1) % 8]).count();
                    let ok = if step == 0 {
                        !(p[0] && p[2] && p[4]) && !(p[2] && p[4] && p[6])
                    } else {
                        !(p[0] && p[2] && p[6]) && !(p[0] && p[4] && p[6])
                    };
                    if (2..=6).contains(&b) && a == 1 && ok {
                        remove.push((y * w + x) as usize);
                    }
                }
            }
            changed |= !remove.is_empty();
            for i in remove {
                s.v[i] = false;
            }
        }
        if !changed {
            return s;
        }
    }
}
/// Distance to the nearest unset pixel (chamfer 3-4, in pixels).
fn distance(m: &Mask) -> Vec<f64> {
    let (w, h) = (m.w, m.h);
    let big = 1e9;
    let mut d: Vec<f64> = m.v.iter().map(|b| if *b { big } else { 0. }).collect();
    let at = |d: &Vec<f64>, x: i64, y: i64| {
        if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
            0.
        } else {
            d[y as usize * w + x as usize]
        }
    };
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let i = y as usize * w + x as usize;
            if d[i] > 0. {
                d[i] = d[i]
                    .min(at(&d, x - 1, y) + 3.)
                    .min(at(&d, x, y - 1) + 3.)
                    .min(at(&d, x - 1, y - 1) + 4.)
                    .min(at(&d, x + 1, y - 1) + 4.);
            }
        }
    }
    for y in (0..h as i64).rev() {
        for x in (0..w as i64).rev() {
            let i = y as usize * w + x as usize;
            if d[i] > 0. {
                d[i] = d[i]
                    .min(at(&d, x + 1, y) + 3.)
                    .min(at(&d, x, y + 1) + 3.)
                    .min(at(&d, x + 1, y + 1) + 4.)
                    .min(at(&d, x - 1, y + 1) + 4.);
            }
        }
    }
    d.into_iter().map(|v| v / 3.).collect()
}
/// Skeleton pixels into polylines (x, y), split at junctions.
fn walk_skeleton(sk: &Mask) -> Vec<Vec<(i64, i64)>> {
    let neigh = |x: i64, y: i64| -> Vec<(i64, i64)> {
        let mut v = Vec::new();
        for dy in -1..=1 {
            for dx in -1..=1 {
                if (dx, dy) != (0, 0) && sk.get(x + dx, y + dy) {
                    v.push((x + dx, y + dy));
                }
            }
        }
        v
    };
    let pts: Vec<(i64, i64)> = (0..sk.v.len())
        .filter(|i| sk.v[*i])
        .map(|i| ((i % sk.w) as i64, (i / sk.w) as i64))
        .collect();
    let mut used = std::collections::HashSet::new();
    let key = |a: (i64, i64), b: (i64, i64)| if a <= b { (a, b) } else { (b, a) };
    let mut paths = Vec::new();
    let walk = |a: (i64, i64), b: (i64, i64), used: &mut std::collections::HashSet<_>| {
        let mut path = vec![a, b];
        used.insert(key(a, b));
        let (mut prev, mut cur) = (a, b);
        while neigh(cur.0, cur.1).len() == 2 {
            let Some(next) = neigh(cur.0, cur.1)
                .into_iter()
                .find(|q| *q != prev && !used.contains(&key(cur, *q)))
            else {
                break;
            };
            used.insert(key(cur, next));
            prev = cur;
            cur = next;
            path.push(cur);
        }
        path
    };
    for &p in pts.iter().filter(|p| neigh(p.0, p.1).len() != 2) {
        for q in neigh(p.0, p.1) {
            if !used.contains(&key(p, q)) {
                paths.push(walk(p, q, &mut used));
            }
        }
    }
    for &p in &pts {
        for q in neigh(p.0, p.1) {
            if !used.contains(&key(p, q)) {
                paths.push(walk(p, q, &mut used));
            }
        }
    }
    paths
}
/// Douglas-Peucker simplification.
fn simplify(pts: &[Pt], tol: f64) -> Vec<Pt> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    let (mut worst, mut at) = (0., 0);
    for (i, p) in pts.iter().enumerate().skip(1).take(pts.len() - 2) {
        let d = crate::editor::point_distance(*p, a, b);
        if d > worst {
            worst = d;
            at = i;
        }
    }
    if worst <= tol {
        return vec![a, b];
    }
    let mut left = simplify(&pts[..=at], tol);
    left.pop();
    left.extend(simplify(&pts[at..], tol));
    left
}
/// Group pixels into at most k colours (median cut, then close colours merged).
fn clusters(img: &Raster, m: &Mask, k: usize) -> Vec<([f64; 3], Mask)> {
    let idx: Vec<usize> = (0..m.v.len()).filter(|i| m.v[*i]).collect();
    if idx.len() < 30 {
        return vec![];
    }
    let px = |i: usize| [img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]];
    let mut boxes: Vec<Vec<usize>> = vec![idx.clone()];
    while boxes.len() < k {
        let (bi, ch, range) = boxes
            .iter()
            .enumerate()
            .flat_map(|(bi, b)| {
                (0..3).map(move |c| {
                    let (lo, hi) = b.iter().fold((255u8, 0u8), |(lo, hi), i| {
                        (lo.min(px(*i)[c]), hi.max(px(*i)[c]))
                    });
                    (bi, c, hi.saturating_sub(lo))
                })
            })
            .max_by_key(|t| t.2)
            .unwrap();
        if range < 8 {
            break;
        }
        let mut b = boxes.swap_remove(bi);
        b.sort_unstable_by_key(|i| px(*i)[ch]);
        let upper = b.split_off(b.len() / 2);
        boxes.push(b);
        boxes.push(upper);
    }
    let palette: Vec<[f64; 3]> = boxes
        .iter()
        .filter(|b| !b.is_empty())
        .map(|b| {
            let mut s = [0.; 3];
            for i in b {
                for (acc, v) in s.iter_mut().zip(px(*i)) {
                    *acc += v as f64;
                }
            }
            s.map(|v| v / b.len() as f64)
        })
        .collect();
    let mut groups: Vec<([f64; 3], Mask)> =
        palette.iter().map(|c| (*c, Mask::new(m.w, m.h))).collect();
    for &i in &idx {
        let p = px(i).map(f64::from);
        let best = (0..palette.len())
            .min_by(|a, b| {
                let d = |c: &[f64; 3]| (0..3).map(|j| (c[j] - p[j]).powi(2)).sum::<f64>();
                d(&palette[*a]).total_cmp(&d(&palette[*b]))
            })
            .unwrap();
        groups[best].1.v[i] = true;
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.1.count()));
    let mut merged: Vec<([f64; 3], Mask)> = Vec::new();
    for (rgb, m) in groups {
        match merged
            .iter_mut()
            .find(|g| (0..3).all(|c| (g.0[c] - rgb[c]).abs() < 34.))
        {
            Some(g) => g.1 = g.1.or(&m),
            None => merged.push((rgb, m)),
        }
    }
    merged
}

/// What a drawing traces to: pen strokes on top, colouring under them.
pub struct Traced {
    pub strokes: Vec<Line>,
    pub under: Vec<Line>,
}

pub struct TraceOptions {
    /// Page position of the image's top-left corner, and page units per pixel.
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub colors: usize,
    /// Boxes (image pixels x, y, w, h) blanked first: labels the page rewrites.
    pub erase: Vec<[i64; 4]>,
    pub band: f64,
    /// Colour with opaque pen strokes (dark pages) rather than highlighter.
    pub opaque: bool,
    pub seed: u64,
}

pub fn trace(img: &Raster, o: &TraceOptions) -> Traced {
    let (w, h) = (img.width, img.height);
    let mut rng = Rng::new(o.seed);
    let mut a = img.clone();
    // Paper is the median colour of the border.
    let border: Vec<usize> = (0..w)
        .flat_map(|x| [x, (h - 1) * w + x])
        .chain((0..h).flat_map(|y| [y * w, y * w + w - 1]))
        .collect();
    let paper: [u8; 3] = [0, 1, 2].map(|c| {
        let mut v: Vec<u8> = border.iter().map(|i| a.rgb[i * 3 + c]).collect();
        v.sort_unstable();
        v[v.len() / 2]
    });
    for [ex, ey, ew, eh] in &o.erase {
        for yy in (*ey).max(0)..(ey + eh).min(h as i64) {
            for xx in (*ex).max(0)..(ex + ew).min(w as i64) {
                let i = (yy as usize * w + xx as usize) * 3;
                a.rgb[i..i + 3].copy_from_slice(&paper);
            }
        }
    }
    let lum: Vec<f64> = (0..w * h)
        .map(|i| {
            (0.299 * a.rgb[i * 3] as f64
                + 0.587 * a.rgb[i * 3 + 1] as f64
                + 0.114 * a.rgb[i * 3 + 2] as f64)
                / 255.
        })
        .collect();
    let near_paper = Mask {
        w,
        h,
        v: (0..w * h)
            .map(|i| (0..3).all(|c| (a.rgb[i * 3 + c] as i32 - paper[c] as i32).abs() < 26))
            .collect(),
    };
    // An outline is darker than what is around it, whatever the fill behind it.
    let local = closing(&lum, w, h, 4);
    let line = Mask {
        w,
        h,
        v: (0..w * h)
            .map(|i| (local[i] - lum[i] > 0.2 || lum[i] < 0.36) && !near_paper.v[i])
            .collect(),
    };
    let line = remove_small(&line, 12);
    let colour = remove_small(
        &Mask {
            w,
            h,
            v: (0..w * h).map(|i| !near_paper.v[i] && !line.v[i]).collect(),
        },
        8,
    );
    let mut out = Traced {
        strokes: vec![],
        under: vec![],
    };

    let pen = |rng: &mut Rng, rgb: [f64; 3], thick_px: f64, even: bool| -> Pen {
        let mut p = Pen::new(
            [rgb[0] / 255., rgb[1] / 255., rgb[2] / 255., 1.],
            rng.seed(),
        );
        if even {
            p.fineliner = true;
            p.width = (thick_px * o.scale / 1.05).clamp(0.7, 6.);
        } else {
            p.width = (thick_px * o.scale / 1.3).clamp(0.6, 5.);
            p.vary = 0.25;
        }
        p
    };
    let lines_of = |mask: &Mask, rgb: Option<[f64; 3]>, rng: &mut Rng, out: &mut Traced| {
        let dist = distance(mask);
        for path in walk_skeleton(&skeleton(mask)) {
            if path.len() < 4 {
                continue;
            }
            let pts: Vec<Pt> = path.iter().map(|(x, y)| [*x as f64, *y as f64]).collect();
            let simple = simplify(&pts, 0.7);
            let mut ds: Vec<f64> = path
                .iter()
                .map(|(x, y)| dist[*y as usize * w + *x as usize])
                .collect();
            ds.sort_by(f64::total_cmp);
            let thick = ds[ds.len() / 2] * 2.;
            let col = rgb.unwrap_or_else(|| {
                let mut ch: [Vec<u8>; 3] = Default::default();
                for (x, y) in &path {
                    let p = a.pixel(*x as usize, *y as usize);
                    for c in 0..3 {
                        ch[c].push(p[c]);
                    }
                }
                ch.map(|mut v| {
                    v.sort_unstable();
                    v[v.len() / 2] as f64
                })
            });
            let placed: Vec<Pt> = simple
                .iter()
                .map(|[x, y]| [o.x + x * o.scale, o.y + y * o.scale])
                .collect();
            if placed.len() < 2 {
                continue;
            }
            let mut p = pen(rng, col, thick.max(1.2), false);
            out.strokes.push(p.stroke(&placed, 1.6, 1, 0.12));
        }
    };
    lines_of(&line, None, &mut rng, &mut out);

    let mut taken = Mask::new(w, h);
    for (rgb, m) in clusters(&a, &colour, o.colors.clamp(1, 16)) {
        let m = remove_small(&m, 14);
        if !m.any() {
            continue;
        }
        let mut fill = Mask::new(w, h);
        for comp in components(&m, true) {
            let mut sub = Mask::new(w, h);
            for &i in &comp {
                sub.v[i] = true;
            }
            let length = skeleton(&sub).count().max(1);
            if (comp.len() as f64) / (length as f64) < 5.5 && comp.len() > 10 {
                lines_of(&sub, Some(rgb), &mut rng, &mut out);
            } else {
                fill = fill.or(&sub);
            }
        }
        if !fill.any() {
            continue;
        }
        // Reach under the outlines so colour meets the ink.
        let fill = fill.or(&dilate_mask(&fill, 2).and(&line)).and_not(&taken);
        taken = taken.or(&fill);
        let col = solid(rgb.map(|v| v / 255.));
        let step = o.band * 0.98 / o.scale;
        let r = o.band / 2.;
        let mut yy = step / 2.;
        while yy < h as f64 {
            let row = yy as usize;
            let mut x = 0;
            while x < w {
                if !fill.v[row * w + x] {
                    x += 1;
                    continue;
                }
                let s = x;
                while x < w && fill.v[row * w + x] {
                    x += 1;
                }
                let (mut xa, mut xb) = (
                    o.x + s as f64 * o.scale + r * 0.6,
                    o.x + x as f64 * o.scale - r * 0.6,
                );
                if xb - xa < 0.5 {
                    if (x - s) as f64 * o.scale < r {
                        continue;
                    }
                    xa = o.x + (s + x) as f64 / 2. * o.scale;
                    xb = xa;
                }
                let py = o.y + yy * o.scale;
                if o.opaque || !reachable(rgb.map(|v| v / 255.)) {
                    let mut p = pen(&mut rng, rgb, o.band * 1.02 / o.scale, true);
                    out.under
                        .push(p.stroke(&[[xa, py], [xb + 0.01, py]], 3., 0, 0.1));
                } else {
                    let j = rng.uniform(-0.3, 0.3);
                    out.under.push(highlight_line(
                        [xa, py],
                        [xb + 0.01, py + j],
                        o.band,
                        col,
                        &mut rng,
                    ));
                }
            }
            yy += step;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outlines_become_ink_and_fills_become_colouring() {
        // Ivory paper, a pale blue square with a dark 3 px outline, and a red line.
        let (w, h) = (80usize, 60usize);
        let mut rgb = vec![0u8; w * h * 3];
        for y in 0..h {
            for x in 0..w {
                let p: [u8; 3] = if (10..=13).contains(&y) && (5..75).contains(&x) {
                    [220, 30, 30]
                } else if (20..50).contains(&x) && (20..50).contains(&y) {
                    if !(23..47).contains(&x) || !(23..47).contains(&y) {
                        [30, 32, 50]
                    } else {
                        [150, 200, 250]
                    }
                } else {
                    [251, 247, 239]
                };
                rgb[(y * w + x) * 3..(y * w + x) * 3 + 3].copy_from_slice(&p);
            }
        }
        let img = Raster::new(w, h, rgb).unwrap();
        let t = trace(
            &img,
            &TraceOptions {
                x: 100.,
                y: 200.,
                scale: 2.,
                colors: 6,
                erase: vec![],
                band: 6.,
                opaque: false,
                seed: 1,
            },
        );
        assert!(!t.strokes.is_empty(), "outline and red line drawn");
        assert!(
            t.strokes.iter().any(|l| l.rgba[0] > 0.6 && l.rgba[1] < 0.3),
            "the red line keeps its colour"
        );
        assert!(
            !t.under.is_empty() && t.under.iter().all(|l| l.tool == 1),
            "the blue fill is highlighter"
        );
        let all = t.strokes.iter().chain(&t.under).flat_map(|l| &l.points);
        assert!(all.clone().all(|[x, y]| *x >= 95.
            && *x <= 100. + 2. * w as f64 + 5.
            && *y >= 195.
            && *y <= 200. + 2. * h as f64 + 5.));
        assert!(reachable([0.98, 0.9, 0.7]) && !reachable([0.1, 0.1, 0.5]));
        assert_eq!(img.median(20, 20, 3, 30), Some([30, 32, 50]));
        let s = simplify(&[[0., 0.], [1., 0.01], [2., 0.], [3., 5.]], 0.5);
        assert_eq!(s.len(), 3);
    }
}
