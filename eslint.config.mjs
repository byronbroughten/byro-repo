import { eslintPreset, variableNaming } from "@byronbroughten/config/eslint";
import { defineConfig } from "eslint/config";

// Each package under packages/ lints with its own eslint.config.mjs; the root lint finds them with --flag v10_config_lookup_from_file.
export default defineConfig(
  ...eslintPreset,
  // Agent worktrees are whole checkouts that git excludes locally, which ESLint doesn't read.
  { ignores: [".claude/worktrees/**"] },
  // These run or ship apart from packages/, so they carry their own plain guards instead of importing a package's helper.
  {
    files: [
      "config/**/*.{js,ts}",
      ".claude/hooks/**/*.ts",
      ".claude/skills/**/*.ts",
      ".cursor/hooks/**/*.ts",
      "scripts/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `(^|/)packages/|^(@byronbroughten/sheets-framework|sheets-real-estate)(/|$)`,
              message:
                "The config package and the hooks import nothing from packages/; write a plain guard instead.",
            },
          ],
        },
      ],
    },
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
