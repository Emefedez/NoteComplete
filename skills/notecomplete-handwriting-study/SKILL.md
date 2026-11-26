---
name: notecomplete-handwriting-study
description: Write natural handwritten NoteComplete/Noteful notebooks, grade handwritten quizzes on existing pages, rewrite messy pages as clean copies, and reproduce page designs from mockups using the NoteComplete MCP. Use when the user asks for handwritten ink notes, grading/marking a notebook page, or recreating a study sheet layout in ink.
---

# NoteComplete Handwritten Study Pages & Grading

Use this workflow when the user explicitly wants handwritten ink notebooks, page annotations/grading, or visual mockup-to-ink study sheets. (If the user has **Prefer Markdown (.md)** enabled and did not ask for handwriting, use `notecomplete-markdown-prefabs` instead.)

## 1. Writing new handwritten pages (`create_notebook`, `add_pages`, `clean_copy`)
1. Always call `example_pages()` (or `example_pages(name)` for `cell-biology`, `radiation`, `clean-copy`, `quiz`, `answers-tree`) first to match the dialect and layout density.
2. Aim for ~90% of one page per section using `!columns`, `> [sky]`, `!zone`, `!stat`, `!sticky`, and plain SVG `!draw` blocks.
3. For formulas, prefer native KaTeX `textbox` items (`math: true`) via `write_on_page` rather than hand-drawn equations.
4. Inspect the returned PNG preview after every write; if content spills onto an extra page or overlaps, tighten and re-run.

## 2. Grading or marking an existing page (`page_image` → `page_layout` → `write_on_page`)
1. Call `page_image(path, page)` to read the student's answers.
2. Call `page_layout(path, page)` to get exact `[x0, y0, x1, y1]` boxes for every handwritten line, option, and text box.
3. Submit **one batched `write_on_page`** call with all marks (`check`, `cross`, `ellipse`, `highlight`, `text`, `textbox`, `tape`).
4. Verify the returned preview so no marks collide with existing ink.

## 3. Copying a page design from a picture (`design_mockup` → `mockup_grid` → `design_page`)
1. Generate a layout picture with `design_mockup` (or use any image path).
2. Inspect coordinates with `mockup_grid(image)` (and `region` to zoom in).
3. Render crisp handwriting, cards, highlights, and traced drawings with `design_page`.
