# Recognition (OCR and similar local models)

Recognition runs on the device (Tesseract.js / ONNX in a worker), downloads its data on first use, and runs as a background job. These rules make its output useful without a server.

## Quality as passes

- Normal: a few passes (the whole page; the ink alone at two sizes). **High**: more passes, larger, with thickened strokes, as scattered text (segmentation mode 11), and every detected line read again on its own (mode 7, a `rectangle` per line).
- **Voting**: readings of one spot from different passes merge; the text is chosen by summed confidence; a reading that is a real word counts double. Two words of the *same* pass never merge (close CJK characters, a word and its accent). A fragment of a word that one pass split goes when more passes agree on the whole.
- Words come out **line by line** (group by vertical overlap of the middle), not sorted by raw y.
- Full-precision models may need routines the web build lacks (Tesseract's float `tessdata_best` aborts in the WASM cores): measure before promising them; get quality from passes and voting instead.

## Quick result first

- Offer "Quick result first" for the slow mode: every page gets the normal passes (stored, searchable at once), then the extra passes run and **vote together with the kept readings** instead of starting over. Make the slow set a superset of the quick set so nothing is read twice.
- Stopping in between keeps the quick result and says how many pages have only that.

## Spelling help from word lists

- Per chosen language: a **frequency list** (picks corrections) and a **full word list** (vetoes corrections of real but rare words). Download on first use, credit their licences, release them when the job ends (full lists are tens of MB in memory). Combine languages with frequencies normalised per million so an English term in Spanish notes is a word, not a typo.
- Normal mode, conservative: only words that are not words; candidates from look-alike characters (`/`→l, `€`→e, `rn`→m) and one-letter edits, ranked by likely confusion then frequency; a close second means leave it.
- Deep mode, a noisy channel: for each word score candidates (the reading, other passes' readings, one and two edits away) by `log10(frequency) − λ·cost`, λ rising with the engine's confidence; costs: look-alike < confused letters < any letter. An accented reading that is a word is kept (the engine saw the mark); acronyms are kept.
- Never lose the original: the reading stays as an alternative the search matches.

## Search over recognised text

- Fuzzy for recognised sources (one edit on long words), exact elsewhere.
- Chinese/Japanese: split into characters in the query and the index (each character gets a slice of its word's box), so a query matches across OCR's arbitrary word breaks; no spaces between CJK characters in snippets.

## Measure it

- Make ground truth: write known text as handwriting in several hands (fonts × neatness × pen) and score recall/precision per quality (`tools/ocr_handwriting_bench.mjs` in NoteComplete). Include mixed-language lines. Compare old and new code on the same text before claiming a gain.
- Real handwriting differs from synthetic: say so when reporting numbers.
