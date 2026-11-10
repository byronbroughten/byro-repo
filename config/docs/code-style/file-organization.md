# Imports and file organization: examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Imports & file organization". The rules are there, one line each; this file holds the examples.

## No barrel files

A package's declared public entries are its only barrels. Every other file is imported directly by its path, except a test harness's subject-split pieces, which reach its tests through the harness (below).

## File naming

- A class file mirrors its exported class: `RowImporter.ts`, `ConfigLoader.ts`.
- A static-bundle file takes a short abbreviation: `Str.ts` exports `Str`. A fat bundle's pieces split into a same-named subfolder, as `Obj/merge.ts` in `@byronbroughten/utils` does, and are re-assembled in the parent file.
- Plain data, config and entry-point files are camelCase: `columnConfigs.ts`, `routes.ts`, `index.ts`.
- A module whose helpers fall into groups that share nothing splits by subject into a same-named subfolder: `HttpClient/headers.ts` exports `requestHeaders`.
- A test harness split that way re-assembles its pieces: `runner/src/specRunHarness.ts` re-exports the builders in `specRunHarness/stepResults.ts` and `timing.ts`, so the 27 SpecRun test files keep one import. A barrel's costs (every importer loading everything behind it, import cycles, bundles that can't drop unused code) don't reach test code, which never ships. The harness also keeps its own fixture, setup and readers, so it isn't a barrel. (R667.1 on byronbroughten/byro-repo#667)
