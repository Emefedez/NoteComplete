//! Single-line handwriting fonts (SVG fonts whose glyphs are pen paths, not
//! outlines) and the glyphs they lack: Greek letters and math signs drawn by
//! hand, accented letters composed from their base letter and a drawn accent,
//! and inverted ¿ ¡. Fonts are SIL OFL 1.1 (assets/fonts/OFL*.txt); the font
//! files and the extra glyphs come from noteful-mcp (MIT).
use std::{borrow::Cow, collections::HashMap, f64::consts::PI, sync::OnceLock};

pub type Pt = [f64; 2];

/// Paths in font units, y down (negative above the baseline).
#[derive(Clone, Debug)]
pub struct Glyph {
    pub adv: f64,
    pub paths: Vec<Vec<Pt>>,
}
pub struct Font {
    pub em: f64,
    pub xheight: f64,
    pub cap: f64,
    glyphs: HashMap<char, Glyph>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FontName {
    Patrick,
    Caveat,
    Readability,
    Felix,
    Allure,
    Elfin,
    Nixish,
}
pub const FONT_NAMES: [&str; 7] = [
    "patrick",
    "caveat",
    "readability",
    "felix",
    "allure",
    "elfin",
    "nixish",
];
impl FontName {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name.trim().to_ascii_lowercase().as_str() {
            "patrick" | "patrick hand" => Self::Patrick,
            "caveat" => Self::Caveat,
            "readability" => Self::Readability,
            "felix" => Self::Felix,
            "allure" => Self::Allure,
            "elfin" => Self::Elfin,
            "nixish" => Self::Nixish,
            // The block capitals font is not bundled; its titles use Patrick Hand.
            "block" => Self::Patrick,
            _ => return None,
        })
    }
    fn source(self) -> &'static str {
        match self {
            Self::Patrick => include_str!("../../assets/fonts/PatrickHandLine.svg"),
            Self::Caveat => include_str!("../../assets/fonts/CaveatLine.svg"),
            Self::Readability => include_str!("../../assets/fonts/EMSReadability.svg"),
            Self::Felix => include_str!("../../assets/fonts/EMSFelix.svg"),
            Self::Allure => include_str!("../../assets/fonts/EMSAllure.svg"),
            Self::Elfin => include_str!("../../assets/fonts/EMSElfin.svg"),
            Self::Nixish => include_str!("../../assets/fonts/EMSNixish.svg"),
        }
    }
    fn index(self) -> usize {
        self as usize
    }
}

pub fn font(name: FontName) -> &'static Font {
    static FONTS: [OnceLock<Font>; 7] = [const { OnceLock::new() }; 7];
    FONTS[name.index()].get_or_init(|| Font::parse(name.source()))
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(at) = tag[from..].find(name) {
        let start = from + at;
        let before = tag[..start].chars().last();
        let rest = &tag[start + name.len()..];
        if before.is_some_and(char::is_whitespace) {
            if let Some(value) = rest.strip_prefix("=\"") {
                return value.find('"').map(|end| &value[..end]);
            }
        }
        from = start + name.len();
    }
    None
}
fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(end) = tail.find(';') else {
            out.push_str(tail);
            return out;
        };
        let entity = &tail[1..end];
        let ch = match entity {
            "quot" => Some('"'),
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "apos" => Some('\''),
            e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16)
                .ok()
                .and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}
fn number(s: &str) -> Option<f64> {
    s.trim().parse().ok()
}
/// `M x y L x y C x1 y1 x2 y2 x y` (absolute) into polylines, y flipped down.
pub(crate) fn parse_path(d: &str) -> Vec<Vec<Pt>> {
    let mut paths = Vec::new();
    let mut cur: Vec<Pt> = Vec::new();
    let mut cmd = 'M';
    let mut nums: Vec<f64> = Vec::new();
    let flush = |cmd: char, nums: &mut Vec<f64>, cur: &mut Vec<Pt>, paths: &mut Vec<Vec<Pt>>| {
        match cmd {
            'M' => {
                for (i, p) in nums.as_chunks::<2>().0.iter().enumerate() {
                    if i == 0 {
                        if cur.len() > 1 {
                            paths.push(std::mem::take(cur));
                        }
                        cur.clear();
                    }
                    cur.push([p[0], -p[1]]);
                }
            }
            'L' => cur.extend(nums.as_chunks::<2>().0.iter().map(|p| [p[0], -p[1]])),
            'C' => {
                for c in nums.as_chunks::<6>().0 {
                    let p0 = cur.last().copied().unwrap_or([c[4], -c[5]]);
                    cur.extend(bezier(p0, [c[0], -c[1]], [c[2], -c[3]], [c[4], -c[5]], 8));
                }
            }
            _ => {}
        }
        nums.clear();
    };
    let mut token = String::new();
    for ch in d.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_alphabetic() && ch != 'e' && ch != 'E' {
            if let Some(n) = number(&token) {
                nums.push(n);
            }
            token.clear();
            flush(cmd, &mut nums, &mut cur, &mut paths);
            cmd = ch.to_ascii_uppercase();
        } else if ch.is_whitespace()
            || ch == ','
            || (ch == '-' && !token.is_empty() && !token.ends_with(['e', 'E']))
        {
            if let Some(n) = number(&token) {
                nums.push(n);
            }
            token.clear();
            if ch == '-' {
                token.push(ch);
            }
        } else {
            token.push(ch);
        }
    }
    flush(cmd, &mut nums, &mut cur, &mut paths);
    if !cur.is_empty() {
        paths.push(cur);
    }
    paths
}
pub(crate) fn bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: usize) -> Vec<Pt> {
    (1..=n)
        .map(|i| {
            let t = i as f64 / n as f64;
            let u = 1. - t;
            let (a, b, c, d) = (u * u * u, 3. * u * u * t, 3. * u * t * t, t * t * t);
            [
                a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
            ]
        })
        .collect()
}

impl Font {
    fn parse(source: &str) -> Self {
        let face = source
            .find("<font-face")
            .map(|at| &source[at..at + source[at..].find('>').unwrap_or(0)])
            .unwrap_or("");
        let em = attr(face, "units-per-em").and_then(number).unwrap_or(1000.);
        let declared_x = attr(face, "x-height").and_then(number).unwrap_or(em * 0.4);
        let default_adv = source
            .find("<font ")
            .and_then(|at| attr(&source[at..at + source[at..].find('>')?], "horiz-adv-x"))
            .and_then(number)
            .unwrap_or(em * 0.5);
        let mut glyphs = HashMap::new();
        let mut rest = source;
        while let Some(at) = rest.find("<glyph") {
            let tail = &rest[at..];
            let end = tail.find('>').unwrap_or(tail.len());
            let tag = &tail[..end];
            rest = &tail[end..];
            let Some(unicode) = attr(tag, "unicode").map(unescape) else {
                continue;
            };
            let mut chars = unicode.chars();
            let (Some(ch), None) = (chars.next(), chars.next()) else {
                continue;
            };
            let adv = attr(tag, "horiz-adv-x")
                .and_then(number)
                .unwrap_or(default_adv);
            let paths = attr(tag, "d").map(parse_path).unwrap_or_default();
            glyphs.insert(ch, Glyph { adv, paths });
        }
        // The declared x-height is often off; measure the real one from "x"
        // and the cap height from "H".
        let height = |c: char| {
            glyphs.get(&c).and_then(|g| {
                let ys: Vec<f64> = g.paths.iter().flatten().map(|p| p[1]).collect();
                let (lo, hi) = ys
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), y| {
                        (a.min(*y), b.max(*y))
                    });
                (hi > lo).then_some(hi - lo)
            })
        };
        let xheight = height('x').unwrap_or(declared_x);
        let cap = height('H').unwrap_or(xheight * 1.4);
        Self {
            em,
            xheight,
            cap,
            glyphs,
        }
    }
    /// The glyph for a character, drawing what the font lacks when it can.
    pub fn glyph(&self, ch: char) -> Option<Cow<'_, Glyph>> {
        let ch = match ch {
            '−' | '–' | '—' if !self.glyphs.contains_key(&ch) => '-',
            '’' | '‘' if !self.glyphs.contains_key(&ch) => '\'',
            '“' | '”' if !self.glyphs.contains_key(&ch) => '"',
            '…' if !self.glyphs.contains_key(&ch) => '.',
            c => c,
        };
        if let Some(g) = self.glyphs.get(&ch) {
            return Some(Cow::Borrowed(g));
        }
        if let Some((adv, strokes)) = super::glyphs::extra(ch) {
            let k = self.xheight;
            return Some(Cow::Owned(Glyph {
                adv: adv * k,
                paths: strokes
                    .into_iter()
                    .map(|s| s.into_iter().map(|[x, y]| [x * k, -y * k]).collect())
                    .collect(),
            }));
        }
        if let Some(g) = self.inverted(ch) {
            return Some(Cow::Owned(g));
        }
        let (base, accent) = super::glyphs::decompose(ch)?;
        // i and j lose their dot under an accent.
        let base = match base {
            'i' if self.glyphs.contains_key(&'ı') => 'ı',
            b => b,
        };
        let g = self.glyph(base)?.into_owned();
        Some(Cow::Owned(self.with_accent(g, accent, base.is_uppercase())))
    }
    fn inverted(&self, ch: char) -> Option<Glyph> {
        let source = match ch {
            '¿' => '?',
            '¡' => '!',
            _ => return None,
        };
        let g = self.glyphs.get(&source)?;
        let [x0, y0, x1, y1] = bbox(&g.paths)?;
        let (cx, cy) = ((x0 + x1) / 2., (y0 + y1) / 2.);
        // Turned over, hanging a little below the baseline.
        let drop = self.xheight * 0.3;
        Some(Glyph {
            adv: g.adv,
            paths: g
                .paths
                .iter()
                .map(|p| {
                    p.iter()
                        .map(|q| [2. * cx - q[0], 2. * cy - q[1] + drop])
                        .collect()
                })
                .collect(),
        })
    }
    fn with_accent(&self, mut g: Glyph, accent: super::glyphs::Accent, upper: bool) -> Glyph {
        let Some([x0, y0, x1, y1]) = bbox(&g.paths) else {
            return g;
        };
        let k = self.xheight;
        let cx = (x0 + x1) / 2.;
        let top = if upper {
            y0.min(-self.cap)
        } else {
            y0.min(-self.xheight)
        };
        for stroke in super::glyphs::accent_strokes(accent) {
            g.paths.push(
                stroke
                    .into_iter()
                    .map(|[x, y]| match accent {
                        // Marks below the letter hang from the baseline.
                        super::glyphs::Accent::Cedilla | super::glyphs::Accent::Ogonek => {
                            [cx + x * k, -y * k]
                        }
                        // A bar through the letter, across its box.
                        super::glyphs::Accent::Stroke => {
                            [x0 + (x1 - x0) * (x + 0.5), y1 + (y0 - y1) * (y + 0.5)]
                        }
                        _ => [cx + x * k, top - k * 0.28 - y * k],
                    })
                    .collect(),
            );
        }
        g
    }
}

pub(crate) fn bbox(paths: &[Vec<Pt>]) -> Option<[f64; 4]> {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in paths.iter().flatten() {
        b = [
            b[0].min(p[0]),
            b[1].min(p[1]),
            b[2].max(p[0]),
            b[3].max(p[1]),
        ];
    }
    b[0].is_finite().then_some(b)
}

/// Points on an ellipse from a0 to a1 (degrees, counter-clockwise, y up).
pub(crate) fn arc(cx: f64, cy: f64, rx: f64, ry: f64, a0: f64, a1: f64, n: usize) -> Vec<Pt> {
    (0..=n)
        .map(|i| {
            let a = (a0 + (a1 - a0) * i as f64 / n as f64) * PI / 180.;
            [cx + rx * a.cos(), cy + ry * a.sin()]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fonts_parse_and_draw_what_they_lack() {
        for name in FONT_NAMES {
            let f = font(FontName::parse(name).unwrap());
            assert!(f.xheight > 100. && f.cap > f.xheight, "{name}");
            for c in "aZ09?!éÉÑñ¿¡αΣ√≈→".chars().filter(|c| *c != '→') {
                assert!(
                    f.glyph(c).is_some_and(|g| !g.paths.is_empty()),
                    "{name} {c}"
                );
            }
        }
        let f = font(FontName::Patrick);
        let plain = f.glyph('I').unwrap().paths.len();
        assert_eq!(
            f.glyph('Í').unwrap().paths.len(),
            plain + 1,
            "an acute is one stroke"
        );
        let e = bbox(&f.glyph('É').unwrap().paths).unwrap();
        assert!(e[1] < -f.cap, "the accent sits above the capital");
        assert!(f.glyph('\u{e123}').is_none());
        assert_eq!(
            parse_path("M 1 2 L 3 -4 M 5 6 L 7 8"),
            vec![vec![[1., -2.], [3., 4.]], vec![[5., -6.], [7., -8.]]]
        );
    }
}
