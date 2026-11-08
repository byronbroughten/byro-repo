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

// What a visit of one array or object found; isStopping: its children aren't entered.
interface Visit<RR> {
  found: RR[];
  isStopping?: boolean;
}

// sh-syntax's own BinCmdOperator and RedirOperator, typed against them, as only shellSyntax.ts may load sh-syntax's values.
export const operatorCodes = {
  binary: { AndStmt: 11, OrStmt: 12, Pipe: 13, PipeAll: 14 },
  redirect: {
    RdrOut: 63,
    AppOut: 64,
    RdrIn: 65,
    RdrInOut: 66,
    DplIn: 67,
    DplOut: 68,
    ClbOut: 69,
    RdrClob: 69,
    AppClob: 70,
    Hdoc: 71,
    DashHdoc: 72,
    WordHdoc: 73,
    RdrAll: 74,
    RdrAllClob: 75,
    AppAll: 76,
    AppAllClob: 77,
  },
} as const satisfies {
  binary: typeof BinCmdOperator;
  redirect: typeof RedirOperator;
};
const { binary, redirect } = operatorCodes;
const operatorTexts = {
  binary: {
    [binary.AndStmt]: "&&",
    [binary.OrStmt]: "||",
    [binary.Pipe]: "|",
    [binary.PipeAll]: "|&",
  },
  redirect: {
    [redirect.RdrOut]: ">",
    [redirect.AppOut]: ">>",
    [redirect.RdrIn]: "<",
    [redirect.RdrInOut]: "<>",
    [redirect.DplIn]: "<&",
    [redirect.DplOut]: ">&",
    [redirect.ClbOut]: ">|",
    [redirect.AppClob]: ">>|",
    [redirect.Hdoc]: "<<",
    [redirect.DashHdoc]: "<<-",
    [redirect.WordHdoc]: "<<<",
    [redirect.RdrAll]: "&>",
    [redirect.RdrAllClob]: "&>|",
    [redirect.AppAll]: "&>>",
    [redirect.AppAllClob]: "&>>|",
  },
} as const satisfies {
  binary: Record<BinCmdOperator, string>;
  redirect: Record<RedirOperator, string>;
};
const heredocOperators = new Set<RedirOperator>([
  redirect.Hdoc,
  redirect.DashHdoc,
]);

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
  return foundIn(tree, (value): Visit<NN> => {
    if (!isNode(value)) return { found: [] };
    if (isMatch(value)) return { found: [value], isStopping: true };
    if (isStoppingAtSubstitutions && isSubstitution(value)) {
      return { found: [], isStopping: true };
    }
    return { found: [] };
  });
}

function placedOperatorsIn(tree: unknown): PlacedOperator[] {
  return foundIn(tree, (value): Visit<PlacedOperator> => {
    if (Array.isArray(value)) return { found: separatorsAmong(value) };
    return { found: isNode(value) ? ownOperatorsOf(value) : [] };
  });
}

// An expansion's parts, such as `${x:-…}`'s word, sit in objects that are no node, so every array and object is visited.
function foundIn<RR>(tree: unknown, visit: (value: object) => Visit<RR>): RR[] {
  if (typeof tree !== "object" || tree === null) return [];
  const { found, isStopping } = visit(tree);
  if (isStopping) return found;
  return [
    ...found,
    ...Object.values(tree).flatMap((child: unknown) => foundIn(child, visit)),
  ];
}

// The `;` or `&` after each command of a list but the last, and the `&` after a last one sent to the background.
function separatorsAmong(items: readonly unknown[]): PlacedOperator[] {
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
