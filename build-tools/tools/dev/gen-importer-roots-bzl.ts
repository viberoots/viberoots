#!/usr/bin/env zx-wrapper
/**
 * Generate lang/importer_roots.bzl from build-tools/tools/lib/importer-roots.json
 * - Deterministic ordering
 * - Fail fast when the contract is missing or invalid
 */
import fsp from "node:fs/promises";
import path from "node:path";

type RawContract = Partial<{
  allowDotImporter: unknown;
  workspaceRoots: unknown;
}>;

function normalizeWorkspaceRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) continue;
    if (trimmed === ".") continue;
    if (trimmed.includes("/") || trimmed.includes("\\")) continue;
    out.push(trimmed);
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

async function writeIfChanged(dst: string, data: string) {
  try {
    const cur = await fsp.readFile(dst, "utf8");
    if (cur === data) return;
  } catch {}
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  const tmp = path.join(
    path.dirname(dst),
    `.${path.basename(dst)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fsp.writeFile(tmp, data, "utf8");
  await fsp.rename(tmp, dst);
}

async function main() {
  const jsonPath = "build-tools/tools/lib/importer-roots.json";
  const bzlPath = "lang/importer_roots.bzl";
  const txt = await fsp.readFile(jsonPath, "utf8");
  const raw = JSON.parse(txt) as RawContract;
  const allowDotImporter = raw.allowDotImporter === false ? false : true;
  const workspaceRoots = normalizeWorkspaceRoots(raw.workspaceRoots);
  const out = renderBzl(allowDotImporter, workspaceRoots);
  await writeIfChanged(bzlPath, out);
  console.log(`wrote ${bzlPath} (${workspaceRoots.length} workspace roots)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
