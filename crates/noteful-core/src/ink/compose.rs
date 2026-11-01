//! Markdown into handwritten pages, in two looks. `classic` is a plain
//! notebook: headings, bullets, checkboxes, boxed notes, dividers. `study` is
//! a composed study sheet: titles with shadows, section accents, cards,
//! columns, colour zones, stickies, stats, tree maps and SVG drawings. See
//! `super::DIALECT` for the syntax. Ported from noteful-mcp's layout.py and
//! study.py (MIT).
use super::{
    font::{FontName, Pt},
    hand::{
        self, arrow, bullet, checkmark, color, highlight_color, highlight_line, rect, star,
        text_style, text_width, underline, wobble, wrap, write_line, Hand, Pen, Rgba, TextStyle,
    },
    paper::{Paper, PaperKind, A4},
    svg::{self, rect_pts, DrawOptions},
    InkPage,
};
use crate::Line;
use std::f64::consts::{PI, TAU};

const MARGIN_X: f64 = 95.;
const TOP: f64 = 120.;
const ACCENTS_PER_PAGE: usize = 3;

#[derive(Clone, Copy)]
struct Tone {
    ink: Rgba,
    pastel: Rgba,
}
fn tone(ink: &str, pastel: &str) -> Tone {
    Tone {
        ink: hand::hex(ink).unwrap(),
        pastel: highlight_color(pastel),
    }
}
const LIGHT: [(&str, &str); 6] = [
    ("#e9573f", "peach"),
    ("#f39a1e", "yellow"),
    ("#2f7fd6", "blue"),
    ("#7a52c7", "lavender"),
    ("#2a9d8f", "mint"),
    ("#e0457b", "pink"),
];
const DARK: [(&str, &str); 6] = [
    ("#ff5fa2", "pink"),
    ("#ffe066", "yellow"),
    ("#5ec8ff", "blue"),
    ("#8ef06b", "mint"),
    ("#ffa24c", "peach"),
    ("#c38bff", "lavender"),
];
/// Palette slot of an accent name (coral, amber, sky, purple, teal, pink and synonyms).
pub fn accent_index(name: &str) -> Option<usize> {
    Some(match name.trim().to_ascii_lowercase().as_str() {
        "coral" | "red" | "orange" | "peach" => 0,
        "amber" | "yellow" => 1,
        "sky" | "blue" => 2,
        "purple" | "lavender" => 3,
        "teal" | "mint" | "green" => 4,
        "pink" => 5,
        _ => return None,
    })
}
fn neon(name: &str) -> Rgba {
    let hex = match name.trim().to_ascii_lowercase().as_str() {
        "pink" | "coral" => "#ff5fa2",
        "mint" | "green" | "teal" => "#8ef06b",
        "lavender" | "purple" => "#c38bff",
        "peach" | "orange" => "#ffa24c",
        "blue" | "sky" => "#5ec8ff",
        _ => "#ffe066",
    };
    hand::hex(hex).unwrap()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Bold,
    Highlight,
    Pill,
    Grey,
    Link,
}
#[derive(Clone, Debug, PartialEq)]
struct Span {
    start: usize,
    end: usize,
    kind: Kind,
    color: Option<String>,
    /// For links (`[label](url)`): where the written label goes.
    link: Option<String>,
}

fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}
fn find_from(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(hay.len()));
    }
    (from..=hay.len().saturating_sub(needle.len())).find(|&i| hay[i..i + needle.len()] == *needle)
}
fn starts(hay: &[char], at: usize, s: &str) -> bool {
    let n: Vec<char> = s.chars().collect();
    hay.len() >= at + n.len() && hay[at..at + n.len()] == n[..]
}
/// `**bold**`, `==highlight==` (`=={pink}..==`, `{hl:pink}==..==`), `[[pill]]`,
/// `((grey))` and `[label](url)` links: plain text and the spans they mark, in characters.
fn parse_inline(text: &str) -> (String, Vec<Span>) {
    let t = chars(text);
    let mut out: Vec<char> = Vec::new();
    let mut spans = Vec::new();
    let mut i = 0;
    let closing =
        |from: usize, close: &str| find_from(&t, &chars(close), from).filter(|&e| e > from);
    while i < t.len() {
        let mut matched = None;
        if starts(&t, i, "**") {
            if let Some(e) = closing(i + 2, "**") {
                matched = Some((i + 2, e, e + 2, Kind::Bold, None));
            }
        }
        if matched.is_none() && (starts(&t, i, "==") || starts(&t, i, "{hl:")) {
            let mut j = i;
            let mut col = None;
            if starts(&t, j, "{hl:") {
                if let Some(e) = find_from(&t, &['}'], j) {
                    col = Some(t[j + 4..e].iter().collect::<String>());
                    j = e + 1;
                }
            }
            if starts(&t, j, "==") {
                j += 2;
                if starts(&t, j, "{") {
                    if let Some(e) = find_from(&t, &['}'], j) {
                        col = col.or(Some(t[j + 1..e].iter().collect()));
                        j = e + 1;
                    }
                }
                if let Some(e) = closing(j, "==") {
                    matched = Some((j, e, e + 2, Kind::Highlight, col));
                }
            }
        }
        if matched.is_none() && starts(&t, i, "[[") {
            if let Some(e) = closing(i + 2, "]]") {
                matched = Some((i + 2, e, e + 2, Kind::Pill, None));
            }
        }
        if matched.is_none() && starts(&t, i, "((") {
            if let Some(e) = closing(i + 2, "))") {
                matched = Some((i + 2, e, e + 2, Kind::Grey, None));
            }
        }
        // [label](https://…): the label is written, the address kept with its words.
        if matched.is_none() && t[i] == '[' && !starts(&t, i, "[[") {
            if let Some(e) = closing(i + 1, "](") {
                if let Some(z) = find_from(&t, &[')'], e + 2) {
                    let url: String = t[e + 2..z].iter().collect();
                    if crate::pages::link_valid(&url) {
                        matched = Some((i + 1, e, z + 1, Kind::Link, Some(url)));
                    }
                }
            }
        }
        match matched {
            Some((a, z, next, kind, col)) => {
                let start = out.len();
                out.extend(&t[a..z]);
                let (color, link) = if kind == Kind::Link {
                    (None, col)
                } else {
                    (col, None)
                };
                spans.push(Span {
                    start,
                    end: out.len(),
                    kind,
                    color: color.or_else(|| (kind == Kind::Highlight).then(|| "yellow".into())),
                    link,
                });
                i = next;
            }
            None => {
                out.push(t[i]);
                i += 1;
            }
        }
    }
    (out.into_iter().collect(), spans)
}

fn doodle(name: &str, cx: f64, cy: f64, s: f64) -> (Vec<Vec<Pt>>, Vec<Vec<Pt>>) {
    let circle = |cx: f64, cy: f64, r: f64, n: usize| -> Vec<Pt> {
        (0..=n)
            .map(|i| {
                let a = TAU * i as f64 / n as f64;
                [cx + r * a.cos(), cy + r * a.sin()]
            })
            .collect()
    };
    match name {
        "sun" => {
            let body = circle(cx, cy, s * 0.42, 40);
            let mut out = vec![body.clone()];
            for i in 0..8 {
                let a = TAU * i as f64 / 8.;
                out.push(vec![
                    [cx + s * 0.58 * a.cos(), cy + s * 0.58 * a.sin()],
                    [cx + s * 0.85 * a.cos(), cy + s * 0.85 * a.sin()],
                ]);
            }
            (out, vec![body])
        }
        "heart" => {
            let h: Vec<Pt> = (0..=40)
                .map(|i| {
                    let t = TAU * i as f64 / 40.;
                    let x = 16. * t.sin().powi(3);
                    let y =
                        13. * t.cos() - 5. * (2. * t).cos() - 2. * (3. * t).cos() - (4. * t).cos();
                    [cx + x * s * 1.6 / 32., cy - y * s * 1.6 / 32.]
                })
                .collect();
            (vec![h.clone()], vec![h])
        }
        "star" => {
            let p: Vec<Pt> = (0..11)
                .map(|i| {
                    let r = s * if i % 2 == 0 { 0.8 } else { 0.35 };
                    let a = -PI / 2. + i as f64 * PI / 5.;
                    [cx + r * a.cos(), cy + r * a.sin()]
                })
                .collect();
            (vec![p.clone()], vec![p])
        }
        "atom" => {
            let mut rings: Vec<Vec<Pt>> = (0..3)
                .map(|k| {
                    let a0 = k as f64 * PI / 3.;
                    (0..=40)
                        .map(|i| {
                            let t = TAU * i as f64 / 40.;
                            [
                                cx + s * 0.85 * t.cos() * a0.cos() - s * 0.3 * t.sin() * a0.sin(),
                                cy + s * 0.85 * t.cos() * a0.sin() + s * 0.3 * t.sin() * a0.cos(),
                            ]
                        })
                        .collect()
                })
                .collect();
            let core = circle(cx, cy, s * 0.14, 16);
            rings.push(core.clone());
            (rings, vec![core])
        }
        "drop" => {
            let mut p = vec![[cx, cy - s * 0.85]];
            p.extend((-30..=210).step_by(10).map(|d| {
                let a = (d as f64).to_radians();
                [cx + s * 0.45 * a.cos(), cy + s * 0.25 + s * 0.45 * a.sin()]
            }));
            p.push([cx, cy - s * 0.85]);
            (vec![p.clone()], vec![p])
        }
        "bolt" => {
            let p = vec![
                [cx + s * 0.15, cy - s * 0.85],
                [cx - s * 0.4, cy + s * 0.1],
                [cx, cy + s * 0.1],
                [cx - s * 0.2, cy + s * 0.85],
                [cx + s * 0.45, cy - s * 0.15],
                [cx + s * 0.05, cy - s * 0.15],
                [cx + s * 0.15, cy - s * 0.85],
            ];
            (vec![p.clone()], vec![p])
        }
        "cloud" => {
            let mut p = Vec::new();
            for (ccx, ccy, r, a0, a1) in [
                (-0.45, 0.15, 0.32, 90, 270),
                (-0.12, -0.15, 0.4, 160, 360),
                (0.38, 0.05, 0.36, 230, 450),
            ] {
                p.extend((a0..=a1).step_by(15).map(|a| {
                    let a = (a as f64).to_radians();
                    [cx + s * (ccx + r * a.cos()), cy + s * (ccy + r * a.sin())]
                }));
            }
            p.push([cx - s * 0.45, cy + s * 0.47]);
            (vec![p.clone()], vec![p])
        }
        "leaf" => {
            let side = |sign: f64, rev: bool| -> Vec<Pt> {
                let mut v: Vec<Pt> = (0..=20)
                    .map(|i| {
                        let t = i as f64 / 20.;
                        [
                            cx - s * 0.7 + s * 1.4 * t,
                            cy + s * 0.6 - s * 1.2 * t + sign * s * 0.45 * (PI * t).sin(),
                        ]
                    })
                    .collect();
                if rev {
                    v.reverse();
                }
                v
            };
            let mut outline = side(-1., false);
            outline.extend(side(1., true));
            (
                vec![
                    outline.clone(),
                    vec![
                        [cx - s * 0.75, cy + s * 0.65],
                        [cx + s * 0.5, cy - s * 0.45],
                    ],
                ],
                vec![outline],
            )
        }
        _ => (vec![], vec![]),
    }
}

/// Composer options; see `super::ComposeOptions` for the public form.
pub(crate) struct Setup {
    pub study: bool,
    pub dark: bool,
    pub paper: Paper,
    pub ink: Option<Rgba>,
    pub accent: String,
    pub font: FontName,
    pub size: f64,
    pub hand: Hand,
    pub fineliner: bool,
    pub seed: u64,
}

pub(crate) struct Composer {
    study: bool,
    dark: bool,
    paper: Paper,
    ink: Rgba,
    accent: Rgba,
    grey: Rgba,
    shadow: Rgba,
    palette: Vec<Tone>,
    font: FontName,
    size: f64,
    hand: Hand,
    fineliner: bool,
    pub pages: Vec<InkPage>,
    y: f64,
    x0: f64,
    x1: f64,
    last_baselines: Vec<f64>,
    pen: Pen,
    section: usize,
    region_top: f64,
    turkish: bool,
    pub warnings: Vec<String>,
}

impl Composer {
    pub fn new(s: Setup) -> Self {
        let (ink, grey, shadow, tones) = if s.dark {
            ("#f4f1ea", "#a3a3ad", "#3a3a40", DARK)
        } else {
            ("#1f2233", "#6b6f80", "#d9cfc0", LIGHT)
        };
        let mut palette: Vec<Tone> = tones.iter().map(|(i, p)| tone(i, p)).collect();
        if let Some(first) = accent_index(&s.accent).filter(|_| s.study) {
            palette.rotate_left(first);
        }
        let classic_ink = color("ink").unwrap();
        let ink = s.ink.unwrap_or(if s.study {
            hand::hex(ink).unwrap()
        } else {
            classic_ink
        });
        let accent = if s.study {
            palette[0].ink
        } else {
            color(&s.accent)
                .or_else(|| accent_index(&s.accent).map(|i| tone(LIGHT[i].0, LIGHT[i].1).ink))
                .unwrap_or_else(|| color("blue").unwrap())
        };
        let mut c = Self {
            study: s.study,
            dark: s.dark,
            paper: s.paper.with_dark(s.dark || s.paper.dark),
            ink,
            accent,
            grey: hand::hex(grey).unwrap(),
            shadow: hand::hex(shadow).unwrap(),
            palette,
            font: s.font,
            size: s.size,
            hand: s.hand,
            fineliner: s.fineliner,
            pages: Vec::new(),
            y: TOP,
            x0: MARGIN_X,
            x1: A4[0] - MARGIN_X,
            last_baselines: Vec::new(),
            pen: Pen::new(ink, s.seed),
            section: 0,
            region_top: -1.,
            turkish: false,
            warnings: Vec::new(),
        };
        c.new_page();
        c
    }
    /// Compose into a region of an existing page (write_on_page markdown items).
    pub fn at(mut self, x0: f64, x1: f64, y: f64) -> Self {
        self.x0 = x0;
        self.x1 = x1.max(x0 + 40.);
        self.y = y;
        self
    }

    // -- plumbing -----------------------------------------------------------
    /// The words of a line just written, for the page's text.
    fn words(&mut self, text: &str, x: f64, y: f64, style: &TextStyle) {
        let words = hand::word_boxes(text, x, y, style);
        self.page().words.extend(words);
    }
    fn page(&mut self) -> &mut InkPage {
        self.pages.last_mut().unwrap()
    }
    pub fn new_page(&mut self) {
        self.pages.push(InkPage {
            lines: vec![],
            under: vec![],
            paper: self.paper,
            words: vec![],
        });
        self.y = TOP;
        self.section = 0;
    }
    fn colour(&self) -> Rgba {
        self.palette[self.section % ACCENTS_PER_PAGE].ink
    }
    fn tone_of(&self, ink: Rgba) -> Tone {
        self.palette
            .iter()
            .copied()
            .find(|t| t.ink == ink)
            .unwrap_or(Tone {
                ink,
                pastel: highlight_color("yellow"),
            })
    }
    fn colour_named(&mut self, name: Option<&str>) -> Rgba {
        let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) else {
            return self.colour();
        };
        if let Some(i) = accent_index(name) {
            // Named accents keep their hue even when the palette was rotated.
            let tones = if self.dark { DARK } else { LIGHT };
            return hand::hex(tones[i].0).unwrap();
        }
        match hand::hex(name) {
            Some(c) => c,
            None => {
                self.warnings
                    .push(format!("Unknown colour '{name}'; used the section colour."));
                self.colour()
            }
        }
    }
    fn pastel(&self, ink: Rgba) -> Rgba {
        let tones = if self.dark { DARK } else { LIGHT };
        tones
            .iter()
            .find(|(h, _)| hand::hex(h) == Some(ink))
            .map(|(_, p)| highlight_color(p))
            .unwrap_or_else(|| self.tone_of(ink).pastel)
    }
    fn style(&self, scale: f64) -> TextStyle {
        text_style(self.font, self.size * scale, self.hand)
    }
    fn st(&self, scale: f64) -> TextStyle {
        text_style(self.font, self.size * 0.98 * scale, self.hand)
    }
    fn pen_for(&mut self, color: Option<Rgba>, width: Option<f64>) -> Pen {
        let mut p = Pen::new(color.unwrap_or(self.ink), self.pen.rng.seed());
        p.fineliner = self.fineliner;
        if self.fineliner {
            p.width = 1.0;
        }
        if let Some(w) = width {
            p.width = w;
        }
        p
    }
    fn baseline(&mut self, advance: f64) -> f64 {
        let mut b = self.y + advance * 0.62;
        if self.page_paper().kind == PaperKind::Ruled {
            let (r0, r) = (Paper::rule_y(0), Paper::rule_pitch());
            b = r0 + ((b - r0) / r).ceil() * r - 3.;
        }
        self.y = b + advance * 0.38;
        b
    }
    fn page_paper(&self) -> Paper {
        self.pages.last().map_or(self.paper, |p| p.paper)
    }
    fn bottom(&self) -> f64 {
        A4[1] - 90.
    }
    fn ensure(&mut self, h: f64) {
        if self.y + h > self.bottom() {
            self.new_page();
        }
    }
    fn add(&mut self, lines: Vec<Line>) {
        self.page().lines.extend(lines);
    }
    fn add1(&mut self, line: Line) {
        self.page().lines.push(line);
    }
    /// Highlighter goes first, under all ink of the page (later fills lower).
    fn add_under(&mut self, mut lines: Vec<Line>) {
        for l in &mut lines {
            l.under = true;
        }
        let page = self.page();
        page.under.splice(0..0, lines);
    }
    fn capture(&mut self, f: impl FnOnce(&mut Self)) -> (Vec<Line>, Vec<Line>) {
        let saved = (
            std::mem::take(&mut self.page().lines),
            std::mem::take(&mut self.page().under),
        );
        f(self);
        let page = self.page();
        (
            std::mem::replace(&mut page.lines, saved.0),
            std::mem::replace(&mut page.under, saved.1),
        )
    }
    fn place(&mut self, (mut lines, mut under): (Vec<Line>, Vec<Line>), rotate: f64, centre: Pt) {
        if rotate != 0. {
            let (c, s) = (rotate.cos(), rotate.sin());
            for l in lines.iter_mut().chain(under.iter_mut()) {
                for p in &mut l.points {
                    let (dx, dy) = (p[0] - centre[0], p[1] - centre[1]);
                    *p = [centre[0] + dx * c - dy * s, centre[1] + dx * s + dy * c];
                }
            }
        }
        self.add_under(under);
        self.add(lines);
    }
    fn fill(&mut self, polys: Vec<Vec<Pt>>, colour: Rgba, band: f64) {
        if self.dark {
            return; // pastel washes vanish on black; outlines carry the colour
        }
        let pastel = self.pastel(colour);
        let lines = svg::fill_shapes(&[(polys, pastel)], band, 0., &mut self.pen.rng);
        self.add_under(lines);
    }

    // -- text cases --------------------------------------------------------
    fn upper(&self, text: &str) -> String {
        let text = if self.turkish {
            text.replace('i', "İ").replace('ı', "I")
        } else {
            text.to_owned()
        };
        text.chars()
            .flat_map(|c| {
                let mut u = c.to_uppercase();
                match (u.next(), u.next()) {
                    (Some(x), None) => vec![x],
                    _ => vec![c],
                }
            })
            .collect()
    }
    /// Capitals for headings; Greek, units and formulas (digits, scripts,
    /// inner capitals like mV or pH, single small letters) and `backticks`
    /// keep their case.
    fn caps(&self, text: &str) -> String {
        let mut out = String::new();
        let t = chars(text);
        let mut i = 0;
        while i < t.len() {
            if t[i] == '`' {
                if let Some(e) = find_from(&t, &['`'], i + 1) {
                    out.extend(&t[i + 1..e]);
                    i = e + 1;
                    continue;
                }
            }
            let ws = t[i].is_whitespace();
            let start = i;
            while i < t.len() && t[i].is_whitespace() == ws && !(t[i] == '`' && !ws) {
                i += 1;
            }
            if i == start {
                out.push(t[i]);
                i += 1;
                continue;
            }
            let tok: String = t[start..i].iter().collect();
            if ws {
                out.push_str(&tok);
                continue;
            }
            let word = tok.trim_matches(|c| ".,;:!?()[]".contains(c));
            let wc = chars(word);
            let keep = tok.chars().any(|c| {
                c.is_ascii_digit()
                    || c == '^'
                    || c == '_'
                    || ('\u{370}'..='\u{3ff}').contains(&c)
                    || c == 'µ'
            }) || wc
                .windows(2)
                .any(|w| w[0].is_alphanumeric() && w[1].is_ascii_uppercase())
                || (wc.len() == 1 && wc[0].is_lowercase());
            out.push_str(&if keep { tok } else { self.upper(&tok) });
        }
        out
    }
    fn body_text(&self, text: &str) -> String {
        text.replace('`', "")
    }

    // -- classic blocks ---------------------------------------------------------
    fn highlight_spans(
        &mut self,
        line: &str,
        offset: usize,
        spans: &[Span],
        x: f64,
        b: f64,
        st: &TextStyle,
    ) {
        let lc = chars(line);
        for sp in spans.iter().filter(|s| s.kind == Kind::Highlight) {
            let (a, z) = (sp.start.max(offset), sp.end.min(offset + lc.len()));
            if a >= z {
                continue;
            }
            let pre: String = lc[..a - offset].iter().collect();
            let upto: String = lc[..z - offset].iter().collect();
            let xa = x + text_width(&pre, st) - st.size * 0.3;
            let xb = x + text_width(upto.trim_end(), st) + st.size * 0.3;
            let yc = b - st.size * 0.55;
            let col = highlight_color(sp.color.as_deref().unwrap_or("yellow"));
            let dy = self.pen.rng.uniform(-1., 1.);
            let l = highlight_line(
                [xa, yc],
                [xb, yc + dy],
                st.size * 2.3,
                col,
                &mut self.pen.rng,
            );
            self.add_under(vec![l]);
        }
    }
    fn heading(&mut self, text: &str, level: usize, colour: Option<Rgba>) {
        let scale = [2.0, 1.45, 1.2][level.clamp(1, 3) - 1];
        let st = self.style(scale);
        self.ensure(st.size * 4.);
        let b = self.baseline(st.size * if level == 1 { 2.6 } else { 2.4 });
        let c = colour.unwrap_or(if level == 1 { self.ink } else { self.accent });
        let mut pen = self.pen_for(Some(c), Some(if level == 1 { 1.55 } else { 1.4 }));
        let (plain, spans) = parse_inline(text);
        self.highlight_spans(&plain, 0, &spans, self.x0, b, &st);
        let (s, x_end) = write_line(&mut pen, &plain, self.x0, b, &st);
        self.words(&plain, self.x0, b, &st);
        self.add(s);
        if level <= 2 {
            let mut p = self.pen_for(Some(colour.unwrap_or(self.accent)), None);
            let u = underline(
                &mut p,
                self.x0,
                x_end.min(self.x1),
                b + st.size * 0.55,
                level == 1,
            );
            self.add(u);
        }
        self.y += st.size * 0.3;
    }
    fn paragraph(&mut self, text: &str, colour: Option<Rgba>, indent: f64) {
        let st = self.style(1.);
        let (plain, spans) = parse_inline(text);
        let pc = chars(&plain);
        self.last_baselines.clear();
        let mut pos = 0;
        for line in wrap(&plain, self.x1 - self.x0 - indent, &st) {
            self.ensure(st.size * st.line_height);
            let b = self.baseline(st.size * st.line_height);
            self.last_baselines.push(b);
            if !line.is_empty() {
                pos = find_from(&pc, &chars(&line), pos).unwrap_or(pos);
            }
            self.highlight_spans(&line, pos, &spans, self.x0 + indent, b, &st);
            pos += line.chars().count();
            let mut pen = self.pen_for(colour, None);
            let (s, _) = write_line(&mut pen, &line, self.x0 + indent, b, &st);
            self.words(&line, self.x0 + indent, b, &st);
            self.add(s);
        }
    }
    fn classic_bullet(&mut self, text: &str, colour: Option<Rgba>, mark: &str) {
        let st = self.style(1.);
        self.ensure(st.size * st.line_height);
        self.paragraph(text, colour, 32.);
        let y = self.last_baselines.first().copied().unwrap_or(self.y);
        let mut pen = self.pen_for(Some(self.accent), None);
        match mark {
            "todo" | "done" => {
                let b = st.size * 1.7;
                let r = rect(&mut pen, self.x0, y - b + 2., b, b, 0.);
                self.add(r);
                if mark == "done" {
                    let mut g = self.pen_for(color("green"), Some(1.6));
                    let c = checkmark(&mut g, self.x0 + 3., y - b * 0.45, b * 1.2);
                    self.add1(c);
                }
            }
            "arrow" => {
                let a = arrow(
                    &mut pen,
                    [self.x0, y - st.size * 0.45],
                    [self.x0 + 18., y - st.size * 0.45],
                    6.,
                );
                self.add(a);
            }
            _ => {
                let d = bullet(&mut pen, self.x0 + 8., y - st.size * 0.45, 3.2);
                self.add1(d);
            }
        }
    }
    fn callout(&mut self, text: &str, colour: Option<Rgba>) {
        let st = self.style(1.);
        let pad = 16.;
        let lines = wrap(
            &parse_inline(text).0,
            self.x1 - self.x0 - 2. * pad - 10.,
            &st,
        );
        let h = lines.len() as f64 * st.size * st.line_height + pad;
        self.ensure(h + 20.);
        let top = self.y + 6.;
        self.y = top + pad / 2.;
        let saved = (self.x0, self.x1);
        self.x0 += pad;
        self.x1 -= pad;
        self.paragraph(text, colour, 0.);
        (self.x0, self.x1) = saved;
        let mut pen = self.pen_for(Some(self.accent), None);
        let r = rect(
            &mut pen,
            self.x0,
            top,
            self.x1 - self.x0,
            self.y - top + pad / 2.,
            0.,
        );
        self.add(r);
        self.y += pad + 4.;
    }
    fn divider(&mut self) {
        self.ensure(30.);
        if self.study {
            self.y += 14.;
            let mut pen = self.pen_for(Some(self.grey), Some(0.9));
            let dy = self.pen.rng.uniform(0., 1.);
            let l = hand::line(
                &mut pen,
                [self.x0 - 10., self.y],
                [self.x1 + 10., self.y + dy],
                0.4,
            );
            self.add1(l);
            self.y += 18.;
        } else {
            self.y += 18.;
            let mut pen = self.pen_for(Some(self.accent), None);
            let dy = self.pen.rng.uniform(-3., 3.);
            let l = hand::line(
                &mut pen,
                [self.x0 + 40., self.y],
                [self.x1 - 40., self.y + dy],
                1.6,
            );
            self.add1(l);
            self.y += 18.;
        }
    }
    fn tape(&mut self, x: f64, y: f64, w: f64, h: f64, angle: f64, palette: &str) {
        let t = hand::tape(x, y, w, h, angle, hand::tape_color(palette));
        self.add1(t);
    }

    pub fn markdown(&mut self, text: &str) {
        if text.chars().any(|c| "ğışĞİŞ".contains(c)) {
            self.turkish = true;
        }
        let lines: Vec<&str> = text.lines().collect();
        if self.study {
            self.blocks(&lines);
        } else {
            self.classic(&lines);
        }
    }

    fn classic(&mut self, lines: &[&str]) {
        let mut pending_tape: Option<String> = None;
        for raw in lines {
            let mut line = raw.trim_end().to_owned();
            let mut colour = None;
            if let Some(rest) = line.strip_prefix("{color:") {
                if let Some((name, after)) = rest.split_once('}') {
                    colour = Some(color(name).unwrap_or_else(|| {
                        self.warnings.push(format!("Unknown colour '{name}'."));
                        self.ink
                    }));
                    line = after.trim_start().to_owned();
                }
            }
            if !line.trim().is_empty() {
                if let Some(p) = pending_tape.take() {
                    self.tape(self.x0 - 30., self.y + 2., 200., 36., -0.06, &p);
                }
            }
            let l = line.as_str();
            if l.trim().is_empty() {
                self.y += 14.;
            } else if l.trim() == "\\pagebreak" {
                self.new_page();
            } else if l.starts_with("!tape") {
                pending_tape = Some(l.split_whitespace().nth(1).unwrap_or("mint").to_owned());
            } else if l.trim() == "---" {
                self.divider();
            } else if let Some(t) = l.strip_prefix("### ") {
                self.heading(t, 3, colour);
            } else if let Some(t) = l.strip_prefix("## ") {
                self.heading(t, 2, colour);
            } else if let Some(t) = l.strip_prefix("# ") {
                self.heading(t, 1, colour);
            } else if l.len() > 4
                && (l.starts_with("[ ] ") || l.starts_with("[x] ") || l.starts_with("[X] "))
            {
                self.classic_bullet(
                    &l[4..],
                    colour,
                    if l.starts_with("[ ]") { "todo" } else { "done" },
                );
            } else if let Some(t) = l.strip_prefix("- ").or_else(|| l.strip_prefix("* ")) {
                self.classic_bullet(t, colour, "dot");
            } else if let Some(t) = l.strip_prefix("-> ") {
                self.classic_bullet(t, colour, "arrow");
            } else if let Some(t) = l.strip_prefix("> ") {
                self.callout(t, colour);
            } else {
                self.paragraph(l, colour, 0.);
            }
        }
    }

    // -- study: inline -------------------------------------------------------
    /// One line with its inline marks; returns the end x.
    #[allow(clippy::too_many_arguments)]
    fn rich_line(
        &mut self,
        line: &str,
        offset: usize,
        spans: &[Span],
        x: f64,
        b: f64,
        st: &TextStyle,
        colour: Option<Rgba>,
        width: Option<f64>,
    ) -> f64 {
        let lc = chars(line);
        let n = lc.len();
        let mut cuts = vec![0, n];
        for sp in spans {
            for v in [
                sp.start as isize - offset as isize,
                sp.end as isize - offset as isize,
            ] {
                if v > 0 && (v as usize) < n {
                    cuts.push(v as usize);
                }
            }
        }
        cuts.sort_unstable();
        cuts.dedup();
        let mut starts_at = std::collections::HashMap::new();
        let mut ends_at = std::collections::HashMap::new();
        let mut cx = x;
        let dark = self.dark;
        let dark_hl = |s: &Span| s.kind == Kind::Highlight && dark;
        for w in cuts.windows(2) {
            let (a, z) = (w[0], w[1]);
            let piece: String = lc[a..z].iter().collect();
            let kinds: Vec<&Span> = spans
                .iter()
                .filter(|s| {
                    s.start as isize - offset as isize <= a as isize
                        && z as isize <= s.end as isize - offset as isize
                })
                .collect();
            let mut col = colour.unwrap_or(self.ink);
            let mut wd = width;
            let mut pst = *st;
            if kinds.iter().any(|s| s.kind == Kind::Bold) {
                col = self.colour();
                wd = Some(width.unwrap_or(1.15) * 1.45);
            }
            if kinds.iter().any(|s| s.kind == Kind::Grey) {
                col = self.grey;
                pst = text_style(st.font, st.size * 0.88, self.hand);
            }
            for s in &kinds {
                if dark_hl(s) {
                    col = neon(s.color.as_deref().unwrap_or("yellow"));
                }
            }
            let link = kinds.iter().find_map(|s| s.link.clone());
            if link.is_some() {
                col = self.colour();
            }
            let mut pen = self.pen_for(Some(col), wd);
            let lead = piece.chars().take_while(|c| c.is_whitespace()).count();
            let x_start = cx + text_width(&piece.chars().take(lead).collect::<String>(), &pst);
            let (s, end) = write_line(&mut pen, &piece, cx, b, &pst);
            let first_word = self.page().words.len();
            self.words(&piece, cx, b, &pst);
            self.add(s);
            // A link: its words carry the address, and it is underlined like a link.
            if let Some(link) = link {
                for w in &mut self.page().words[first_word..] {
                    w.link = Some(link.clone());
                }
                let trail = piece
                    .chars()
                    .rev()
                    .take_while(|c| c.is_whitespace())
                    .count();
                let x_end = end - text_width(&" ".repeat(trail), &pst);
                let mut under = self.pen_for(Some(col), Some(0.9));
                let u = underline(&mut under, x_start, x_end, b + pst.size * 0.35, false);
                self.add(u);
            }
            cx = end;
            let trail = piece
                .chars()
                .rev()
                .take_while(|c| c.is_whitespace())
                .count();
            starts_at.insert(a, x_start);
            ends_at.insert(
                z,
                if trail > 0 {
                    cx - text_width(&" ".repeat(trail), &pst)
                } else {
                    cx
                },
            );
        }
        for sp in spans {
            let a = (sp.start as isize - offset as isize).max(0) as usize;
            let z = ((sp.end as isize - offset as isize).max(0) as usize).min(n);
            if a >= z || matches!(sp.kind, Kind::Bold | Kind::Grey | Kind::Link) || dark_hl(sp) {
                continue;
            }
            let (xa, xb) = (
                *starts_at.get(&a).unwrap_or(&x),
                *ends_at.get(&z).unwrap_or(&cx),
            );
            if sp.kind == Kind::Highlight {
                let yc = b - st.size * 0.55;
                let col = highlight_color(sp.color.as_deref().unwrap_or("yellow"));
                let dy = self.pen.rng.uniform(-1., 1.);
                let l = highlight_line(
                    [xa - 3., yc],
                    [xb + 3., yc + dy],
                    st.size * 2.2,
                    col,
                    &mut self.pen.rng,
                );
                self.add_under(vec![l]);
            } else {
                let h = st.size * 2.3;
                let y0 = b - st.size * 1.65;
                let c = self.colour();
                self.fill(
                    vec![rect_pts(xa - 7., y0, xb - xa + 14., h, h / 2., 0.)],
                    c,
                    4.,
                );
                let mut pen = self.pen_for(Some(c), Some(1.));
                let r = rect(&mut pen, xa - 7., y0, xb - xa + 14., h, h / 2. - 1.);
                self.add(r);
            }
        }
        cx
    }
    #[allow(clippy::too_many_arguments)]
    fn rich_paragraph(
        &mut self,
        text: &str,
        x0: f64,
        x1: f64,
        st: &TextStyle,
        colour: Option<Rgba>,
        width: Option<f64>,
    ) {
        let (plain, spans) = parse_inline(text);
        let plain = self.body_text(&plain);
        let pc = chars(&plain);
        let mut pos = 0;
        for line in wrap(&plain, x1 - x0, st) {
            self.ensure(st.size * st.line_height);
            let b = self.baseline(st.size * st.line_height);
            self.last_baselines.push(b);
            if !line.is_empty() {
                pos = find_from(&pc, &chars(&line), pos).unwrap_or(pos);
            }
            self.rich_line(&line, pos, &spans, x0, b, st, colour, width);
            pos += line.chars().count();
        }
    }

    // -- study: titles -------------------------------------------------------
    fn title(&mut self, text: &str) {
        let mut text = text.trim_end().to_owned();
        let mut icon = None;
        if text.ends_with(':') {
            if let Some(open) = text[..text.len() - 1].rfind(':') {
                let name = &text[open + 1..text.len() - 1];
                if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    icon = Some(name.to_owned());
                    text = text[..open].trim_end().to_owned();
                }
            }
        }
        if text.contains('|') && !text.contains("**") {
            let (a, z) = text.split_once('|').unwrap();
            text = format!("**{}**{}", a.trim(), z.trim());
        }
        let parts: Vec<&str> = text.split("//").map(str::trim).collect();
        let accent = self.palette[0].ink;
        if parts.len() > 1 {
            self.title_two_lines(parts[0], parts[1], accent, icon.as_deref());
        } else {
            self.title_banner(parts[0], accent, icon.as_deref());
        }
    }
    fn title_parts(&self, text: &str) -> (String, Vec<Span>) {
        let (plain, spans) = parse_inline(text);
        (self.caps(&plain), spans)
    }
    fn title_banner(&mut self, text: &str, accent: Rgba, icon: Option<&str>) {
        let (plain, spans) = self.title_parts(text);
        let mut st = text_style(self.font, self.size * 3.1, Hand::Neat);
        while text_width(&plain, &st) > (self.x1 - self.x0) - 170. && st.size > self.size * 1.6 {
            st.size *= 0.92;
        }
        let w = text_width(&plain, &st);
        self.ensure(st.size * 4.);
        let b = self.baseline(st.size * 2.7);
        let x = (self.x0 + self.x1 - w) / 2.;
        let thick = (st.size * 0.15).max(4.2);
        self.section = 0;
        let shadow = self.shadow;
        self.rich_line(
            &plain,
            0,
            &[],
            x + thick * 0.8,
            b + thick * 0.8,
            &st,
            Some(shadow),
            Some(thick),
        );
        let xe = self.rich_line(&plain, 0, &spans, x, b, &st, None, Some(thick));
        let mid = b - st.size * 0.7;
        if let Some(icon) = icon {
            for side in [-1., 1.] {
                let cx = if side < 0. { x - 46. } else { xe + 46. };
                self.doodle(icon, cx, mid, st.size, accent);
            }
        } else {
            for (x0, x1) in [(x - 70., x - 22.), (xe + 22., xe + 70.)] {
                for (k, dy) in [-st.size * 0.55, 0., st.size * 0.55]
                    .into_iter()
                    .enumerate()
                {
                    let c = if k == 1 { accent } else { self.ink };
                    let mut pen = self.pen_for(Some(c), Some(thick * 0.8));
                    let j = self.pen.rng.uniform(-1., 1.);
                    let l = hand::line(&mut pen, [x0, mid + dy], [x1, mid + dy + j], 0.4);
                    self.add1(l);
                }
            }
        }
        self.y += st.size * 0.6;
    }
    fn title_two_lines(&mut self, top: &str, big: &str, accent: Rgba, icon: Option<&str>) {
        let (t_plain, t_spans) = self.title_parts(top);
        let (b_plain, b_spans) = self.title_parts(big);
        let tst = text_style(self.font, self.size * 2.0, Hand::Neat);
        let mut bst = text_style(self.font, self.size * 3.6, Hand::Neat);
        while text_width(&b_plain, &bst) > self.x1 - self.x0 - 20. && bst.size > self.size * 2. {
            bst.size *= 0.92;
        }
        self.ensure(tst.size * 3. + bst.size * 3.);
        let b1 = self.baseline(tst.size * 2.6);
        self.section = 0;
        let x0 = self.x0;
        let xe = self.rich_line(&t_plain, 0, &t_spans, x0, b1, &tst, None, Some(3.2));
        if let Some(icon) = icon {
            let c = self.palette[1].ink;
            self.doodle(
                icon,
                xe + tst.size * 2.2,
                b1 - tst.size * 0.7,
                tst.size * 1.6,
                c,
            );
        }
        let b2 = self.baseline(bst.size * 2.4);
        let mut xe2 = 0.;
        let cap = self.capture(|c| {
            xe2 = c.rich_line(
                &b_plain,
                0,
                &b_spans,
                x0,
                b2,
                &bst,
                None,
                Some((bst.size * 0.15).max(4.6)),
            );
        });
        if !self.dark {
            let yc = b2 - bst.size * 0.25;
            let pastel = self.pastel(accent);
            let band = highlight_line(
                [x0 - 10., yc],
                [xe2 + 10., yc + 1.5],
                bst.size * 0.9,
                pastel,
                &mut self.pen.rng,
            );
            self.add_under(vec![band]);
        }
        self.place(cap, 0., [0., 0.]);
        self.y += bst.size * 0.4;
    }
    fn subtitle(&mut self, text: &str) {
        let st = self.st(1.05);
        let b = self.baseline(st.size * 2.4);
        let (plain, spans) = parse_inline(text);
        let c = self.palette[2].ink;
        let x0 = self.x0;
        self.rich_line(&plain, 0, &spans, x0, b, &st, Some(c), Some(1.1));
        let y = b + st.size * 1.4;
        let mut pen = self.pen_for(Some(self.grey), Some(0.9));
        let l = hand::line(&mut pen, [self.x0 - 10., y], [self.x1 + 10., y + 1.], 0.4);
        self.add1(l);
        self.y = y + st.size * 0.8;
    }
    fn doodle(&mut self, name: &str, cx: f64, cy: f64, size: f64, colour: Rgba) {
        let (outlines, fills) = doodle(name, cx, cy, size / 2.);
        if outlines.is_empty() {
            self.warnings.push(format!(
                "Unknown doodle ':{name}:'; use heart, sun, star, atom, drop, bolt, cloud or leaf."
            ));
            return;
        }
        if !fills.is_empty() {
            self.fill(fills, colour, 2.4);
        }
        let mut pen = self.pen_for(Some(colour), Some(1.6));
        for pts in outlines {
            let w = wobble(&mut pen, &pts, 0.3);
            let s = pen.stroke(&w, 1.5, 0, 0.15);
            self.add1(s);
        }
    }

    // -- study: headings and body ---------------------------------------------
    fn section_heading(&mut self, text: &str, level: usize) {
        if level == 2 {
            self.section += 1;
        }
        let st = self.st(if level == 2 { 1.45 } else { 1.12 });
        if (self.y - self.region_top).abs() > 1. {
            self.y += if level == 2 { 16. } else { 10. };
        }
        self.ensure(st.size * 4.);
        let (plain, spans) = parse_inline(text);
        let plain = self.caps(&plain);
        let pc = chars(&plain);
        let two_tone = spans.iter().any(|s| s.kind == Kind::Bold);
        let pen_w = if level == 2 { 2.4 } else { 1.8 };
        let colour = if two_tone { self.ink } else { self.colour() };
        let mut pos = 0;
        let (mut xe, mut b) = (self.x0, self.y);
        for (k, line) in wrap(&plain, self.x1 - self.x0, &st).into_iter().enumerate() {
            let adv = if k == 0 {
                st.size * if level == 2 { 2.9 } else { 2.4 }
            } else {
                st.size * 2.1
            };
            b = self.baseline(adv);
            if !line.is_empty() {
                pos = find_from(&pc, &chars(&line), pos).unwrap_or(pos);
            }
            let x0 = self.x0;
            xe = self.rich_line(&line, pos, &spans, x0, b, &st, Some(colour), Some(pen_w));
            pos += line.chars().count();
        }
        if level == 2 && xe < self.x1 - 30. {
            let y = b - st.size * 0.45;
            let c = self.colour();
            let mut pen = self.pen_for(Some(c), Some(1.3));
            let j = self.pen.rng.uniform(-1., 1.);
            let l = hand::line(&mut pen, [xe + 14., y], [self.x1, y + j], 0.5);
            self.add1(l);
        }
        self.y += st.size * 0.15;
    }
    fn body(&mut self, text: &str) {
        self.last_baselines.clear();
        let st = self.st(1.);
        let (x0, x1) = (self.x0, self.x1);
        self.rich_paragraph(text, x0, x1, &st, None, Some(1.15));
    }
    fn item(&mut self, text: &str, mark: &str) {
        let st = self.st(1.);
        self.last_baselines.clear();
        let indent = if matches!(mark, "star" | "dot" | "hook") {
            26.
        } else {
            34.
        };
        let (x0, x1) = (self.x0, self.x1);
        self.rich_paragraph(text, x0 + indent, x1, &st, None, Some(1.15));
        let b = self.last_baselines.first().copied().unwrap_or(self.y);
        let y = b - st.size * 0.5;
        let c = self.colour();
        let mut pen = self.pen_for(Some(c), Some(1.4));
        match mark {
            "star" => {
                let s = star(&mut pen, self.x0 + 9., y, st.size * 0.7);
                self.add1(s);
            }
            "dot" => {
                let s = bullet(&mut pen, self.x0 + 9., y, 2.4);
                self.add1(s);
            }
            "hook" => {
                let l = hand::line(
                    &mut pen,
                    [self.x0 + 3., y - st.size * 0.9],
                    [self.x0 + 3., y],
                    0.3,
                );
                self.add1(l);
                let a = arrow_open(&mut pen, [self.x0 + 3., y], [self.x0 + 19., y], 6.);
                self.add(a);
            }
            number => {
                let r = st.size * 0.95;
                let cx = self.x0 + r + 2.;
                let ring: Vec<Pt> = (0..=30)
                    .map(|i| {
                        let a = TAU * i as f64 / 30.;
                        [cx + r * a.cos(), y + r * a.sin()]
                    })
                    .collect();
                let mut pts = ring[..ring.len() - 2].to_vec();
                pts.push(ring[2]);
                let w = wobble(&mut pen, &pts, 0.3);
                let s = pen.stroke(&w, 1.2, 0, 0.15);
                self.add1(s);
                let small = self.st(0.8);
                let (s, _) = write_line(
                    &mut pen,
                    number,
                    cx - text_width(number, &small) / 2.,
                    y + st.size * 0.45,
                    &small,
                );
                self.add(s);
            }
        }
    }
    fn stat(&mut self, text: &str) {
        let text = text.trim();
        let (num, rest) = text.split_once(' ').unwrap_or((text, ""));
        let big = self.st(1.7);
        let st = self.st(1.);
        self.ensure(big.size * 3.);
        let b = self.baseline(big.size * 2.5);
        let c = self.colour();
        let mut pen = self.pen_for(Some(c), Some(2.6));
        let (s, xe) = write_line(&mut pen, num, self.x0, b, &big);
        self.words(num, self.x0, b, &big);
        self.add(s);
        let (plain, spans) = parse_inline(rest);
        let plain = self.body_text(&plain);
        let pc = chars(&plain);
        let tx = (xe + 26.).max(self.x0 + big.size * 5.2);
        let (mut y, mut pos) = (b, 0);
        for (k, line) in wrap(&plain, self.x1 - tx, &st).into_iter().enumerate() {
            if k > 0 {
                y += st.size * st.line_height;
            }
            if !line.is_empty() {
                pos = find_from(&pc, &chars(&line), pos).unwrap_or(pos);
            }
            self.rich_line(&line, pos, &spans, tx, y, &st, None, Some(1.15));
            pos += line.chars().count();
        }
        self.y = self.y.max(y + st.size * 0.6);
        self.section += 1;
    }

    // -- study: cards and regions ----------------------------------------------
    fn colour_prefix<'a>(&mut self, text: &'a str) -> (Option<Rgba>, &'a str) {
        let t = text.trim_start();
        if let Some(rest) = t.strip_prefix('[') {
            if let Some((name, after)) = rest.split_once(']') {
                if !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_alphanumeric() || c == '#' || c == ' ' || c == '_')
                {
                    return (Some(self.colour_named(Some(name))), after.trim_start());
                }
            }
        }
        (None, text)
    }
    fn titled(text: &str, max: usize) -> (String, String) {
        if let Some((title, body)) = text.split_once(": ") {
            let tl = title.trim();
            if !tl.is_empty()
                && tl.chars().count() <= max
                && !tl.contains("((")
                && !tl.contains(':')
            {
                return (tl.to_owned(), body.trim_start().to_owned());
            }
        }
        (String::new(), text.trim().to_owned())
    }
    #[allow(clippy::too_many_arguments)]
    fn card(
        &mut self,
        text: &str,
        x0: Option<f64>,
        x1: Option<f64>,
        height: Option<f64>,
        measure: bool,
        colour: Option<Rgba>,
    ) -> f64 {
        let x0 = x0.unwrap_or(self.x0);
        let x1 = x1.unwrap_or(self.x1);
        let (named, text) = self.colour_prefix(text);
        let colour = colour.or(named).unwrap_or_else(|| self.colour());
        let (title, body) = Self::titled(text, 48);
        let pad = 20.;
        let st = self.st(1.);
        let tst = self.st(1.2);
        let lines = wrap(
            &self.body_text(&parse_inline(&body).0),
            x1 - x0 - 2. * pad,
            &st,
        );
        let mut h = if title.is_empty() { 0. } else { tst.size * 2.7 }
            + lines.len() as f64 * st.size * st.line_height
            + pad * 1.5;
        h = h.max(height.unwrap_or(0.));
        if measure {
            return h;
        }
        let top = self.y + 4.;
        let inset = 3.;
        self.fill(
            vec![rect_pts(
                x0 + inset,
                top + inset,
                x1 - x0 - 2. * inset,
                h - 2. * inset,
                18.,
                0.,
            )],
            colour,
            11.,
        );
        let mut pen = self.pen_for(Some(colour), Some(1.3));
        let r = rect(&mut pen, x0, top, x1 - x0, h, 20.);
        self.add(r);
        let saved = (self.y, self.section);
        if let Some(i) = self.palette.iter().position(|t| t.ink == colour) {
            self.section = i;
        }
        self.y = top + pad * 0.45;
        if !title.is_empty() {
            let b = self.baseline(tst.size * 2.7);
            let (plain, spans) = parse_inline(&title);
            let plain = self.caps(&plain);
            self.rich_line(
                &plain,
                0,
                &spans,
                x0 + pad,
                b,
                &tst,
                Some(colour),
                Some(2.1),
            );
        }
        self.last_baselines.clear();
        self.rich_paragraph(&body, x0 + pad, x1 - pad, &st, None, Some(1.15));
        (self.y, self.section) = saved;
        h
    }
    fn cards(&mut self, text: &str) {
        let parts: Vec<String> = text.split("||").map(|p| p.trim().to_owned()).collect();
        let gap = 24.;
        let n = parts.len() as f64;
        let w = (self.x1 - self.x0 - gap * (n - 1.)) / n;
        let cols: Vec<(f64, f64)> = (0..parts.len())
            .map(|i| {
                (
                    self.x0 + i as f64 * (w + gap),
                    self.x0 + i as f64 * (w + gap) + w,
                )
            })
            .collect();
        let colours: Vec<Rgba> = parts
            .iter()
            .enumerate()
            .map(|(i, p)| match self.colour_prefix(p).0 {
                Some(c) => c,
                None => self.palette[(self.section + i) % ACCENTS_PER_PAGE].ink,
            })
            .collect();
        let h = parts
            .iter()
            .zip(&cols)
            .map(|(p, (a, z))| self.card(p, Some(*a), Some(*z), None, true, None))
            .fold(0., f64::max);
        self.ensure(h + 24.);
        for ((p, (a, z)), c) in parts.iter().zip(&cols).zip(colours) {
            self.card(p, Some(*a), Some(*z), Some(h), false, Some(c));
        }
        self.y += h + 26.;
    }
    fn single_card(&mut self, text: &str) {
        let h = self.card(text, None, None, None, true, None);
        self.ensure(h + 20.);
        self.card(text, None, None, None, false, None);
        self.y += h + 24.;
    }
    fn sticky(&mut self, text: &str) {
        let (named, text) = self.colour_prefix(text);
        let colour = named.unwrap_or(self.palette[1].ink);
        let (title, body) = Self::titled(text, 40);
        let (x0, x1) = (self.x0 + 8., (self.x1 - 8.).min(self.x0 + 420.));
        let pad = 22.;
        let st = self.st(1.02);
        let tst = self.st(1.2);
        let lines = wrap(
            &self.body_text(&parse_inline(&body).0),
            x1 - x0 - 2. * pad,
            &st,
        );
        let h = if title.is_empty() { 0. } else { tst.size * 2.7 }
            + lines.len() as f64 * st.size * st.line_height
            + pad * 2.;
        self.ensure(h + 40.);
        let top = self.y + 22.;
        let paper_colour = if colour == self.palette[1].ink {
            highlight_color("yellow")
        } else {
            self.pastel(colour)
        };
        let dark = self.dark;
        let title_colour = self.palette[0].ink;
        let cap = self.capture(|c| {
            if !dark {
                let f = svg::fill_shapes(
                    &[(vec![rect_pts(x0, top, x1 - x0, h, 3., 0.)], paper_colour)],
                    10.,
                    0.,
                    &mut c.pen.rng,
                );
                c.add_under(f);
            }
            let tape = rect_pts((x0 + x1) / 2. - 50., top - 12., 100., 24., 0., 0.);
            let f = svg::fill_shapes(
                &[(vec![tape], highlight_color("pink"))],
                4.,
                0.9,
                &mut c.pen.rng,
            );
            c.add_under(f);
            if dark {
                let mut pen = c.pen_for(Some(colour), Some(1.2));
                let r = rect(&mut pen, x0, top, x1 - x0, h, 3.);
                c.add(r);
            }
            let saved = c.y;
            c.y = top + pad * 0.6;
            if !title.is_empty() {
                let b = c.baseline(tst.size * 2.7);
                let t = c.caps(&title);
                c.rich_line(&t, 0, &[], x0 + pad, b, &tst, Some(title_colour), Some(2.0));
            }
            c.last_baselines.clear();
            c.rich_paragraph(&body, x0 + pad, x1 - pad, &st, None, Some(1.15));
            c.y = saved;
        });
        self.place(cap, (-2f64).to_radians(), [(x0 + x1) / 2., top + h / 2.]);
        self.y = top + h + 24.;
    }
    fn zone(&mut self, lines: &[&str], colour: Option<&str>) {
        let colour = match colour.filter(|c| !c.is_empty()) {
            Some(c) => self.colour_named(Some(c)),
            None => self.palette[2].ink,
        };
        self.y += 8.;
        let top = self.y + 10.;
        self.y = top;
        self.region_top = top;
        let first = self.pages.len() - 1;
        self.blocks(lines);
        let bottom = self.y + 14.;
        if !self.dark {
            let pastel = self.pastel(colour);
            let last = self.pages.len() - 1;
            // The band runs to the foot of each page the zone fills, then to its end.
            for page in first..=last {
                let y0 = if page == first { top - 18. } else { 42. };
                let y1 = if page == last { bottom } else { A4[1] - 40. };
                if y1 <= y0 {
                    continue;
                }
                let band = rect_pts(0., y0, A4[0], y1 - y0, 0., 0.);
                let mut f = svg::fill_shapes(&[(vec![band], pastel)], 12., 0., &mut self.pen.rng);
                for l in &mut f {
                    l.under = true;
                }
                self.pages[page].under.splice(0..0, f);
            }
        }
        self.y = bottom + 16.;
    }
    fn columns(&mut self, groups: &[Vec<&str>], ratio: f64) {
        let gap = 34.;
        let total = self.x1 - self.x0 - gap * (groups.len().max(1) - 1) as f64;
        let widths: Vec<f64> = if groups.len() == 2 {
            vec![total * ratio, total * (1. - ratio)]
        } else {
            vec![total / groups.len().max(1) as f64; groups.len()]
        };
        let start = self.y + 12.;
        let page = self.pages.len();
        let (x0, x1) = (self.x0, self.x1);
        let mut bottom = start;
        // Where columns that moved to a new page ended there.
        let mut later: Option<f64> = None;
        let mut cx = x0;
        for (g, w) in groups.iter().zip(widths) {
            let begin = if self.pages.len() == page { start } else { TOP };
            (self.x0, self.x1, self.y) = (cx, cx + w, begin);
            self.region_top = begin;
            self.blocks(g);
            if self.pages.len() == page {
                bottom = bottom.max(self.y);
            } else {
                later = Some(later.map_or(self.y, |b: f64| b.max(self.y)));
            }
            cx += w + gap;
        }
        (self.x0, self.x1) = (x0, x1);
        self.y = later.unwrap_or(bottom);
    }
    fn tree(&mut self, head: &str, branches: &[(String, Vec<(String, usize)>)]) {
        let (topic, question) = head.split_once('|').unwrap_or((head, ""));
        let tst = self.st(2.8);
        let qst = self.st(1.35);
        let bst = self.st(1.75);
        let lst = self.st(1.2);
        let n = branches.len().max(1) as f64;
        let colw = (self.x1 - self.x0) / n;
        if self.y > 200. {
            self.y += 26.;
        }
        let b = self.baseline(tst.size * 2.6);
        let text = topic.trim();
        let w = text_width(text, &tst);
        let cx = (self.x0 + self.x1) / 2.;
        let mut pen = self.pen_for(Some(self.ink), Some(3.));
        let (s, _) = write_line(&mut pen, text, cx - w / 2., b, &tst);
        self.words(text, cx - w / 2., b, &tst);
        self.add(s);
        let mut top = b + 14.;
        let q = question.trim();
        if !q.is_empty() {
            let qw = text_width(q, &qst);
            let qb = b + qst.size * 2.6;
            let mut pen = self.pen_for(Some(self.ink), Some(1.3));
            let (s, _) = write_line(&mut pen, q, cx - qw / 2., qb, &qst);
            self.words(q, cx - qw / 2., qb, &qst);
            self.add(s);
            let mut pen = self.pen_for(Some(self.ink), Some(1.));
            let l = hand::line(
                &mut pen,
                [cx - qw / 2., qb + 6.],
                [cx + qw / 2., qb + 7.],
                0.4,
            );
            self.add1(l);
            top = qb + 14.;
        }
        let by = top + 170.;
        let mut bottom = by;
        for (i, (name, leaves)) in branches.iter().enumerate() {
            let colour = self.palette[i % self.palette.len()].ink;
            let bx = self.x0 + colw * (i as f64 + 0.5);
            let label = self.caps(name);
            let mut lab = bst;
            // Long labels shrink to fit their column, down to a small x-height.
            while text_width(&label, &lab) > colw - 14. && lab.size > self.size * 0.8 {
                lab.size *= 0.92;
            }
            let lw = text_width(&label, &lab);
            let start = [cx + (bx - cx) * 0.25, top + 6.];
            let mut pen = self.pen_for(Some(self.ink), Some(1.6));
            let a = arrow_open(&mut pen, start, [bx, by - bst.size * 2.4], 18.);
            self.add(a);
            let mut pen = self.pen_for(Some(colour), Some(2.4));
            let (s, _) = write_line(&mut pen, &label, bx - lw / 2., by, &lab);
            self.words(&label, bx - lw / 2., by, &lab);
            self.add(s);
            let mut y = by + bst.size * 0.8;
            let lx = bx - (colw * 0.42).min((lw / 2.).max(60.));
            for (leaf, depth) in leaves {
                y += lst.size * lst.line_height;
                let x = lx + *depth as f64 * 22.;
                let mut pen = self.pen_for(Some(self.ink), Some(1.1));
                let l = hand::line(
                    &mut pen,
                    [x, y - lst.size * 1.3],
                    [x, y - lst.size * 0.45],
                    0.2,
                );
                self.add1(l);
                let a = arrow_open(
                    &mut pen,
                    [x, y - lst.size * 0.45],
                    [x + 13., y - lst.size * 0.45],
                    5.,
                );
                self.add(a);
                for ln in wrap(leaf, colw - (x - lx) - 30., &lst) {
                    let (s, _) = write_line(&mut pen, &ln, x + 18., y, &lst);
                    self.words(&ln, x + 18., y, &lst);
                    self.add(s);
                    y += lst.size * lst.line_height;
                }
                y -= lst.size * lst.line_height;
            }
            bottom = bottom.max(y);
        }
        self.y = bottom + 30.;
    }
    fn drawing(&mut self, svg_text: &str, width: Option<f64>) {
        let width = width
            .unwrap_or((self.x1 - self.x0) * 0.85)
            .min(self.x1 - self.x0);
        let opts = DrawOptions {
            label_font: self.font,
            caps: false,
            band: 5.,
            ink: self.ink,
            pastel: !self.dark,
        };
        let mut pen = self.pen_for(Some(self.ink), Some(1.3));
        match svg::drawing(svg_text, 0., 0., width, None, &mut pen, &opts) {
            Ok(mut d) => {
                let h = d.size[1];
                if self.y + h + 20. > self.bottom() && self.y > 200. {
                    self.new_page();
                }
                let (dx, dy) = ((self.x0 + self.x1 - d.size[0]) / 2., self.y + 10.);
                for l in d.strokes.iter_mut().chain(d.under.iter_mut()) {
                    for p in &mut l.points {
                        *p = [p[0] + dx, p[1] + dy];
                    }
                }
                self.warnings
                    .extend(d.warnings.into_iter().map(|w| format!("Drawing: {w}")));
                self.add_under(d.under);
                self.add(d.strokes);
                self.y += h + 24.;
            }
            Err(e) => self.warnings.push(format!("Drawing skipped: {e}")),
        }
    }

    // -- study: block parser -----------------------------------------------------
    fn until_end<'a>(lines: &[&'a str], mut i: usize) -> (Vec<&'a str>, usize) {
        let mut depth = 0;
        let mut out = Vec::new();
        while i < lines.len() {
            let s = lines[i].trim();
            if s.starts_with("!columns") || s.starts_with("!zone") || s.starts_with("!draw") {
                depth += 1;
            } else if s == "!end" {
                if depth == 0 {
                    return (out, i + 1);
                }
                depth -= 1;
            }
            out.push(lines[i]);
            i += 1;
        }
        (out, i)
    }
    fn blocks(&mut self, lines: &[&str]) {
        let mut i = 0;
        while i < lines.len() {
            let raw = lines[i].trim_end();
            let line = raw.trim();
            i += 1;
            if line.is_empty() {
                self.y += 10.;
            } else if line == "\\pagebreak" {
                self.new_page();
            } else if let Some(arg) = line.strip_prefix("!draw") {
                let (body, next) = Self::until_end(lines, i);
                i = next;
                let w = arg
                    .trim()
                    .trim_matches(['[', ']'])
                    .parse::<f64>()
                    .ok()
                    .filter(|w| *w > 20.);
                self.drawing(&body.join("\n"), w);
            } else if let Some(arg) = line.strip_prefix("!columns") {
                let (body, next) = Self::until_end(lines, i);
                i = next;
                let mut groups = vec![vec![]];
                let mut depth = 0;
                for ln in body {
                    let s = ln.trim();
                    if s.starts_with("!columns") || s.starts_with("!zone") || s.starts_with("!draw")
                    {
                        depth += 1;
                    } else if s == "!end" {
                        depth -= 1;
                    }
                    if s == "!col" && depth == 0 {
                        groups.push(vec![]);
                    } else {
                        groups.last_mut().unwrap().push(ln);
                    }
                }
                let ratio = arg
                    .trim()
                    .trim_matches(['[', ']'])
                    .parse::<f64>()
                    .map_or(0.5, |r| (r / 100.).clamp(0.15, 0.85));
                self.columns(&groups, ratio);
            } else if let Some(arg) = line.strip_prefix("!zone") {
                let name = arg.trim().trim_matches(['[', ']']).trim().to_owned();
                let (body, next) = Self::until_end(lines, i);
                i = next;
                self.zone(&body, Some(&name));
            } else if let Some(t) = line.strip_prefix("!sticky") {
                self.sticky(t);
            } else if let Some(t) = line.strip_prefix("!stat") {
                self.stat(t);
            } else if let Some(head) = line.strip_prefix("!map") {
                let mut branches: Vec<(String, Vec<(String, usize)>)> = Vec::new();
                while i < lines.len() {
                    let ln = lines[i];
                    let body = ln.trim_start();
                    let Some(item) = body.strip_prefix("- ").or_else(|| body.strip_prefix("* "))
                    else {
                        break;
                    };
                    let indent = ln.len() - body.len();
                    if indent == 0 || branches.is_empty() {
                        let (name, leaves) = if item.contains(':') && item.contains(';') {
                            let (n, l) = item.split_once(':').unwrap();
                            (n, l)
                        } else {
                            (item, "")
                        };
                        branches.push((
                            name.trim().to_owned(),
                            leaves
                                .split(';')
                                .map(str::trim)
                                .filter(|v| !v.is_empty())
                                .map(|v| (v.to_owned(), 0))
                                .collect(),
                        ));
                    } else {
                        branches
                            .last_mut()
                            .unwrap()
                            .1
                            .push((item.to_owned(), (indent / 2).saturating_sub(1)));
                    }
                    i += 1;
                }
                self.tree(head.trim(), &branches);
            } else if line.starts_with("!tape") {
                let palette = line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("mint")
                    .trim_matches(['[', ']'])
                    .to_owned();
                self.tape(self.x0 - 30., self.y + 2., 200., 36., -0.06, &palette);
            } else if line == "---" {
                self.divider();
            } else if let Some(t) = line.strip_prefix("### ") {
                self.section_heading(t, 3);
            } else if let Some(t) = line.strip_prefix("## ") {
                self.section_heading(t, 2);
            } else if let Some(t) = line.strip_prefix("# ") {
                self.title(t);
            } else if line.len() > 2
                && line.starts_with('_')
                && line.ends_with('_')
                && !line.starts_with("__")
            {
                self.subtitle(&line[1..line.len() - 1]);
            } else if let Some(t) = line.strip_prefix(">> ") {
                self.cards(t);
            } else if let Some(t) = line.strip_prefix("> ") {
                self.single_card(t);
            } else if let Some(t) = line.strip_prefix("-> ") {
                self.item(t, "hook");
            } else if let Some(t) = line.strip_prefix("* ") {
                self.item(t, "star");
            } else if let Some(t) = line.strip_prefix("- ") {
                self.item(t, "dot");
            } else if let Some((n, rest)) = numbered(line) {
                self.item(rest, n);
            } else if let Some(t) = line
                .strip_prefix("[ ] ")
                .or_else(|| line.strip_prefix("[x] "))
                .or_else(|| line.strip_prefix("[X] "))
            {
                let done = !line.starts_with("[ ]");
                self.item(t, if done { "✓" } else { "·" });
            } else if line.starts_with('!') && !line.starts_with("!=") {
                self.warnings.push(format!(
                    "Unknown directive '{}'; written as text.",
                    line.split_whitespace().next().unwrap_or(line)
                ));
                self.body(line);
            } else {
                self.body(line);
            }
        }
    }
}

/// `1. text` or `2) text` → ("1", "text").
fn numbered(line: &str) -> Option<(&str, &str)> {
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 || digits > 3 {
        return None;
    }
    let rest = &line[digits..];
    let rest = rest
        .strip_prefix(". ")
        .or_else(|| rest.strip_prefix(") "))?;
    Some((&line[..digits], rest))
}

/// An arrow with a hollow triangle head, as in hand-drawn tree diagrams.
fn arrow_open(pen: &mut Pen, a: Pt, b: Pt, head: f64) -> Vec<Line> {
    let ang = (b[1] - a[1]).atan2(b[0] - a[0]);
    let base = [b[0] - head * ang.cos(), b[1] - head * ang.sin()];
    let l = [
        base[0] + head * 0.55 * (ang + PI / 2.).cos(),
        base[1] + head * 0.55 * (ang + PI / 2.).sin(),
    ];
    let r = [
        base[0] + head * 0.55 * (ang - PI / 2.).cos(),
        base[1] + head * 0.55 * (ang - PI / 2.).sin(),
    ];
    let shaft = hand::line(pen, a, base, 1.6);
    let tri = wobble(pen, &[b, l, r, b, l], 0.4);
    vec![shaft, pen.stroke(&tri, 1.5, 0, 0.2)]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_are_written_as_their_label_and_kept_with_its_words() {
        let (plain, spans) = parse_inline(
            "see [the source](https://example.com/a) or [x](javascript:alert(1)) [[pill]]",
        );
        assert_eq!(plain, "see the source or [x](javascript:alert(1)) pill");
        assert_eq!(spans[0].kind, Kind::Link);
        assert_eq!(spans[0].link.as_deref(), Some("https://example.com/a"));
        assert_eq!((spans[0].start, spans[0].end), (4, 14));
        assert_eq!(spans[1].kind, Kind::Pill);
        // Written: the label's words carry the address; the others do not.
        let pages = crate::ink::compose(
            "- Code on [GitHub here](https://github.com/x/y) and [install](notecomplete:install)",
            &Default::default(),
        )
        .unwrap()
        .0;
        let words = &pages[0].words;
        let link = |t: &str| words.iter().find(|w| w.text == t).unwrap().link.clone();
        assert_eq!(link("GitHub").as_deref(), Some("https://github.com/x/y"));
        assert_eq!(link("here").as_deref(), Some("https://github.com/x/y"));
        assert_eq!(link("install").as_deref(), Some("notecomplete:install"));
        assert_eq!(link("Code"), None);
        assert!(crate::pages::words_valid(words));
    }
    #[test]
    fn inline_marks_and_caps() {
        let (plain, spans) = parse_inline("a **b** =={pink}c== [[d]] ((e)) {hl:mint}==f==");
        assert_eq!(plain, "a b c d e f");
        let kinds: Vec<_> = spans
            .iter()
            .map(|s| (s.start, s.end, s.kind, s.color.clone()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                (2, 3, Kind::Bold, None),
                (4, 5, Kind::Highlight, Some("pink".into())),
                (6, 7, Kind::Pill, None),
                (8, 9, Kind::Grey, None),
                (10, 11, Kind::Highlight, Some("mint".into())),
            ]
        );
        let c = Composer::new(Setup {
            study: true,
            dark: false,
            paper: Paper::DOT,
            ink: None,
            accent: "sky".into(),
            font: FontName::Patrick,
            size: 11.,
            hand: Hand::Neat,
            fineliner: true,
            seed: 1,
        });
        assert_eq!(
            c.caps("energy in mV and pH of T^4, `keep` x"),
            "ENERGY IN mV AND pH OF T^4, keep x"
        );
        assert_eq!(c.caps("biología celular"), "BIOLOGÍA CELULAR");
        assert_eq!(numbered("12. twelve"), Some(("12", "twelve")));
        assert_eq!(numbered("2020 was"), None);
    }
}
