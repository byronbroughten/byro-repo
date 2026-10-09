# Glossary map

Three contexts, one per package, each with its own `GLOSSARY.md` glossary. Read the ones the topic touches; the app's glossary assumes the framework's.

## Contexts

- [Sheets framework](./packages/framework/GLOSSARY.md): what an operator sees in any app built on the framework: sheet layout, endpoints, run states, columns.
- [Real estate](./packages/real-estate/GLOSSARY.md): this app's own words: units and the occupancy ledger.
- [Writing](./packages/writing/GLOSSARY.md): the words of a reader-facing prose spec: Piece, Deliverable and Reference.

## Relationships

- **The app refines the framework's terms, never redefines them.** It links to a framework term where it leans on one, and lists the words the two use differently under its "Same word, two meanings".
- **The framework names nothing from the app.** A term every Sheets-backed app would want goes in the framework's glossary; a real-estate term goes in the app's.
- **Writing shares no terms with the two Sheets contexts.** Its glossary links neither of theirs, and neither links it.
- **Architecture words are neither Sheets glossary's**: Raw, Identified, Named, profile and Operator are the framework's [`docs/vocabulary.md`](./packages/framework/docs/vocabulary.md).
