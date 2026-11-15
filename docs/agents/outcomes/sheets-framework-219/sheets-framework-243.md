# sheets-framework#243 outcome

Spec: [sheets-framework#219](https://github.com/byronbroughten/sheets-framework/issues/219)

| Issue | Workflow | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #243 | code | Opus low | 1 | 4 | 80K | Fix (resumed implementer) | 1 | 1 | 0 | 0 | 7 min | $1.26 | $2.19 | Fixed: A dry run with the Layout tab missing throws while placing layoutRight beside layoutLeft. (packages/framework/dev/chores/devFixtures/DevFixtureBuilder.ts:53-59); _addFixtureTable is a Middle Man that only forwards to createTable. (packages/framework/dev/chores/devFixtures/DevFixtureBuilder.ts:62); The ID-second reorder has no reason at the site. (packages/framework/dev/chores/devFixtures/devFixtureSheets.ts:48); A dry run with the Layout tab missing throws in _originBeside. (packages/framework/dev/chores/devFixtures/DevFixtureBuilder.ts:53-59). Proposed: TableOrigin.expected() repeats the newTab origin that createTable already decides. (packages/framework/dev/chores/devFixtures/DevFixtureBuilder.ts _addFirstTableExtras). | ce751249-7927-493b-936e-0992530306a6, 215436da-186a-4db4-9efa-c43ab2a5973b |
