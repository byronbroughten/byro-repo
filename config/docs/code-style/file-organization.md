# Imports and file organization: examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Imports & file organization". The rules are there, one line each; this file holds the examples.

## No barrel files

A package's declared public entries are its only barrels. Every other file is imported directly by its path.

## File naming

- A class file mirrors its exported class: `RowImporter.ts`, `ConfigLoader.ts`.
- A static-bundle file takes a short abbreviation: `Str.ts` exports `Str`. A fat bundle's pieces split into a same-named subfolder, as `utils/Obj/merge.ts` does, and are re-assembled in the parent file.
- Plain data, config and entry-point files are camelCase: `columnConfigs.ts`, `routes.ts`, `index.ts`.
- A long module's helpers split by subject into a same-named subfolder: `HttpClient/headers.ts` exports `requestHeaders`.
