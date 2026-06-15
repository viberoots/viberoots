#!/usr/bin/env zx-wrapper
/**
 * Generate build-tools/lang/nix_attr_aliases.bzl from build-tools/tools/lib/nix-attr-aliases.json
 * - Deterministic key ordering
 * - Safe no-op when JSON is missing or empty
 */
import fsp from "node:fs/promises";
import path from "node:path";
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
  const root = process.cwd();
  const jsonPath = buildToolPath(root, "tools/lib/nix-attr-aliases.json");
  const bzlPath = buildToolPath(root, "lang/nix_attr_aliases.bzl");
  const src = await readJsonIfExists<Record<string, string>>(jsonPath);
  const map = validateMap(src || {});
  const data = renderBzl(map);
  await writeIfChanged(bzlPath, data);
  console.log(`wrote ${bzlPath} (${Object.keys(map).length} aliases)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
