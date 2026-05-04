import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers";
import { readCompositeGraph, type ProviderIndexEntry } from "../lib/graph-view";
import type { PatchScope, ProviderModel } from "../lib/lang-contracts";
import { formatTextRow } from "./invalidation-report-format";
import {
  computeInvalidationRow,
  readAutoMap,
  type InvalidationReportNode,
} from "./invalidation-report-row";

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
  package_local_patches_action_inputs_expected: boolean;
  package_local_patches_action_inputs_observed_in: string[];
  global_nix_inputs_action_inputs_expected: boolean;
  global_nix_inputs_action_inputs_observed_in: string[];
  global_nix_inputs_labels_stamped: boolean;
  module_providers: string[];
};

export type InvalidationReportOptions = {
  graphPath: string;
  autoMapPath: string;
  outPath: string;
  jsonOutPath: string;
  jsonOnly: boolean;
};

export async function generateInvalidationReport(opts: InvalidationReportOptions): Promise<void> {
  const autoMap = await readAutoMap(opts.autoMapPath);
  const comp = await readCompositeGraph({ graphPath: opts.graphPath || undefined });
  const nodes = (comp.nodes || []) as InvalidationReportNode[];
  const providerIndex = (comp.providerIndex || {}) as unknown as Record<
    string,
    ProviderIndexEntryExt
  >;
  const nodeLockIndex = (comp.nodeLockIndex || {}) as Record<string, string>;

  const rows = nodes
    .map((n) => computeInvalidationRow(n, autoMap, nodeLockIndex))
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
