# sheets-framework#168 outcome

Spec: [sheets-framework#166](https://github.com/byronbroughten/sheets-framework/issues/166)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #168 | Opus medium | 2 | 3 | 52K | Fix (resumed implementer) | 2 | 1 | 0 | 6 min | $0.92 | $1.75 | Fixed: The new pointer gives the app's businessEndpoints AGENTS.md two labels, and the link sits on the 'worked example' one rather than on 'the app's own endpoint-folder rules'. (packages/framework/docs/architecture/endpoint-dispatch.md:7). Proposed: The framework code-style docs restate the app-only rule that a business operator's verb comes from the app's GLOSSARY, using a monorepo-relative path. (packages/framework/docs/code-style.md:49, packages/framework/docs/code-style/naming.md:45); Framework docs still use the app's buildLedger.ts, OccupancyLedgerOperator, buildLedger.test.ts and businessEndpoints map as worked examples without marking them as the app's. (packages/framework/docs/code-style/class-shape.md:13,64; docs/testing.md:96; docs/code-style/type-modeling.md:29). | 411230d8-9cd1-4bfb-b579-763234ed12e8, 01f17e17-48ac-4e78-94f9-07b04804473e |
