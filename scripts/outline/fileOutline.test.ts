import { describe, expect, it } from "vitest";

import { fileOutline } from "./fileOutline.ts";

function lines(...outline: string[]): string {
  return outline.join("\n");
}

describe("fileOutline", () => {
  it("lists a module's functions, a multi-line signature on one line", () => {
    const source = lines(
      'import { join } from "node:path";',
      "",
      "export function pathOf(folder: string, name: string): string {",
      "  return join(folder, name);",
      "}",
      "",
      "function report(",
      "  hits: string[],",
      "  passageCount: number,",
      "): string {",
      '  return "";',
      "}",
    );
    expect(fileOutline("module.ts", source)).toBe(
      lines(
        "3: export function pathOf(folder: string, name: string): string",
        "7: function report(hits: string[], passageCount: number): string",
      ),
    );
  });

  it("nests a class's members under it, marked, with the unexported function below", () => {
    const source = lines(
      "export class Ledger {",
      "  static readonly unitCount = 4;",
      "  #rows: string[] = [];",
      "  constructor(private readonly name: string) {}",
      "  static init(name: string): Ledger {",
      "    return new Ledger(name);",
      "  }",
      "  get rowCount(): number {",
      "    return this.#rows.length;",
      "  }",
      "  set label(value: string) {}",
      "  add(row: string) {",
      "    this.#rows.push(clean(row));",
      "  }",
      "  protected _flush(): void {}",
      "  private _reset(): void {}",
      "  #sort(): void {}",
      "}",
      "",
      "function clean(row: string): string {",
      "  return row.trim();",
      "}",
    );
    expect(fileOutline("Ledger.ts", source)).toBe(
      lines(
        "1: export class Ledger",
        "  2: static readonly unitCount",
        "  3: #rows: string[]",
        "  4: constructor(private readonly name: string)",
        "  5: static init(name: string): Ledger",
        "  8: get rowCount(): number",
        "  11: set label(value: string)",
        "  12: add(row: string)",
        "  15: protected _flush(): void",
        "  16: private _reset(): void",
        "  17: #sort(): void",
        "20: function clean(row: string): string",
      ),
    );
  });

  it("nests a bundle's methods and function-valued properties under it", () => {
    const source = lines(
      "export const npmCommands = {",
      "  programOf(words: string[]): string | undefined {",
      "    return words[0];",
      "  },",
      '  label: "npm",',
      '  isNpm: (words: string[]) => words[0] === "npm",',
      "};",
    );
    expect(fileOutline("npmCommands.ts", source)).toBe(
      lines(
        "1: export const npmCommands",
        "  2: programOf(words: string[]): string | undefined",
        "  6: isNpm(words: string[])",
      ),
    );
  });

  it("writes destructured parameters as written and a return type only where declared", () => {
    const source = lines(
      "export function overlapHits({",
      "  deliverable,",
      "  passages,",
      "}: OverlapInput): OverlapHit[] {",
      "  return [];",
      "}",
      'export const firstOf = ([head]: string[], fallback = "") => head ?? fallback;',
    );
    expect(fileOutline("overlapHits.ts", source)).toBe(
      lines(
        "1: export function overlapHits({ deliverable, passages, }: OverlapInput): OverlapHit[]",
        "7: export const firstOf = ([head]: string[], fallback)",
      ),
    );
  });

  it("lists interfaces, types, enums and plain constants", () => {
    const source = lines(
      "interface AppChore {",
      "  name: string;",
      "}",
      "export type Verdict<VD> = { why: VD };",
      "enum Tier {",
      "  Free,",
      "}",
      'const usage: string = "usage";',
      "let count = 0;",
    );
    expect(fileOutline("types.ts", source)).toBe(
      lines(
        "1: interface AppChore",
        "4: export type Verdict<VD>",
        "5: enum Tier",
        "8: const usage: string",
        "9: let count",
      ),
    );
  });

  it("errors naming a file that fails to parse", () => {
    expect(() =>
      fileOutline("broken.ts", "function report(hits: string[] {"),
    ).toThrow(/^broken\.ts doesn't parse, line 1: /);
  });
});
