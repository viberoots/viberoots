import * as fsp from "node:fs/promises";
import path from "node:path";
import { copyTree } from "../../lib/copy-tree";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { isGeneratedRepoStateRelPath } from "./generated-state-excludes";
import { PREPARED_MARKER, seedStageDir } from "./seed-stage-layout";
import {
  acquireSeedStageLock,
  createSharedSeedStagePin,
  sweepStaleSeedStages,
} from "./seed-stage-ownership";
import { prepareStageSeed } from "./seed-stage-prepare";
import { ensureWritableTree, stageReady } from "./seed-stage-tree";

export { seedStageRootDirForTest, shouldStageSeed } from "./seed-stage-layout";
export { createSharedSeedStagePin } from "./seed-stage-ownership";

export async function stageSeedStore(
  seedPath: string,
  seedKey: string,
  seedTtlMs: number,
  opts: { workspaceRoot?: string; sharedPinIso?: string } = {},
): Promise<string> {
  await sweepStaleSeedStages(seedKey, seedTtlMs, opts.workspaceRoot);
  const stageDir = seedStageDir(seedKey);
  const publishReadyStage = async () => {
    if (opts.sharedPinIso) await createSharedSeedStagePin(stageDir, opts.sharedPinIso);
    return stageDir;
  };
  if (await stageReady(stageDir, seedKey)) {
    await ensureWritableTree(stageDir);
    await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
    await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
    return await publishReadyStage();
  }
  const release = await acquireSeedStageLock(seedKey, seedTtlMs);
  try {
    if (await stageReady(stageDir, seedKey)) {
      await ensureWritableTree(stageDir);
      await fsp.rm(path.join(stageDir, ".seed-store-writable"), { force: true }).catch(() => {});
      await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
      return await publishReadyStage();
    }
    await ensureWritableTree(stageDir).catch(() => {});
    await fsp.rm(stageDir, { recursive: true, force: true }).catch(async () => {
      await ensureWritableTree(stageDir).catch(() => {});
      await fsp.rm(stageDir, { recursive: true, force: true });
    });
    await mkdirWithMacosMetadataExclusion(path.dirname(stageDir)).catch(() => {});
    await copyTree(seedPath, stageDir, {
      cloneMode: "none",
      exclude: isGeneratedRepoStateRelPath,
      force: true,
    });
    await mkdirWithMacosMetadataExclusion(stageDir).catch(() => {});
    await ensureWritableTree(stageDir);
    if (opts.workspaceRoot) {
      await prepareStageSeed(stageDir, opts.workspaceRoot);
    } else {
      await fsp.writeFile(path.join(stageDir, PREPARED_MARKER), "ok\n", "utf8");
    }
    await fsp.writeFile(path.join(stageDir, "seed.key"), seedKey + "\n", "utf8");
    await fsp.writeFile(path.join(stageDir, ".seed-store-ready"), "ok\n", "utf8");
    return await publishReadyStage();
  } finally {
    await release();
  }
}
