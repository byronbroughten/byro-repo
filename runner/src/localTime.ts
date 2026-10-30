// Human-facing times: the machine's local time with its zone abbreviation, as `2026-10-29 07:49:05 CDT`.
// Run state, facts files and event files keep ISO UTC for machine readers; only text a person reads uses these.

const localTimePattern =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (\S+)$/;
const gmtOffsetPattern = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/;

const hourMs = 3_600_000;

export function localTimeOf(time: Date): string {
  const date = [
    time.getFullYear(),
    twoDigitsOf(time.getMonth() + 1),
    twoDigitsOf(time.getDate()),
  ].join("-");
  const clock = [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map(twoDigitsOf)
    .join(":");
  return `${date} ${clock} ${zoneOf(time)}`;
}

// The zone tells a repeated hour apart when the clocks go back; one this machine doesn't use reads as local.
export function timeOfLocal(text: string): Date | undefined {
  const match = localTimePattern.exec(text);
  if (match === null) return undefined;
  const zone = match[7] ?? "";
  const [year = 0, month = 1, day, hours, minutes, seconds] = match
    .slice(1, 7)
    .map(Number);
  const offsetMs = gmtOffsetMsOf(zone);
  if (offsetMs !== undefined) {
    const utc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
    return new Date(utc - offsetMs);
  }
  const local = new Date(year, month - 1, day, hours, minutes, seconds);
  const candidates = [-hourMs, 0, hourMs].map(
    (shiftMs) => new Date(local.getTime() + shiftMs),
  );
  return candidates.find((time) => localTimeOf(time) === text) ?? local;
}

function twoDigitsOf(value: number): string {
  return String(value).padStart(2, "0");
}

// Made per call, so a test's or a session's TZ is the one read.
function zoneOf(time: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  }).formatToParts(time);
  return parts.find(({ type }) => type === "timeZoneName")?.value ?? "UTC";
}

function gmtOffsetMsOf(zone: string): number | undefined {
  const match = gmtOffsetPattern.exec(zone);
  if (match === null) return undefined;
  const [, sign = "+", hours = "0", minutes = "0"] = match;
  const offsetMs = Number(hours) * hourMs + Number(minutes) * 60_000;
  return sign === "-" ? -offsetMs : offsetMs;
}
