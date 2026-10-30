// One TypeScript file's outline: each top-level declaration with its line, signatures but no bodies.
import ts from "typescript";

const memberIndent = "  ";
const typeKeywords = {
  [ts.SyntaxKind.InterfaceDeclaration]: "interface",
  [ts.SyntaxKind.TypeAliasDeclaration]: "type",
} as const;

export function fileOutline(fileName: string, sourceText: string): string {
  throwOnParseError(fileName, sourceText);
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  return sourceFile.statements.flatMap(statementLinesOf).join("\n");
}

// createSourceFile parses past a syntax error, so transpileModule's syntax-only diagnostics catch it.
function throwOnParseError(fileName: string, sourceText: string): void {
  const [diagnostic] =
    ts.transpileModule(sourceText, { fileName, reportDiagnostics: true })
      .diagnostics ?? [];
  if (!diagnostic) return;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  throw new Error(
    `${fileName} doesn't parse, line ${diagnosticLineOf(diagnostic)}: ${message}`,
  );
}

function diagnosticLineOf(diagnostic: ts.Diagnostic): string {
  if (!diagnostic.file || diagnostic.start === undefined) return "?";
  return String(lineNumberOf(diagnostic.file, diagnostic.start));
}

function statementLinesOf(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement)) {
    return [declarationLineOf(statement, "function", signatureOf(statement))];
  }
  if (ts.isClassDeclaration(statement)) {
    return [
      declarationLineOf(statement, "class"),
      ...indented(statement.members.flatMap(classMemberLinesOf)),
    ];
  }
  if (ts.isVariableStatement(statement)) {
    const keyword = statement.declarationList.getFirstToken()?.getText() ?? "";
    return statement.declarationList.declarations.flatMap((declaration) =>
      variableLinesOf(
        declaration,
        `${modifiersOf(statement)}${keyword} ${oneLine(declaration.name.getText())}`,
      ),
    );
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return [
      declarationLineOf(
        statement,
        typeKeywords[statement.kind],
        typeParametersOf(statement),
      ),
    ];
  }
  if (ts.isEnumDeclaration(statement)) {
    return [declarationLineOf(statement, "enum")];
  }
  return [];
}

function declarationLineOf(
  statement: ts.Statement & ts.HasModifiers & { name?: ts.Identifier },
  keyword: string,
  rest = "",
): string {
  return lineOf(
    statement,
    `${modifiersOf(statement)}${keyword} ${statement.name?.text ?? ""}${rest}`,
  );
}

function typeParametersOf(
  node: ts.DeclarationWithTypeParameterChildren,
): string {
  if (!node.typeParameters) return "";
  return `<${node.typeParameters.map((parameter) => oneLine(parameter.getText())).join(", ")}>`;
}

function classMemberLinesOf(member: ts.ClassElement): string[] {
  if (ts.isConstructorDeclaration(member)) {
    return [lineOf(member, `constructor${signatureOf(member)}`)];
  }
  if (ts.isPropertyDeclaration(member)) {
    const optional = member.questionToken ? "?" : "";
    const value = member.initializer && unwrapped(member.initializer);
    if (value && isFunctionValue(value)) {
      return [
        lineOf(
          member,
          `${memberNameOf(member)}${optional}${signatureOf(value)}`,
        ),
      ];
    }
    return [
      lineOf(
        member,
        `${memberNameOf(member)}${optional}${typeAnnotationOf(member.type)}`,
      ),
    ];
  }
  return methodOrAccessorLinesOf(member);
}

// Takes any node, as a class's members and a bundle's share no narrower type.
function methodOrAccessorLinesOf(member: ts.Node): string[] {
  if (ts.isMethodDeclaration(member)) {
    return [lineOf(member, `${memberNameOf(member)}${signatureOf(member)}`)];
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return [
      lineOf(member, `get ${memberNameOf(member)}${signatureOf(member)}`),
    ];
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return [
      lineOf(member, `set ${memberNameOf(member)}${signatureOf(member)}`),
    ];
  }
  return [];
}

function memberNameOf(
  member: ts.HasModifiers & { name: ts.PropertyName },
): string {
  return `${modifiersOf(member)}${oneLine(member.name.getText())}`;
}

function variableLinesOf(
  declaration: ts.VariableDeclaration,
  heading: string,
): string[] {
  const value = declaration.initializer && unwrapped(declaration.initializer);
  if (value && isFunctionValue(value)) {
    return [lineOf(declaration, `${heading} = ${signatureOf(value)}`)];
  }
  const line = lineOf(
    declaration,
    `${heading}${typeAnnotationOf(declaration.type)}`,
  );
  if (value && ts.isObjectLiteralExpression(value)) {
    return [line, ...indented(value.properties.flatMap(bundleFunctionLinesOf))];
  }
  return [line];
}

function bundleFunctionLinesOf(member: ts.ObjectLiteralElementLike): string[] {
  if (!ts.isPropertyAssignment(member)) return methodOrAccessorLinesOf(member);
  const value = unwrapped(member.initializer);
  if (!isFunctionValue(value)) return [];
  return [
    lineOf(member, `${oneLine(member.name.getText())}${signatureOf(value)}`),
  ];
}

// `as const`, `satisfies` and parentheses wrap a bundle or a function without changing what it is.
function unwrapped(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapped(expression.expression);
  }
  return expression;
}

function isFunctionValue(
  expression: ts.Expression,
): expression is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

function indented(lines: string[]): string[] {
  return lines.map((line) => `${memberIndent}${line}`);
}

function lineOf(node: ts.Node, text: string): string {
  return `${lineNumberOf(node.getSourceFile(), node.getStart())}: ${text}`;
}

function lineNumberOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function modifiersOf(node: ts.HasModifiers): string {
  const modifiers = ts.getModifiers(node) ?? [];
  return modifiers.map((modifier) => `${modifier.getText()} `).join("");
}

function signatureOf(node: ts.SignatureDeclaration): string {
  const parameters = node.parameters.map(parameterOf).join(", ");
  return `${typeParametersOf(node)}(${parameters})${typeAnnotationOf(node.type)}`;
}

// A default value is body, not signature, so it's left out and only its optionality shows.
function parameterOf(parameter: ts.ParameterDeclaration): string {
  const rest = parameter.dotDotDotToken ? "..." : "";
  const isOptional =
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined;
  const optional = isOptional ? "?" : "";
  return `${modifiersOf(parameter)}${rest}${oneLine(parameter.name.getText())}${optional}${typeAnnotationOf(parameter.type)}`;
}

function typeAnnotationOf(type: ts.TypeNode | undefined): string {
  return type ? `: ${oneLine(type.getText())}` : "";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ");
}
