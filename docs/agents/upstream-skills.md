# Upstream skills

Some skills in `.claude/skills/` are copies of another repo's skills, vendored so this repo picks which to load and can fork them. [`.claude/skills/upstream.json`](../../.claude/skills/upstream.json) records each upstream path's status and the commit it was synced at. `/check-upstream-skills` reports what moved upstream since then.

## Layout

Every skill sits flat at `.claude/skills/<name>/`, vendored or this repo's own, since nested folders load lazily. A vendored skill keeps its upstream supporting files and `agents/openai.yaml` as upstream has them.

## The manifest

Each upstream path has one entry with a `status`:

- `vendored`: copied here; its `syncedSha` is the upstream commit the copy matches, apart from its recorded divergences.
- `reference-only`: tracked for its upstream changes, never copied, so it costs no context.
- `declined`: not taken, with a one-line `reason`.

`notes` holds each deliberate divergence of the copy. A fork into a new skill of this repo's own names it in `derivedInto`.

## Editing a vendored skill

Record every edit to a vendored copy as a divergence in its `notes`, worded so the next sync can reapply it. An unrecorded edit is lost when the copy is next replaced from upstream. A change big enough to make the skill this repo's own is a fork: copy it under a new name and set `derivedInto`.
