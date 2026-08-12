import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshGlueAndExportGraph } from "../dev/dev-build/glue";
import type { ActiveReviewedRemoteNix } from "../remote-exec/active-reviewed-remote-nix";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { runArtifactTool } from "./artifact-command";
import { withArtifactReproducibilityTempConsumer } from "./artifact-reproducibility-temp-consumer";
import { prepareProtectedRustConsumer } from "./protected-rust-patch-consumer";
import { materializeProtectedRustDependency } from "./protected-rust-dependency-authority";
import { protectedPatchWorkflow } from "./protected-rust-patch-workflow";
import { assertProtectedRustPatchLifecycle } from "./protected-rust-patch-lifecycle";
import {
  realizeProtectedRustPatchPhase,
  type ProtectedRustPatchPhase,
} from "./protected-rust-patch-phase";
import {
  protectedRustPatchCaseDefinitions,
  type ProtectedRustPatchCaseDefinition,
} from "./protected-rust-patch-case-definitions";
import { prepareProtectedTauriPnpmAuthority } from "./protected-tauri-pnpm-authority";
import type { NixCachePolicyCapability } from "../lib/nix-cache-policy-capability";
export { protectedRustPatchCaseIds } from "./protected-rust-patch-case-definitions";
export { protectedRustPatchCaseDefinitions } from "./protected-rust-patch-case-definitions";
export type { ProtectedRustPatchPhase } from "./protected-rust-patch-phase";

export type ProtectedRustPatchCaseResult = {
  caseId: string;
  driverSource: string;
  workflowSource: string;
  workflowActions: ["start", "apply", "remove"];
  patchPath: string;
  baseline: ProtectedRustPatchPhase;
  patched: ProtectedRustPatchPhase;
  restored: ProtectedRustPatchPhase;
};

type ExactNix = Pick<ActiveReviewedRemoteNix, "runNix">;

export async function runProtectedRustPatchCaseDrivers(opts: {
  active: ExactNix;
  remoteCiTools: string;
  artifactToolsRoot?: string;
  nixCachePolicyCapability?: NixCachePolicyCapability;
  system: string;
  caseIds?: string[];
}): Promise<ProtectedRustPatchCaseResult[]> {
  const definitions = protectedRustPatchCaseDefinitions(opts.system);
  const selected = opts.caseIds
    ? definitions.filter(({ id }) => opts.caseIds!.includes(id))
    : definitions;
  if (opts.caseIds && selected.length !== opts.caseIds.length) {
    throw new Error(`unknown protected Rust patch case: ${opts.caseIds.join(",")}`);
  }
  const results: ProtectedRustPatchCaseResult[] = [];
  for (const definition of selected) results.push(await runCase(opts, definition));
  return results;
}

async function runCase(
  opts: {
    active: ExactNix;
    remoteCiTools: string;
    artifactToolsRoot?: string;
    nixCachePolicyCapability?: NixCachePolicyCapability;
    system: string;
  },
  definition: ProtectedRustPatchCaseDefinition,
): Promise<ProtectedRustPatchCaseResult> {
  const ownerRoot = await fs.mkdtemp(path.join(os.tmpdir(), `vbr-patch-${definition.id}-`));
  const artifactToolsRoot = opts.artifactToolsRoot || opts.remoteCiTools;
  const transportEnv = artifactTransportEnvironment(process.env);
  delete transportEnv.VBR_ARTIFACT_TOOLS_ROOT;
  try {
    const authority = await materializeProtectedRustDependency({
      ownerRoot,
      artifactToolsRoot,
      active: opts.active,
    });
    return await withArtifactReproducibilityTempConsumer({
      matrixId: definition.id,
      ownerRoot,
      artifactToolsRoot,
      baseEnv: transportEnv,
      nixCachePolicyCapability: opts.nixCachePolicyCapability,
      immutableSourceRoot: path.join(opts.remoteCiTools, "share/viberoots-source"),
      cleanupProofFile: path.join(ownerRoot, "cleanup.json"),
      prepareWorkspaceState: async (workspaceRoot) => {
        await prepareProtectedRustConsumer(workspaceRoot, definition, authority);
        await fs.writeFile(
          path.join(workspaceRoot, ".patch-sessions.json"),
          '{\n  "version": 1,\n  "sessions": {\n    "rust": {}\n  }\n}\n',
        );
      },
      prepareImmutableDependencies:
        definition.id === "rust-tauri-darwin-pr12"
          ? async (workspaceRoot) => {
              await prepareProtectedTauriPnpmAuthority({
                workspaceRoot,
                artifactToolsRoot,
                active: opts.active,
              });
            }
          : undefined,
      operation: async (workspaceRoot) => {
        const workflow = protectedPatchWorkflow({ workspaceRoot, definition });
        const baselineIdentity = await gitIdentity(workspaceRoot, artifactToolsRoot);
        const phaseOpts = { artifactToolsRoot };
        const baseline = await realizeProtectedRustPatchPhase(
          opts.active,
          definition,
          workspaceRoot,
          "42",
          { ...phaseOpts, ...baselineIdentity, patchDigest: null },
        );
        const applied = await workflow.apply();
        await refreshGlueAndExportGraph(workspaceRoot, artifactToolsRoot);
        const patchedIdentity = await commitPhase(
          workspaceRoot,
          artifactToolsRoot,
          `reproducibility: apply ${definition.id} dependency patch`,
        );
        const patched = await realizeProtectedRustPatchPhase(
          opts.active,
          definition,
          workspaceRoot,
          "43",
          { ...phaseOpts, ...patchedIdentity, patchDigest: applied.patchDigest },
        );
        await workflow.remove();
        await refreshGlueAndExportGraph(workspaceRoot, artifactToolsRoot);
        const restoredIdentity = await commitPhase(
          workspaceRoot,
          artifactToolsRoot,
          `reproducibility: remove ${definition.id} dependency patch`,
        );
        const restored = await realizeProtectedRustPatchPhase(
          opts.active,
          definition,
          workspaceRoot,
          "42",
          { ...phaseOpts, ...restoredIdentity, patchDigest: null },
        );
        assertProtectedRustPatchLifecycle(definition.id, baseline, patched, restored);
        return {
          caseId: definition.id,
          driverSource: path.join(
            opts.remoteCiTools,
            "share/viberoots-source/build-tools/tools/ci/protected-rust-patch-case-driver.ts",
          ),
          workflowSource: path.join(
            opts.remoteCiTools,
            "share/viberoots-source/build-tools/tools/patch/patch-rust.ts",
          ),
          workflowActions: ["start", "apply", "remove"],
          patchPath: applied.patchPath,
          baseline,
          patched,
          restored,
        };
      },
    });
  } finally {
    await fs.rm(ownerRoot, { recursive: true, force: true });
  }
}

async function commitPhase(workspaceRoot: string, artifactToolsRoot: string, message: string) {
  await git(workspaceRoot, artifactToolsRoot, ["add", "--all"]);
  await git(workspaceRoot, artifactToolsRoot, ["commit", "--no-gpg-sign", "-m", message]);
  return await gitIdentity(workspaceRoot, artifactToolsRoot);
}

async function gitIdentity(workspaceRoot: string, artifactToolsRoot: string) {
  const consumerCommit = (
    await git(workspaceRoot, artifactToolsRoot, ["rev-parse", "HEAD"])
  ).trim();
  const consumerTree = (
    await git(workspaceRoot, artifactToolsRoot, ["rev-parse", "HEAD^{tree}"])
  ).trim();
  return { consumerCommit, consumerTree };
}

async function git(workspaceRoot: string, artifactToolsRoot: string, args: string[]) {
  const transportEnv = artifactTransportEnvironment(process.env);
  delete transportEnv.VBR_ARTIFACT_TOOLS_ROOT;
  return (
    await runArtifactTool({
      tool: "git",
      args,
      workspaceRoot,
      artifactToolsRoot,
      baseEnv: {
        ...transportEnv,
        GIT_AUTHOR_NAME: "Viberoots Reproducibility",
        GIT_AUTHOR_EMAIL: "reproducibility@viberoots.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_NAME: "Viberoots Reproducibility",
        GIT_COMMITTER_EMAIL: "reproducibility@viberoots.invalid",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      },
    })
  ).stdout;
}
