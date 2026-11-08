// Finds nodes anywhere in mvdan/sh's syntax tree, for SegmentReader.ts, WordRenderer.ts and ../ShellParser.ts.
import type {
  BinCmdOperator,
  CmdSubst,
  FuncDecl,
  Node,
  ProcSubst,
  Redirect,
  RedirOperator,
} from "sh-syntax";

export type Substitution = CmdSubst | ProcSubst;

// An operator's text and the byte it sits at.
interface PlacedOperator {
  at: number;
  text: string;
}

const operatorTexts = {
  binary: { 11: "&&", 12: "||", 13: "|", 14: "|&" },
  redirect: {
    63: ">",
    64: ">>",
    65: "<",
    66: "<>",
    67: "<&",
    68: ">&",
    69: ">|",
    70: ">>|",
    71: "<<",
    72: "<<-",
    73: "<<<",
    74: "&>",
    75: "&>|",
    76: "&>>",
    77: "&>>|",
  },
} as const satisfies {
  binary: Record<BinCmdOperator, string>;
  redirect: Record<RedirOperator, string>;
};
const heredocOperators = new Set<RedirOperator>([71, 72]);

export const syntaxNodes = {
  // The outermost substitutions in a tree; each one's own commands hold the rest.
  substitutionsIn(tree: unknown): Substitution[] {
    return matchesIn(tree, isSubstitution, true);
  },

  heredocsIn(tree: unknown): Redirect[] {
    return matchesIn(tree, isHeredoc, false);
  },

  // Each function a tree defines, outside its substitutions, which run in a subshell of their own.
  functionNamesIn(tree: unknown): Set<string> {
    return new Set(
      matchesIn(tree, isFuncDecl, true).flatMap(({ name }) =>
        name ? [name.value] : [],
      ),
    );
  },

  // Each operator and redirect in a tree, in byte order; a newline between commands counts as `;`.
  operatorsIn(tree: unknown): string[] {
    return placedOperatorsIn(tree)
      .sort((a, b) => a.at - b.at)
      .map(({ text }) => text);
  },
};

function matchesIn<NN extends Node>(
  tree: unknown,
  isMatch: (node: Node) => node is NN,
  isStoppingAtSubstitutions: boolean,
): NN[] {
  if (Array.isArray(tree)) {
    return tree.flatMap((item) =>
      matchesIn(item, isMatch, isStoppingAtSubstitutions),
    );
  }
  if (typeof tree !== "object" || tree === null) return [];
  if (isNode(tree)) {
    if (isMatch(tree)) return [tree];
    if (isStoppingAtSubstitutions && isSubstitution(tree)) return [];
  }
  return Object.values(tree).flatMap((child: unknown) =>
    matchesIn(child, isMatch, isStoppingAtSubstitutions),
  );
}

// An expansion's parts, such as `${x:-…}`'s word, sit in objects that are no node, so every object is entered.
function placedOperatorsIn(tree: unknown): PlacedOperator[] {
  if (Array.isArray(tree)) {
    return [
      ...separatorsAmong(tree),
      ...tree.flatMap((item) => placedOperatorsIn(item)),
    ];
  }
  if (typeof tree !== "object" || tree === null) return [];
  return [
    ...(isNode(tree) ? ownOperatorsOf(tree) : []),
    ...Object.values(tree).flatMap((child: unknown) =>
      placedOperatorsIn(child),
    ),
  ];
}

// The `;` or `&` after each command of a list but the last, and the `&` after a last one sent to the background.
function separatorsAmong(items: unknown[]): PlacedOperator[] {
  return items.flatMap((item, at) => {
    if (!isNode(item) || item.type !== "Stmt") return [];
    if (item.background) return [{ at: item.end, text: "&" }];
    return at < items.length - 1 ? [{ at: item.end, text: ";" }] : [];
  });
}

function ownOperatorsOf(node: Node): PlacedOperator[] {
  if (node.type === "BinaryCmd") {
    return [{ at: node.opPos.offset, text: operatorTexts.binary[node.op] }];
  }
  if (node.type === "Redirect") {
    return [{ at: node.opPos.offset, text: operatorTexts.redirect[node.op] }];
  }
  if (node.type === "CmdSubst") {
    const [open, close] = node.backquotes ? ["`", "`"] : ["$(", ")"];
    return enclosingOperatorsOf(node, open, close);
  }
  if (node.type === "Subshell") return enclosingOperatorsOf(node, "(", ")");
  if (node.type === "ProcSubst") return enclosingOperatorsOf(node, "(", ")");
  if (node.type === "ArithmCmd") return enclosingOperatorsOf(node, "((", "))");
  return [];
}

function enclosingOperatorsOf(
  node: Node,
  open: string,
  close: string,
): PlacedOperator[] {
  return [
    { at: node.start, text: open },
    { at: node.end - 1, text: close },
  ];
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function isSubstitution(node: Node): node is Substitution {
  return node.type === "CmdSubst" || node.type === "ProcSubst";
}

function isHeredoc(node: Node): node is Redirect {
  return node.type === "Redirect" && heredocOperators.has(node.op);
}

function isFuncDecl(node: Node): node is FuncDecl {
  return node.type === "FuncDecl";
}
