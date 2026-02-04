#!/usr/bin/env zx-wrapper
import type { Adapter, Batch, Node } from "../types.ts";
import { packageDirFromTargetName } from "../batch.ts";
import type { LanguageClassificationOptions } from "./helpers.ts";
import { validateLanguageClassification } from "./helpers.ts";
import type { ImporterScopedAdapterRegistryEntry } from "./importer-scoped-registry.ts";
import {
  attachImporterLockfileLabelsIfMacroStamped,
  hasKindLabel,
  lockfileLabels,
  validateAutoAttachImporterSupport,
  validateImporterLockfileLabels,
} from "./importer-lockfile-labels.ts";

export type ImporterScopedAdapterSharedOptions = {
  adapterName: string;
  lockfileBasename: string;
  isTarget(node: Node): boolean;
  findNearestLockfile(pkgDir: string): Promise<string | null>;
};

export type ImporterScopedAdapterValidationOptions = ImporterScopedAdapterSharedOptions & {
  shouldWarnMissingKindLabel(node: Node): boolean;
};

function missingKindFinding(adapterName: string, node: Node): string {
  return [
    `[exporter][${adapterName}] missing kind:* label on ${node.name}.`,
    "Fix: use macros that stamp a kind label (e.g., 'kind:lib', 'kind:bin', 'kind:test', 'kind:bundle').",
  ].join("\n");
}

function missingLockfileFinding(
  adapterName: string,
  node: Node,
  pkgDir: string,
  lockfileBasename: string,
): string {
  return [
    `[exporter][${adapterName}] missing importer-scoped lockfile label on ${node.name}.`,
    `Fix: ensure a ${lockfileBasename} exists in '${pkgDir}' (or an ancestor) so the exporter can attach lockfile:<path>#<importer>, or stamp the label explicitly via macros.`,
  ].join("\n");
}

export async function validateImporterScopedAdapter(
  nodes: Node[],
  opts: ImporterScopedAdapterValidationOptions,
): Promise<string[]> {
  const out: string[] = [];
  const lockByPkg = new Map<string, Promise<string | null>>();
  const nearestLock = (pkgDir: string) => {
    const key = pkgDir || ".";
    const cur = lockByPkg.get(key);
    if (cur) return cur;
    const next = opts.findNearestLockfile(key);
    lockByPkg.set(key, next);
    return next;
  };

  for (const n of nodes) {
    if (!opts.isTarget(n)) continue;

    if (!hasKindLabel(n) && opts.shouldWarnMissingKindLabel(n)) {
      out.push(missingKindFinding(opts.adapterName, n));
    }

    out.push(...validateImporterLockfileLabels({ adapterName: opts.adapterName, node: n }));

    if (hasKindLabel(n) && lockfileLabels(n).length === 0) {
      const pkgDir = packageDirFromTargetName(n.name || "") || ".";
      const lockRel = await nearestLock(pkgDir);
      if (!lockRel) {
        out.push(missingLockfileFinding(opts.adapterName, n, pkgDir, opts.lockfileBasename));
      } else {
        out.push(
          ...validateAutoAttachImporterSupport({
            adapterName: opts.adapterName,
            node: n,
            lockfilePath: lockRel,
          }),
        );
      }
    }
  }

  return out;
}

export async function attachImporterScopedLockfileLabels(
  opts: ImporterScopedAdapterSharedOptions & { nodes: Node[] },
): Promise<Node[]> {
  return attachImporterLockfileLabelsIfMacroStamped({
    nodes: opts.nodes,
    isTarget: opts.isTarget,
    findNearestLockfile: opts.findNearestLockfile,
  });
}

export type ImporterScopedAdapterFactoryOptions = {
  name: string;
  isTarget(node: Node): boolean;
  importerScopedConfig: ImporterScopedAdapterRegistryEntry;
  classification: LanguageClassificationOptions;
};

export function buildImporterScopedAdapter(opts: ImporterScopedAdapterFactoryOptions): Adapter {
  return {
    name: opts.name,
    isNode(n) {
      return opts.isTarget(n);
    },
    async validate(nodes: Node[]) {
      const out: string[] = [];
      out.push(
        ...(await validateImporterScopedAdapter(nodes, {
          adapterName: opts.name,
          lockfileBasename: opts.importerScopedConfig.lockfileBasename,
          isTarget: opts.isTarget,
          findNearestLockfile: opts.importerScopedConfig.findNearestLockfile,
          shouldWarnMissingKindLabel: opts.importerScopedConfig.shouldWarnMissingKindLabel,
        })),
      );
      out.push(...validateLanguageClassification(nodes, opts.classification));
      return out;
    },
    async buildBatches(_nodes: Node[]): Promise<Batch[]> {
      return [];
    },
    async attachLabels(nodes: Node[]): Promise<Node[]> {
      return attachImporterScopedLockfileLabels({
        nodes,
        adapterName: opts.name,
        lockfileBasename: opts.importerScopedConfig.lockfileBasename,
        isTarget: opts.isTarget,
        findNearestLockfile: opts.importerScopedConfig.findNearestLockfile,
      });
    },
  };
}
