// The developer's `heldSends` setting: under `agentDiscretion` an app alias's `--confirm` without `--force` is free. gateLookups.ts reads it from the primary's settings.local.json, never from the command or the process environment.
export type HeldSends = "confirm" | "agentDiscretion";

// A key in the settings file's `env` block, which Claude Code accepts, unlike an unknown top-level one.
const settingKey = "BYRO_HELD_SENDS";

export const heldSends = {
  settingKey,
  // A missing or unknown value holds the send.
  valueOf(value: unknown): HeldSends {
    return value === "agentDiscretion" ? "agentDiscretion" : "confirm";
  },
  // As an environment assignment or an argument, either of which the gate ignores.
  isNamedIn(command: string): boolean {
    return new RegExp(`\\b(${settingKey}|heldSends)\\b`).test(command);
  },
  inlineWhy:
    "names the `heldSends` setting inline, which the gate reads only from the developer's settings",
} as const;
