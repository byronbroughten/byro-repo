// Checks a Deliverable against the writing style sheet with Jev and prints a `## Jev style` section.
// Usage and the Style file's shape: docs/agents/jev.md.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { runJevStyle } from "./runJevStyle.ts";
import { TypeSafeJevClient } from "./TypeSafeJevClient.ts";

const usage =
  'usage: npm run jev:style -- --deliverable <file> --style <file> [--section "<heading>"]…';

try {
  const { values } = parseArgs({
    options: {
      deliverable: { type: "string" },
      style: { type: "string" },
      section: { type: "string", multiple: true },
    },
  });
  if (!values.deliverable || !values.style) throw new Error(usage);
  const printed = await runJevStyle({
    deliverablePath: values.deliverable,
    stylePath: values.style,
    sections: values.section ?? [],
    styleSheetPath: fileURLToPath(
      new URL("../../docs/writing-style.md", import.meta.url),
    ),
    academicSheetPath: fileURLToPath(
      new URL("../../docs/academic-writing-style.md", import.meta.url),
    ),
    apiKey: process.env.TYPESAFE_API_KEY?.trim(),
    connect: (apiKey) => new TypeSafeJevClient(apiKey),
  });
  printed.stderr.forEach((line) => console.error(line));
  console.log(printed.stdout);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
