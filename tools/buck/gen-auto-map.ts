#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { writeIfChanged, maybeAssumeUnchanged } from "../lib/fs-helpers.ts";
// zx is available via shebang; we'll use `$` to interact with git when present.
import { readCompositeGraph } from "../lib/graph-view.ts";
// PR6 (go-cpp-local-patching): provider mapping is Node-only (lockfile:...) and nixpkg; Go `module:`
// labels are kept for diagnostics and are intentionally ignored here.
import { providersForLabels, parseLockfileLabel } from "../lib/labels.ts";
import * as fssync from "node:fs";
import { getFlagStr } from "../lib/cli.ts";
import { ensureGraph } from "./glue-run.ts";
import { isProviderPackageNode } from "../lib/graph-utils.ts";
// no path import needed when not checking provider existence

type Node = {
  name: string;
  rule_type?: string;
  labels?: string[];
};

const graphPath = getFlagStr("graph", "");
const outPath = getFlagStr("out", "third_party/providers/auto_map.bzl");

// writeIfChanged now imported from ../lib/fs-helpers

// parsing moved to tools/lib/labels.ts

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
  for (const n of list) {
    // PR-2: Skip provider-package nodes to avoid self-mappings in auto_map.
    if (n.name && isProviderPackageNode(n.name)) {
      continue;
    }
    const provs: string[] = [];
    const labels = Array.isArray(n.labels) ? (n.labels as string[]) : [];
    for (const l of labels) {
      if (typeof l !== "string") continue;
      if (l.startsWith("lockfile:")) {
        // Map importer-scoped lockfile labels directly to their providers.
        // Do not gate on filesystem presence; tests synthesize graphs without real files.
        const parsed = parseLockfileLabel(l);
        if (!parsed) continue;
        const [prov] = providersForLabels([l]);
        if (prov) provs.push(prov);
      } else if (l.startsWith("nixpkg:")) {
        const [prov] = providersForLabels([l]);
        if (prov) provs.push(prov);
      }
    }
    const uniq = Array.from(new Set(provs));
    if (uniq.length > 0 && n.name) {
      mapping[n.name] = uniq;
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
