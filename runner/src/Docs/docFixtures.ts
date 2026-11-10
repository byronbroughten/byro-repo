import { readFileSync } from "node:fs";

import type { GoogleDocument } from "./googleDocs.ts";

/** A `documents.get` JSON fixture from `fixtures/`, by its file's name. */
export function fixtureDocument(name: string): GoogleDocument {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as GoogleDocument;
}
