#!/usr/bin/env zx-wrapper
import type { Node } from "../types.ts";
import {
  findNearestPnpmLockForPackage,
  findNearestUvLockForPackage,
} from "../../../lib/importers.ts";
import { parseLockfileLabel } from "../../../lib/labels.ts";
import { lockfileLabels } from "./importer-lockfile-labels.ts";

export type ImporterScopedAdapterLanguage = "node" | "python";

type FindNearestLockfile = (pkgDir: string) => Promise<string | null>;

export type ImporterScopedAdapterRegistryEntry = {
  lockfileBasename: "pnpm-lock.yaml" | "uv.lock";
  findNearestLockfile: FindNearestLockfile;
  shouldWarnMissingKindLabel(node: Node): boolean;
  hasLockfileLabelForThisEcosystem(node: Node): boolean;
};

function findNearestLockfileForBasename(
  basename: ImporterScopedAdapterRegistryEntry["lockfileBasename"],
) {
  const byBasename: Record<
    ImporterScopedAdapterRegistryEntry["lockfileBasename"],
    FindNearestLockfile
  > = {
    "pnpm-lock.yaml": findNearestPnpmLockForPackage,
    "uv.lock": findNearestUvLockForPackage,
  };
  return byBasename[basename];
}

function hasLockfileLabelForBasename(node: Node, basename: string): boolean {
  for (const l of lockfileLabels(node)) {
    const parsed = parseLockfileLabel(l);
    if (!parsed) continue;
    if (parsed.lockfile === basename || parsed.lockfile.endsWith(`/${basename}`)) return true;
  }
  return false;
}

function shouldWarnMissingKindWhenMacroStamped(node: Node): boolean {
  return lockfileLabels(node).length > 0;
}

export const IMPORTER_SCOPED_ADAPTER_REGISTRY = {
  node: {
    lockfileBasename: "pnpm-lock.yaml",
    findNearestLockfile: findNearestLockfileForBasename("pnpm-lock.yaml"),
    shouldWarnMissingKindLabel: shouldWarnMissingKindWhenMacroStamped,
    hasLockfileLabelForThisEcosystem(node: Node) {
      return hasLockfileLabelForBasename(node, "pnpm-lock.yaml");
    },
  },
  python: {
    lockfileBasename: "uv.lock",
    findNearestLockfile: findNearestLockfileForBasename("uv.lock"),
    shouldWarnMissingKindLabel: shouldWarnMissingKindWhenMacroStamped,
    hasLockfileLabelForThisEcosystem(node: Node) {
      return hasLockfileLabelForBasename(node, "uv.lock");
    },
  },
} satisfies Record<ImporterScopedAdapterLanguage, ImporterScopedAdapterRegistryEntry>;

export function importerScopedAdapterRegistryEntry(
  lang: ImporterScopedAdapterLanguage,
): ImporterScopedAdapterRegistryEntry {
  return IMPORTER_SCOPED_ADAPTER_REGISTRY[lang];
}
