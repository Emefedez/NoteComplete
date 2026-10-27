use crate::{hex, Cursor, Error, Result};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Style {
    pub rgba: [f64; 4],
    pub tool: u16,
    pub extra: [u8; 8],
}
impl Default for Style {
    fn default() -> Self {
        Self {
            rgba: [0., 0., 0., 1.],
            tool: 0,
            extra: [0; 8],
        }
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct Stroke {
    pub offset: usize,
    pub size: usize,
    pub header: [u8; 38],
    pub flags: u16,
    pub id: u64,
    pub z_order: u64,
    pub layer: u32,
    pub radius: f64,
    pub unknown: u32,
    /// Flag 0x10: `[u32 opaque][u32 len][UTF-8 ID]` after the header. The ID names a
    /// kind-23 object on the same page; points stay in page coordinates.
    pub link: Option<(u32, String)>,
    pub points: Vec<[f64; 2]>,
    pub radii: Vec<f64>,
    pub bounds: Vec<f64>,
    pub quantized: Vec<[u16; 2]>,
    pub auxiliary: Vec<u8>,
    pub style: Style,
}
impl Stroke {
    /// Flag 2: the pixel eraser's per-segment mask, `[u32 0][u32 N-1]` then one
    /// `(a, b)` f32 pair per segment: `[0, b]` erased at its start and
    /// `[1 - a, 1]` towards its end (noteful-mcp notes). `None` when absent or
    /// not in that shape, in which case the stroke renders whole.
    pub fn eraser_mask(&self) -> Option<Vec<[f64; 2]>> {
        let n = self.points.len();
        let aux = &self.auxiliary;
        if self.flags & 2 == 0 || n < 2 || aux.len() != n * 8 {
            return None;
        }
        let word = |i: usize| u32::from_be_bytes(aux[i..i + 4].try_into().unwrap());
        if word(0) != 0 || word(4) as usize != n - 1 {
            return None;
        }
        let pairs: Vec<[f64; 2]> = aux[8..]
            .as_chunks::<8>()
            .0
            .iter()
            .map(|c| {
                let v = |i: usize| f32::from_be_bytes(c[i..i + 4].try_into().unwrap()) as f64;
                [v(0), v(4)]
            })
            .collect();
        pairs
            .iter()
            .flatten()
            .all(|v| v.is_finite() && (-1e-3..=1. + 1e-3).contains(v))
            .then_some(pairs)
    }
    /// Polylines still visible after pixel erasing, each with its radii (if any).
    pub fn visible_runs(&self) -> Vec<(Vec<[f64; 2]>, Vec<f64>)> {
        let Some(mask) = self.eraser_mask() else {
            return vec![(self.points.clone(), self.radii.clone())];
        };
        let at = |i: usize, t: f64| {
            let (p, q) = (self.points[i], self.points[i + 1]);
            let r = (!self.radii.is_empty())
                .then(|| self.radii[i] + (self.radii[i + 1] - self.radii[i]) * t);
            ([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], r)
        };
        let point = |i: usize| (self.points[i], self.radii.get(i).copied());
        let mut out = Vec::new();
        let mut cur: Vec<([f64; 2], Option<f64>)> = Vec::new();
        let mut flush = |cur: &mut Vec<([f64; 2], Option<f64>)>| {
            if cur.len() > 1 {
                let (p, r): (Vec<_>, Vec<_>) = cur.drain(..).unzip();
                out.push((p, r.into_iter().flatten().collect()));
            }
            cur.clear();
        };
        for (i, [a, b]) in mask.into_iter().enumerate() {
            if a <= 0. && b <= 0. {
                if cur.is_empty() {
                    cur.push(point(i));
                }
                cur.push(point(i + 1));
                continue;
            }
            if a + b >= 1. {
                flush(&mut cur);
                continue;
            }
            if b > 0. {
                flush(&mut cur);
                cur.push(at(i, b));
            } else if cur.is_empty() {
                cur.push(point(i));
            }
            cur.push(at(i, 1. - a));
            if a > 0. {
                flush(&mut cur);
            }
        }
        flush(&mut cur);
        out
    }
    pub fn to_json(&self) -> Value {
        json!({"offset_in_blob":self.offset,"size":self.size,"record_prefix":"f101",
            "opaque_header_hex":hex(&self.header),"id_raw":format!("{:016x}",self.id),
            "flags":self.flags,"z_order_raw":self.z_order,"layer_raw":self.layer,
            "thickness_candidate":self.radius,"unknown_0x30":self.unknown,
            "linked_object":self.link.as_ref().map(|l| &l.1),
            "point_count":self.points.len(),"encoding":if self.points.len()<=4 {"float32"} else {"quantized_uint16"},
            "float32_0x38_0x3c_0x40_0x44":&self.bounds[..self.bounds.len().min(4)],
            "uint16_pairs":self.quantized,"candidate_points":self.points,"radii":self.radii,
            "pressure_candidate":self.radii,"auxiliary_hex":hex(&self.auxiliary),
            "style":{"rgba":self.style.rgba,"tool_raw":self.style.tool,"extra_hex":hex(&self.style.extra)}})
    }
}
pub fn decode_strokes(data: &[u8]) -> Result<Vec<Stroke>> {
    let mut r = Cursor::new(data, 0);
    let mut style = Style::default();
    let mut out = Vec::new();
    let mut budget = data.len();
    while r.remaining() > 0 {
        let offset = r.pos;
        let cmd = r.uint(2)?;
        if cmd == 0xf102 {
            let rgba = [r.float(8)?, r.float(8)?, r.float(8)?, r.float(8)?];
            if rgba.iter().any(|x| !(0.0..=1.0).contains(x)) {
                return Err(Error::new(offset, "Invalid RGBA"));
            }
            let tool = r.uint(2)? as u16;
            let mut extra = [0; 8];
            extra.copy_from_slice(r.take(8)?);
            style = Style { rgba, tool, extra };
            continue;
        }
        if cmd != 0xf101 {
            return Err(Error::new(offset, "Unsupported stroke command"));
        }
        let mut header = [0; 38];
        header.copy_from_slice(r.take(38)?);
        let mut h = Cursor::new(&header, offset + 2);
        let id = h.uint(8)?;
        let flags = h.uint(2)? as u16;
        // Bit 2 (tape revealed, per noteful-mcp) does not change the layout.
        if flags & !0x17 != 0 {
            return Err(Error::new(offset, "Unsupported stroke flags"));
        }
        h.take(16)?;
        let z_order = h.uint(8)?;
        let layer = h.uint(4)? as u32;
        let link = if flags & 0x10 != 0 {
            let opaque = r.uint(4)? as u32;
            let n = r.uint(4)? as usize;
            let at = r.at();
            let id = std::str::from_utf8(r.take(n)?)
                .map_err(|_| Error::new(at, "Invalid stroke link"))?;
            Some((opaque, id.to_owned()))
        } else {
            None
        };
        let radius = r.float(8)?;
        let unknown = r.uint(4)? as u32;
        let count = r.uint(4)? as usize;
        let dim = if flags & 1 != 0 { 3 } else { 2 };
        if count > budget || count > data.len() / 4 {
            return Err(Error::new(r.at(), "Stroke point budget exceeded"));
        }
        budget -= count;
        let auxiliary = if flags & 2 != 0 {
            r.take(count * 8)?.to_vec()
        } else {
            Vec::new()
        };
        let mut bounds = Vec::new();
        let mut points = Vec::new();
        let mut radii = Vec::new();
        let mut quantized = Vec::new();
        if count > 4 {
            for _ in 0..dim * 2 {
                bounds.push(r.float(4)?);
            }
        }
        for _ in 0..count {
            let mut p = [0.; 3];
            let mut q = [0u16; 3];
            for j in 0..dim {
                p[j] = if count <= 4 {
                    r.float(4)?
                } else {
                    q[j] = r.uint(2)? as u16;
                    bounds[j * 2] + f64::from(q[j]) / 65535. * bounds[j * 2 + 1]
                };
                if !p[j].is_finite() {
                    return Err(Error::new(r.at(), "Non-finite coordinate"));
                }
            }
            points.push([p[0], p[1]]);
            if dim == 3 {
                radii.push(p[2]);
            }
            if count > 4 {
                quantized.push([q[0], q[1]]);
            }
        }
        out.push(Stroke {
            offset,
            size: r.pos - offset,
            header,
            flags,
            id,
            z_order,
            layer,
            radius,
            unknown,
            link,
            points,
            radii,
            bounds,
            quantized,
            auxiliary,
            style: style.clone(),
        });
    }
    Ok(out)
}
