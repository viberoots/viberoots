import * as fsp from "node:fs/promises";
import { isProviderPackageNode } from "../lib/graph-utils";
import {
  dropConfigSuffix,
  packagePathFromLabel,
  parseLockfileLabel,
  normalizeTargetLabel,
} from "../lib/labels";
import {
  patchInvalidationStrategyForLang,
  type PatchScope,
  type ProviderModel,
} from "../lib/lang-contracts";
import type { InvalidationRow } from "./invalidation-report-lib";

type AutoMap = Record<string, string[]>;

const GLOBAL_NIX_INPUT_LABELS = [
  "root//.viberoots/workspace:flake.nix",
  "root//.viberoots/workspace:flake.lock",
  "root//projects/config:node-modules.hashes.json",
  "workspace_buck//:graph.json",
  "viberoots//build-tools/tools/nix:nixpkgs_source_registry",
  "root//.viberoots/workspace:nixpkgs-source-registry-extension",
];

export type InvalidationReportNode = {
  name?: string;
  rule_type?: string;
  labels?: string[];
  srcs?: unknown;
  deps?: unknown;
  nix_inputs?: unknown;
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
  return labels.some((label) => typeof label === "string" && canonicalInputLabel(label) === want);
}

function hasGlobalNixInputs(values: string[]): boolean {
  const canonical = new Set(values.map(canonicalInputLabel));
  return GLOBAL_NIX_INPUT_LABELS.every((label) => canonical.has(label));
}

function canonicalInputLabel(label: string): string {
  return dropConfigSuffix(String(label || "").trim()).replace(/^@/, "");
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

function looksLikePatchPath(p: string, lang: string): boolean {
  const s = String(p || "");
  if (!s) return false;
  if (!s.endsWith(".patch")) return false;
  return s.includes(`/patches/${lang}/`);
}

export async function readAutoMap(p: string): Promise<AutoMap> {
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

export function computeInvalidationRow(
  n: InvalidationReportNode,
  autoMap: AutoMap,
  nodeLockIndex: Record<string, string>,
): InvalidationRow | null {
  const rawName = String(n.name || "");
  if (!rawName) return null;
  const target = normalizeTargetLabel(rawName);
  if (isProviderPackageNode(target)) return null;

  const labels = Array.isArray(n.labels) ? (n.labels as string[]) : [];
  const langs = langsFromLabels(labels);
  const primaryLang = langs[0] || "";
  const patchScope =
    patchScopeFromLabels(labels) ||
    (primaryLang ? patchInvalidationStrategyForLang(primaryLang)?.patchScope || null : null);

  const providerModel =
    langs.length === 1
      ? providerModelForLang(primaryLang)
      : primaryLang
        ? providerModelForLang(primaryLang)
        : null;

  const lockfileLabelRaw = nodeLockIndex[target] || null;
  const lockParsed = lockfileLabelRaw ? parseLockfileLabel(lockfileLabelRaw) : null;

  const importerLocalPatchesExpected = patchScope === "importer-local";
  const importerLocalPatchesObserved: string[] = [];

  const packageLocalPatchesExpected = patchScope === "package-local";
  const packageLocalPatchesObserved: string[] = [];

  const globalNixLabelsStamped = GLOBAL_NIX_INPUT_LABELS.every((label) => hasLabel(labels, label));
  const globalNixObserved: string[] = [];
  const globalNixExpected =
    hasGlobalNixInputs(listValues(n.srcs)) || hasGlobalNixInputs(listValues(n.nix_inputs));

  if (Array.isArray(n.srcs)) {
    const srcsList = n.srcs as unknown[];
    if (hasGlobalNixInputs(srcsList.filter((x) => typeof x === "string") as string[])) {
      globalNixObserved.push("srcs(list)/global_nix_inputs");
    }
    if (importerLocalPatchesExpected && primaryLang) {
      const importerDir = lockParsed?.importer ? `${lockParsed.importer}/` : "";
      const hasImporterPatch = (srcsList as any[]).some(
        (x) =>
          typeof x === "string" &&
          looksLikePatchPath(x, primaryLang) &&
          (!importerDir ||
            String(x).includes(`/${importerDir}patches/${primaryLang}/`) ||
            String(x).startsWith(`${importerDir}patches/${primaryLang}/`)),
      );
      if (hasImporterPatch) {
        importerLocalPatchesObserved.push(
          lockParsed?.importer
            ? `srcs(list)/${lockParsed.importer}/patches/${primaryLang}`
            : `srcs(list)/<importer>/patches/${primaryLang}`,
        );
      }
    }
    if (packageLocalPatchesExpected && primaryLang) {
      const pkgPath = packagePathFromLabel(target);
      const hasPkgPatch = (srcsList as any[]).some(
        (x) =>
          typeof x === "string" &&
          String(x).endsWith(".patch") &&
          String(x).includes(`${pkgPath}/patches/${primaryLang}/`),
      );
      if (hasPkgPatch) {
        packageLocalPatchesObserved.push(`srcs(list)/${pkgPath}/patches/${primaryLang}`);
      }
    }
  } else if (n.srcs && typeof n.srcs === "object") {
    const keys = Object.keys(n.srcs as Record<string, unknown>);
    if (hasGlobalNixInputs(listValues(n.srcs))) {
      globalNixObserved.push("srcs(dict)/__global_nix_inputs__");
    }
    if (keys.some((k) => k.startsWith("__patch_inputs__/"))) {
      if (importerLocalPatchesExpected) {
        importerLocalPatchesObserved.push("srcs(dict)/__patch_inputs__");
      } else if (packageLocalPatchesExpected) {
        packageLocalPatchesObserved.push("srcs(dict)/__patch_inputs__");
      } else {
        importerLocalPatchesObserved.push("srcs(dict)/__patch_inputs__");
      }
    }
  }

  if (Array.isArray(n.nix_inputs)) {
    const nixInputs = n.nix_inputs as unknown[];
    if (hasGlobalNixInputs(nixInputs.filter((x) => typeof x === "string") as string[])) {
      globalNixObserved.push("nix_inputs(list)/global_nix_inputs");
    }
  } else if (n.nix_inputs && typeof n.nix_inputs === "object") {
    const keys = Object.keys(n.nix_inputs as Record<string, unknown>);
    if (hasGlobalNixInputs(listValues(n.nix_inputs))) {
      globalNixObserved.push("nix_inputs(dict)/__global_nix_inputs__");
    }
  }

  if (Array.isArray(n.deps)) {
    const deps = n.deps.filter((d) => typeof d === "string") as string[];
    if (deps.some((d) => String(d).endsWith("__patch_inputs"))) {
      importerLocalPatchesObserved.push("deps/*__patch_inputs");
    }
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
    package_local_patches_action_inputs_expected: packageLocalPatchesExpected,
    package_local_patches_action_inputs_observed_in: sortedUnique(packageLocalPatchesObserved),
    global_nix_inputs_action_inputs_expected: globalNixExpected,
    global_nix_inputs_action_inputs_observed_in: sortedUnique(globalNixObserved),
    global_nix_inputs_labels_stamped: globalNixLabelsStamped,
    module_providers: moduleProviders,
  };
}
