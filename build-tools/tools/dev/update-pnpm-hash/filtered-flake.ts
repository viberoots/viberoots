import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "../filtered-flake-diagnostics";
import { filteredFlakeRsyncExcludeArgs } from "../nix-build-filtered-flake-lib";
import { emitTimingDetail } from "../../lib/timing-detail";

export async function makeFilteredFlakeRef(opts: {
  repoRoot: string;
  attr: string;
}): Promise<{ flakeRef: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "scaf-flake-"));
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const src = path.resolve(opts.repoRoot);
  if (filteredFlakeDiagnosticsEnabled()) {
    const dirty = await readDirtyGitStats(src);
    if (dirty) {
      const sample =
        dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
      console.warn(
        `[update-pnpm-hash] filtered flake dirty-tree entries=${dirty.entryCount}${sample}`,
      );
    }
  }
  const snapshotStart = Date.now();
  const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
  await $({
    stdio: "pipe",
  })`rsync -a --delete ${rsyncExcludes} ${src}/ ${snapDir}/`;
  if (filteredFlakeDiagnosticsEnabled()) {
    const stats = await readSnapshotStats(snapDir);
    const elapsedMs = Date.now() - snapshotStart;
    emitTimingDetail("filteredFlake updatePnpmHashSnapshotRsync", elapsedMs);
    console.warn(
      `[update-pnpm-hash] filtered flake snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
    );
  }
  return {
    flakeRef: `path:${snapDir}#${opts.attr}`,
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
