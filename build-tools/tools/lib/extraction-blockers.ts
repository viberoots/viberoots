import fs from "node:fs";
import path from "node:path";

export type ExtractionBlocker = {
  kind: "path" | "buck-load" | "buck-label";
  path: string;
  detail: string;
};

const ALLOWED_VISIBLE_ROOT_ENTRIES = new Set([
  "AGENTS.md",
  "README.md",
  "buck-out",
  "projects",
  "viberoots",
]);

const ROOT_LEGACY_PATHS = [
  "build-tools",
  "third_party/providers",
  "prelude",
  "toolchains",
] as const;

const ACTIVE_BUCK_ROOTS = [
  "TARGETS",
  "projects",
  "build-tools/tools/scaffolding/templates",
  "viberoots/build-tools/tools/scaffolding/templates",
  ".viberoots/workspace/providers",
  ".viberoots/workspace/buck",
] as const;

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function walkBuckFiles(root: string, rel: string, out: string[]): void {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return;
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    const name = path.basename(rel);
    if (name.startsWith("TARGETS") || rel.endsWith(".bzl") || rel.endsWith(".jinja")) out.push(rel);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(full)) {
    walkBuckFiles(root, path.join(rel, entry), out);
  }
}

function buckFiles(root: string): string[] {
  const files: string[] = [];
  for (const rel of ACTIVE_BUCK_ROOTS) walkBuckFiles(root, rel, files);
  return files;
}

function visibleRootBlockers(root: string): ExtractionBlocker[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && !ALLOWED_VISIBLE_ROOT_ENTRIES.has(name))
    .sort()
    .map((name) => ({
      kind: "path" as const,
      path: name,
      detail:
        "visible parent root entry is outside the extracted workspace contract; only AGENTS.md, README.md, buck-out, projects, and viberoots are allowed",
    }));
}

function scanBuckFile(root: string, rel: string): ExtractionBlocker[] {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const blockers: ExtractionBlocker[] = [];
  if (text.includes('load("//build-tools') || text.includes("load('//build-tools")) {
    blockers.push({
      kind: "buck-load",
      path: rel,
      detail: "active Buck file loads //build-tools; use @viberoots//build-tools before extraction",
    });
  }
  if (text.includes("//third_party/providers")) {
    blockers.push({
      kind: "buck-label",
      path: rel,
      detail: "active Buck file references //third_party/providers; use workspace_providers",
    });
  }
  return blockers;
}

export function findExtractionBlockers(workspaceRoot: string): ExtractionBlocker[] {
  const root = path.resolve(workspaceRoot);
  const pathBlockers = ROOT_LEGACY_PATHS.filter((rel) => exists(root, rel)).map((rel) => ({
    kind: "path" as const,
    path: rel,
    detail: `root ${rel} exists; the extraction must move or remove this old-layout surface`,
  }));
  const blockers = visibleRootBlockers(root)
    .concat(pathBlockers)
    .concat(buckFiles(root).flatMap((rel) => scanBuckFile(root, rel)));
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.kind}\0${blocker.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatExtractionBlockers(blockers: ExtractionBlocker[]): string {
  return blockers.map((b) => `${b.kind}: ${b.path} - ${b.detail}`).join("\n");
}
