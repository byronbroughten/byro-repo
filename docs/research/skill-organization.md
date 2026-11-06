# How should skills be organized? (research for byronbroughten/byro-repo#576)

Researched 2026-11-06 against Claude Code 2.1.319. Remote sources were read from shallow clones and from the docs' Markdown endpoints (`https://code.claude.com/docs/en/<page>.md`):

- `mattpocock/skills` at `4ae2317` (2026-10-31)
- `anthropics/skills` at `ca45fc4` (2026-10-28)
- `anthropics/claude-plugins-official` at `a1ecfbc` (2026-11-05)
- `obra/superpowers` at `22f0b46` (2026-11-03)
- `openai/skills` at `49f948f`

Local paths are relative to the byro-repo root.

## 1. How `mattpocock/skills` groups its skills

**Layout.** There are 39 `SKILL.md` files, each at `skills/<bucket>/<name>/SKILL.md`. The buckets are `engineering/` (20 skills), `productivity/` (7), `misc/` (4), `in-progress/` (8) and `deprecated/` (empty). No skill sits deeper than one bucket.

**Stated why.** `AGENTS.md:1-7` (`CLAUDE.md` is identical) says:

> Skills are organized into bucket folders under `skills/`:
> - `engineering/`: daily code work
> - `productivity/`: daily non-code workflow tools
> - `misc/`: kept around but rarely used, not promoted
> - `in-progress/`: beta: public on purpose, feedback wanted, not shipped in the plugin
> - `deprecated/`: no longer used

So a bucket encodes two things: the kind of work (code or non-code), and the skill's **release status** (promoted, frozen, beta or retired). `AGENTS.md:9` says:

> Every skill in `engineering/` or `productivity/` (the **promoted** buckets) must have a reference in the top-level `README.md` and an entry in `.claude-plugin/plugin.json`'s `skills` array (the Claude Code plugin ships exactly the promoted set).

Other parts of the repo follow the buckets:

- **Bucket READMEs.** Each bucket has a `README.md`. The promoted buckets group their skills into "User-invoked" and "Model-invoked"; the rest use a flat list (`AGENTS.md:15`).
- **Docs pages.** `docs/<bucket>/<skill>.md` mirrors only the two promoted buckets. "the docs path is repo organisation only" (`AGENTS.md:17`).
- **Frozen skills.** `.out-of-scope/frozen-misc-skills.md` freezes `misc/`: "They aren't promoted: they don't ship in the Claude Code plugin, they have no docs page".

**Manifest.** `.claude-plugin/plugin.json:21-49` names one plugin, `mattpocock-skills`, whose `skills` field is an explicit array of 27 paths: `./skills/engineering/<name>` and `./skills/productivity/<name>`. `.claude-plugin/marketplace.json` makes the repo a one-plugin marketplace (`"source": "./"`).

**Why the manifest takes that shape.** ADR `.agents/adr/0002-ship-as-a-claude-code-plugin.md:7-17` explains it. Claude Code's `plugin.json` "accepts `skills` as an **array of explicit skill-directory paths**", which lets the plugin ship only the promoted set out of the bucketed tree. Codex accepts only "a **single path string**" and "discovers `SKILL.md` files recursively under it". Codex also "**drops symlinks**" when it copies a plugin, so a flat directory of symlinks into the buckets "does not survive install".

**Namespacing.** `.out-of-scope/harness-name-collisions.md` relies on it to resolve clashes with built-ins: "The Claude Code plugin exposes every skill under its plugin name … `/mattpocock-skills:research`". The buckets themselves never appear in a skill's name.

**Local dev install.** `scripts/link-skills.sh` finds every `SKILL.md` outside `deprecated/` and `misc/` and symlinks each skill folder **flat** into `~/.claude/skills/<basename>` (`names+=("$(basename "$src")")`, then `ln -sfn "$src" "$target"`). The bucket is dropped at install time.

## 2. Claude Code's discovery rules (official docs)

**Plain skills are discovered exactly one level down.** The location table at `skills.md:156-164` (https://code.claude.com/docs/en/skills) gives `Project | .claude/skills/<skill-name>/SKILL.md`, and the same `<skill-name>/SKILL.md` shape for personal, enterprise and `--add-dir` locations. No page I read documents recursion inside `.claude/skills/`.

I ran a probe on 2.1.319 in a scratch git repo with two skills:

- `.claude/skills/flat-probe/SKILL.md`
- `.claude/skills/grp/nested-probe/SKILL.md`

`claude -p` listed only `flat-probe`. `/nested-probe` answered "`/nested-probe` isn't installed in this session". `/grp:nested-probe` was not found either, while `/flat-probe` ran. **A grouping folder inside `.claude/skills/` hides the skills beneath it.**

Contrast with commands: a subfolder of `.claude/commands/` *is* namespaced, `.claude/commands/frontend/component.md` → `/frontend:component` (`skills.md:449`).

**Symlinks.** `skills.md:168`:

> a `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk. Claude Code reads `SKILL.md` from the target and loads the skill once even if several locations point at the same target.

**Nested `.claude/skills/` in subdirectories (monorepos).** `skills.md:161` lists a "Nested" location, `<subdir>/.claude/skills/<skill-name>/SKILL.md`. `skills.md:177` says skills load "from `.claude/skills/` in the directory where you start it and in every parent directory up to the repository root". `skills.md:181` describes the lazy load:

> Skills in a `.claude/skills/` directory below where you started don't load at startup. They load the first time Claude reads or edits a file in that subdirectory … Until then they don't appear in the `/` menu and you can't invoke them by name.

When names clash, both skills load and the nested one becomes `/apps/web:deploy` (`skills.md:183-186, 446`). In a worktree, the search for parent directories stops at the worktree root (`skills.md:179`).

**Plugin skills and naming.** A plugin skill lives at `<plugin>/skills/<skill-name>/SKILL.md` and loads "as `/plugin-name:skill-name`" (`skills.md:163`). The naming table gives `my-plugin/skills/review/SKILL.md → /my-plugin:review`, and frontmatter `name` replaces only the last segment (`skills.md:450`; `plugins/components.md:247`). A plugin skill and a plain skill with the same name both load, "because plugin skills are namespaced" (`skills.md:218`).

**Plugins can scan grouping folders.** `plugins-reference.md:148` (https://code.claude.com/docs/en/plugins-reference) says the manifest `skills` field takes:

> Directories to scan for skills, each a directory of `<name>/SKILL.md` folders or one folder holding `SKILL.md` directly. … Adds to the default `skills/` scan

So `"skills": ["./coding/", "./piece/"]` is a documented shape. The default `skills/` directory is still scanned (`plugins-reference.md:416`). A marketplace entry that lists `skills` replaces the default scan instead (`plugins-reference.md:681`). Whichever folder a skill came from, its name is still `<plugin>:<skill>`.

**A project can load a local plugin from inside the repo.** There are three routes.

1. **Skills-directory plugin.** A folder under `.claude/skills/` that contains `.claude-plugin/plugin.json` loads as `<name>@skills-dir` (`skills.md:173`; `plugins/loading.md:54`). `plugins/create.md:243` says: "To make a plugin load for everyone in one repository, create the same layout yourself at `<project>/.claude/skills/<name>/`, including its `.claude-plugin/plugin.json`."
   - **Naming.** A root `SKILL.md` in that folder "is also a personal skill, so you invoke it as `/my-tool`", while skills under its `skills/` get "the plugin-name prefix, such as `/my-tool:example`" (`plugins/create.md:235`).
   - **Trust.** It loads "only after the same trust check that applies to project allow rules in `.claude/settings.json`. Trusting a parent folder or running with `-p` isn't enough" (`plugins/loading.md:76`).
   - **No parent search.** Claude Code "reads the `.claude/skills/` of the session's primary working directory and, unlike plain skills and commands, doesn't search parent directories for plugins" (`plugins/loading.md:88`).
   - **Probe.** I added `.claude/skills/grp/.claude-plugin/plugin.json` (`{"name":"grp","skills":["./"]}`). `claude plugin list` reported: "1 project-scope directory under ./.claude/skills/ that may load as a plugin was skipped because this workspace was not trusted".
2. **`enabledPlugins` in `.claude/settings.json`**, from a marketplace (`plugins/loading.md:70`). Marketplaces that a repository lists under `extraKnownMarketplaces` also need the trust dialog (`plugins/loading.md:72`). Claude Code "doesn't scan a project's `.claude/plugins/` directory" (`plugins/loading.md:70`).
3. **`--plugin-dir <path>` or `CLAUDE_CODE_PLUGIN_DIRS`.** These load an `@inline` plugin for that session only (`plugins/loading.md:53`). Probe: `claude --plugin-dir .claude/skills/grp -p "/grp:nested-probe"` ran the nested skill (output `NESTED`).

**Symlinks inside an installed plugin.** When a plugin is copied into the cache, a symlink to a target outside the plugin's own folder is either dereferenced (if it stays in the marketplace) or skipped. "For plugins installed from a local path … Claude Code preserves only symlinks that resolve within the plugin's own directory and skips all others" (`plugins/host-marketplace.md:75-81`). Skills-directory and `--plugin-dir` plugins "load in place and [are] never copied" (`plugins/loading.md:210`).

**Cloud sessions.** "Plugins declared in the repository's `.claude/settings.json` … don't load in cloud sessions" (`skills.md:228`). Committed `.claude/skills/` does load in cloud sessions other than project threads.

## 3. How `runner/skills/` reaches the session today

Through four committed relative symlinks in `.claude/skills/`. No plugin and no generator is involved in loading:

- `ls -la .claude/skills` shows:
  - `implement-code -> ../../runner/skills/implement-code`
  - `judge-findings -> ../../runner/skills/judge-findings`
  - `mine-outcomes -> ../../runner/skills/mine-outcomes`
  - `runner -> ../../runner/skills/runner`
- `git ls-files -s .claude/skills` records all four as mode `120000`, so they are tracked symlinks and check out into every worktree.
- `docs/agents/upstream-skills.md:7`: "A runner skill lives in `runner/skills/<name>/` and sits here as a symlink, `.claude/skills/<name>` → `../../runner/skills/<name>`, so it is invoked as `/<name>` where a plugin would namespace it as `/<plugin>:<name>`."
- `runner/README.md:19`: "byro-repo loads each one through a symlink in `.claude/skills/`, not a plugin".
- There is no plugin manifest anywhere in the repo (`find` for `plugin.json` and `marketplace.json` outside `node_modules` and worktrees found none). `.claude/settings.json` has no `enabledPlugins` and mentions skills only at `:69-70` (`Bash(.claude/skills/inbox/record.sh *)`). `.claude/settings.local.json` sets `"syncClaudeAiSkills": false`.
- **Generator.** `runner/src/implementCodeSkill.ts:1-3` builds `/implement-code`'s text: "The committed skill is runner/skills/implement-code/SKILL.md; byro-repo's drift test regenerates it". The test is `scripts/runner/implementCodeSkill.test.ts:9-10`, which uses `toMatchFileSnapshot("../../runner/skills/implement-code/SKILL.md")`. It writes the real file, never the link.
- **Recorded behaviour of the links.** `docs/claude-code-behaviour.md:27-28` records two things:
  - An Edit through the symlink is denied while an Edit to the real file passes.
  - The announced base directory is the symlink path, so links out of a runner skill climb to the repo root (`docs/agents/upstream-skills.md:7`).
- **Runner steps invoke skills by bare name.**
  - `scripts/runner/runner.config.json:2` sets `"skillNames": { "review": "code-review" }`, with the same default at `runner/src/runKnobs.ts:69`.
  - `runner/src/reviewStep.ts:42` reads: `Call the Skill tool with "${skillName}"`.
  - Steps run `claude -p` (`runner/src/ClaudeAgentStep.ts:128`) with `--settings` (`:143`) in the issue workspace (`cwd`, `:59`). No `--plugin-dir` or `--add-dir` is passed.

## 4. What the upstream sync assumes about local paths

**The manifest has no local-path field.** Keys in `.claude/skills/upstream.json` are `repo`, `skillsRoot`, `pluginManifest`, `syncedSha`, `promoted`, `paths`, `status`, `notes`, `reason` and `derivedInto`. A vendored path such as `skills/engineering/code-review` (`upstream.json:38`) maps to its local copy only by the upstream folder's basename, under a flat `.claude/skills/`.

**`/check-upstream-skills` assumes the flat layout.**

- **Forks.** `SKILL.md:7`: "a bare name is a skill at `.claude/skills/<name>/`, an entry with a slash a repo-relative path".
- **Syncing.** `SKILL.md:21`: "**Take a vendored change:** copy the upstream folder over `.claude/skills/<name>/`, then reapply every divergence".

**The report code assumes it once.** `trackedChangeSummary.ts:22-25` is `forkPathOf`: `if (fork.includes("/")) return fork; return \`.claude/skills/${fork}/\`;`. Six `derivedInto` lists use bare names (`upstream.json:42, 57, 91, 97, 112, 118`).

**Everything else in `check.ts` reads only the upstream clone.**

- It lists `SKILL.md` folders under `skillsRoot` at any depth (`check.ts:143-147`).
- It guesses a move by matching basenames (`check.ts:124-127`).
- It reads `plugin.json`'s `skills` array and strips `./skills/` (`check.ts:129-135`).

Upstream bucket changes are therefore already reported. **Local subfolders would break nothing in `check.ts`**, only the skill's step-21 copy target and `forkPathOf`'s default, both of which assume `.claude/skills/<name>/`.

**Other flat-layout assumptions in the repo:**

- `config/docLint.js:32`: `skillPattern: /^(?:\.claude|runner)\/skills\/([^/]+)\/SKILL\.md$/`. This requires a skill to sit exactly one folder under either root, and the index check over `coding-workflow.md` and `piece-workflow.md` (`docLint.js:28-33`) depends on it.
- `docs/agents/upstream-skills.md:7`: "Every skill sits flat at `.claude/skills/<name>/` … since nested folders load lazily." The lazy load the docs describe is for `<subdir>/.claude/skills/` (`skills.md:181`). A grouping folder *inside* `.claude/skills/` does not load at all (probe, §2), so this line gives the wrong reason for a rule that still holds.
- The runner-skill link rule (`upstream-skills.md:7`) relies on `.claude/skills/<name>/` and `runner/skills/<name>/` being "equally deep". Adding a level on one side only would break every root-climbing link.
- 31 Markdown files under `docs`, `packages/*/docs`, `runner`, `config` and `.claude/skills` link `.claude/skills/<name>/...` paths (by `grep -rl`). `settings.json:69-70` names `.claude/skills/inbox/record.sh`.
- No hook under `.claude/hooks/` references a skill path.

## 5. Other published practice

- **`anthropics/skills`.** Flat: 19 skills at `skills/<name>/SKILL.md`. The README describes "Skill examples for Creative & Design, Development & Technical, Enterprise & Communication, and Document Skills", but those are not folders. Grouping lives only in `.claude-plugin/marketplace.json`, which declares five plugins over the same flat tree (`document-skills`, `example-skills`, `claude-api`, `academy-guide`, `discernment-nudge`). Each has `"source": "./"`, `"strict": false` and an explicit `skills` array, for example `document-skills` = `./skills/xlsx`, `docx`, `pptx` and `pdf` (`marketplace.json:12-22`). Users pick a group by installing a plugin (`/plugin install document-skills@anthropic-agent-skills`, README).
- **Anthropic's best-practices doc** (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
  - **Naming.** Recommends consistent names: gerund form preferred, noun phrases or action verbs acceptable. It warns against "Inconsistent patterns within your skill collection" and says consistency helps "Organize and search through multiple Skills" (`best-practices:168-198`).
  - **Folders.** Its folder advice ("Structure directories by domain or feature", "Keep references one level deep from `SKILL.md`") is about files *inside* one skill (`:378-382, 1057`). It says nothing on grouping skills into folders.
- **Agent Skills spec** (https://agentskills.io/specification): `name` "Must match the parent directory name" (`spec:69`). A skill is "a directory containing, at minimum, a `SKILL.md` file" (`spec:11`). The spec defines no collection layout.
- **`anthropics/claude-plugins-official`** (the default marketplace): groups by **plugin**. Plugins live at `plugins/<plugin>/` (41 internal) and `external_plugins/`, and each plugin's skills sit flat in its own `skills/` (for example `plugins/plugin-dev/skills/` has 7). The README's "Plugin names are immutable" says renaming a published plugin "breaks their install with a `plugin-not-found` error".
- **`obra/superpowers`.** One plugin, 15 skills flat at `skills/<name>/`. `.claude-plugin/plugin.json` has no `skills` key, so it uses the default scan.
- **`openai/skills`** (Codex; now marked deprecated in its README): buckets by release status, `skills/.system` (auto-installed), `.curated` and `.experimental` (README:17-36). It is the same status idea as Pocock's buckets.

## Implications for this repo

The facts above fix these constraints:

1. **Plain skills are flat.** Moving skills into `.claude/skills/coding/<name>/` without a plugin manifest makes them undiscoverable (probe, §2). Group folders can exist only as a plugin's scan roots, as nested `<subdir>/.claude/skills/` (lazy, keyed to files in that subdirectory), or outside `.claude/skills/` and reached through symlinks, as the runner skills already are.
2. **A plugin renames every skill it holds** to `/<plugin>:<name>`. That reaches `/start-issue` and the other slash names in `AGENTS.md`, the 31 linking docs, and the runner's bare `"code-review"` (`runner.config.json:2`, `reviewStep.ts:42`), unless the bare name also resolves. The docs don't promise a bare name for plugin skills; in my `--plugin-dir` probe `/nested-probe` did reach the plugin skill, but that behaviour is undocumented.
3. **An in-repo plugin under `.claude/skills/<group>/` needs workspace trust, and `-p` does not count.** It loads only from the primary working directory. Runner steps are `claude -p` sessions in fresh issue worktrees, so they would need `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` to see it reliably. Plugins declared in settings also don't reach cloud sessions.
4. **The symlink pattern is the documented way** to keep a flat loaded layout while the files live in grouped folders elsewhere (`skills.md:168`). Pocock's `link-skills.sh` does the same for `~/.claude/skills`. The cost is the recorded edit-denial and base-directory quirks (`claude-code-behaviour.md:27-28`), plus the equal-depth link rule, which a deeper real location would break.
5. **Moving vendored skills breaks little in the sync.** The upstream check reads only upstream. A local move needs a local-path rule in `upstream.json` or `/check-upstream-skills` (`SKILL.md:7, 21`), a change to `forkPathOf` (`trackedChangeSummary.ts:22-25`) and a change to docLint's `skillPattern` (`docLint.js:32`). `docs/agents/upstream-skills.md:7`'s stated reason ("nested folders load lazily") should be corrected whatever is chosen.
6. **Published collections group skills in one of two ways.** Some use status buckets (Pocock, OpenAI). Others group by plugin over a flat tree (Anthropic's two repos, superpowers). None of them groups skills inside a harness's loaded `.claude/skills/` directory. Pocock's buckets disappear at install time: the plugin array or the flattening symlink script removes them.
