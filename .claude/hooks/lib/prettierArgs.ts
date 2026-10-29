import { join } from "node:path";

// Only .prettierignore: Prettier's default also reads .gitignore, whose `packages/*` would skip every clone's files.
export function prettierWriteArgsOf(root: string, args: string[]): string[] {
  return [
    "--write",
    "--log-level",
    "warn",
    "--ignore-path",
    join(root, ".prettierignore"),
    ...args,
  ];
}
