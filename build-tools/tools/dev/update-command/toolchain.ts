import * as fsp from "node:fs/promises";
import path from "node:path";
import { makeFilteredFlakeRef } from "../update-pnpm-hash/filtered-flake";
import { ensureToolchainPathsFiles } from "../toolchain-paths";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureArtifactToolsGcRoot } from "./artifact-tools-gc-root";

export type RepairedArtifactToolchainAuthority = {
  artifactToolsRoot: string;
  viberootsSource: string;
};

export async function repairArtifactToolchainAuthority(
  root: string,
): Promise<RepairedArtifactToolchainAuthority> {
  try {
    await ensureArtifactToolsGcRoot({
      repoRoot: root,
      storePath: canonicalArtifactToolsRoot(root),
    });
  } catch {
    // Only explicit `u` may recover a missing generated tool authority. Bootstrap
    // from the already-locked immutable workspace, then rebuild below from the
    // current filtered source so dirty tool changes still enter the final identity.
    const bootstrap = await ensureToolchainPathsFiles(root, { refresh: true });
    await ensureArtifactToolsGcRoot({
      repoRoot: root,
      storePath: bootstrap.artifactTools.root,
    });
  }
  const filtered = await makeFilteredFlakeRef({ repoRoot: root, attr: "remote-worker-tools" });
  try {
    if (!filtered.viberootsInputRoot) {
      throw new Error("u requires an immutable filtered viberoots toolchain source");
    }
    const finalPaths = await ensureToolchainPathsFiles(root, {
      refresh: true,
      artifactToolsFlakeRef: `path:${filtered.viberootsInputRoot}`,
    });
    await ensureArtifactToolsGcRoot({
      repoRoot: root,
      storePath: finalPaths.artifactTools.root,
    });
    return {
      artifactToolsRoot: finalPaths.artifactTools.root,
      viberootsSource: await fsp.realpath(
        path.join(finalPaths.artifactTools.root, "share", "viberoots-source"),
      ),
    };
  } finally {
    await filtered.cleanup();
  }
}
