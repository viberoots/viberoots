#!/usr/bin/env zx-wrapper
/**
 * Generate build-tools/lang/nix_attr_aliases.bzl from build-tools/tools/lib/nix-attr-aliases.json
 * - Deterministic key ordering
 * - Safe no-op when JSON is missing or empty
 */
import fsp from "node:fs/promises";
import { writeIfChanged } from "../lib/fs-helpers";
import { buildToolPath } from "./dev-build/paths";

async function readJsonIfExists<T = unknown>(p: string): Promise<T | null> {
  try {
    const data = await fsp.readFile(p, "utf8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function validateMap(obj: unknown): Record<string, string> {
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    const key = k.trim().toLowerCase();
    const val = v.trim().toLowerCase();
    if (!key || !val) continue;
    out[key] = val;
  }
  return out;
}

function renderBzl(map: Record<string, string>): string {
  const keys = Object.keys(map).sort();
  const body =
    keys.length === 0
      ? "{}"
      : "{\n" + keys.map((k) => `    "${k}": "${map[k]}",`).join("\n") + "\n}";
  return [
    "# GENERATED FILE — DO NOT EDIT.",
    "# Rendered from build-tools/tools/lib/nix-attr-aliases.json",
    '# Keys must be normalized (lowercased, with a leading "pkgs." prefix).',
    `NIX_ATTR_ALIASES = ${body}`,
    "",
  ].join("\n");
}

async function main() {
  const root = process.cwd();
  const jsonPath = buildToolPath(root, "tools/lib/nix-attr-aliases.json");
  const bzlPath = buildToolPath(root, "lang/nix_attr_aliases.bzl");
  const src = await readJsonIfExists<Record<string, string>>(jsonPath);
  const map = validateMap(src || {});
  const data = renderBzl(map);
  const changed = await writeIfChanged(bzlPath, data);
  console.log(
    `wrote ${bzlPath} (${Object.keys(map).length} aliases)${changed ? "" : " (unchanged)"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
