---
name: notecomplete-handwriting-study
description: Write natural handwritten NoteComplete/Noteful notebooks, grade handwritten quizzes on existing pages, rewrite messy pages as clean copies, and reproduce page designs from mockups using the NoteComplete MCP. Use when the user asks for handwritten ink notes, grading/marking a notebook page, or recreating a study sheet layout in ink.
---

# NoteComplete Handwritten Study Pages & Grading

Use this workflow when writing handwritten ink notebooks, annotating/grading pages, or building visual study sheets. Check the NoteComplete MCP `initialize` instructions for the user's format setting (`Both` by default — feel free to use ink, Markdown, or combine **both** in the same note via `write_notes` / `add_prefab` with `target="notes"`, choosing what fits each part best; if set to `Markdown only`, use `notecomplete-markdown-prefabs` instead).

## 1. Writing new handwritten pages (`create_notebook`, `add_pages`, `clean_copy`)
1. Always call `example_pages()` (or `example_pages(name)` for `cell-biology`, `radiation`, `clean-copy`, `quiz`, `answers-tree`) first to match the dialect and layout density.
2. Aim for ~90% of one page per section using `!columns`, `> [sky]`, `!zone`, `!stat`, `!sticky`, and plain SVG `!draw` blocks. For boxes/cards/frames, use `> [color]`, `!sticky`, `!zone`, or `shape` rectangles—**never** stack or tile multiple highlighter strokes to fake a box.
3. For formulas and worked math, **always** use native KaTeX `textbox` items (`math: true`) via `write_on_page` (leaving space in the layout) rather than plain-text approximations or hand-drawn equations. **Save to `.nfedit`** whenever a notebook uses prefabs or `math: true` text boxes (`.noteful` flattens prefabs to static images and strips `math: true`).
4. For graphs, statistical/R plots (`r_figure` / `r-math`: normal, t, chi-square, binomial, histogram, boxplot, scatter, custom R), function plots (`plot`), charts (`histogram`/`bar`), timelines, process states, UML, truth tables, or number lines, leave space on the page (or use `!zone`) and call `add_prefab` on the generated `.nfedit` page instead of hand-drawing them in `!draw`. For `r_figure`, pre-run with `Rscript` and embed `cache.svg` so plots are immediately rendered and stay double-click editable in NoteComplete.
5. When summarizing a source PDF/manual, add clickable `[label](file:///abs/path/to/file.pdf#page=N)` links on both new and existing pages so clicking jumps straight to the expanded source page.
6. Inspect the returned PNG preview after every write (and do a quick final page-by-page overview with `page_image` once generation finishes) to catch any text/axis/label overlap or crowding and tighten/reposition before finishing.

## 2. Grading or marking an existing page (`page_image` → `page_layout` → `write_on_page`)
1. Call `page_image(path, page)` to read the student's answers.
2. Call `page_layout(path, page)` to get exact `[x0, y0, x1, y1]` boxes for every handwritten line, option, and text box.
3. Submit **one batched `write_on_page`** call with all marks (`check`, `cross`, `ellipse`, `highlight`, `text`, `textbox`, `tape`).
4. Verify the returned preview so no marks collide with existing ink.

## 3. Copying a page design from a picture (`design_mockup` → `mockup_grid` → `design_page`)
1. Generate a layout picture with `design_mockup` (or use any image path).
2. Inspect coordinates with `mockup_grid(image)` (and `region` to zoom in).
3. Render crisp handwriting, cards, highlights, and traced drawings with `design_page`.
