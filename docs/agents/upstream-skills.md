# Upstream skills

Some skills in `.claude/skills/` are copies of another repo's skills, vendored so this repo picks which to load and can fork them. [`.claude/skills/upstream.json`](../../.claude/skills/upstream.json) records each upstream path's status and the commit it was synced at. `/check-upstream-skills` reports what moved upstream since then.

## Layout

Every skill sits flat at `.claude/skills/<name>/`, vendored or this repo's own, since nested folders load lazily. A runner skill lives in `runner/skills/<name>/` and sits here as a symlink, `.claude/skills/<name>` → `../../runner/skills/<name>`, so it is invoked as `/<name>` where a plugin would namespace it as `/<plugin>:<name>`. **A runner skill's link out of its own folder climbs to the repo root first**, as in `../../../runner/GLOSSARY.md`, with the repo-root path as its text: Claude Code gives the model `.claude/skills/<name>/` as the base directory ([symlinks and protection](../claude-code-behaviour.md#symlinks-and-protection)), and only a link through the root resolves the same from it and from `runner/skills/<name>/`, which are equally deep. A vendored skill keeps its upstream supporting files and `agents/openai.yaml` as upstream has them.

## The manifest

Each upstream path has one entry with a `status`:

- `vendored`: copied here; its `syncedSha` is the upstream commit the copy matches, apart from its recorded divergences.
- `reference-only`: tracked for its upstream changes, never copied, so it costs no context.
- `declined`: not taken, with a one-line `reason`.

`notes` holds each deliberate divergence of the copy. `derivedInto` lists the forks: skills of this repo's own copied from this path under new names, or a repo-relative path for a fork outside `.claude/skills/`. The runner's implement-step prompt, `runner/src/implementStep.ts`, is one: a fork of `implement`. The report names a changed path's forks, so each one gets a verdict on whether to take the same change. A sync never copies upstream over a fork.

## Editing a vendored skill

Record every edit to a vendored copy as a divergence in its `notes`, worded so the next sync can reapply it. An unrecorded edit is lost when the copy is next replaced from upstream. A change big enough to make the skill this repo's own is a fork: copy it under a new name and add that name to the path's `derivedInto`. A fork may keep the upstream name when the path turns `reference-only`, since nothing then copies upstream over it.
