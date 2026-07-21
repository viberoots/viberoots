#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { getArgvTokens, getFlagBool, getFlagStr } from "../lib/cli";
import { ensureNixStoreToolPathSync, envWithResolvedNixBin } from "../lib/tool-paths";
import {
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "./nix-build-filtered-flake-lib";
import { filteredSnapshotSelection } from "./filtered-flake-snapshot-selection";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../lib/macos-metadata";
import { repairSnapshotViberootsInput } from "./filtered-flake-viberoots-input";
import { runCommand } from "./filtered-flake-command";
import { classifyArtifactBuild } from "../lib/artifact-build-policy";
import { inspectArtifactSource } from "../lib/artifact-source-inventory";
import {
  emitArtifactPolicyEvidence,
  inspectArtifactBuildPolicy,
} from "./artifact-policy-inspection";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";
import { materializeEvaluationBundle } from "./evaluation-bundle";
import { withoutEvaluationSelectors } from "./evaluation-bundle-env";
import {
  evaluationBundleDevOverrides,
  evaluationBundleHasLanguageOverrides,
} from "./evaluation-bundle-selectors";
import {
  assertNoArtifactSelectorInjection,
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";
import {
  materializeDeclaredImporterInputs,
  materializeDeclaredProviderEdges,
  readDeclaredBuckActionInputs,
} from "./nix-build-filtered-flake-declared-inputs";
import {
  copyWorkspaceControlIntoSnapshot,
  copyWorkspaceGraphIntoSnapshot,
  resolveSnapshotFlakeDir,
} from "./nix-build-filtered-flake-preparation";
import {
  formatDuration,
  prewarmFinalStoreForTarget,
  readSnapshotStats,
} from "./nix-build-filtered-flake-runtime";
export {
  assertDeclaredBuckActionInput,
  readDeclaredBuckActionInputs,
} from "./nix-build-filtered-flake-declared-inputs";

async function main(declaredArtifactToolsRoot: string): Promise<void> {
  const devOverrides = evaluationBundleDevOverrides(getArgvTokens(), {});
  const attr = getFlagStr("attr", "");
  if (!attr) {
    console.error("[nix-build-filtered-flake] missing --attr");
    process.exit(2);
  }
  const snapshotOnly = getFlagBool("snapshot-only");
  const buckActionInputsPath = getFlagStr("buck-action-inputs", "").trim();
  const buckAction = buckActionInputsPath !== "";
  const declaredSourceRoot = buckAction ? String(process.env.VIBEROOTS_ROOT || "").trim() : "";
  const root = path.resolve(getFlagStr("workspace-root", "").trim() || process.cwd());
  const declaredActionInputs = await readDeclaredBuckActionInputs(
    buckActionInputsPath,
    root,
    getFlagStr("buck-action-state-root", "").trim(),
  );
  const target = getFlagStr("target", "").trim();
  assertNoArtifactSelectorInjection(process.env, {
    allow: buckAction ? ["VBR_ARTIFACT_TOOLS_ROOT", "VIBEROOTS_ROOT"] : ["VBR_ARTIFACT_TOOLS_ROOT"],
  });
  // Explicit --target is the canonical public authority. Downstream helpers still
  // read process.env.BUCK_TARGET as the internally declared selector; set it here
  // after admission so the ambient-ingress rejection stays intact.
  if (target) process.env.BUCK_TARGET = target;
  const platform = "";
  const targetPackage = targetPackageFromLabel(target);
  const policyEnv = buildArtifactEnvironment({
    baseEnv: withoutArtifactEnvironmentInfluence(
      envWithResolvedNixBin(withoutEvaluationSelectors(process.env)),
    ),
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(root, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: root,
    artifactToolsRoot: declaredArtifactToolsRoot,
    internal: {
      BUCK_GRAPH_JSON: getFlagStr("buck-graph-json", "").trim(),
      BUCK_TARGET: target,
      WORKSPACE_ROOT: root,
    },
  });
  let immutableViberootsInputRoot = "";
  if (buckAction) {
    const canonicalSourceRoot = path.join(
      String(policyEnv.VBR_ARTIFACT_TOOLS_ROOT || ""),
      "share",
      "viberoots-source",
    );
    let canonicalReal: string;
    try {
      canonicalReal = await fsp.realpath(canonicalSourceRoot);
    } catch (error) {
      throw new Error("Buck action viberoots source authority is unavailable", { cause: error });
    }
    immutableViberootsInputRoot = canonicalReal;
    // The canonical re-exec strips VIBEROOTS_ROOT before invoking this entrypoint. When the
    // Buck action bootstrap did declare it, verify that it matches the canonical tool closure.
    // When it is absent post-re-exec, canonical ingress already asserted the
    // tool closure is authentic, so no further comparison is required.
    if (declaredSourceRoot) {
      const declaredReal = await fsp.realpath(declaredSourceRoot);
      if (declaredReal !== canonicalReal) {
        throw new Error(
          `Buck action viberoots source authority mismatch: declared=${declaredSourceRoot} canonical=${canonicalSourceRoot}`,
        );
      }
    }
    policyEnv.VIBEROOTS_ROOT = canonicalSourceRoot;
  }
  const sourceInventory = await inspectArtifactSource({
    targetPackages: targetPackage ? [targetPackage] : [],
    runGit: async () =>
      await runCommand({
        command: ensureNixStoreToolPathSync("git", policyEnv),
        args: ["ls-files", "-z", "--others", "--exclude-standard"],
        cwd: root,
        env: policyEnv,
        allowFailure: true,
      }),
  });
  const classification = classifyArtifactBuild({
    diagnosticImpure: getFlagBool("impure"),
    localDevelopment:
      sourceInventory.localDevelopment || evaluationBundleHasLanguageOverrides(devOverrides),
  });
  const policyEvidence = await inspectArtifactBuildPolicy({
    classification,
    impureEvaluation: false,
    env: policyEnv,
    toolPaths: { node: process.execPath },
    toolNames: ["git", "rsync"],
    runCommand: async (command, args) =>
      await runCommand({ command, args, env: policyEnv, allowFailure: true }),
  });
  emitArtifactPolicyEvidence(policyEvidence);
  const tmpBase = policyEnv.TMPDIR || "/tmp";
  const workDir = await mkdtempNoindex("vbr-flake-", {
    baseName: "vbr-flake",
    tmpBase,
  });
  const snapDir = path.join(workDir, "src");
  let keepSnapshot = snapshotOnly;
  let exactStoreCleanup: (() => Promise<void>) | null = null;
  const withHeartbeat = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      console.error(`[nix-build-filtered-flake] ${label} still running (${elapsed}s)`);
    }, 15000);
    try {
      return await p;
    } finally {
      clearInterval(timer);
    }
  };
  try {
    await mkdirWithMacosMetadataExclusion(snapDir);
    const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
    // Single graph-derived source authority: reuse the same selection helper the
    // canonical build-selected.ts entrypoint uses via makeFilteredFlakeRef so
    // scaffolded importers, cpp link_deps package closures, and declared Buck
    // sources land in one authoritative snapshot rather than two heuristic paths.
    const declaredGraphPath = path.resolve(
      getFlagStr("buck-graph-json", "").trim() ||
        path.join(root, ".viberoots", "workspace", "buck", "graph.json"),
    );
    const snapshotSelection = await filteredSnapshotSelection(root, target, declaredGraphPath);
    const snapshotStart = Date.now();
    const rsyncBin = ensureNixStoreToolPathSync("rsync", policyEnv);
    const presentRelPaths: string[] = [];
    for (const rel of snapshotSelection.relPaths) {
      try {
        await fsp.lstat(path.join(root, rel));
        presentRelPaths.push(rel);
      } catch {}
    }
    const snapshotSources = defaultFilteredFlakeSnapshotRsyncSources(presentRelPaths);
    console.error(
      `[nix-build-filtered-flake] creating graph-derived snapshot: ${snapDir} target=${target || "<none>"} relPaths=${presentRelPaths.length} declaredSources=${snapshotSelection.declaredSources.length}`,
    );
    await withHeartbeat(
      "snapshot-rsync",
      runCommand({
        command: rsyncBin,
        args: ["-a", "--delete", "--relative", ...rsyncExcludes, ...snapshotSources, `${snapDir}/`],
        cwd: root,
        env: policyEnv,
      }),
    );
    for (const relative of snapshotSelection.declaredSources) {
      const copied = path.join(snapDir, relative);
      const stat = await fsp.lstat(copied).catch(() => null);
      if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) {
        throw new Error(`declared Buck source was excluded from filtered snapshot: ${relative}`);
      }
    }
    await copyWorkspaceControlIntoSnapshot(root, snapDir);
    const snapshotGraphPath = await copyWorkspaceGraphIntoSnapshot(
      root,
      snapDir,
      declaredGraphPath,
    );
    // Buck action inputs that live outside the workspace tree (e.g.
    // __provider_edges__/* staged at the action root) still need targeted copy
    // into the snapshot; they are declared inputs but not workspace source.
    if (buckAction && snapshotGraphPath) {
      const importer = targetPackageFromLabel(target);
      if (importer) {
        await materializeDeclaredImporterInputs({
          root,
          snapDir,
          graphPath: snapshotGraphPath,
          target,
          importer,
          declaredActionInputs,
        });
        await materializeDeclaredProviderEdges({
          root,
          snapDir,
          graphPath: snapshotGraphPath,
          target,
          importer,
          declaredActionInputs,
        });
      }
    }
    const snapshotStats = await readSnapshotStats(snapDir, policyEnv);
    console.error(
      `[nix-build-filtered-flake] snapshot ready in ${formatDuration(Date.now() - snapshotStart)} files=${snapshotStats.fileCount} dirs=${snapshotStats.dirCount} kb=${snapshotStats.kb}`,
    );
    const flakeDir = await resolveSnapshotFlakeDir(snapDir);
    const snapshotViberootsInput = await repairSnapshotViberootsInput({
      snapDir,
      flakeDir,
      immutableInputRoot: immutableViberootsInputRoot,
      env: policyEnv,
    });
    const snapshotViberootsRoot = snapshotViberootsInput
      ? path.resolve(flakeDir, snapshotViberootsInput)
      : "";
    if (snapshotViberootsInput) {
      console.error(
        "[nix-build-filtered-flake] repaired snapshot viberoots input:",
        snapshotViberootsInput,
      );
      await fsp.rm(path.join(snapDir, "viberoots"), { recursive: true, force: true });
    }
    if (snapshotOnly) {
      console.error(
        `[nix-build-filtered-flake] snapshot-only mode; keeping snapshot at ${snapDir}`,
      );
      process.stdout.write(`${snapDir}\n`);
      return;
    }
    const bundle = await materializeEvaluationBundle({
      stagedSource: snapDir,
      attr,
      target,
      classification,
      platform,
      requireGraph: Boolean(target),
      artifactEnv: policyEnv,
      devOverrides,
      wasmBackend: getFlagStr("wasm-backend", "").trim(),
      onlyCpp: getFlagBool("planner-only-cpp"),
      coverage: getFlagBool("coverage"),
    });
    const flakeRef = bundle.flakeRef;
    const bundleRoot = bundle.workspaceRoot;
    console.error("[nix-build-filtered-flake] building attr:", attr);
    const inheritedNixEnv = withoutArtifactEnvironmentInfluence(
      envWithResolvedNixBin(withoutEvaluationSelectors(process.env)),
    );
    const nixEnv = buildArtifactEnvironment({
      baseEnv: inheritedNixEnv,
      mode: String(process.env.CI || "").trim() ? "ci" : "local",
      stateRoot: path.join(root, "buck-out", "tmp", "artifact-environment"),
      workspaceRoot: root,
      artifactToolsRoot: declaredArtifactToolsRoot,
      internal: {
        VBR_PNPM_FILTERED_SNAPSHOT_ROOT: bundleRoot,
        ...(snapshotViberootsRoot
          ? {
              VIBEROOTS_FLAKE_INPUT_ROOT: snapshotViberootsRoot,
              VIBEROOTS_ROOT: snapshotViberootsRoot,
              VIBEROOTS_SOURCE_ROOT: snapshotViberootsRoot,
            }
          : {}),
        VBR_FILTERED_FLAKE_SNAPSHOT: "1",
      },
    });
    const nixBin = ensureNixStoreToolPathSync("nix", nixEnv);
    const fixedStore = await prewarmFinalStoreForTarget(bundleRoot, root, attr, flakeRef, nixEnv);
    exactStoreCleanup = fixedStore.cleanup;
    const buildStart = Date.now();
    const nixArgs = [
      "build",
      ...artifactNixPolicyArgs(),
      "--no-write-lock-file",
      "--accept-flake-config",
      flakeRef,
      "--option",
      "min-free",
      "0",
      "--option",
      "max-free",
      "0",
      "--no-link",
      "--print-out-paths",
    ];
    const runOnce = () =>
      withHeartbeat(
        "nix-build",
        runCommand({
          command: nixBin,
          args: nixArgs,
          env: nixEnv,
          allowFailure: true,
        }),
      );
    const res = await runNixBuildWithTransientRetry({ runOnce });
    if (Number(res.exitCode || 0) !== 0) {
      const err = new Error(`nix build exited with code ${res.exitCode}`);
      (err as Error & { stderr?: string }).stderr = String(res.stderr || "");
      process.stderr.write(String(res.stderr || ""));
      throw err;
    }
    const outPath =
      String(res.stdout || "")
        .trim()
        .split(/\n+/)
        .filter(Boolean)
        .at(-1) || "";
    console.error(
      `[nix-build-filtered-flake] nix build finished in ${formatDuration(Date.now() - buildStart)}${outPath ? ` out=${outPath}` : ""}`,
    );
    if (!outPath) {
      throw new Error("[nix-build-filtered-flake] nix build produced no output path");
    }
    process.stdout.write(`${outPath}\n`);
  } finally {
    await exactStoreCleanup?.();
    if (!keepSnapshot) {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const declaredBuckAction = getFlagStr("buck-action-inputs", "").trim() !== "";
  const artifactToolsRoot = enterCanonicalArtifactEntrypoint(process.cwd(), {
    declaredBuckAction,
    allowDevOverrides: true,
  });
  main(artifactToolsRoot).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
