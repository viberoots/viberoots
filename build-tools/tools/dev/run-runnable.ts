#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getArgvTokens } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { inferRunnableFromOutPath, type RunnableManifestEntry } from "../lib/runnables.ts";
import { validateSsrRunnableContract } from "../lib/runnable-contracts.ts";
import {
  parseArgs,
  importerForTarget,
  runnableHintsForTarget,
  readManifestEntry,
  runCommand,
} from "./run-runnable-core.ts";
import { buildRunnableManifest, buildSelectedOutPath } from "./run-runnable-graph.ts";

async function main() {
  const parsed = parseArgs(getArgvTokens());
  if (!parsed.target || parsed.target.startsWith("-")) {
    console.error("usage: p <target> [args...]");
    console.error("   or: d <target> [args...]");
    process.exit(2);
  }
  const workspaceRoot = await findRepoRoot(process.cwd());
  const target = parsed.target;
  let targetHints: { importer: string; mode: "static" | "ssr"; framework: string } | null = null;
  let entry: RunnableManifestEntry | null = null;
  const testManifestPath = String(process.env.RUNNABLE_TEST_MANIFEST || "").trim();
  if (testManifestPath) {
    entry = await readManifestEntry(testManifestPath, target);
  } else {
    // Fast path: use selected-target build + output-shape inference first.
    // This avoids full graph manifest materialization for one-target run commands.
    const hints = await runnableHintsForTarget(workspaceRoot, target);
    targetHints = hints;
    const importer = hints.importer;
    let selectedError: unknown = null;
    try {
      const outPath = await buildSelectedOutPath(workspaceRoot, target);
      const inferred = await inferRunnableFromOutPath({
        label: target,
        outPath,
        mode: hints.mode,
        framework: hints.framework || undefined,
        ...(importer ? { importer } : {}),
      });
      if (inferred) {
        entry = {
          label: target,
          kind: inferred.kind,
          bins: [],
          runnable: inferred,
        };
      }
    } catch (e) {
      selectedError = e;
    }
    if (!entry) {
      if (targetHints?.mode === "ssr" && selectedError) throw selectedError;
      const currentManifestPath = path.join(
        workspaceRoot,
        "buck-out",
        "tmp",
        "runnable-manifest-current",
        "manifest.json",
      );
      entry = await readManifestEntry(currentManifestPath, target);
    }
    if (!entry) {
      if (selectedError) throw selectedError;
      const refreshedManifestPath = await buildRunnableManifest(workspaceRoot);
      entry = await readManifestEntry(refreshedManifestPath, target);
    }
  }
  if (!entry?.runnable) {
    console.error(`target is not runnable (or is library-only): ${target}`);
    process.exit(2);
  }
  if (entry.runnable.kind === "webapp-ssr") {
    const errs = validateSsrRunnableContract(target, entry.runnable);
    if (errs.length > 0) {
      for (const err of errs) console.error(err);
      process.exit(2);
    }
  }
  let spec = parsed.mode === "dev" ? entry.runnable.run.dev : entry.runnable.run.prod;
  if (parsed.mode === "dev" && !spec) {
    if (entry.runnable.kind === "webapp-ssr") {
      console.error(
        `SSR contract error for ${target}: missing run.dev argv (expected pnpm --dir <importer> dev:ssr)`,
      );
      process.exit(2);
    }
    const hints = targetHints || (await runnableHintsForTarget(workspaceRoot, target));
    const importer = hints.importer || (await importerForTarget(workspaceRoot, target));
    if (importer) {
      const devScript =
        entry.runnable.kind === "webapp-ssr" || hints.mode === "ssr" ? "dev:ssr" : "dev";
      spec = { argv: ["pnpm", "--dir", importer, devScript] };
    }
  }
  if (!spec) {
    console.error(`run.${parsed.mode} is not available for ${target}`);
    process.exit(2);
  }
  const exitCode = await runCommand(spec.argv, parsed.passthrough, spec.cwd);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
