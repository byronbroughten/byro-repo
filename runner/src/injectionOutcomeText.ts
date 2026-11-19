import type {
  BriefRun,
  HookCall,
  HookSession,
  InjectionOutcome,
  SkillCall,
} from "./InjectionProbe.ts";

export function injectionOutcomeText(outcome: InjectionOutcome): string {
  const head = `${outcome.skill} (allowed-tools: ${outcome.allowedTools ?? "none"}) by ${outcome.invokedBy}`;
  const parts: string[] = [];
  if (outcome.invokedBy !== "slash command") {
    parts.push(skillCallText(outcome.skillCall));
  }
  parts.push(briefText(outcome));
  if (outcome.hook !== undefined) {
    parts.push(`${outcome.hook.event} hook's tmpdir ${outcome.hook.tmpdir}`);
  } else {
    parts.push("no hook reported its tmpdir");
  }
  if (outcome.brief?.markerFolder !== undefined) {
    const { path, read, write } = outcome.brief.markerFolder;
    parts.push(`marker folder ${path} ${read}, ${write}`);
  }
  if (outcome.hookCalls.length > 0) {
    parts.push(
      `PreToolUse saw ${outcome.hookCalls.map(hookCallText).join(", ")}`,
    );
  } else {
    parts.push("no PreToolUse call");
  }
  return `${head}: ${parts.join("; ")}`;
}

function skillCallText(skillCall: SkillCall | undefined): string {
  if (skillCall === undefined) return "no Skill call";
  if (skillCall.status === "ran") return "Skill call ran";
  if (skillCall.status === "unanswered") return "Skill call had no result";
  return `Skill call failed (${skillCall.error})`;
}

function briefText({ brief, hook }: InjectionOutcome): string {
  if (brief === undefined) return "not run";
  return `ran, ps ${brief.ps}, ${sessionIdText(brief, hook)}`;
}

// The brief names where it found anything session-like; the hook's own session ID says which of them is the real one.
function sessionIdText(brief: BriefRun, hook: HookSession | undefined): string {
  const found = Object.entries(brief.sessionIds);
  if (hook?.sessionId === undefined) {
    return `no hook session ID to compare (brief saw ${foundText(found)})`;
  }
  const sessionId = hook.sessionId;
  const seenIn = found
    .filter(([, value]) => value.includes(sessionId))
    .map(([name]) => name);
  if (seenIn.length > 0) return `session ID seen in ${seenIn.join(", ")}`;
  return `session ID not seen (brief saw ${foundText(found)})`;
}

function foundText(found: [string, string][]): string {
  if (found.length === 0) return "nothing";
  return found.map(([name, value]) => `${name}=${value}`).join(", ");
}

function hookCallText({ toolName, command }: HookCall): string {
  if (command === undefined) return toolName;
  return `${toolName} ${command}`;
}
