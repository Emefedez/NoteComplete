//! A small seeded generator (SplitMix64) so the same seed and input always
//! write the same strokes, on every platform, with no dependency.

#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x9e37_79b9_7f4a_7c15)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    /// Uniform in [0, 1).
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.unit()
    }
    /// A fresh seed for a child pen.
    pub fn seed(&mut self) -> u64 {
        self.next_u64() >> 2
    }
}

/// Smooth 1-D value noise for tremor, drift and shape wobble.
pub struct Noise([f64; 64]);
impl Noise {
    pub fn new(rng: &mut Rng) -> Self {
        let mut v = [0.; 64];
        for x in &mut v {
            *x = rng.uniform(-1., 1.);
        }
        Self(v)
    }
    pub fn at(&self, t: f64) -> f64 {
        let i = t.floor();
        let f = t - i;
        let i = i as i64;
        let a = self.0[i.rem_euclid(64) as usize];
        let b = self.0[(i + 1).rem_euclid(64) as usize];
        let f = f * f * (3. - 2. * f);
        a + (b - a) * f
    }
}

/// A stable seed from text (FNV-1a), for "same title, same pages".
pub fn seed_of(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeats_for_a_seed_and_stays_in_range() {
        let (mut a, mut b) = (Rng::new(7), Rng::new(7));
        for _ in 0..1000 {
            let x = a.uniform(-2., 3.);
            assert_eq!(x, b.uniform(-2., 3.));
            assert!((-2.0..3.0).contains(&x));
        }
        assert_ne!(Rng::new(1).next_u64(), Rng::new(2).next_u64());
        let n = Noise::new(&mut a);
        assert!((0..500).all(|i| n.at(i as f64 * 0.13 - 20.).abs() <= 1.));
    }
}
