// One TypeScript file's outline: each top-level declaration with its line, signatures but no bodies.
import ts from "typescript";

const memberIndent = "  ";
const typeKeywords = {
  [ts.SyntaxKind.InterfaceDeclaration]: "interface",
  [ts.SyntaxKind.TypeAliasDeclaration]: "type",
  [ts.SyntaxKind.EnumDeclaration]: "enum",
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
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return String(line + 1);
}

function statementLinesOf(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement)) {
    return [
      lineOf(
        statement,
        `${modifiersOf(statement)}function ${statement.name?.text ?? ""}${signatureOf(statement)}`,
      ),
    ];
  }
  if (ts.isClassDeclaration(statement)) {
    return [
      lineOf(
        statement,
        `${modifiersOf(statement)}class ${statement.name?.text ?? ""}`,
      ),
      ...nested(statement.members.flatMap(classMemberLinesOf)),
    ];
  }
  if (ts.isVariableStatement(statement)) {
    const keyword = statement.declarationList.getFirstToken()?.getText() ?? "";
    return statement.declarationList.declarations.flatMap((declaration) =>
      variableLinesOf(
        declaration,
        `${modifiersOf(statement)}${keyword} ${flat(declaration.name.getText())}`,
      ),
    );
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return [
      lineOf(
        statement,
        `${modifiersOf(statement)}${typeKeywords[statement.kind]} ${statement.name.text}${typeParametersOf(statement)}`,
      ),
    ];
  }
  return [];
}

function typeParametersOf(
  node: ts.DeclarationWithTypeParameterChildren,
): string {
  if (!node.typeParameters) return "";
  return `<${node.typeParameters.map((parameter) => flat(parameter.getText())).join(", ")}>`;
}

function classMemberLinesOf(member: ts.ClassElement): string[] {
  if (ts.isConstructorDeclaration(member)) {
    return [lineOf(member, `constructor${signatureOf(member)}`)];
  }
  if (ts.isPropertyDeclaration(member)) {
    const optional = member.questionToken ? "?" : "";
    return [
      lineOf(
        member,
        `${memberNameOf(member)}${optional}${typeAnnotationOf(member.type)}`,
      ),
    ];
  }
  return methodLinesOf(member);
}

// A method or accessor, which a class and a bundle write the same way.
function methodLinesOf(member: ts.Node): string[] {
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
  return `${modifiersOf(member)}${flat(member.name.getText())}`;
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
    return [line, ...nested(value.properties.flatMap(bundleMemberLinesOf))];
  }
  return [line];
}

// A bundle's functions, the rest of its properties being data.
function bundleMemberLinesOf(member: ts.ObjectLiteralElementLike): string[] {
  if (!ts.isPropertyAssignment(member)) return methodLinesOf(member);
  const value = unwrapped(member.initializer);
  if (!isFunctionValue(value)) return [];
  return [
    lineOf(member, `${flat(member.name.getText())}${signatureOf(value)}`),
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

function nested(lines: string[]): string[] {
  return lines.map((line) => `${memberIndent}${line}`);
}

function lineOf(node: ts.Node, text: string): string {
  const { line } = node
    .getSourceFile()
    .getLineAndCharacterOfPosition(node.getStart());
  return `${line + 1}: ${text}`;
}

function modifiersOf(node: ts.HasModifiers): string {
  const modifiers = ts.getModifiers(node) ?? [];
  return modifiers.map((modifier) => `${modifier.getText()} `).join("");
}

function signatureOf(node: ts.SignatureDeclaration): string {
  const parameters = node.parameters.map(parameterOf).join(", ");
  return `${typeParametersOf(node)}(${parameters})${typeAnnotationOf(node.type)}`;
}

// A default value is body, not signature, so it's left out.
function parameterOf(parameter: ts.ParameterDeclaration): string {
  const rest = parameter.dotDotDotToken ? "..." : "";
  const optional = parameter.questionToken ? "?" : "";
  return `${modifiersOf(parameter)}${rest}${flat(parameter.name.getText())}${optional}${typeAnnotationOf(parameter.type)}`;
}

function typeAnnotationOf(type: ts.TypeNode | undefined): string {
  return type ? `: ${flat(type.getText())}` : "";
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}
