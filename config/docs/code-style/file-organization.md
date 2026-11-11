# Imports and file organization: examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Imports & file organization". The rules are there, one line each; this file holds the examples.

## No barrel files

A package's declared public entries are its only barrels. Every other file is imported directly by its path, except a subfolder's pieces, which reach their importers through the same-named parent file that re-assembles them.

## Re-assembling a subfolder isn't a barrel

A barrel costs in three ways: every importer loads everything behind it, it makes import cycles easy to create, and a bundler can't drop what it forwards. The first two reach test code as much as shipped code, so "tests never ship" doesn't exempt a test file. A parent re-assembling its own subfolder avoids the costs another way: its importers want the whole subject anyway, so routing the pieces through it loads nothing extra. `Obj.ts` users want `Obj`, and every SpecRun test already loads `runner/src/specRunHarness.ts` for its setup. A file that forwards unrelated files has no such subject, and is a barrel in any folder.

Each piece goes through whole: `Obj.ts` takes `merge` from `Obj/merge.ts` as it is, and a harness exports its `stepResults` bundle, not members picked out of it. A hand-picked list is a second copy of the piece's members that has to be kept in step, and the harness's had already drifted: a test imported the harness and `stepResults.commitFile` beside it, because the list left `commitFile` out. (R667.1 on byronbroughten/byro-repo#667)

## File naming

- A class file mirrors its exported class: `RowImporter.ts`, `ConfigLoader.ts`.
- A static-bundle file takes a short abbreviation: `Str.ts` exports `Str`. A fat bundle's pieces split into a same-named subfolder, as `Obj/merge.ts` in `@byronbroughten/utils` does.
- Plain data, config and entry-point files are camelCase: `columnConfigs.ts`, `routes.ts`, `index.ts`.
- A module whose helpers fall into groups that share nothing splits by subject into a same-named subfolder: `HttpClient/headers.ts` exports `requestHeaders`.