#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFlagBool, getPositionals } from "../lib/cli";
import { readMigrationLabelSkipPaths } from "./stale-names-lint-allowlists";
import {
  normalizeStaleNamePath,
  scanStaleNameEntry,
  type StaleNameHit,
} from "./stale-names-scanner";

const execFileAsync = promisify(execFile);

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return String(stdout || "")
    .split("\0")
    .filter(Boolean)
    .map(normalizeStaleNamePath)
    .sort();
}

async function scanFile(
  repoRoot: string,
  rel: string,
  migrationLabelSkipPaths: ReadonlySet<string>,
): Promise<StaleNameHit[]> {
  let text = "";
  try {
    text = await fsp.readFile(path.join(repoRoot, rel), "utf8");
  } catch {}
  return scanStaleNameEntry({ rel, text, migrationLabelSkipPaths });
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const positional = getPositionals();
  const relPaths =
    positional.length > 0
      ? positional.map((file) =>
          normalizeStaleNamePath(path.relative(repoRoot, path.resolve(file))),
        )
      : await listTrackedFiles(repoRoot);
  const migrationLabelSkipPaths = await readMigrationLabelSkipPaths(repoRoot);
  const hits = (
    await Promise.all(relPaths.map((rel) => scanFile(repoRoot, rel, migrationLabelSkipPaths)))
  ).flat();

  if (hits.length === 0) {
    process.stderr.write("[stale-names-lint] no stale names found\n");
    return;
  }
  const lines = [
    `[stale-names-lint] found ${hits.length} stale naming hit(s):`,
    ...hits.slice(0, 80).map((hit) => `  ${hit.rel}:${hit.line} ${hit.label}`),
    ...(hits.length > 80 ? [`  ... and ${hits.length - 80} more`] : []),
  ];
  process.stderr.write(lines.join("\n") + "\n");
  if (!getFlagBool("no-fail")) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`[stale-names-lint] unexpected error: ${error?.message ?? error}\n`);
  process.exit(2);
});
