import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  assertArtifactClassificationAdmitted,
  type ArtifactBuildClassification,
  type ArtifactJobPurpose,
} from "../lib/artifact-build-policy";
import { targetPackageFromLabel } from "../lib/artifact-source-inventory";
import { admitArtifactContext, inspectWorkspaceArtifactSource } from "./artifact-policy-inspection";
import { makeFilteredFlakeRef } from "./filtered-flake";
import {
  evaluationBundleDevOverrides,
  evaluationBundleHasLanguageOverrides,
} from "./evaluation-bundle-selectors";
import {
  buildArtifactEnvironment,
  withoutArtifactEnvironmentInfluence,
} from "../lib/artifact-environment";

function isLikelyTempWorkspace(workspaceRoot: string): boolean {
  const workspaceAbs = path.resolve(workspaceRoot);
  return (
    workspaceAbs.startsWith("/tmp/") ||
    workspaceAbs.startsWith("/private/tmp/") ||
    workspaceAbs.startsWith("/private/var/folders/") ||
    workspaceAbs.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`)
  );
}

export async function canonicalRunnableViberootsSource(artifactToolsRoot: string): Promise<string> {
  const declared = path.join(artifactToolsRoot, "share", "viberoots-source");
  const canonical = await fsp.realpath(declared).catch(() => "");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(canonical)) {
    throw new Error(
      `runnable artifact requires recorded immutable viberoots source authority: ${
        canonical || declared
      }`,
    );
  }
  await Promise.all([
    fsp.access(path.join(canonical, "flake.nix")),
    fsp.access(path.join(canonical, "build-tools", "tools", "dev", "zx-init.mjs")),
  ]);
  return canonical;
}

export async function chooseRunnableFlakeRef(opts: {
  workspaceRoot: string;
  target?: string;
  sourceMode: "auto" | "git" | "path";
  attr: "graph-generator" | "graph-generator-selected";
  purpose: ArtifactJobPurpose;
  artifactToolsRoot: string;
}): Promise<{
  flakeRef: string;
  classification: ArtifactBuildClassification;
  workspaceRoot?: string;
  bundleDigest: string;
  cleanup?: () => Promise<void>;
}> {
  const pathSource =
    opts.sourceMode === "path" ||
    (opts.sourceMode === "auto" && isLikelyTempWorkspace(opts.workspaceRoot));
  if (pathSource) {
    assertArtifactClassificationAdmitted({
      classification: "local-development",
      purpose: opts.purpose,
      impureEvaluation: false,
    });
  }
  const baseEnv = withoutArtifactEnvironmentInfluence(process.env);
  const artifactEnv = buildArtifactEnvironment({
    baseEnv,
    mode: String(process.env.CI || "").trim() ? "ci" : "local",
    stateRoot: path.join(opts.workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot: opts.workspaceRoot,
    artifactToolsRoot: opts.artifactToolsRoot,
    internal: opts.target ? { BUCK_TARGET: opts.target, WORKSPACE_ROOT: opts.workspaceRoot } : {},
  });
  const targetPackages = opts.target ? [targetPackageFromLabel(opts.target)].filter(Boolean) : [];
  let classification: ArtifactBuildClassification;
  const devOverrides = evaluationBundleDevOverrides(process.argv.slice(2), {});
  const languageOverrides = evaluationBundleHasLanguageOverrides(devOverrides);

  if (pathSource) {
    classification = "local-development";
  } else {
    const inventory = await inspectWorkspaceArtifactSource({
      workspaceRoot: opts.workspaceRoot,
      targetPackages,
      env: artifactEnv,
    });
    classification =
      languageOverrides || (opts.sourceMode !== "git" && inventory.localDevelopment)
        ? "local-development"
        : "hermetic";
    if (inventory.localDevelopment && opts.sourceMode === "auto") {
      console.warn("[run-runnable] bundling relevant untracked files as local development source:");
      for (const file of inventory.relevant.slice(0, 50)) console.warn(` - ${file}`);
    }
  }

  await admitArtifactContext({
    classification,
    purpose: opts.purpose,
    impureEvaluation: false,
    workspaceRoot: opts.workspaceRoot,
    internal: opts.target ? { BUCK_TARGET: opts.target, WORKSPACE_ROOT: opts.workspaceRoot } : {},
    toolNames: ["git"],
    env: baseEnv,
    artifactToolsRoot: opts.artifactToolsRoot,
  });

  // Artifact ingress has already authenticated this tool closure. Seal that recorded
  // source into the evaluation bundle so pnpm reconciliation reads the bundle's
  // path input and lock, never an ambient source selector or the live worktree.
  const immutableViberootsInputRoot = await canonicalRunnableViberootsSource(
    opts.artifactToolsRoot,
  );
  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: opts.workspaceRoot,
    attr: opts.attr,
    logPrefix: "[run-runnable]",
    target: opts.target,
    classification,
    env: artifactEnv,
    selectorEnv: baseEnv,
    devOverrides,
    immutableViberootsInputRoot,
  });
  return {
    flakeRef: filtered.flakeRef,
    classification,
    workspaceRoot: filtered.workspaceRoot,
    bundleDigest: filtered.bundleDigest,
    cleanup: filtered.cleanup,
  };
}
