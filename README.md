# Real Estate Manager — Apps Script

> Coding agents working in this repo: start at [`AGENTS.md`](./AGENTS.md). This README is for people.

An npm-workspaces root for managing real estate operations — properties, units, households, leases, subsidies, charges and payments — on a Google Sheets spreadsheet that acts as both the database and the UI, with TypeScript compiled and pushed to Apps Script.

## The packages

| Package | What it is |
| --- | --- |
| [`sheets-framework`](https://github.com/byronbroughten/sheets-framework) (`@byronbroughten/sheets-framework`), cloned into `packages/framework` | A project-agnostic framework for typed apps on Google Sheets + Apps Script: the numbered tiers from raw cell I/O up to endpoint dispatch, the Node and Apps Script hosts, and the `sheets-framework` bin. It names nothing from real estate, and it is tested against its own dev spreadsheet, `Sheets Framework Dev`. |
| [`sheets-real-estate`](https://github.com/byronbroughten/sheets-real-estate) (`sheets-real-estate`), cloned into `packages/real-estate` | This project: the real-estate endpoints and chores, bundled with the framework's source and pushed to the business spreadsheet's Apps Script project. |
| [`utils`](https://github.com/byronbroughten/utils) (`@byronbroughten/utils`), cloned into `packages/utils` | Domain-free TypeScript utilities, one import subpath per module: `Arr`, `Obj`, `Str`, `Val`, `lazy`, and `SerialDate` and `SerialDateTime` for dates as Sheets serials. The framework and the app both depend on it. |
| `writing`, a private repo cloned into `packages/writing` | Specs for reader-facing prose, filed as issues. The text itself lives in Google Docs. Its repo is private, so it has no public link. |
| [`config`](./config/README.md) (`@byronbroughten/config`) | The general tooling the packages share: an ESLint flat-config preset, the prettier config and a base tsconfig. The framework layers its tier and Sheets rules on it in its own `eslint.config.mjs`, and exports the app's as a preset. |

Before adding a file, ask "would this make sense in a TypeScript project with no Sheets at all?" If yes, it belongs in `packages/utils`. If not, ask "would this make sense in a completely different Sheets-backed app?" If yes, it belongs in `packages/framework`, generically named. If no, it belongs in `packages/real-estate`. A piece of writing for a reader goes in `packages/writing`.

## Architecture: the numbered tiers

Each numbered folder under the framework's `src/` is a dependency tier, and dependencies only point downward (lint enforces it):

| Folder | What it does |
| --- | --- |
| `00_Source` | The host-neutral `RawSource` port, cell values, and the Google Sheets adapter behind the port |
| `01_SpreadsheetSchema` | The configs generated from the live spreadsheet, and the types and schema classes that read them |
| `02_SpreadsheetRaw` | Positional reads and writes, by sheet ID and row and column index |
| `03_SpreadsheetIdentified` | Sheets and columns addressed by generated ID |
| `04_SpreadsheetNamed` | Sheets and columns addressed by name: the API most code uses |
| `05_Operators` | Classes that add methods for one data structure, including regenerating the configs |
| `06_API` | Routing a sheet edit to the endpoint registered for its column |

The app imports the framework only through its public entry. The precise words for all of this (Raw, Identified, Named and profile) are defined in [`vocabulary.md`](https://github.com/byronbroughten/sheets-framework/blob/master/docs/vocabulary.md).

## Two spreadsheets

Every command that touches a live spreadsheet names its target: `dev:*` for `Sheets Framework Dev`, `app:*` for the real-estate one, as `npm run dev:chore <name>` or `npm run app:gen:configs`. [`docs/targets-and-gates.md`](./docs/targets-and-gates.md) has the full table.

## Words

[`GLOSSARY-MAP.md`](./GLOSSARY-MAP.md) points at the three glossaries: the framework's operator-facing words, the app's units and occupancy ledger, and the words of a writing spec.

## Testing

Vitest, across the two Sheets packages: `npm test`. Co-located `Foo.test.ts`. Fakes, exemplars, and endpoint-run testing: [`testing.md`](https://github.com/byronbroughten/sheets-framework/blob/master/docs/testing.md).

## Known rough edges

- **The properties probe is blind to a Table that moved down or right.** On the trigger path, a sheet's table metadata arrives only because `SheetRaw.gatherFetchProperties` requests the single cell at the Table header row and start column, and the Sheets API returns a sheet's `tables` only for a filter whose range overlaps the table. That probe, and the column-id row that shares its round trip, aim at the layout constant; later row fetches use the live Table start once `tables.range` is in state. A table that moved down or right still returns no metadata and looks identical to a table that was never created. That is why `SpreadsheetRaw`'s placement reporter pays for one full sheet-properties read before throwing, to tell "no Table here" from "Table somewhere else" — only on a path that is already aborting (#9).
