Handwriting Markdown, one block per line. `look: study` (default) composes study notes; `look: classic` is a plain notebook.

Study look:
- `# THE **CARDIAC** CYCLE` title in thick capitals with a soft shadow; the `**word**` takes the accent. End with `:heart:` (or sun, star, atom, drop, bolt, cloud, leaf) for a doodle beside it.
- `# SOLAR & TERRESTRIAL // RADIATION` two-line title, the second line big on a marker band.
- `_Meteorology · week 3_` subtitle line, then a thin rule.
- `## Section` or `## **SMOOTH** muscle` coloured capitals on a rule to the margin; each section takes the next accent (three per page).
- `### Label` small coloured capitals.
- Body is mixed case: `**term**` accent colour, `==phrase==` highlighter (`=={pink}phrase==`), `[[tag]]` pill, `((detail))` grey.
- Items: `- dot`, `* star`, `-> hook arrow`, `1. circled number`, `[ ] open` / `[x] done`.
- `> [sky] TITLE: text ((detail))` card with a pastel fill; `>> A: text || B: text` cards side by side.
- `!columns 55` … `!col` … `!end` columns (the first 55 % wide); put a `!draw` on one side.
- `!zone [sky]` … `!end` a pale full-width band behind a topic.
- `!sticky [yellow] TITLE: text` a taped sticky note, slightly turned.
- `!stat 30 reflected (albedo)` a big number with its meaning.
- `!map TOPIC | question?` then `- BRANCH` lines and indented `  - leaf` lines: a tree diagram (best on dark pages).
- `!draw 480` then an `<svg viewBox=…>…</svg>` then `!end`: a diagram drawn in ink (see below).
- `!tape [mint]` a strip of washi tape; `---` a thin rule; `\pagebreak` a new page.
- Colours: coral, amber, sky, purple, teal, pink (or #hex). Keep 2–3 per page.

Classic look: `# ` `## ` `### ` headings, `- ` bullets, `[ ] ` / `[x] ` checkboxes, `-> ` arrows, `> ` boxed note, `---` divider, `{color:red} ` colour for one line, `==text==` highlighter, `!tape mint`.

Science: Greek letters, `T^4`, `m^{-2}`, `CO_2`, `λ_{max}`, `→ ⇄ ≈ ± ° √ ∞ ≤ ≥` are drawn by hand. Accented letters (á é í ó ú ñ ü ç …) and ¿ ¡ are written with their accents.

Drawings: plain SVG with a viewBox 400–650 wide, scaled to the width given (the page is 1091 wide; inside a column it is capped by the column), so labels need font-size 18–22. Outlines (`stroke="#1f2233" stroke-width="2"`) become hand-drawn ink; fills become pastel highlighter colouring under the ink, so separate stacked parts with outlines, not darker fills; later shapes cover earlier ones. `<text x y font-size text-anchor>` becomes handwriting: put labels outside the drawing, joined to their part by a `<line>`. Use curves (C/Q/A) for organic shapes. Gradients, patterns, masks, clip paths, images and `<use>` are skipped.

Options: paper dot | grid | ruled | blank (dark-… for black pages); theme light | dark; font patrick (default), caveat, readability, felix, allure, elfin, nixish; hand neat | natural | messy; pen fineliner (study default) | ballpoint (pressure, classic default); size is the body x-height (default 11; the page is 1091 × 1543).
