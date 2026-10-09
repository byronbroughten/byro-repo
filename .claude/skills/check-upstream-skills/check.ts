// Report-only: compares each upstream source with .claude/skills/upstream.json; it never edits.
// Usage: node check.ts <work-dir>. Exits 1 when anything upstream moved, 0 when up to date.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type PathEntry, trackedChangeSummary } from "./trackedChangeSummary.ts";

interface Source {
  repo: string;
  skillsRoot: string;
  pluginManifest: string;
  syncedSha: string;
  promoted: string[];
  paths: Record<string, PathEntry>;
}

interface Manifest {
  sources: Record<string, Source>;
}

interface TrackedChange {
  summary: string;
  patch: string;
}

interface LayoutChanges {
  unclassified: string[];
  removed: string[];
}

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "upstream.json");

main(process.argv[2]);

function main(workDir: string | undefined): void {
  if (!workDir) throw new Error("usage: node check.ts <work-dir>");
  mkdirSync(workDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const changedSources = Object.entries(manifest.sources).filter(([name, source]) =>
    reportSource(workDir, name, source),
  );
  process.exitCode = changedSources.length > 0 ? 1 : 0;
}

function reportSource(workDir: string, name: string, source: Source): boolean {
  const slug = name.replaceAll("/", "__");
  const clone = syncClone(join(workDir, slug), source.repo);
  const head = git(clone, "rev-parse", "origin/HEAD");
  console.log(`# ${name}`);
  console.log(`HEAD ${short(head)} (${git(clone, "log", "-1", "--format=%cs", head)}); synced ${short(source.syncedSha)}`);

  const tracked = trackedChanges(clone, source, head);
  const declined = declinedChanges(clone, source, head);
  const layout = layoutChanges(clone, source, head);
  const promoted = promotedChanges(clone, source, head);
  const inProgressCount = inProgressChanges(clone, source, head);

  console.log(`\nTracked paths changed since their syncedSha: ${tracked.length}`);
  tracked.forEach((change) => console.log(`  ${change.summary}`));
  console.log(`Declined paths changed: ${declined.length > 0 ? declined.join(", ") : "none"}`);
  console.log(`\nUnclassified upstream skills: ${layout.unclassified.length}`);
  layout.unclassified.forEach((line) => console.log(`  ${line}`));
  console.log(`Tracked paths gone upstream: ${layout.removed.length}`);
  layout.removed.forEach((path) => console.log(`  ${path}`));
  console.log(`\nPromoted set: ${promoted.length > 0 ? "changed" : "unchanged"}`);
  promoted.forEach((line) => console.log(`  ${line}`));
  console.log(`In-progress skills changed: ${inProgressCount}`);

  if (tracked.length > 0) {
    const patchFile = join(workDir, `${slug}.patch`);
    writeFileSync(patchFile, `${tracked.map((change) => change.patch).join("\n")  }\n`);
    console.log(`\nFull diff of changed tracked paths: ${patchFile}`);
  }
  const hasChanged =
    tracked.length + declined.length + layout.unclassified.length + layout.removed.length + promoted.length > 0;
  if (!hasChanged) console.log("\nUp to date.");
  console.log("");
  return hasChanged;
}

// Blobless: full history for per-path diffs, file contents fetched only when read.
function syncClone(clone: string, repo: string): string {
  if (existsSync(clone)) git(clone, "fetch", "-q", "origin");
  else execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", repo, clone]);
  return clone;
}

function trackedChanges(clone: string, source: Source, head: string): TrackedChange[] {
  return Object.entries(source.paths).flatMap(([path, entry]) => {
    if (entry.status === "declined") return [];
    const syncedSha = entry.syncedSha ?? source.syncedSha;
    const commits = lines(git(clone, "log", "--oneline", `${syncedSha}..${head}`, "--", path));
    if (commits.length === 0) return [];
    const stat = git(clone, "diff", "--shortstat", syncedSha, head, "--", path) || "no content change";
    return [
      {
        summary: trackedChangeSummary({ path, entry, commitCount: commits.length, stat }),
        patch: git(clone, "diff", syncedSha, head, "--", path),
      },
    ];
  });
}

function declinedChanges(clone: string, source: Source, head: string): string[] {
  return Object.entries(source.paths)
    .filter(([path, entry]) => entry.status === "declined" && hasDiff(clone, source.syncedSha, head, path))
    .map(([path]) => path);
}

function layoutChanges(clone: string, source: Source, head: string): LayoutChanges {
  const skillsNow = skillDirs(clone, source.skillsRoot, head);
  const skillsThen = new Set(skillDirs(clone, source.skillsRoot, source.syncedSha));
  const removed = Object.keys(source.paths).filter(
    (path) => path.startsWith(`${source.skillsRoot}/`) && !skillsNow.includes(path),
  );
  const unclassified = skillsNow
    .filter((dir) => !(dir in source.paths))
    .map((dir) => `${dir}${skillsThen.has(dir) ? "" : " (new)"}${movedFromNote(dir, removed)}`);
  return { unclassified, removed };
}

function movedFromNote(dir: string, removed: string[]): string {
  const match = removed.find((path) => basename(path) === basename(dir));
  return match ? ` (moved from ${match}?)` : "";
}

function promotedChanges(clone: string, source: Source, head: string): string[] {
  const pluginManifest = JSON.parse(git(clone, "show", `${head}:${source.pluginManifest}`)) as { skills: string[] };
  const promotedNow = pluginManifest.skills.map((path) => path.replace(/^\.\/skills\//, ""));
  const added = promotedNow.filter((path) => !source.promoted.includes(path)).map((path) => `+ ${path}`);
  const dropped = source.promoted.filter((path) => !promotedNow.includes(path)).map((path) => `- ${path}`);
  return [...added, ...dropped];
}

function inProgressChanges(clone: string, source: Source, head: string): number {
  const root = `${source.skillsRoot}/in-progress`;
  const files = lines(git(clone, "diff", "--name-only", source.syncedSha, head, "--", root));
  return new Set(files.map((file) => file.slice(root.length + 1).split("/")[0])).size;
}

function skillDirs(clone: string, root: string, sha: string): string[] {
  return lines(git(clone, "ls-tree", "-r", "--name-only", sha, "--", root))
    .filter((file) => file.endsWith("/SKILL.md"))
    .map((file) => dirname(file));
}

function hasDiff(clone: string, from: string, to: string, path: string): boolean {
  return lines(git(clone, "diff", "--name-only", from, to, "--", path)).length > 0;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
}

function lines(text: string): string[] {
  return text ? text.split("\n") : [];
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
