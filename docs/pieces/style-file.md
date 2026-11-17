# Style files

A Style file holds what a piece review's `standards` axis applies beside the Voice and Craft sheets: the spec's axis values and its Style field's overrides, Form and Order. `/review-piece` writes it in its inputs step, and the runner writes it for its piece review step (`styleInputsOf` in `runner/src/Workflow/piece/reviewInputs.ts`), which the review then uses as given.

## File format

- **It opens with `Evidence:`, `Formality:` and `Academic:` lines**, the spec's Evidence and Formality values and `yes` or `no`; `Academic: yes` adds [`docs/academic-writing-style.md`](../academic-writing-style.md)'s rules.
- **An optional `Kind:` line says what the Piece is.**
- **Then a required `## Overrides` heading holds the spec's overrides, Form and Order, verbatim**, the heading left empty when the spec has none, so a reviewer can tell no overrides from lost ones. Without Form and Order, a letter's required closing ask reads as a late recommendation.
