import { globSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { eslintPreset, variableNaming } from "@byronbroughten/config/eslint";
import { defineConfig } from "eslint/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const runnerRoot = join(repoRoot, "runner");

// Each package under packages/ lints with its own eslint.config.mjs; the root lint finds them with --flag v10_config_lookup_from_file.
export default defineConfig(
  ...eslintPreset,
  // Workspaces and Claude Code's worktrees are whole checkouts; ESLint doesn't read the .gitignore that skips them.
  { ignores: [".claude/worktrees/**"] },
  // These run or ship apart from packages/, so they carry their own plain guards instead of importing a package's helper.
  {
    files: [
      "config/**/*.{js,ts}",
      ".claude/hooks/**/*.ts",
      ".claude/skills/**/*.ts",
      "scripts/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: packagesImportRegex(workspaceNames(repoRoot, "packages/")),
              message:
                "The config package and the hooks import nothing from packages/; write a plain guard instead.",
            },
          ],
        },
      ],
    },
  },
  // The runner takes everything repo-specific as injected config, so it can be split out.
  {
    files: ["runner/**/*.{js,ts}"],
    plugins: {
      runner: { rules: { "import-boundary": runnerImportBoundary() } },
    },
    rules: { "runner/import-boundary": "error" },
  },
  // tsc checks these for undefined names, as typescript-eslint leaves it to tsc in .ts files.
  { files: ["config/{docLint,lintDocs}.js"], rules: { "no-undef": "off" } },
  // Test helpers keep bare T, K and V.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/naming-convention": ["error", variableNaming],
    },
  },
);

export function packagesImportRegex(names) {
  const alternatives = [
    "(^|/)packages/",
    ...names.map((name) => `^${escapeRegex(name)}(/|$)`),
  ];
  return alternatives.join("|");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runnerImportBoundary() {
  const otherWorkspaces = workspaceNames(repoRoot).filter(
    (name) => name !== "@byronbroughten/spec-runner",
  );
  return {
    meta: {
      type: "problem",
      messages: {
        outside:
          "The runner imports nothing from the rest of byro-repo ({{source}}); take it as injected config.",
      },
    },
    create(context) {
      function check(node) {
        const source = node.source;
        if (source?.type !== "Literal" || typeof source.value !== "string") {
          return;
        }
        if (isOutsideRunner(source.value, context.filename, otherWorkspaces)) {
          context.report({
            node: source,
            messageId: "outside",
            data: { source: source.value },
          });
        }
      }
      return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
        ImportExpression: check,
      };
    },
  };
}

// With no packages checked out (as on CI) it finds none, which is harmless: tsc fails any import of a missing package.
export function workspaceNames(root, patternPrefix = "") {
  const { workspaces } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  return globSync(
    workspaces
      .filter((pattern) => pattern.startsWith(patternPrefix))
      .map((pattern) => `${pattern}/package.json`),
    { cwd: root },
  ).map((path) => JSON.parse(readFileSync(join(root, path), "utf8")).name);
}

function isOutsideRunner(specifier, filename, otherWorkspaces) {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const fromRunner = relative(
      runnerRoot,
      resolve(dirname(filename), specifier),
    );
    return (
      fromRunner === ".." ||
      fromRunner.startsWith(`..${sep}`) ||
      isAbsolute(fromRunner)
    );
  }
  return otherWorkspaces.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}
