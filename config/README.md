# @byronbroughten/config

General tooling for TypeScript projects: an ESLint flat-config preset, the prettier config, a base tsconfig, a doc linter and the general style docs. Plain JS, no build step; one version of each peer (eslint, prettier, typescript) is needed only for the export that uses it.

| Export | Consume it with |
| --- | --- |
| `@byronbroughten/config/eslint` | `eslintPreset` spread first in `defineConfig(...)`, with project rules after it. `styleSyntax` and `variableNaming` are exported for a project block that overrides `no-restricted-syntax` or `@typescript-eslint/naming-convention`. |
| `@byronbroughten/config/prettier` | `"prettier": "@byronbroughten/config/prettier"` in `package.json`. |
| `@byronbroughten/config/tsconfig.base.json` | `"extends"` in a `tsconfig.json`, which adds its own `target`, `module` and `types`. |
| `lint-docs` (bin) | A `package.json` script such as `"lint:docs": "lint-docs --published packages/<name>"`. It lints the git repo it runs in; see below. |
| `docs/code-style.md` (files) | Read from `node_modules/@byronbroughten/config/docs/`, with its reasoning under `docs/code-style/`. A project keeps its own style doc for the rules only it needs and says it layers on this one, as the framework's does. |

## The doc linter

`lint-docs` lists the repo's tracked and new files via git and checks its markdown docs, exiting non-zero on a violation:

- **Links and anchors** resolve, in `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `README.md`, and every `docs/` file at the repo root, under `config/` and under `packages/<name>/`. A link into a `packages/<name>/` folder the repo doesn't track is external and not checked, so a root doc can point at clones that exist only locally.
- **`--published <dir>`**, repeatable, names each package whose docs (`docs/`, `CONTEXT.md`, `README.md`, `AGENTS.md` and `CLAUDE.md`) ship on their own, so they link only inside it: `packages/<name>`, `config` (this package, in a repo that holds it as a workspace folder), or `.` for the repo root, either relative to the repo root wherever the bin runs. Anything else, or a folder the repo doesn't track, is an error, and without the flag no package is held to the rule.
- **Leads and headings**: a `docs/` file's lead before its first `##` heading, and a file with no `##` heading at all, stay within the `limits` in `docLint.js`.
- **Each nested `AGENTS.md`** has a sibling `CLAUDE.md` containing `@AGENTS.md`.
