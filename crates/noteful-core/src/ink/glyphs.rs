//! Hand-designed single-line glyphs for science notes (Greek letters and math
//! signs the fonts lack), accents for composed letters, and super/subscripts.
//! Coordinates are in x-heights: baseline y = 0, x-height y = 1, capitals
//! ~1.4, descenders ~-0.45, y up. Greek and math shapes are from noteful-mcp
//! (MIT).
use super::font::{arc, Pt};

/// The next character is raised (superscript) or lowered (subscript).
pub const SUP: char = '\u{e000}';
pub const SUB: char = '\u{e001}';

fn cat(parts: &[&[Pt]]) -> Vec<Pt> {
    parts.iter().flat_map(|p| p.iter().copied()).collect()
}

/// (advance, strokes) of a glyph drawn here.
pub fn extra(c: char) -> Option<(f64, Vec<Vec<Pt>>)> {
    let a = arc;
    Some(match c {
        'α' => (1.05, vec![cat(&[&[[0.98, 0.98]], &a(0.42, 0.5, 0.4, 0.48, 15., 345., 24), &[[0.98, -0.02]]])]),
        'β' => (0.85, vec![cat(&[&[[0.14, -0.45], [0.14, 1.05]], &a(0.38, 1.05, 0.24, 0.32, 180., -60., 24), &[[0.25, 0.62]], &a(0.38, 0.33, 0.3, 0.3, 80., -110., 24), &[[0.14, 0.12]]])]),
        'γ' => (0.9, vec![vec![[0.0, 0.95], [0.18, 0.95], [0.33, 0.55], [0.44, 0.05], [0.42, -0.35], [0.36, -0.42], [0.33, -0.25], [0.47, 0.18], [0.64, 0.6], [0.85, 1.0]]]),
        'δ' => (0.9, vec![cat(&[&[[0.72, 1.38], [0.32, 1.42], [0.22, 1.2], [0.4, 1.0], [0.66, 0.82]], &a(0.43, 0.42, 0.37, 0.42, 50., 410., 24)])]),
        'ε' => (0.8, vec![cat(&[&a(0.45, 0.74, 0.32, 0.26, 40., 270., 24), &a(0.45, 0.26, 0.36, 0.26, 90., 320., 24)])]),
        'η' => (0.85, vec![vec![[0.1, 1.0], [0.1, 0.0]], cat(&[&[[0.1, 0.62]], &a(0.42, 0.62, 0.3, 0.36, 160., 0., 24), &[[0.72, -0.45]]])]),
        'θ' => (0.85, vec![a(0.42, 0.7, 0.34, 0.7, 90., 450., 24), vec![[0.1, 0.7], [0.74, 0.7]]]),
        'λ' => (0.95, vec![vec![[0.08, 1.42], [0.28, 1.38], [0.52, 0.7], [0.78, 0.05], [0.9, 0.0]], vec![[0.47, 0.82], [0.05, 0.0]]]),
        'μ' | 'µ' => (0.95, vec![vec![[0.1, 1.0], [0.1, -0.45]], cat(&[&[[0.1, 0.35]], &a(0.4, 0.35, 0.3, 0.35, 180., 360., 24), &[[0.7, 1.0]]]), vec![[0.7, 1.0], [0.72, 0.12], [0.88, 0.0]]]),
        'π' => (1.0, vec![vec![[0.02, 0.92], [0.4, 1.0], [0.95, 0.98]], vec![[0.3, 1.0], [0.27, 0.0]], vec![[0.68, 0.99], [0.7, 0.12], [0.85, 0.0]]]),
        'ρ' => (0.85, vec![cat(&[&[[0.1, -0.45], [0.1, 0.5]], &a(0.42, 0.5, 0.32, 0.48, 180., -180., 24)])]),
        'σ' => (1.0, vec![cat(&[&[[0.95, 0.95], [0.45, 0.92]], &a(0.42, 0.46, 0.34, 0.46, 90., 450., 24)])]),
        'τ' => (0.85, vec![vec![[0.0, 0.95], [0.8, 1.0]], vec![[0.42, 0.98], [0.4, 0.15], [0.58, 0.0]]]),
        'φ' => (1.0, vec![a(0.48, 0.5, 0.4, 0.45, 90., 450., 24), vec![[0.5, 1.4], [0.46, -0.45]]]),
        'ψ' => (1.0, vec![cat(&[&[[0.05, 1.0], [0.12, 0.35]], &a(0.48, 0.35, 0.36, 0.35, 180., 360., 24), &[[0.9, 1.0]]]), vec![[0.5, 1.4], [0.46, -0.45]]]),
        'ω' => (1.15, vec![vec![[0.18, 0.95], [0.05, 0.4], [0.25, 0.0], [0.48, 0.35], [0.58, 0.55], [0.62, 0.35], [0.82, 0.0], [1.02, 0.4], [0.92, 0.95]]]),
        'Δ' => (1.15, vec![vec![[0.0, 0.0], [0.57, 1.42], [1.12, 0.0], [-0.02, 0.02]]]),
        'Σ' | '∑' => (1.0, vec![vec![[0.92, 1.4], [0.02, 1.4], [0.52, 0.7], [0.0, 0.0], [0.95, 0.02]]]),
        'Ω' => (1.15, vec![cat(&[&[[0.05, 0.0], [0.35, 0.02], [0.22, 0.3]], &a(0.57, 0.8, 0.45, 0.62, 225., -45., 24), &[[0.92, 0.3], [0.8, 0.02], [1.1, 0.0]]])]),
        'Φ' => (1.15, vec![a(0.57, 0.7, 0.48, 0.42, 90., 450., 24), vec![[0.57, 1.45], [0.55, -0.05]]]),
        '∝' => (1.15, vec![cat(&[&[[1.08, 0.88], [0.85, 0.65], [0.6, 0.35]], &a(0.38, 0.45, 0.28, 0.32, -20., -340., 24), &[[0.6, 0.55], [0.85, 0.25], [1.08, 0.05]]])]),
        '∞' => (1.35, vec![a(0.35, 0.5, 0.3, 0.3, 0., 360., 24), a(0.95, 0.5, 0.3, 0.3, 180., -180., 24)]),
        '√' => (1.3, vec![vec![[0.0, 0.55], [0.15, 0.62], [0.38, 0.0], [0.62, 1.45], [1.28, 1.45]]]),
        '∂' => (0.9, vec![cat(&[&[[0.15, 1.2], [0.45, 1.42], [0.75, 1.1], [0.8, 0.5]], &a(0.45, 0.38, 0.36, 0.38, 20., 380., 24)])]),
        '∫' => (0.6, vec![vec![[0.55, 1.45], [0.45, 1.5], [0.32, 1.3], [0.28, 0.0], [0.18, -0.4], [0.05, -0.38]]]),
        '×' => (0.85, vec![vec![[0.1, 0.15], [0.72, 0.85]], vec![[0.72, 0.15], [0.1, 0.85]]]),
        '÷' => (0.85, vec![vec![[0.1, 0.5], [0.75, 0.5]], a(0.42, 0.85, 0.05, 0.05, 0., 360., 8), a(0.42, 0.15, 0.05, 0.05, 0., 360., 8)]),
        '±' => (0.9, vec![vec![[0.08, 0.72], [0.82, 0.72]], vec![[0.45, 1.12], [0.45, 0.32]], vec![[0.08, 0.08], [0.82, 0.08]]]),
        '≈' => (0.95, vec![vec![[0.05, 0.62], [0.22, 0.75], [0.45, 0.62], [0.68, 0.5], [0.88, 0.62]], vec![[0.05, 0.28], [0.22, 0.41], [0.45, 0.28], [0.68, 0.16], [0.88, 0.28]]]),
        '°' => (0.55, vec![a(0.25, 1.15, 0.17, 0.19, 0., 360., 24)]),
        '≤' => (0.95, vec![vec![[0.85, 1.0], [0.1, 0.64], [0.85, 0.3]], vec![[0.1, 0.06], [0.85, 0.06]]]),
        '≥' => (0.95, vec![vec![[0.1, 1.0], [0.85, 0.64], [0.1, 0.3]], vec![[0.1, 0.06], [0.85, 0.06]]]),
        '≠' => (0.95, vec![vec![[0.08, 0.66], [0.84, 0.66]], vec![[0.08, 0.32], [0.84, 0.32]], vec![[0.64, 0.98], [0.28, 0.0]]]),
        '∩' => (0.95, vec![cat(&[&[[0.1, 0.0]], &a(0.47, 0.6, 0.37, 0.45, 180., 0., 24), &[[0.84, 0.0]]])]),
        '∪' => (0.95, vec![cat(&[&[[0.1, 1.0]], &a(0.47, 0.4, 0.37, 0.45, 180., 360., 24), &[[0.84, 1.0]]])]),
        '•' => (0.5, vec![a(0.25, 0.45, 0.07, 0.07, 0., 360., 10)]),
        '∈' => (0.9, vec![cat(&[&a(0.5, 0.5, 0.4, 0.45, 90., 270., 16), &[[0.85, 0.05]]]), vec![[0.12, 0.5], [0.75, 0.5]]]),
        '∀' => (1.0, vec![vec![[0.0, 1.4], [0.48, 0.0], [0.96, 1.4]], vec![[0.2, 0.75], [0.76, 0.75]]]),
        '∃' => (0.85, vec![vec![[0.05, 1.4], [0.75, 1.4], [0.75, 0.0], [0.05, 0.0]], vec![[0.15, 0.7], [0.75, 0.7]]]),
        _ => return None,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Accent {
    Acute,
    Grave,
    Circumflex,
    Caron,
    Diaeresis,
    Tilde,
    Ring,
    Breve,
    Macron,
    DotAbove,
    DoubleAcute,
    Cedilla,
    Ogonek,
    Stroke,
}

/// Base letter and accent of a Latin letter.
pub fn decompose(c: char) -> Option<(char, Accent)> {
    use Accent::*;
    const TABLE: &[(&str, &str, Accent)] = &[
        ("ÁÉÍÓÚÝáéíóúýĆćŃńŚśŹźĹĺŔŕ", "AEIOUYaeiouyCcNnSsZzLlRr", Acute),
        ("ÀÈÌÒÙàèìòù", "AEIOUaeiou", Grave),
        ("ÂÊÎÔÛâêîôûĈĉĜĝĤĥĴĵŜŝŴŵŶŷ", "AEIOUaeiouCcGgHhJjSsWwYy", Circumflex),
        ("ČčĎďĚěŇňŘřŠšŤťŽž", "CcDdEeNnRrSsTtZz", Caron),
        ("ÄËÏÖÜäëïöüÿŸ", "AEIOUaeiouyY", Diaeresis),
        ("ÃÑÕãñõĨĩŨũ", "ANOanoIiUu", Tilde),
        ("ÅåŮů", "AaUu", Ring),
        ("ĂăĔĕĞğĬĭŎŏŬŭ", "AaEeGgIiOoUu", Breve),
        ("ĀāĒēĪīŌōŪū", "AaEeIiOoUu", Macron),
        ("ĖėĠġİŻż", "EeGgIZz", DotAbove),
        ("ŐőŰű", "OoUu", DoubleAcute),
        ("ÇçŞşŢţ", "CcSsTt", Cedilla),
        ("ĄąĘęĮįŲų", "AaEeIiUu", Ogonek),
        ("ŁłØøĐđ", "LlOoDd", Stroke),
    ];
    TABLE.iter().find_map(|(composed, bases, accent)| {
        composed
            .chars()
            .position(|x| x == c)
            .and_then(|i| bases.chars().nth(i))
            .map(|b| (b, *accent))
    })
}

fn dot(x: f64, y: f64) -> Vec<Pt> {
    vec![[x - 0.03, y - 0.02], [x + 0.03, y + 0.02]]
}
/// Accent strokes around (0, 0) in x-heights, y up; Stroke is in the letter's
/// box (-0.5..0.5 on both axes).
pub fn accent_strokes(accent: Accent) -> Vec<Vec<Pt>> {
    use Accent::*;
    match accent {
        Acute => vec![vec![[-0.1, 0.0], [0.16, 0.3]]],
        Grave => vec![vec![[-0.16, 0.3], [0.1, 0.0]]],
        Circumflex => vec![vec![[-0.22, 0.0], [0.0, 0.28], [0.22, 0.0]]],
        Caron => vec![vec![[-0.22, 0.28], [0.0, 0.0], [0.22, 0.28]]],
        Diaeresis => vec![dot(-0.16, 0.08), dot(0.16, 0.08)],
        Tilde => vec![vec![[-0.28, 0.02], [-0.18, 0.16], [-0.06, 0.18], [0.06, 0.08], [0.18, 0.02], [0.28, 0.16]]],
        Ring => vec![arc(0.0, 0.14, 0.12, 0.12, 0., 360., 16)],
        Breve => vec![arc(0.0, 0.26, 0.22, 0.24, 180., 360., 12)],
        Macron => vec![vec![[-0.24, 0.08], [0.24, 0.08]]],
        DotAbove => vec![dot(0.0, 0.08)],
        DoubleAcute => vec![vec![[-0.22, 0.0], [-0.06, 0.3]], vec![[0.06, 0.0], [0.22, 0.3]]],
        Cedilla => vec![vec![[0.0, 0.0], [0.02, -0.14], [0.16, -0.22], [0.08, -0.4], [-0.12, -0.38]]],
        Ogonek => vec![vec![[0.18, 0.0], [0.04, -0.16], [0.12, -0.34], [0.28, -0.32]]],
        Stroke => vec![vec![[-0.45, -0.4], [0.45, 0.4]]],
    }
}

const SUPERS: &str = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
const SUPER_PLAIN: &str = "0123456789+-=()ni";
const SUBS: &str = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₓ";
const SUB_PLAIN: &str = "0123456789+-=()aex";

/// `T^4`, `m^{-2}`, `CO_2`, `λ_{max}` and Unicode super/subscripts: each
/// script character is preceded by SUP or SUB.
pub fn scripts(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if (c == '^' || c == '_') && i + 1 < chars.len() {
            let mark = if c == '^' { SUP } else { SUB };
            let body: Option<(Vec<char>, usize)> = if chars[i + 1] == '{' {
                chars[i + 2..]
                    .iter()
                    .position(|&x| x == '}')
                    .filter(|&n| n > 0)
                    .map(|n| (chars[i + 2..i + 2 + n].to_vec(), n + 3))
            } else if c == '^' {
                // ^4, ^-2, ^+, ^n, ^T: a sign then letters or digits.
                let mut n = 1;
                if matches!(chars[i + 1], '-' | '+') {
                    n += 1;
                }
                let start = n;
                while i + n < chars.len() && chars[i + n].is_alphanumeric() {
                    n += 1;
                }
                (n > start).then(|| (chars[i + 1..i + n].to_vec(), n))
            } else {
                // _2, _12: digits only, so snake_case words stay as written.
                let mut n = 1;
                while i + n < chars.len() && chars[i + n].is_ascii_digit() {
                    n += 1;
                }
                (n > 1).then(|| (chars[i + 1..i + n].to_vec(), n))
            };
            if let Some((body, used)) = body {
                for b in body {
                    out.push(mark);
                    out.push(b);
                }
                i += used;
                continue;
            }
        }
        if let Some(p) = SUPERS.chars().position(|x| x == c) {
            out.push(SUP);
            out.push(SUPER_PLAIN.chars().nth(p).unwrap());
        } else if let Some(p) = SUBS.chars().position(|x| x == c) {
            out.push(SUB);
            out.push(SUB_PLAIN.chars().nth(p).unwrap());
        } else {
            out.push(c);
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scripts_mark_raised_and_lowered_characters() {
        let s = |t: &str| scripts(t).replace(SUP, "^").replace(SUB, "_");
        assert_eq!(s("T^4"), "T^4");
        assert_eq!(s("m^{-2}"), "m^-^2");
        assert_eq!(s("10^-8 W"), "10^-^8 W");
        assert_eq!(s("CO_2 + H₂O"), "CO_2 + H_2O");
        assert_eq!(s("λ_{max}"), "λ_m_a_x");
        assert_eq!(s("snake_case x²"), "snake_case x^2");
        assert_eq!(decompose('Ñ'), Some(('N', Accent::Tilde)));
        assert_eq!(decompose('ő'), Some(('o', Accent::DoubleAcute)));
        assert_eq!(decompose('x'), None);
        assert!(extra('α').is_some() && extra('a').is_none());
    }
}
