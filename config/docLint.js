// @ts-check
// Checks a repo's agent-facing docs' links and size limits; a doc map in, violations out. lintDocs.js runs it on the repo it is invoked in.
import { posix } from "node:path";

const limits = {
  leadLines: 5,
  leadBytes: 800,
  unheadedDocBytes: 4 * 1024,
};
const linkedRootFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "GLOSSARY.md",
  "README.md",
]);
const workspaceFolders = new Set(["config"]);

/** @typedef {Record<string, string>} Docs */
/** @typedef {{ path: string, line: number, message: string }} Violation */
/** @typedef {(line: number, message: string) => void} Report */
/** @typedef {{ docs: Docs, known: Set<string>, trackedRoots: Set<string>, published: Set<string>, slugsOf: (path: string) => Set<string>, report: Report }} LinkContext */
/** @typedef {{ line: number, content: string }} ProseLine */
/** @typedef {{ line: number, target: string }} Link */

/**
 * `docs` maps every markdown path to its contents; `paths` lists the other repo files and folders a link may name.
 * @param {{ docs: Docs, paths?: string[], published?: string[] }} args
 * @returns {Violation[]}
 */
export function checkDocs({ docs, paths = [], published = [] }) {
  const known = new Set([...Object.keys(docs), ...paths]);
  const trackedRoots = rootsOf(known);
  const publishedRoots = new Set(
    published.map((root) => normalizeRoot(root, trackedRoots)),
  );
  const slugs = new Map();
  /** @param {string} path */
  function slugsOf(path) {
    if (!slugs.has(path)) slugs.set(path, headingSlugs(docs[path] ?? ""));
    return slugs.get(path) ?? new Set();
  }
  /** @type {Violation[]} */
  const violations = [];
  for (const [path, text] of Object.entries(docs)) {
    /** @type {Report} */
    function report(line, message) {
      violations.push({ path, line, message });
    }
    if (isLinkChecked(path)) {
      checkLinks(path, text, {
        docs,
        known,
        trackedRoots,
        published: publishedRoots,
        slugsOf,
        report,
      });
    }
    if (isDocsFolderFile(path)) checkLead(text, report);
    if (posix.basename(path) === "AGENTS.md" && path !== "AGENTS.md") {
      checkClaudePairing(path, docs, report);
    }
  }
  return violations;
}

// The repo root, a workspace folder such as `config`, or the `packages/<name>` folder, that holds the doc.
/** @param {string} path */
function docRoot(path) {
  const parts = path.split("/");
  const top = parts[0] ?? "";
  if (top === "packages" && parts.length > 2) {
    return parts.slice(0, 2).join("/");
  }
  return workspaceFolders.has(top) && parts.length > 1 ? top : "";
}

// `path` relative to its doc root.
/** @param {string} path */
function inRoot(path) {
  const root = docRoot(path);
  return root === "" ? path : path.slice(root.length + 1);
}

/** @param {string} path */
function isDocsFolderFile(path) {
  return inRoot(path).startsWith("docs/");
}

/** @param {string} path */
function isLinkChecked(path) {
  const name = posix.basename(path);
  const local = inRoot(path);
  if (!local.includes("/")) return linkedRootFiles.has(local);
  return isDocsFolderFile(path) || name === "AGENTS.md" || name === "CLAUDE.md";
}

// The repo root is "", a workspace folder is its name and a package is `packages/<name>`, however the caller spells it; an untracked one is a typo, not a no-op.
/**
 * @param {string} root
 * @param {Set<string>} trackedRoots
 */
function normalizeRoot(root, trackedRoots) {
  const normal = posix.normalize(root).replace(/\/$/, "");
  if (normal === ".") return "";
  if (packageRootOf(normal) !== normal && !workspaceFolders.has(normal)) {
    const folders = [...workspaceFolders].map((folder) => `"${folder}", `);
    throw new Error(
      `published must be ".", ${folders.join("")}or packages/<name>, not ${root}`,
    );
  }
  if (!trackedRoots.has(normal)) {
    throw new Error(`published package ${root} has no tracked files`);
  }
  return normal;
}

// The `packages/<name>` folder a path is in or is.
/** @param {string} path */
function packageRootOf(path) {
  return /^packages\/[^/]+/.exec(path)?.[0];
}

// The workspace and `packages/<name>` folders that hold at least one tracked path.
/** @param {Set<string>} known */
function rootsOf(known) {
  const roots = new Set();
  for (const path of known) {
    const root = docRoot(path);
    if (root) roots.add(root);
  }
  return roots;
}

/**
 * @param {string} resolved
 * @param {string} root
 */
function isInside(resolved, root) {
  if (root === "") return resolved !== ".." && !resolved.startsWith("../");
  return resolved.startsWith(`${root}/`);
}

/**
 * @param {string} path
 * @param {string} text
 * @param {LinkContext} context
 */
function checkLinks(
  path,
  text,
  { docs, known, trackedRoots, published, slugsOf, report },
) {
  // A published package ships without the rest of the repo, so each checked doc in it must stand alone.
  const publishedIn = published.has(docRoot(path)) ? docRoot(path) : undefined;
  const scope = publishedIn === "" ? "the repo" : publishedIn;
  for (const { line, target } of linksIn(text)) {
    const hashAt = target.indexOf("#");
    const file = hashAt === -1 ? target : target.slice(0, hashAt);
    const anchor =
      hashAt === -1 ? null : decodeURIComponent(target.slice(hashAt + 1));
    const resolved =
      file === "" ? path : resolveLink(path, decodeURIComponent(file));
    if (publishedIn !== undefined && !isInside(resolved, publishedIn)) {
      report(
        line,
        `link ${target} leaves ${scope}; its published docs link only inside ${scope}`,
      );
    }
    if (isUntrackedPackagePath(resolved, trackedRoots)) continue;
    if (!known.has(resolved)) {
      report(line, `broken link ${target}: no file ${resolved}`);
      continue;
    }
    if (anchor === null || !(resolved in docs)) continue;
    if (!slugsOf(resolved).has(anchor)) {
      report(
        line,
        `broken anchor ${target}: no heading slugs to ${anchor} in ${resolved}`,
      );
    }
  }
}

// A checkout that lacks a package (the private root without its clones) can't say whether a path in it exists, so a link into it is external.
/**
 * @param {string} resolved
 * @param {Set<string>} trackedRoots
 */
function isUntrackedPackagePath(resolved, trackedRoots) {
  const root = packageRootOf(resolved);
  return root !== undefined && !trackedRoots.has(root);
}

/**
 * @param {string} from
 * @param {string} file
 */
function resolveLink(from, file) {
  const joined = file.startsWith("/")
    ? file.slice(1)
    : posix.join(posix.dirname(from), file);
  return posix.normalize(joined).replace(/\/$/, "");
}

/**
 * @param {string} text
 * @returns {Link[]}
 */
function linksIn(text) {
  /** @type {Link[]} */
  const links = [];
  for (const { line, content } of proseLines(text)) {
    const bare = content.replace(/`[^`]*`/g, "");
    for (const match of bare.matchAll(
      /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )) {
      links.push({ line, target: match[1] ?? "" });
    }
    const reference = /^\s*\[[^\]]+\]:\s*(\S+)/.exec(bare);
    if (reference) links.push({ line, target: reference[1] ?? "" });
  }
  return links.filter(({ target }) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

// Lines outside fenced code blocks, numbered from 1.
/**
 * @param {string} text
 * @returns {ProseLine[]}
 */
function proseLines(text) {
  /** @type {ProseLine[]} */
  const lines = [];
  /** @type {string | null} */
  let fence = null;
  text.split("\n").forEach((content, index) => {
    const opener = /^\s*(```|~~~)/.exec(content);
    if (opener) {
      if (fence === null) fence = opener[1] ?? null;
      else if (opener[1] === fence) fence = null;
      return;
    }
    if (fence === null) lines.push({ line: index + 1, content });
  });
  return lines;
}

// GitHub's slugger: lowercase, drop everything but letters, marks, numbers, spaces, `-` and `_`, then spaces to `-`.
/** @param {string} text */
function headingSlugs(text) {
  const slugs = new Set();
  const seen = new Map();
  for (const { content } of proseLines(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(content);
    if (!heading) continue;
    const rendered = (heading[1] ?? "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*]/g, "");
    const base = rendered
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N} _-]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

// A read-by-heading doc's lead: the non-blank lines after its title and before its first `##` heading.
/**
 * @param {string} text
 * @param {Report} report
 */
function checkLead(text, report) {
  const lines = proseLines(text);
  const firstSection = lines.findIndex(({ content }) => /^##\s/.test(content));
  if (firstSection === -1) {
    const bytes = byteLength(text);
    if (bytes > limits.unheadedDocBytes) {
      report(
        1,
        `doc is ${bytes} bytes with no ## heading; over ${limits.unheadedDocBytes} bytes, give it a short lead and ## headings so it can be read by section`,
      );
    }
    return;
  }
  const lead = lines
    .slice(0, firstSection)
    .filter(({ content }) => content.trim() !== "" && !/^#\s/.test(content));
  const leadLine = lead[0]?.line ?? 1;
  if (lead.length > limits.leadLines) {
    report(
      leadLine,
      `lead is ${lead.length} lines before the first ## heading; keep it to ${limits.leadLines} and move the rest under a heading`,
    );
    return;
  }
  const bytes = byteLength(lead.map(({ content }) => content).join("\n"));
  if (bytes > limits.leadBytes) {
    report(
      leadLine,
      `lead is ${bytes} bytes before the first ## heading; keep it to ${limits.leadBytes} and move the rest under a heading`,
    );
  }
}

/** @param {string} text */
function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * @param {string} path
 * @param {Docs} docs
 * @param {Report} report
 */
function checkClaudePairing(path, docs, report) {
  const claude = posix.join(posix.dirname(path), "CLAUDE.md");
  const importsIt = (docs[claude] ?? "")
    .split("\n")
    .some((line) => line.trim() === "@AGENTS.md");
  if (!importsIt) {
    report(
      1,
      `no sibling CLAUDE.md importing it; add ${claude} containing @AGENTS.md`,
    );
  }
}
