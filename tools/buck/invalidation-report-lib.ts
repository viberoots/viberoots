import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers.ts";
import { readCompositeGraph, type ProviderIndexEntry } from "../lib/graph-view.ts";
import { isProviderPackageNode } from "../lib/graph-utils.ts";
import { parseLockfileLabel, normalizeTargetLabel } from "../lib/labels.ts";
import {
  patchInvalidationStrategyForLang,
  type PatchScope,
  type ProviderModel,
} from "../lib/lang-contracts.ts";
import { formatTextRow } from "./invalidation-report-format.ts";

type AutoMap = Record<string, string[]>;

type Node = {
  name?: string;
  rule_type?: string;
  labels?: string[];
  srcs?: unknown;
  deps?: unknown;
};

export type ProviderIndexEntryExt = ProviderIndexEntry & {
  patch_scope?: PatchScope;
  languages?: string[];
  patch_inputs_expected_in?: unknown;
};

export type InvalidationRow = {
  target: string;
  langs: string[];
  patch_scope: PatchScope | "unknown";
  provider_model: ProviderModel | "unknown";
  lockfile_label: string | null;
  importer: string | null;
  lockfile: string | null;
  importer_local_patches_action_inputs_expected: boolean;
  importer_local_patches_action_inputs_observed_in: string[];
  global_nix_inputs_action_inputs_expected: boolean;
  global_nix_inputs_action_inputs_observed_in: string[];
  module_providers: string[];
};

export type InvalidationReportOptions = {
  graphPath: string;
  autoMapPath: string;
  outPath: string;
  jsonOutPath: string;
  jsonOnly: boolean;
};

function sortedUnique(xs: string[]): string[] {
  return Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function langsFromLabels(labels: string[]): string[] {
  const out: string[] = [];
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (!l.startsWith("lang:")) continue;
    const id = l.slice("lang:".length).trim();
    if (!id) continue;
    out.push(id);
  }
  return sortedUnique(out);
}

function patchScopeFromLabels(labels: string[]): PatchScope | null {
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (!l.startsWith("patch_scope:")) continue;
    const s = l.slice("patch_scope:".length).trim();
    if (s === "package-local" || s === "importer-local") return s;
  }
  return null;
}

function providerModelForLang(lang: string): ProviderModel | null {
  const s = patchInvalidationStrategyForLang(lang);
  return s ? s.providerModel : null;
}

function hasLabel(labels: string[], want: string): boolean {
  return labels.some((l) => typeof l === "string" && l === want);
}

function prefixKeys(obj: unknown, prefix: string): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj as Record<string, unknown>).filter((k) => k.startsWith(prefix));
}

function listValues(obj: unknown): string[] {
  if (Array.isArray(obj)) return obj.filter((x) => typeof x === "string") as string[];
  if (obj && typeof obj === "object") {
    return Object.values(obj as Record<string, unknown>).filter(
      (x) => typeof x === "string",
    ) as string[];
  }
  return [];
}

async function readAutoMap(p: string): Promise<AutoMap> {
  let txt = "";
  try {
    txt = await fsp.readFile(p, "utf8");
  } catch {
    return {};
  }
  const out: AutoMap = {};
  const entryRe = /"([^"]+)"\s*:\s*\[\s*([\s\S]*?)\s*\],/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(txt)) !== null) {
    const target = m[1] || "";
    const body = m[2] || "";
    const provs = Array.from(body.matchAll(/"([^"]+)"/g))
      .map((x) => x[1])
      .filter(Boolean);
    if (!target) continue;
    out[target] = sortedUnique(provs);
  }
  return out;
}

function computeRow(
  n: Node,
  autoMap: AutoMap,
  nodeLockIndex: Record<string, string>,
): InvalidationRow | null {
  const rawName = String(n.name || "");
  if (!rawName) return null;
  const target = normalizeTargetLabel(rawName);
  if (isProviderPackageNode(target)) return null;

  const labels = Array.isArray(n.labels) ? (n.labels as string[]) : [];
  const langs = langsFromLabels(labels);
  const patchScope =
    patchScopeFromLabels(labels) ||
    (langs[0] ? patchInvalidationStrategyForLang(langs[0])?.patchScope || null : null);

  const providerModel =
    langs.length === 1
      ? providerModelForLang(langs[0])
      : langs[0]
        ? providerModelForLang(langs[0])
        : null;

  const lockfileLabelRaw = nodeLockIndex[target] || null;
  const lockParsed = lockfileLabelRaw ? parseLockfileLabel(lockfileLabelRaw) : null;

  const importerLocalPatchesExpected = patchScope === "importer-local";
  const importerLocalPatchesObserved: string[] = [];

  const globalNixExpected =
    hasLabel(labels, "//:flake.lock") ||
    listValues(n.srcs).some((v) => v === "//:flake.lock") ||
    prefixKeys(n.srcs, "__global_nix_inputs__/").length > 0;
  const globalNixObserved: string[] = [];

  if (Array.isArray(n.srcs)) {
    const srcsList = n.srcs as unknown[];
    if (srcsList.some((x) => x === "//:flake.lock")) globalNixObserved.push("srcs(list)");
  } else if (n.srcs && typeof n.srcs === "object") {
    const keys = Object.keys(n.srcs as Record<string, unknown>);
    if (keys.some((k) => k.startsWith("__global_nix_inputs__/")))
      globalNixObserved.push("srcs(dict)/__global_nix_inputs__");
    if (keys.some((k) => k.startsWith("__patch_inputs__/")))
      importerLocalPatchesObserved.push("srcs(dict)/__patch_inputs__");
  }

  if (Array.isArray(n.deps)) {
    const deps = n.deps.filter((d) => typeof d === "string") as string[];
    if (deps.some((d) => String(d).endsWith("__patch_inputs")))
      importerLocalPatchesObserved.push("deps/*__patch_inputs");
  }

  const moduleProviders = sortedUnique(autoMap[target] || []);

  return {
    target,
    langs,
    patch_scope: patchScope || "unknown",
    provider_model: providerModel || "unknown",
    lockfile_label: lockfileLabelRaw,
    importer: lockParsed?.importer || null,
    lockfile: lockParsed?.lockfile || null,
    importer_local_patches_action_inputs_expected: importerLocalPatchesExpected,
    importer_local_patches_action_inputs_observed_in: sortedUnique(importerLocalPatchesObserved),
    global_nix_inputs_action_inputs_expected: globalNixExpected,
    global_nix_inputs_action_inputs_observed_in: sortedUnique(globalNixObserved),
    module_providers: moduleProviders,
  };
}

export async function generateInvalidationReport(opts: InvalidationReportOptions): Promise<void> {
  const autoMap = await readAutoMap(opts.autoMapPath);
  const comp = await readCompositeGraph({ graphPath: opts.graphPath || undefined });
  const nodes = (comp.nodes || []) as Node[];
  const providerIndex = (comp.providerIndex || {}) as unknown as Record<
    string,
    ProviderIndexEntryExt
  >;
  const nodeLockIndex = (comp.nodeLockIndex || {}) as Record<string, string>;

  const rows = nodes
    .map((n) => computeRow(n, autoMap, nodeLockIndex))
    .filter((r): r is InvalidationRow => r !== null)
    .sort((a, b) => a.target.localeCompare(b.target));

  const json = {
    $schema: "https://example.com/schemas/invalidation-report.schema.json",
    version: 1,
    generatedAt: new Date().toISOString(),
    rows,
  };

  if (opts.jsonOnly) {
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  const header = [
    "# invalidation-report",
    "# GENERATED FILE — DO NOT EDIT.",
    "#",
    "# This report answers: “what invalidates this target?” using the shared contract vocabulary.",
    "# Provider edges are shown as a debugging aid; invalidation is driven by real action inputs.",
    "",
  ].join("\n");

  const body =
    rows.map((r) => formatTextRow(r, providerIndex)).join("\n") + (rows.length ? "\n" : "");
  await fsp.mkdir(path.dirname(opts.outPath), { recursive: true }).catch(() => {});
  await writeIfChanged(opts.outPath, header + body);

  if (opts.jsonOutPath) {
    await fsp.mkdir(path.dirname(opts.jsonOutPath), { recursive: true }).catch(() => {});
    await writeIfChanged(opts.jsonOutPath, JSON.stringify(json, null, 2) + "\n");
  }
}
