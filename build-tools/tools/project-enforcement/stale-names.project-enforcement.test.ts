#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readMigrationLabelSkipPaths } from "../dev/stale-names-lint-allowlists";
import { scanStaleNameEntry, type StaleNameHit } from "../dev/stale-names-scanner";
import { resolveProjectScanContext } from "../lib/repo";

const execFileAsync = promisify(execFile);

async function listProjectFiles(workspaceRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "projects"],
    { cwd: workspaceRoot, encoding: "utf8" },
  );
  return String(stdout || "")
    .split("\0")
    .filter(Boolean)
    .sort();
}

async function scan(workspaceRoot: string, rel: string, skips: ReadonlySet<string>) {
  let text = "";
  try {
    text = await fsp.readFile(path.join(workspaceRoot, rel), "utf8");
  } catch {}
  return scanStaleNameEntry({ rel, text, migrationLabelSkipPaths: skips });
}

async function main(): Promise<void> {
  const context = resolveProjectScanContext();
  const files = await listProjectFiles(context.workspaceRoot);
  const skips = await readMigrationLabelSkipPaths(context.workspaceRoot);
  const hits: StaleNameHit[] = (
    await Promise.all(files.map((rel) => scan(context.workspaceRoot, rel, skips)))
  ).flat();
  if (hits.length === 0) return;
  const details = hits
    .slice(0, 80)
    .map((hit) => `  ${hit.rel}:${hit.line} ${hit.label}`)
    .join("\n");
  throw new Error(
    `project stale-name enforcement found ${hits.length} violation(s):\n${details}` +
      (hits.length > 80 ? `\n  ... and ${hits.length - 80} more` : ""),
  );
}

await main();
