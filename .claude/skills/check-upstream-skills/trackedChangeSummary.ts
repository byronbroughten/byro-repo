export interface PathEntry {
  status: "vendored" | "reference-only" | "declined";
  syncedSha?: string;
  reason?: string;
  derivedInto?: string[];
  notes?: string;
}

export interface ChangedPath {
  path: string;
  entry: PathEntry;
  commitCount: number;
  stat: string;
}

export function trackedChangeSummary({ path, entry, commitCount, stat }: ChangedPath): string {
  const summary = `${entry.status.padEnd(14)} ${path}: ${commitCount} commit(s), ${stat}`;
  if (!entry.derivedInto?.length) return summary;
  return `${summary}; forks: ${entry.derivedInto.join(", ")}`;
}
