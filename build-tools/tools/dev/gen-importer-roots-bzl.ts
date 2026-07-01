#!/usr/bin/env zx-wrapper
/**
 * Generate build-tools/lang/importer_roots.bzl from build-tools/tools/lib/importer-roots.json
 * - Deterministic ordering
 * - Fail fast when the contract is missing or invalid
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers";
import { buildToolPath } from "./dev-build/paths";

type RawContract = Partial<{
  allowDotImporter: unknown;
  workspaceRoots: unknown;
}>;

const DEFAULT_WORKSPACE_ROOTS = ["projects/apps", "projects/libs"];

function normalizeWorkspaceRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) continue;
    if (trimmed === ".") continue;
    if (trimmed.includes("\\")) continue;
    const parts = trimmed.split("/");
    if (parts.some((p) => p === "" || p === "." || p === "..")) continue;
    out.push(parts.join("/"));
  }
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
}

function renderBzl(allowDotImporter: boolean, workspaceRoots: string[]): string {
  const roots =
    workspaceRoots.length === 0
      ? "[]"
      : "[\n" + workspaceRoots.map((r) => `    "${r}",`).join("\n") + "\n]";
  return [
    "# GENERATED FILE — DO NOT EDIT.",
    "# Rendered from build-tools/tools/lib/importer-roots.json",
    "",
    `ALLOW_DOT_IMPORTER = ${allowDotImporter ? "True" : "False"}`,
    `WORKSPACE_IMPORTER_ROOTS = ${roots}`,
    "",
  ].join("\n");
}

async function firstExistingFile(paths: string[]): Promise<string> {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return paths[0];
}

async function outputImporterRootsPath(root: string): Promise<string> {
  return buildToolPath(root, "lang/importer_roots.bzl");
}

async function main() {
  const root = process.cwd();
  const jsonPath = await firstExistingFile([
    buildToolPath(root, "tools/lib/importer-roots.json"),
    process.env.VIBEROOTS_SOURCE_ROOT
      ? path.join(
          process.env.VIBEROOTS_SOURCE_ROOT,
          "build-tools",
          "tools",
          "lib",
          "importer-roots.json",
        )
      : "",
    process.env.VIBEROOTS_ROOT
      ? path.join(process.env.VIBEROOTS_ROOT, "build-tools", "tools", "lib", "importer-roots.json")
      : "",
  ]);
  const bzlPath = await outputImporterRootsPath(root);
  const txt = await fsp.readFile(jsonPath, "utf8");
  const raw = JSON.parse(txt) as RawContract;
  const allowDotImporter = raw.allowDotImporter === false ? false : true;
  const workspaceRootsRaw = normalizeWorkspaceRoots(raw.workspaceRoots);
  const workspaceRoots =
    workspaceRootsRaw.length > 0 ? workspaceRootsRaw : DEFAULT_WORKSPACE_ROOTS.slice();
  const out = renderBzl(allowDotImporter, workspaceRoots);
  const changed = await writeIfChanged(bzlPath, out);
  if (String(process.env.VBR_VERBOSE || "").trim()) {
    console.log(
      `wrote ${bzlPath} (${workspaceRoots.length} workspace roots)${changed ? "" : " (unchanged)"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
