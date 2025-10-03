#!/usr/bin/env zx-wrapper
import { writeIfChanged } from "../../lib/fs-helpers";
import { scanFlatPatchDir } from "../../lib/provider-sync";
import { decodeFromPatchFilename, providerNameForModuleKey } from "../../lib/providers";

export type GoEntry = { provider: string; moduleKey: string; patchPath: string };

function decodeModuleKeyFromFilename(file: string): string | null {
  if (!file.endsWith(".patch")) return null;
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) return null;
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) return null;
  const importPath = decodeFromPatchFilename(enc);
  return `${importPath}@${ver}`.toLowerCase();
}

export async function readGoEntries(opts?: {
  patchDir?: string;
  strict?: boolean;
}): Promise<GoEntry[]> {
  const PATCH_DIR = opts?.patchDir || "patches/go";
  const list = await scanFlatPatchDir({
    patchDir: PATCH_DIR,
    strict: opts?.strict,
    decodeKey: decodeModuleKeyFromFilename,
    nameForKey: (key: string) => {
      const at = key.lastIndexOf("@");
      const imp = key.slice(0, at);
      const ver = key.slice(at + 1);
      return providerNameForModuleKey(imp, ver);
    },
  });
  return list.map((e) => ({ provider: e.provider, moduleKey: e.key, patchPath: e.patchPath }));
}

export function renderGoTargets(entries: GoEntry[], opts?: { patchDir?: string }): string {
  const PATCH_DIR = opts?.patchDir || "patches/go";
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    `# Providers derived from filenames in ${PATCH_DIR}.`,
    "",
    'load("//third_party/providers:defs.bzl", "go_module_patch")',
    "",
  ].join("\n");
  const body = entries
    .map(
      (e) =>
        `go_module_patch(name = "${e.provider}", module_key = "${e.moduleKey}", patch_path = "${e.patchPath}",)`,
    )
    .join("\n");
  return header + body + (body ? "\n" : "");
}

export async function syncGoProviders(opts?: {
  outFile?: string;
  patchDir?: string;
  strict?: boolean;
}) {
  const out = opts?.outFile || "third_party/providers/TARGETS.auto";
  const entries = await readGoEntries({ patchDir: opts?.patchDir, strict: opts?.strict });
  const txt = renderGoTargets(entries, { patchDir: opts?.patchDir });
  await writeIfChanged(out, txt);
}
