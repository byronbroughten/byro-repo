import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** @typedef {import("estree").ImportDeclaration | import("estree").ExportNamedDeclaration | import("estree").ExportAllDeclaration | import("estree").ImportExpression} ModuleReference */

// A package's dependencies are read from its package.json, so a relative import into another package is one nothing declares.
/** @type {import("eslint").Rule.RuleModule} */
export const noCrossPackageImport = {
  meta: {
    type: "problem",
    messages: {
      crossPackage:
        "{{source}} leaves this file's package: import the other package by its name.",
    },
  },
  create(context) {
    const ownFolder = dirname(context.filename);
    const ownRoot = packageRootOf(ownFolder);
    /** @param {ModuleReference} node */
    function check(node) {
      const { source } = node;
      if (source?.type !== "Literal" || typeof source.value !== "string") {
        return;
      }
      if (!source.value.startsWith(".")) return;
      if (packageRootOf(resolve(ownFolder, source.value)) !== ownRoot) {
        context.report({
          node: source,
          messageId: "crossPackage",
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

/** @type {Map<string, string | undefined>} */
const packageRoots = new Map();

// An import's target may not exist, so this walks folders rather than asking the resolver.
/**
 * @param {string} path
 * @returns {string | undefined}
 */
function packageRootOf(path) {
  if (packageRoots.has(path)) return packageRoots.get(path);
  const parent = dirname(path);
  let root;
  if (existsSync(join(path, "package.json"))) {
    root = path;
  } else if (parent !== path) {
    root = packageRootOf(parent);
  }
  packageRoots.set(path, root);
  return root;
}
