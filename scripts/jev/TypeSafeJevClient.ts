import { APIError, noul, TypeSafeClient } from "@typesafe-ai/sdk";

import {
  type JevClient,
  jevPin,
  type JevRequest,
  type JevResult,
} from "./JevClient.ts";
import { JevRequestTooLargeError } from "./JevRequestTooLargeError.ts";

export class TypeSafeJevClient implements JevClient {
  readonly #client: TypeSafeClient;

  constructor(apiKey: string) {
    this.#client = new TypeSafeClient({ apiKey });
  }

  async send(request: JevRequest): Promise<JevResult> {
    try {
      return await this.#client.systemOne({ ...request, model: jevPin });
    } catch (error) {
      if (isSizeRejection(error)) {
        throw new JevRequestTooLargeError(error.message, { cause: error });
      }
      throw error;
    }
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

// TypeSafe documents no size limit or status for one, so a 400 or 422 is read by its message.
function isSizeRejection(error: unknown): error is APIError {
  if (!(error instanceof APIError)) return false;
  if (error.status === 413) return true;
  if (error.status !== 400 && error.status !== 422) return false;
  return /too (large|long|many)|limit|exceed/i.test(error.message);
}
