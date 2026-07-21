#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getArgvTokens } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { inferRunnableFromOutPath, type RunnableManifestEntry } from "../lib/runnables";
import { validateSsrRunnableContract } from "../lib/runnable-contracts";
import {
  parseArgs,
  importerForTarget,
  resolveRunnableTargetLabel,
  runnableHintsForTarget,
  readManifestEntry,
  runCommand,
} from "./run-runnable-core";
import { buildRunnableManifest, buildSelectedOutPath } from "./run-runnable-graph";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";
import { canonicalArtifactToolsRoot } from "../lib/artifact-environment";
import { directImporterDevSpec, directStaticWebappDevSpec } from "./run-runnable-dev-spec";

function commandCwdForSpec(
  spec: { argv: string[]; cwd?: string },
  workspaceRoot: string,
): string | undefined {
  if (spec.cwd) return path.isAbsolute(spec.cwd) ? spec.cwd : path.join(workspaceRoot, spec.cwd);
  const argv = Array.isArray(spec.argv) ? spec.argv.map((x) => String(x || "")) : [];
  const cmd = String(argv[0] || "")
    .trim()
    .toLowerCase();
  if (cmd !== "pnpm") return undefined;
  for (let i = 1; i < argv.length - 1; i++) {
    if (argv[i] !== "--dir") continue;
    const importer = String(argv[i + 1] || "").trim();
    if (!importer) continue;
    if (importer.startsWith("/") || importer.startsWith("./") || importer.startsWith("../"))
      continue;
    return workspaceRoot;
  }
  return undefined;
}

export async function runRunnable(opts: {
  argv: string[];
  workspaceRoot: string;
  artifactToolsRoot: string;
  resolveEntry?: (target: string) => Promise<RunnableManifestEntry | null>;
}) {
  const parsed = parseArgs(opts.argv);
  if (parsed.sourceError) {
    console.error(`[run-runnable] ${parsed.sourceError}`);
    process.exit(2);
  }
  if (parsed.target.startsWith("-")) {
    console.error("usage: p <target> [--source=auto|git|path] [args...]");
    console.error("   or: d <target> [--source=auto|git|path] [args...]");
    process.exit(2);
  }
  const cwd = process.cwd();
  const { workspaceRoot, artifactToolsRoot } = opts;
  const target = await resolveRunnableTargetLabel(workspaceRoot, parsed.target || ".", {
    baseDir: cwd,
  });
  let targetHints: { importer: string; mode: "static" | "ssr"; framework: string } | null = null;
  let entry: RunnableManifestEntry | null = null;
  if (opts.resolveEntry) {
    entry = await opts.resolveEntry(target);
  } else {
    // Fast path: use selected-target build + output-shape inference first.
    // This avoids full graph manifest materialization for one-target run commands.
    const hints = await runnableHintsForTarget(workspaceRoot, target);
    targetHints = hints;
    const importer = hints.importer;
    let selectedError: unknown = null;
    let selectedOutPath = "";
    try {
      selectedOutPath = await buildSelectedOutPath(workspaceRoot, target, parsed.sourceMode, {
        artifactToolsRoot,
      });
      const inferred = await inferRunnableFromOutPath({
        label: target,
        outPath: selectedOutPath,
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
      if (!selectedError) {
        throw new Error(`selected output is not runnable for ${target}: ${selectedOutPath}`);
      }
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
      const refreshedManifestPath = await buildRunnableManifest(workspaceRoot, {
        sourceMode: parsed.sourceMode,
        target,
        artifactToolsRoot,
      });
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
  if (parsed.mode === "dev" && spec && targetHints?.importer && !opts.resolveEntry) {
    spec =
      (targetHints.mode === "static"
        ? await directStaticWebappDevSpec(workspaceRoot, targetHints.importer)
        : null) ||
      (await directImporterDevSpec(
        workspaceRoot,
        targetHints.importer,
        targetHints.mode,
        targetHints.framework,
      )) ||
      spec;
  }
  if (!spec) {
    console.error(`run.${parsed.mode} is not available for ${target}`);
    process.exit(2);
  }
  const exitCode = await runCommand(
    spec.argv,
    parsed.passthrough,
    commandCwdForSpec(spec, workspaceRoot),
  );
  process.exitCode = exitCode;
}

export async function enterRunnableEntrypoint(): Promise<{
  argv: string[];
  workspaceRoot: string;
  artifactToolsRoot: string;
}> {
  const initial = parseArgs(getArgvTokens());
  const workspaceRoot = await findRepoRoot(process.cwd());
  const artifactToolsRoot =
    initial.mode === "prod"
      ? enterCanonicalArtifactEntrypoint(workspaceRoot)
      : canonicalArtifactToolsRoot(workspaceRoot);
  return { argv: getArgvTokens(), workspaceRoot, artifactToolsRoot };
}

const invoked = String(process.argv[1] || "").replaceAll("\\", "/");
if (invoked.endsWith("/build-tools/tools/dev/run-runnable.ts")) {
  enterRunnableEntrypoint()
    .then((authority) => runRunnable(authority))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
