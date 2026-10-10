// Hands a request file's yes/no, pick-one or scale questions to Jev and prints { answers, usage } as JSON.
// Usage: npm run jev -- <request.json>. When to use it: docs/agents/jev.md.
import { runJev } from "./runJev.ts";
import { TypeSafeJevClient } from "./TypeSafeJevClient.ts";

try {
  const printed = await runJev({
    requestPath: process.argv[2],
    apiKey: process.env.TYPESAFE_API_KEY?.trim(),
    connect: (apiKey) => new TypeSafeJevClient(apiKey),
  });
  printed.stderr.forEach((line) => console.error(line));
  console.log(printed.stdout);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
