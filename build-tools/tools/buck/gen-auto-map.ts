#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { writeIfChanged, maybeAssumeUnchanged } from "../lib/fs-helpers.ts";
// zx is available via shebang; we'll use `$` to interact with git when present.
import { readCompositeGraph } from "../lib/graph-view.ts";
// Provider mapping is Node-only (lockfile:...) and nixpkg; Go `module:`
// labels are kept for diagnostics and are intentionally ignored here.
import { providersForLabels, parseLockfileLabel } from "../lib/labels.ts";
import { getFlagStr } from "../lib/cli.ts";
import { ensureGraph } from "./glue-run.ts";
import { isProviderPackageNode } from "../lib/graph-utils.ts";
import { isSupportedImporterLabel } from "../lib/importers.ts";
// no path import needed when not checking provider existence

type Node = {
  name: string;
  rule_type?: string;
  labels?: string[];
};

const graphPath = getFlagStr("graph", "");
const outPath = getFlagStr("out", "third_party/providers/auto_map.bzl");

// writeIfChanged now imported from ../lib/fs-helpers

// parsing moved to build-tools/tools/lib/labels.ts

async function main() {
  // Ensure graph exists if caller didn't generate it yet
  try {
    if (graphPath && graphPath.length > 0) {
      await fsp.access(graphPath).catch(async () => {
        await ensureGraph();
      });
    } else {
      await ensureGraph();
    }
  } catch {}
  await maybeAssumeUnchanged(outPath);

  const { nodes } = await readCompositeGraph({
    graphPath: graphPath || undefined,
  });
  const list = nodes as unknown as Node[];

  const mapping: Record<string, string[]> = {};
  const unsupportedLockfileLabels: Array<{ target: string; label: string; importer: string }> = [];
  for (const n of list) {
    // Skip provider-package nodes to avoid self-mappings in auto_map.
    if (n.name && isProviderPackageNode(n.name)) {
      continue;
    }
    const labels = Array.isArray(n.labels) ? (n.labels as string[]) : [];

    // Mapping is centralized in providersForLabels(...). It is responsible for enforcing
    // the supported-importer policy for lockfile labels.
    const provs = providersForLabels(labels);
    if (provs.length > 0 && n.name) mapping[n.name] = provs;

    // Keep a targeted diagnostic so unsupported importer labels are visible and can be enforced in CI.
    for (const l of labels) {
      if (typeof l !== "string" || !l.startsWith("lockfile:")) continue;
      const parsed = parseLockfileLabel(l);
      if (!parsed) continue;
      if (isSupportedImporterLabel(parsed.importer)) continue;
      unsupportedLockfileLabels.push({
        target: String(n.name || ""),
        label: l,
        importer: parsed.importer,
      });
    }
  }
  const keys = Object.keys(mapping).sort();
  const body = keys
    .map((k) => `    "${k}": [\n${mapping[k].map((p) => `        "${p}",`).join("\n")}\n    ],`)
    .join("\n\n");
  const header = `# //third_party/providers/auto_map.bzl\n# GENERATED FILE — DO NOT EDIT.\n\nMODULE_PROVIDERS = {\n`;
  const footer = `\n}\n`;
  const data = header + body + footer;
  await writeIfChanged(outPath, data);

  if (unsupportedLockfileLabels.length > 0) {
    const lines = unsupportedLockfileLabels
      .slice()
      .sort((a, b) => (a.target + a.label).localeCompare(b.target + b.label))
      .map(
        (e) =>
          `- ${e.target}: ${e.label} (importer='${e.importer}' not in {'.', 'apps/*', 'libs/*'})`,
      );
    const msg = [
      "lockfile labels with unsupported importers were ignored (no providers will be generated for them):",
      ...lines,
      "",
      "If this importer should be supported, expand the supported-importer policy in build-tools/tools/lib/importers.ts.",
    ].join("\n");
    if ((process.env.CI || "").toLowerCase() === "true") {
      throw new Error(msg);
    }
    console.warn("WARN:", msg);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
