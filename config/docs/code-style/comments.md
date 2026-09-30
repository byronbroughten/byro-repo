# Comments: reasoning and examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Comments". The rules are there, one line each; this file holds the examples and the why.

## Pull a "what" comment into a named method

A block that would need a comment saying _what_ it does becomes a small private method whose name says it. `Importer._updateAll` split into `_deleteStaleRows`, `_appendMissingRows` and `_updateComputedValues`, and the call site now reads as the list of steps.

## A comment explains a "why not the obvious thing"

A comment sits trailing or immediately above its line and never restates the line. `action: "boolean", // Should perhaps be "boolean" | "string"` is the shape: it tells the reader why the obvious value isn't there.

## File-level navigation blocks

A navigation block is 5–10 lines immediately above the exported class, stating the file's job and where neighbouring work lives, so an agent opens the right sibling instead of the whole tier.
