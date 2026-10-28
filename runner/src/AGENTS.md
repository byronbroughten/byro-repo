# Rules for the runner's `src/`

- **Which file holds a module: the file table in [`runner/README.md`](../README.md)**, one row per file, each one line naming its job. Its words are [`GLOSSARY.md`](../GLOSSARY.md)'s.
- **`SpecRun.ts` only delegates; the `SpecRun/` folder holds one collaborator per concern**, and the table's `SpecRun/` rows name each one's job in one line, so pick the file from there rather than reading `SpecRun/` in ranges.
- **Test `SpecRun` through `specRunHarness.ts`**; each `SpecRun.<subject>.test.ts` covers one group, so the nearest one is the model for a new test.
