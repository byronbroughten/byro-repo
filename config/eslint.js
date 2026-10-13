import eslint from "@eslint/js";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export const variableNaming = {
  selector: "variable",
  format: ["camelCase", "PascalCase"],
  leadingUnderscore: "allow",
  custom: { regex: "^[A-Z][A-Z0-9]+$", match: false },
};
// Generic params are two-letter domain abbreviations; the domain-free utilities keep bare T, K and V.
const typeParameterNaming = {
  selector: "typeParameter",
  format: null,
  custom: { regex: "^[A-Z]{2}$", match: true },
};
export const styleSyntax = [
  {
    selector: "TSEnumDeclaration",
    message:
      "A fixed set is an `as const` object or a union of string literals, not an enum.",
  },
  {
    selector: "ExportDefaultDeclaration",
    message: "Exports are named, so every import spells the name it wants.",
  },
];

// A `private` or `#` method that never reads `this` belongs below the class as a module function.
/** @type {import("eslint").Rule.RuleModule} */
const privateHelperUsesThis = {
  meta: {
    type: "suggestion",
    messages: {
      noThis:
        "{{name}} never reads `this`: make it an unexported module function below the class.",
    },
  },
  create(context) {
    /** @type {{ helper: PrivateHelper | undefined, usesThis: boolean }[]} */
    const frames = [];
    /** @param {import("eslint").Rule.Node} node */
    function enter(node) {
      frames.push({ helper: privateHelperOf(node), usesThis: false });
    }
    function exit() {
      const frame = frames.pop();
      if (frame?.helper && !frame.usesThis) {
        context.report({
          node: frame.helper.key,
          messageId: "noThis",
          data: { name: frame.helper.name },
        });
      }
    }
    function markThis() {
      const frame = frames.at(-1);
      if (frame) frame.usesThis = true;
    }
    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ThisExpression: markThis,
      Super: markThis,
    };
  },
};

/** @typedef {{ key: import("estree").Node, name: string }} PrivateHelper */

/** @param {import("eslint").Rule.Node} node */
function privateHelperOf(node) {
  const method = node.parent;
  if (method?.type !== "MethodDefinition" || method.value !== node) {
    return undefined;
  }
  const { key } = method;
  if (key.type === "PrivateIdentifier") return { key, name: `#${key.name}` };
  const isPrivate =
    "accessibility" in method && method.accessibility === "private";
  return isPrivate && key.type === "Identifier"
    ? { key, name: key.name }
    : undefined;
}

export const eslintPreset = [
  { ignores: ["**/dist/**", "**/coverage/**"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
      style: { rules: { "private-helper-uses-this": privateHelperUsesThis } },
    },
    rules: {
      "simple-import-sort/imports": "error",
      "style/private-helper-uses-this": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      // A module's value and type imports share one line.
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: false }],
      // No setting limits an unbraced body to an exit; multi-line is the nearest, so a one-line non-exiting body also passes.
      curly: ["error", "multi-line"],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "func-style": ["error", "declaration"],
      "prefer-template": "error",
      "no-restricted-syntax": ["error", ...styleSyntax],
      "max-classes-per-file": ["error", 1],
      // `_` marks a parameter kept for its signature; a rest sibling is dropped on purpose.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // Props bags chain as interfaces, so an empty one can name a tier.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
      // Constants are camelCase too; methods stay free, so SHOUTING multi-row deletes pass.
      "@typescript-eslint/naming-convention": [
        "error",
        variableNaming,
        typeParameterNaming,
      ],
    },
  },
  // Tool configs are default exports by their tools' contract.
  {
    files: ["**/*.config.{mjs,ts}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...styleSyntax.filter(
          ({ selector }) => selector !== "ExportDefaultDeclaration",
        ),
      ],
    },
  },
  // Test helpers and plain-JS files are out of the return-type and function-style rules' scope (#153).
  {
    files: ["**/*.test.ts", "**/*.{js,mjs}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "func-style": "off",
    },
  },
];
