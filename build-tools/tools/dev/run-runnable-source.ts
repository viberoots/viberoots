import path from "node:path";
import type { ArtifactBuildClassification, ArtifactJobPurpose } from "../lib/artifact-build-policy";
import { targetPackageFromLabel } from "../lib/artifact-source-inventory";
import { admitArtifactContext, inspectWorkspaceArtifactSource } from "./artifact-policy-inspection";
import { makeFilteredFlakeRef } from "./filtered-flake";

function isLikelyTempWorkspace(workspaceRoot: string): boolean {
  const workspaceAbs = path.resolve(workspaceRoot);
  return (
    workspaceAbs.startsWith("/tmp/") ||
    workspaceAbs.startsWith("/private/tmp/") ||
    workspaceAbs.startsWith("/private/var/folders/") ||
    workspaceAbs.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`)
  );
}

export async function chooseRunnableFlakeRef(opts: {
  workspaceRoot: string;
  target?: string;
  sourceMode: "auto" | "git" | "path";
  attr: "graph-generator" | "graph-generator-selected";
  purpose: ArtifactJobPurpose;
}): Promise<{
  flakeRef: string;
  classification: ArtifactBuildClassification;
  workspaceRoot?: string;
  cleanup?: () => Promise<void>;
}> {
  const targetPackages = opts.target ? [targetPackageFromLabel(opts.target)].filter(Boolean) : [];
  let classification: ArtifactBuildClassification;
  const pathSource = opts.sourceMode === "path" || isLikelyTempWorkspace(opts.workspaceRoot);

  if (pathSource) {
    classification = "local-development";
  } else {
    const inventory = await inspectWorkspaceArtifactSource({
      workspaceRoot: opts.workspaceRoot,
      targetPackages,
    });
    classification =
      opts.sourceMode === "git" || !inventory.localDevelopment ? "hermetic" : "local-development";
    if (inventory.localDevelopment && opts.sourceMode === "auto") {
      console.warn("[run-runnable] bundling relevant untracked files as local development source:");
      for (const file of inventory.relevant.slice(0, 50)) console.warn(` - ${file}`);
    }
  }

  await admitArtifactContext({
    classification,
    purpose: opts.purpose,
    impureEvaluation: true,
    workspaceRoot: opts.workspaceRoot,
    toolNames: ["git"],
  });

  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: opts.workspaceRoot,
    attr: opts.attr,
    logPrefix: "[run-runnable]",
    target: opts.target,
    classification,
  });
  return {
    flakeRef: filtered.flakeRef,
    classification,
    workspaceRoot: filtered.workspaceRoot,
    cleanup: filtered.cleanup,
  };
}
