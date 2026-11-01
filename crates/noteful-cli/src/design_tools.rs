//! Copying a page design into ink: `design_mockup` asks an image model (on
//! the user's own Google account) for a picture of the page, `mockup_grid`
//! lays a labelled pixel grid over any page picture so coordinates can be
//! read off it, and `design_page` draws a spec of what is on the picture as
//! real ink (see noteful_core::ink::design). The model call goes through
//! `curl`; the key is passed on its standard input, never on its command line.
use super::*;
use noteful_core::ink::{
    design::{design_page, Mockups, SPEC_DOC},
    insert_pages, new_notebook,
    trace::Raster,
    InkPage,
};

const MODEL: &str = "gemini-3.1-flash-lite-image";
const STUDIO: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const VERTEX: &str = "https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent";

pub(super) const NO_KEY: &str = "No image model is set up. Mockups use your own Google account: set GEMINI_API_KEY (a key from https://aistudio.google.com/apikey) or NOTEFUL_VERTEX_PROJECT (a Google Cloud project with Vertex AI; uses gcloud's application-default login) in the MCP server's environment and restart it. Or make the mockup with any image tool and pass its file to mockup_grid and design_page.";

const RICH: &str = "Hand-drawn digital study notes written with an Apple Pencil in a notes app, the kind students share on Pinterest. Felt-tip handwriting, slightly irregular, mixed case. Pen weights carry the hierarchy: a very thick block-capital title, medium coloured section headings sitting on a thin coloured rule, fine near-black body text. One colour family with 2-3 accents (coral #e9573f, amber #f39a1e, sky blue #2f7fd6), flat pastel highlighter strokes under key phrases. Rounded cards with a pastel fill and a darker outline of the same hue. Diagrams have flat pastel fills, labels outside the drawing on thin leader lines. Circled step numbers. The page is about 90 % full, airy margins, blocks aligned to two columns.";
const CALM: &str = "Neat handwritten lecture notes written with an Apple Pencil in a notes app, the way a tidy student writes during class. One dark fine pen for almost everything, natural mixed-case handwriting, slightly irregular. One accent colour (sky blue #2f7fd6) for the title and headings, each heading underlined by hand. A few pale yellow highlighter strokes under key terms only. Numbered points, short indented sub-points, an arrow or two. No cards, no boxes, no stickers, no drawings except a small sketch only if the topic needs one. Generous margins and white space; the page is about 75 % full.";
const AVOID: &str = "Body text is in normal mixed-case handwriting; only the title and headings are capitals. Solid letters, a calm palette, clean flat colours, plain paper texture. It looks like a real student's page, not an infographic, poster or planner template: no icons, no emoji, no clipart, no pushpins, no stars or sparkles; not every block in a box. The layout is a little uneven and asymmetric, handwriting size varies slightly, with one or two human touches: a word crossed out and rewritten, a small arrow to a margin note, a quick double underline. Every sentence is real and meaningful.";
const PAPER_LIGHT: &str = "Paper: warm ivory paper with a faint dot grid, seen flat and straight on, filling the whole frame with no desk, no device and no shadows around it.";
const PAPER_DARK: &str = "Paper: true black paper, seen flat and straight on, filling the whole frame, with nothing around it: no app interface, no status bar, no toolbar. White handwriting, neon headings (pink, yellow, sky blue, green).";
const AS_EXAMPLE: &str = "The attached image is a study-notes page in exactly the style I want. Create a new page in the same style (same paper, pens, colours, cards, title and layout habits) about this:";
const AS_PREVIOUS: &str = "The attached image is the previous page of the same notes. Create the next page so it looks like the same student made it with the same pens on the same day: same paper, title style, colours, highlighter and card habits, same handwriting. Only the content and the layout of the blocks change:";

/// Which account mockups go to, from the environment.
pub(super) enum Provider {
    Studio { key: String },
    Vertex { project: String, location: String },
}
pub(super) fn provider(env: impl Fn(&str) -> Option<String>) -> Option<Provider> {
    let set = |k: &str| env(k).filter(|v| !v.trim().is_empty());
    if let Some(key) = set("GEMINI_API_KEY").or_else(|| set("GOOGLE_API_KEY")) {
        return Some(Provider::Studio { key });
    }
    set("NOTEFUL_VERTEX_PROJECT").map(|project| Provider::Vertex {
        project,
        location: set("NOTEFUL_VERTEX_LOCATION").unwrap_or_else(|| "global".into()),
    })
}
fn model() -> String {
    std::env::var("NOTEFUL_IMAGE_MODEL")
        .ok()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| MODEL.into())
}

/// The request for one page; `reference` is "example" or "previous" when an image goes along.
pub(super) fn mockup_prompt(
    content: &str,
    look: &str,
    dark: bool,
    reference: Option<&str>,
) -> String {
    let lead = match reference {
        Some("example") => AS_EXAMPLE,
        Some("previous") => AS_PREVIOUS,
        _ => "",
    };
    [
        "Create a portrait study-notes page image.",
        lead,
        &format!("Content: {}", content.trim()),
        &format!("Style: {}", if look == "rich" { RICH } else { CALM }),
        if dark { PAPER_DARK } else { PAPER_LIGHT },
        AVOID,
    ]
    .iter()
    .filter(|p| !p.is_empty())
    .copied()
    .collect::<Vec<_>>()
    .join("\n\n")
}
pub(super) fn request_body(prompt: &str, reference: Option<&[u8]>) -> Value {
    let mut parts = vec![json!({"text":prompt})];
    if let Some(r) = reference {
        let mime = if r.starts_with(b"\x89PNG") {
            "image/png"
        } else {
            "image/jpeg"
        };
        parts.insert(
            0,
            json!({"inlineData":{"mimeType":mime,"data":STANDARD.encode(r)}}),
        );
    }
    json!({"contents":[{"role":"user","parts":parts}],"generationConfig":{"responseModalities":["IMAGE"],"imageConfig":{"aspectRatio":"3:4"}}})
}
/// The image in a generateContent reply, or why there is none.
pub(super) fn image_of(reply: &Value) -> Res<Vec<u8>> {
    for cand in reply["candidates"].as_array().into_iter().flatten() {
        for part in cand["content"]["parts"].as_array().into_iter().flatten() {
            if let Some(data) = part["inlineData"]["data"].as_str() {
                return Ok(STANDARD.decode(data)?);
            }
        }
    }
    if let Some(msg) = reply["error"]["message"].as_str() {
        return Err(format!("The image model refused the request: {msg}").into());
    }
    let reason = reply["candidates"][0]["finishReason"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| reply["promptFeedback"].to_string());
    Err(
        format!("The image model returned no image ({reason}). Rephrase the content and retry.")
            .into(),
    )
}
fn call_model(p: &Provider, body: &Value) -> Res<Value> {
    let (url, header) = match p {
        Provider::Studio { key } => (
            STUDIO.replace("{model}", &model()),
            format!("x-goog-api-key: {key}"),
        ),
        Provider::Vertex { project, location } => {
            let token = Command::new("gcloud")
                .args(["auth", "application-default", "print-access-token"])
                .output()
                .map_err(|_| "Vertex AI needs gcloud: install the Google Cloud CLI and run gcloud auth application-default login")?;
            if !token.status.success() {
                return Err(format!(
                    "gcloud could not give a token: {}",
                    String::from_utf8_lossy(&token.stderr).trim()
                )
                .into());
            }
            let url = VERTEX
                .replace("{project}", project)
                .replace("{location}", location)
                .replace("{model}", &model());
            (
                url,
                format!(
                    "Authorization: Bearer {}",
                    String::from_utf8_lossy(&token.stdout).trim()
                ),
            )
        }
    };
    let dir = std::env::temp_dir().join(format!("notecomplete-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let body_file = dir.join(format!("mockup-{:x}.json", hash(&body.to_string())));
    std::fs::write(&body_file, body.to_string())?;
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "--max-time",
            "180",
            "-X",
            "POST",
            &url,
            "-H",
            "@-",
            "--data-binary",
        ])
        .arg(format!("@{}", body_file.display()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Mockups need curl installed")?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(format!("Content-Type: application/json\n{header}\n").as_bytes())?;
    let out = child.wait_with_output()?;
    let _ = std::fs::remove_file(&body_file);
    if !out.status.success() {
        return Err(format!(
            "The image model could not be reached: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )
        .into());
    }
    serde_json::from_slice(&out.stdout).map_err(|_| {
        format!(
            "The image model sent an unexpected reply: {}",
            snippet(&String::from_utf8_lossy(&out.stdout), 300)
        )
        .into()
    })
}

/// Decode a PNG or JPEG mockup, resized to the spec's pixel size when it differs.
fn decode(path: &Path, size: Option<(u32, u32)>) -> Res<Raster> {
    let img = image::open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .to_rgb8();
    let img = match size {
        Some((w, h)) if (w, h) != img.dimensions() && w > 0 && h > 0 => {
            image::imageops::resize(&img, w, h, image::imageops::FilterType::Lanczos3)
        }
        _ => img,
    };
    let (w, h) = img.dimensions();
    Raster::new(w as usize, h as usize, img.into_raw()).ok_or_else(|| "Empty image".into())
}

/// The picture with a labelled pixel grid, as SVG; `region` [x, y, w, h] zooms in with a finer grid.
pub(super) fn grid_svg(
    data: &[u8],
    size: (u32, u32),
    step: u32,
    region: Option<[u32; 4]>,
) -> (String, u32) {
    let (w, h) = size;
    let mime = if data.starts_with(b"\x89PNG") {
        "image/png"
    } else {
        "image/jpeg"
    };
    let [ox, oy, rw, rh] = region
        .map(|r| [r[0].min(w - 1), r[1].min(h - 1), r[2].max(1), r[3].max(1)])
        .unwrap_or([0, 0, w, h]);
    let (rw, rh) = (rw.min(w - ox), rh.min(h - oy));
    let zoom = if region.is_some() {
        (900. / rw.max(rh) as f64).max(1.)
    } else {
        1.
    };
    let step = if region.is_some() {
        (step / 5).max(5)
    } else {
        step.max(5)
    };
    let font = 13. / zoom;
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{ox} {oy} {rw} {rh}\" width=\"{}\" height=\"{}\"><image x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" href=\"data:{mime};base64,{}\"/>",
        (rw as f64 * zoom).round(),
        (rh as f64 * zoom).round(),
        STANDARD.encode(data)
    );
    let first = |o: u32| o.div_ceil(step) * step;
    for (vertical, from, to) in [(true, ox, ox + rw), (false, oy, oy + rh)] {
        let mut v = first(from);
        while v <= to {
            let alpha = if v % (step * 2) == 0 { 0.43 } else { 0.2 };
            let line = if vertical {
                format!("<line x1=\"{v}\" y1=\"{oy}\" x2=\"{v}\" y2=\"{}\"", oy + rh)
            } else {
                format!("<line x1=\"{ox}\" y1=\"{v}\" x2=\"{}\" y2=\"{v}\"", ox + rw)
            };
            let (tx, ty) = if vertical {
                (v as f64 + 2. / zoom, oy as f64 + font)
            } else {
                (ox as f64 + 2. / zoom, v as f64 + font)
            };
            out.push_str(&format!(
                "{line} stroke=\"#ff00ff\" stroke-opacity=\"{alpha}\" stroke-width=\"{}\"/><text x=\"{tx}\" y=\"{ty}\" font-family=\"sans-serif\" font-size=\"{font}\" fill=\"#c800c8\">{v}</text>",
                1. / zoom
            ));
            v += step;
        }
    }
    out.push_str("</svg>");
    (out, (rw as f64 * zoom).round() as u32)
}
fn grid_png(data: &[u8], step: u32, region: Option<[u32; 4]>) -> Res<Vec<u8>> {
    let size = image::load_from_memory(data)?;
    let (svg, width) = grid_svg(data, (size.width(), size.height()), step, region);
    rasterize(svg, width.clamp(200, 2400))
}

pub(super) fn tools() -> Vec<Value> {
    let path =
        json!({"type":"string","description":"Path to a .noteful, .notecomp or .nfedit note"});
    vec![
        tool("design_mockup", "Draw a picture of a study page with an image model on the user's own Google account (GEMINI_API_KEY or NOTEFUL_VERTEX_PROJECT in the server's environment), to copy into ink with design_page. content: what the page holds and roughly where (title, sections, a drawing, cards, a zone…), quoting the exact title and labels. look: 'calm' (default: ordinary notes, one pen, underlined headings, a little highlighter) or 'rich' (only for a visual summary page: cards, a drawing, a sticky note); most pages are calm. theme: light | dark. reference: an example name to imitate (default: clean-copy for rich light pages, answers-tree for dark, none for calm) or the path of the previous page's mockup, which keeps a multi-page note consistent. Returns the mockup's path, the mockup and a grid.",
            json!({"content":{"type":"string"},"look":{"type":"string","enum":["calm","rich"]},"theme":{"type":"string","enum":["light","dark"]},"reference":{"type":"string"}}), &["content"]),
        tool("mockup_grid", "A mockup (or any page picture, PNG or JPEG) with a labelled pixel grid, to read the coordinates a design_page spec needs. region [x, y, w, h] zooms in with a finer grid, for small text.",
            json!({"path":{"type":"string"},"step":{"type":"integer","minimum":10,"maximum":400},"region":{"type":"array","items":{"type":"integer","minimum":0},"minItems":4,"maxItems":4}}), &["path"]),
        tool("design_page", &format!("Write pages that copy page designs (mockups) in real ink. pages: one spec per page. Either title (a new notebook) or path (pages added to that note after after_page, 0 = at the start; a copy unless in_place). Workflow: design_mockup (or a picture the user gives) → mockup_grid to read coordinates → design_page → page_image to compare with the mockup and fix what is off. List every block of the mockup in its own pixels with the CORRECT words (image models garble text: copy the layout, sizes and colours), trace drawings straight from the mockup (erase their labels and write the labels as text), and match each text's h (cap height) and w (line length) to the mockup.\n{SPEC_DOC}"),
            json!({"pages":{"type":"array","items":{"type":"object"}},"title":{"type":"string"},"path":path,"after_page":{"type":"integer","minimum":0},
                "out":{"type":"string","description":"Where to write (.noteful, .notecomp or .nfedit)"},"overwrite":{"type":"boolean"},"in_place":{"type":"boolean","description":"Change the source note itself; the previous file is kept as <name>.bak"}}), &["pages"]),
    ]
}

impl Server {
    pub(super) fn call_design(&mut self, name: &str, args: &Value) -> Option<Res<Value>> {
        Some(match name {
            "design_mockup" => self.design_mockup(args),
            "mockup_grid" => (|| {
                let path = PathBuf::from(args["path"].as_str().ok_or("path is required")?);
                let data = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
                let region = args["region"].as_array().map(|r| {
                    r.iter()
                        .filter_map(Value::as_u64)
                        .map(|v| v as u32)
                        .collect::<Vec<_>>()
                });
                let region = match region {
                    Some(r) => Some(<[u32; 4]>::try_from(r).map_err(|_| "region is [x, y, w, h]")?),
                    None => None,
                };
                let png = grid_png(
                    &data,
                    args["step"].as_u64().unwrap_or(50).clamp(10, 400) as u32,
                    region,
                )?;
                Ok(json!([{"type":"image","data":STANDARD.encode(png),"mimeType":"image/png"}]))
            })(),
            "design_page" => self.design(args),
            _ => return None,
        })
    }

    fn design_mockup(&mut self, args: &Value) -> Res<Value> {
        let content = args["content"]
            .as_str()
            .filter(|c| !c.trim().is_empty())
            .ok_or("content is required")?;
        let look = args["look"].as_str().unwrap_or("calm");
        let dark = args["theme"].as_str() == Some("dark");
        let Some(p) = provider(|k| std::env::var(k).ok()) else {
            return Ok(json!([{"type":"text","text":NO_KEY}]));
        };
        let reference = args["reference"].as_str().map(str::to_owned).or_else(|| {
            (look != "calm").then(|| if dark { "answers-tree" } else { "clean-copy" }.to_owned())
        });
        let (image, kind) = match reference.as_deref() {
            None => (None, None),
            Some(r) if noteful_core::ink::EXAMPLES.iter().any(|e| e.name == r) => {
                (Some(self.example_png(r)?), Some("example"))
            }
            Some(r) => (
                Some(std::fs::read(r).map_err(|e| format!("{r}: {e}"))?),
                Some("previous"),
            ),
        };
        let body = request_body(&mockup_prompt(content, look, dark, kind), image.as_deref());
        let data = image_of(&call_model(&p, &body)?)?;
        let dir = library().join("ink").join("mockups");
        std::fs::create_dir_all(&dir)?;
        let stem: String = content
            .trim()
            .chars()
            .take(40)
            .map(|c| {
                if c.is_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        let stem = stem.trim_matches('-').to_owned();
        let stem = if stem.is_empty() {
            "page".to_owned()
        } else {
            stem
        };
        let ext = if data.starts_with(b"\x89PNG") {
            "png"
        } else {
            "jpg"
        };
        let mut out = dir.join(format!("{stem}.{ext}"));
        let mut n = 2;
        while out.exists() {
            out = dir.join(format!("{stem}-{n}.{ext}"));
            n += 1;
        }
        std::fs::write(&out, &data)?;
        let size = image::load_from_memory(&data)?;
        let mime = if ext == "png" {
            "image/png"
        } else {
            "image/jpeg"
        };
        let mut content = vec![
            json!({"type":"text","text":format!("Mockup ({}x{}) saved to {}. Copy it with design_page (size [{}, {}]); zoom with mockup_grid(path, region=[x, y, w, h]) where text is small.", size.width(), size.height(), out.display(), size.width(), size.height())}),
            json!({"type":"image","data":STANDARD.encode(&data),"mimeType":mime}),
        ];
        if let Ok(grid) = grid_png(&data, 50, None) {
            content
                .push(json!({"type":"image","data":STANDARD.encode(grid),"mimeType":"image/png"}));
        }
        Ok(Value::Array(content))
    }

    fn design(&mut self, args: &Value) -> Res<Value> {
        let specs = args["pages"]
            .as_array()
            .filter(|p| !p.is_empty())
            .ok_or("pages must list at least one spec")?;
        if specs.len() > 50 {
            return Err("At most 50 pages per call".into());
        }
        // Every mockup the specs name, decoded once at its spec's pixel size.
        let mut mockups = Mockups::new();
        for spec in specs {
            let size = spec["size"]
                .as_array()
                .and_then(|s| Some((s.first()?.as_u64()? as u32, s.get(1)?.as_u64()? as u32)));
            let parts: Vec<&Value> = match spec["parts"].as_array() {
                Some(p) => p.iter().collect(),
                None => vec![spec],
            };
            for part in parts {
                for path in [part["mockup"].as_str(), spec["mockup"].as_str()]
                    .into_iter()
                    .flatten()
                {
                    if !mockups.contains_key(path) {
                        mockups.insert(path.to_owned(), decode(Path::new(path), size)?);
                    }
                }
            }
        }
        let mut pages: Vec<InkPage> = Vec::new();
        let (mut collisions, mut warnings) = (Vec::new(), Vec::new());
        for (i, spec) in specs.iter().enumerate() {
            let d = design_page(spec, i as u64 + 1, &mockups)?;
            collisions.extend(
                d.collisions
                    .into_iter()
                    .map(|c| format!("page {}: {c}", i + 1)),
            );
            warnings.extend(
                d.warnings
                    .into_iter()
                    .map(|w| format!("page {}: {w}", i + 1)),
            );
            pages.push(d.page);
        }
        let (out, backup, first, data, editor) = match args["path"].as_str() {
            Some(_) => {
                let source = note_path(args)?;
                let data = std::fs::read(&source)?;
                let mut editor = if is_nfedit(&source) {
                    Editor::open_project(std::str::from_utf8(&data)?)?
                } else if is_notecomplete(&data) {
                    Editor::open_notecomplete(&data)?
                } else {
                    Editor::open(&data)?
                };
                let count = editor.page_order().len();
                let at = args["after_page"].as_u64().map_or(count, |n| n as usize);
                if at > count {
                    return Err(format!(
                        "The note has {count} pages; after_page must be 0 to {count}"
                    )
                    .into());
                }
                let shown = insert_pages(&mut editor, at, &pages)?;
                let title = editor.scene.title.clone();
                let (out, backup) = ink_tools::destination(args, Some(&source), &title)?;
                (out, backup, shown[0], Some(data), editor)
            }
            None => {
                let title = args["title"]
                    .as_str()
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or("Design");
                let editor = new_notebook(title, &pages)?;
                let (out, _) = ink_tools::destination(args, None, title)?;
                (out, None, 0, None, editor)
            }
        };
        ink_tools::save(&editor, &out, data.as_deref(), backup.as_deref())?;
        let note = (!collisions.is_empty()).then(|| "Overlapping text: fix these in the spec (move or shorten the text) and write again.".to_owned());
        let report = json!({"written":out,"backup":backup,"pages":editor.page_order().len(),"new_pages":(first + 1..=first + pages.len()).collect::<Vec<_>>(),"collisions":collisions,"warnings":warnings,"note":note});
        self.preview(&out, first, report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_requests_and_replies() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| pairs.iter().find(|p| p.0 == k).map(|p| p.1.to_owned())
        };
        assert!(provider(env(&[])).is_none());
        assert!(
            matches!(provider(env(&[("GEMINI_API_KEY", "k")])), Some(Provider::Studio { key }) if key == "k")
        );
        assert!(
            matches!(provider(env(&[("NOTEFUL_VERTEX_PROJECT", "p")])), Some(Provider::Vertex { location, .. }) if location == "global")
        );
        let p = mockup_prompt("Cells: title, a diagram", "rich", true, Some("previous"));
        assert!(
            p.contains("previous page")
                && p.contains("true black paper")
                && p.contains("Rounded cards")
        );
        let body = request_body("x", Some(b"\x89PNG...."));
        assert_eq!(
            body["contents"][0]["parts"][0]["inlineData"]["mimeType"],
            "image/png"
        );
        assert_eq!(body["contents"][0]["parts"][1]["text"], "x");
        let reply = json!({"candidates":[{"content":{"parts":[{"text":"here"},{"inlineData":{"mimeType":"image/png","data":STANDARD.encode(b"img")}}]}}]});
        assert_eq!(image_of(&reply).unwrap(), b"img");
        assert!(image_of(&json!({"candidates":[{"finishReason":"SAFETY"}]}))
            .unwrap_err()
            .to_string()
            .contains("SAFETY"));
        assert!(image_of(&json!({"error":{"message":"API key not valid"}}))
            .unwrap_err()
            .to_string()
            .contains("not valid"));
    }

    #[test]
    fn grids_and_design_pages_from_a_mockup() {
        let dir = std::env::temp_dir().join(format!("nc-design-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // A small mockup: ivory page with a blue card.
        let mut img = image::RgbImage::from_pixel(300, 400, image::Rgb([250, 246, 238]));
        for y in 100..180 {
            for x in 30..270 {
                img.put_pixel(x, y, image::Rgb([160, 205, 245]));
            }
        }
        let mock = dir.join("mock.png");
        img.save(&mock).unwrap();
        let data = std::fs::read(&mock).unwrap();
        let (svg, width) = grid_svg(&data, (300, 400), 50, None);
        assert_eq!(width, 300);
        assert!(svg.contains(">250</text>") && svg.contains("data:image/png;base64,"));
        let (zoomed, zw) = grid_svg(&data, (300, 400), 50, Some([0, 0, 100, 100]));
        assert_eq!(zw, 900);
        assert!(zoomed.contains("viewBox=\"0 0 100 100\"") && zoomed.contains(">10</text>"));

        let mut server = Server::default();
        let out = dir.join("design.noteful");
        let spec = json!({"size":[300,400],"mockup":mock,"items":[
            {"t":"text","x":30,"y":60,"h":20,"text":"{#e9573f:CELLS} today"},
            {"t":"rect","x":30,"y":100,"w":240,"h":80,"fill":"auto","stroke":"#2f7fd6","r":10},
            {"t":"text","x":45,"y":140,"h":12,"text":"Inside the card"}]});
        let reply = server
            .handle(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"design_page","arguments":{"pages":[spec],"title":"Design","out":out}}}))
            .unwrap();
        assert_ne!(reply["result"]["isError"], true, "{reply}");
        let report: Value =
            serde_json::from_str(reply["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(report["pages"], 1);
        assert_eq!(report["collisions"], json!([]));
        assert_eq!(
            Editor::open(&std::fs::read(&out).unwrap())
                .unwrap()
                .page_order()
                .len(),
            1
        );
        let bad = server
            .handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"design_page","arguments":{"pages":[{"mockup":dir.join("missing.png"),"items":[]}]}}}))
            .unwrap();
        assert_eq!(bad["result"]["isError"], true);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
