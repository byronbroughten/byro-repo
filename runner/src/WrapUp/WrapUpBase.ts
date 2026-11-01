// The Base WrapUp and its collaborators share, importing no collaborator so `extends WrapUpBase` loads first.

import { messageOf } from "../failureText.ts";
import { sleep } from "../sleep.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import {
  defaultWrapUpKnobs,
  type WrapUpConfig,
  type WrapUpKnobs,
} from "./wrapUpTypes.ts";

export class WrapUpBase {
  protected readonly config: WrapUpConfig;
  protected readonly knobs: WrapUpKnobs;

  constructor(config: WrapUpConfig) {
    this.config = config;
    this.knobs = { ...defaultWrapUpKnobs, ...config.knobs };
  }

  protected async _withRetries<RV>(
    label: string,
    action: () => Promise<RV>,
  ): Promise<RV> {
    const tries = this.knobs.networkTries;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        if (attempt >= tries) {
          throw new WrapUpFailure(
            "network",
            `${label} failed after ${tries} tries: ${messageOf(error)}`,
          );
        }
        await this._sleep(this.knobs.backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  protected get _sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? sleep;
  }

  protected _log(line: string): void {
    this.config.log?.(line);
  }
}
