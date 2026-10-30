// Human-facing times: the machine's local time with its zone abbreviation, as `2026-10-29 07:49:05 CDT`.
// Run state, facts files and event files keep ISO UTC for machine readers; only text a person reads uses these.

export interface StampedLine {
  time: Date;
  text: string;
}

const timePatterns = {
  localStampedLine:
    /^((\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (\S+)) (.*)$/, // localTimeOf's date, clock and zone, then the text.
  gmtOffset: /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/,
} as const;

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

// A line opening with localTimeOf's stamp, split into its time and text; undefined for a line with none.
// The zone tells a repeated hour apart when the clocks go back; one this machine doesn't use reads as local.
export function localStampedLineOf(line: string): StampedLine | undefined {
  const match = timePatterns.localStampedLine.exec(line);
  if (match === null) return undefined;
  const stamp = match[1] ?? "";
  const zone = match[8] ?? "";
  const text = match[9] ?? "";
  const [year = 0, month = 1, day, hours, minutes, seconds] = match
    .slice(2, 8)
    .map(Number);
  const offsetMs = gmtOffsetMsOf(zone);
  if (offsetMs !== undefined) {
    const utc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
    return { time: new Date(utc - offsetMs), text };
  }
  const local = new Date(year, month - 1, day, hours, minutes, seconds);
  const candidates = [-hourMs, 0, hourMs].map(
    (shiftMs) => new Date(local.getTime() + shiftMs),
  );
  const time =
    candidates.find((candidate) => localTimeOf(candidate) === stamp) ?? local;
  return { time, text };
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
  const match = timePatterns.gmtOffset.exec(zone);
  if (match === null) return undefined;
  const [, sign = "+", hours = "0", minutes = "0"] = match;
  const offsetMs = Number(hours) * hourMs + Number(minutes) * 60_000;
  return sign === "-" ? -offsetMs : offsetMs;
}
