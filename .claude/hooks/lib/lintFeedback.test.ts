import { describe, expect, it } from "vitest";

import { lintFeedback } from "./lintFeedback.ts";

const filePath = "packages/framework/src/utils/Arr.ts";
function eslintJson(messages: object[]): string {
  return JSON.stringify([{ filePath: `/repo/${filePath}`, messages }]);
}
function error(
  line: number,
  column: number,
  ruleId: string | null,
  message: string,
): object {
  return { ruleId, severity: 2, message, line, column };
}

describe("lintFeedback", () => {
  it("is silent for a clean file", () => {
    expect(
      lintFeedback({ eslintJson: eslintJson([]), filePath }),
    ).toBeUndefined();
    expect(lintFeedback({ eslintJson: "[]", filePath })).toBeUndefined();
  });

  it("lists each remaining error with its line, column and rule", () => {
    const feedback = lintFeedback({
      eslintJson: eslintJson([
        error(4, 9, "no-restricted-syntax", "Use an as const object."),
        error(
          12,
          1,
          "@typescript-eslint/explicit-function-return-type",
          "Missing return type.",
        ),
      ]),
      filePath,
    });
    expect(feedback).toContain(`2 errors in ${filePath}`);
    expect(feedback).toContain(
      "4:9 no-restricted-syntax Use an as const object.",
    );
    expect(feedback).toContain(
      "12:1 @typescript-eslint/explicit-function-return-type Missing return type.",
    );
  });

  it("names a parse error, which has no rule", () => {
    const feedback = lintFeedback({
      eslintJson: eslintJson([error(3, 2, null, "Unexpected token")]),
      filePath,
    });
    expect(feedback).toContain("1 error in");
    expect(feedback).toContain("3:2 parse-error Unexpected token");
  });

  it("ignores warnings", () => {
    const warning = {
      ruleId: null,
      severity: 1,
      message: "File ignored.",
      line: 0,
      column: 0,
    };
    expect(
      lintFeedback({ eslintJson: eslintJson([warning]), filePath }),
    ).toBeUndefined();
  });

  it("caps a long list and says how many were left out", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      error(index + 1, 1, "curly", "Expected braces."),
    );
    const feedback = lintFeedback({ eslintJson: eslintJson(many), filePath });
    expect(feedback).toContain("25 errors");
    expect(feedback).toContain("and 5 more");
    expect(feedback?.split("\n")).toHaveLength(22);
  });

  it("fails open on output it can't parse", () => {
    expect(lintFeedback({ eslintJson: "", filePath })).toBeUndefined();
    expect(
      lintFeedback({ eslintJson: "Oops! Something went wrong", filePath }),
    ).toBeUndefined();
    expect(
      lintFeedback({ eslintJson: '{"messages":[]}', filePath }),
    ).toBeUndefined();
    expect(lintFeedback({ eslintJson: "[null, 3]", filePath })).toBeUndefined();
  });
});
