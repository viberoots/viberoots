#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { readCompositeGraph } from "../lib/graph-view.ts";
import {
  buildImporterRequirementReport,
  importerPatchDir,
  patchFilenameForId,
  remediationCommand,
} from "../lib/node-patch-requirements.ts";
import {
  computeImporterLabel,
  findImporterLockfiles,
  isSupportedImporterLabel,
} from "../lib/importers.ts";

function deterministicImporters(lockfiles: string[]): string[] {
  const out = new Set<string>();
  for (const lockfile of lockfiles) {
    const importer = computeImporterLabel(lockfile);
    if (!isSupportedImporterLabel(importer)) continue;
    out.add(importer);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

async function writePlaceholder(importer: string, patchId: string): Promise<boolean> {
  const filename = patchFilenameForId(patchId);
  if (!filename) return false;
  const dir = importerPatchDir(importer);
  const abs = path.resolve(dir, filename);
  try {
    await fsp.access(abs);
    return false;
  } catch {}
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const body = [
    `# placeholder for required Node patch: ${patchId}`,
    "# replace with an actual unified diff",
    "",
  ].join("\n");
  await fsp.writeFile(abs, body, "utf8");
  return true;
}

async function main(): Promise<void> {
  const importerArg = getFlagStr("importer", "").trim();
  const writePlaceholders = getFlagBool("write-placeholders");
  const check = getFlagBool("check") || !writePlaceholders;
  const lockfiles = await findImporterLockfiles(["pnpm-lock.yaml"]);
  const importers = importerArg ? [importerArg] : deterministicImporters(lockfiles);
  const graphPath = (process.env.BUCK_GRAPH_JSON || "").trim();
  const graph = await readCompositeGraph(graphPath ? { graphPath } : {});

  if (importers.length === 0) {
    console.error("node patch requirements: no Node importers discovered");
    return;
  }

  let hardFailures = 0;
  for (const importer of importers) {
    const report = await buildImporterRequirementReport(graph.nodes, importer);
    const missingAll = [...report.missingRequired, ...report.missingOptional].sort((a, b) =>
      a.localeCompare(b),
    );
    const hasGaps = report.missingRequired.length > 0 || report.missingOptional.length > 0;
    console.error(`node patch requirements checklist for ${importer}`);
    console.error(
      `  [x] resolved transitive requirements (required=${report.requirementsRequired.length}, optional=${report.requirementsOptional.length})`,
    );
    console.error(`  [x] collected importer patches (count=${report.importerPatchIds.length})`);
    if (!hasGaps) {
      console.error("  [x] no missing required patches");
      console.error("  [x] no missing optional patches");
      if (check) console.error(`node patch requirements: OK for ${importer}`);
      continue;
    }
    if (report.missingRequired.length > 0) {
      console.error(`  [ ] missing required patches (${report.missingRequired.length})`);
    } else {
      console.error("  [x] no missing required patches");
    }
    if (report.missingOptional.length > 0) {
      console.error(`  [ ] missing optional patches (${report.missingOptional.length})`);
    } else {
      console.error("  [x] no missing optional patches");
    }

    if (report.missingRequired.length > 0) {
      hardFailures += 1;
      console.error(`ERROR: missing required transitive Node patches for importer ${importer}`);
      console.error(`  missing required: ${report.missingRequired.join(", ")}`);
    }
    if (report.missingOptional.length > 0) {
      console.warn(`WARN: missing optional transitive Node patches for importer ${importer}`);
      console.warn(`  missing optional: ${report.missingOptional.join(", ")}`);
    }

    const remedy = remediationCommand(importer);
    console.error(`Fix: ${remedy}`);

    if (writePlaceholders && missingAll.length > 0) {
      const created: string[] = [];
      for (const patchId of missingAll) {
        if (await writePlaceholder(importer, patchId)) created.push(patchId);
      }
      if (created.length > 0) {
        console.error(`wrote placeholder patch files for ${importer}: ${created.join(", ")}`);
      }
    }
  }

  if (hardFailures > 0 && !writePlaceholders) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
