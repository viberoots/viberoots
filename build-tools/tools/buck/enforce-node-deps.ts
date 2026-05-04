#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool } from "../lib/cli";
import { writeIfChanged } from "../lib/fs-helpers";
import { normalizeTargetLabel } from "../lib/labels";
import {
  applyEdits,
  collectDeps,
  expectedWorkspaceDeps,
  formatDeps,
  listImporters,
  loadWorkspaceMap,
  parseTargets,
} from "../lib/node-deps-enforcement-core";
import { uniqSorted } from "../lib/posix-path";
import { repoRoot } from "../lib/repo";

async function readJsonFile<T>(filePath: string): Promise<T> {
  const txt = await fsp.readFile(filePath, "utf8");
  return JSON.parse(txt) as T;
}

async function main(): Promise<void> {
  const fix = getFlagBool("fix");
  const check = getFlagBool("check") || !fix;
  const root = repoRoot();
  const workspaceMap = await loadWorkspaceMap(root);
  const mapLabels = new Set(Object.values(workspaceMap).map((v) => normalizeTargetLabel(v)));

  const importers = await listImporters(root);
  const drift: Array<{
    target: string;
    importer: string;
    missing: string[];
    extra: string[];
  }> = [];
  const missingMaps: Array<{ importer: string; name: string }> = [];
  const fixTargets: Array<{ importer: string; target: string }> = [];

  for (const importer of importers) {
    const pkgPath = path.join(root, importer, "package.json");
    let pkg: any = {};
    try {
      pkg = await readJsonFile(pkgPath);
    } catch (e) {
      throw new Error(`failed to read ${pkgPath}: ${String(e)}`);
    }
    const deps = collectDeps(pkg);
    const { expected, missingMap } = expectedWorkspaceDeps(deps, workspaceMap);
    for (const name of missingMap) missingMaps.push({ importer, name });

    const targetsPath = path.join(root, importer, "TARGETS");
    let targetsText = "";
    try {
      targetsText = await fsp.readFile(targetsPath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseTargets(targetsText);
    for (const block of parsed.blocks) {
      if (!block.name) continue;
      const target = `//${importer}:${block.name}`;
      const actualWorkspace = uniqSorted(
        block.depsItems.map((d) => normalizeTargetLabel(d)).filter((d) => mapLabels.has(d)),
      );
      const missing = expected.filter((d) => !actualWorkspace.includes(d));
      const extra = actualWorkspace.filter((d) => !expected.includes(d));
      if (missing.length || extra.length) {
        drift.push({
          target,
          importer,
          missing,
          extra,
        });
        fixTargets.push({ importer, target });
      }
    }

    if (fix && fixTargets.some((t) => t.importer === importer)) {
      const parsedFix = parseTargets(targetsText);
      const edits: Array<{ start: number; end: number; newLines: string[] }> = [];
      for (const block of parsedFix.blocks) {
        if (!block.name) continue;
        const target = `//${importer}:${block.name}`;
        if (!fixTargets.some((t) => t.importer === importer && t.target === target)) continue;
        const nonWorkspace = block.depsItems.filter((d) => !mapLabels.has(normalizeTargetLabel(d)));
        const merged = uniqSorted([...nonWorkspace, ...expected]);
        const indent = block.depsIndent || block.nameIndent || block.blockIndent + "  ";
        const newLines = formatDeps(indent, merged);
        if (block.depsStart !== null && block.depsEnd !== null) {
          edits.push({ start: block.depsStart, end: block.depsEnd, newLines });
        } else if (newLines.length > 0 && block.nameLine >= 0) {
          edits.push({ start: block.nameLine + 1, end: block.nameLine, newLines });
        }
      }
      if (edits.length > 0) {
        const updatedLines = applyEdits(parsedFix.lines, edits);
        const endsWithNewline = targetsText.endsWith("\n");
        const nextText = updatedLines.join("\n") + (endsWithNewline ? "\n" : "");
        await writeIfChanged(targetsPath, nextText);
      }
    }
  }

  if (missingMaps.length > 0) {
    for (const miss of missingMaps) {
      console.error(
        `ERROR: ${miss.importer}/package.json uses workspace:${miss.name} without mapping in build-tools/tools/node/workspace-map.json`,
      );
    }
    process.exit(1);
  }

  if (fix) return;

  if (drift.length === 0) {
    if (check) console.log("node deps enforcement: OK");
    return;
  }

  for (const d of drift) {
    console.error(`ERROR: node deps drift in ${d.target}`);
    if (d.missing.length > 0) console.error(`  missing: ${d.missing.join(", ")}`);
    if (d.extra.length > 0) console.error(`  extra: ${d.extra.join(", ")}`);
  }
  console.error("Fix: node build-tools/tools/buck/enforce-node-deps.ts --fix");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
