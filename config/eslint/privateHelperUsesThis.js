// A `private` or `#` method that never reads `this` belongs below the class as a module function.
/** @type {import("eslint").Rule.RuleModule} */
export const privateHelperUsesThis = {
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
