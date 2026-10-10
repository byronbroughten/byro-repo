import { noul, TypeSafeClient } from "@typesafe-ai/sdk";

import {
  type JevClient,
  jevPin,
  type JevRequest,
  type JevResult,
} from "./JevClient.ts";

export class TypeSafeJevClient implements JevClient {
  readonly #client: TypeSafeClient;

  constructor(apiKey: string) {
    this.#client = new TypeSafeClient({ apiKey });
  }

  async send(request: JevRequest): Promise<JevResult> {
    return this.#client.systemOne({ ...request, model: jevPin });
  }

  // The model list returns only aliases, never version numbers.
  async latestVersion(): Promise<string> {
    const { model } = await this.#client.systemOne({
      state: "ping",
      questions: { ping: noul("Is this text a greeting?") },
      model: "jev-latest",
    });
    return model;
  }
}
