import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "./filtered-flake-diagnostics";
import { filteredFlakeRsyncExcludeArgs } from "./nix-build-filtered-flake-lib";
import { emitTimingDetail } from "../lib/timing-detail";

export async function makeFilteredFlakeRef(opts: {
  workspaceRoot: string;
  attr: string;
  logPrefix: string;
}): Promise<{ flakeRef: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDirRaw = await fsp.mkdtemp(path.join(tmpBase, "vbr-flake-"));
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const snapDirReal = await fsp.realpath(snapDir).catch(() => snapDir);
  const src = path.resolve(opts.workspaceRoot);
  console.warn(
    `${opts.logPrefix} creating filtered source snapshot (excludes node_modules, buck-out, etc.)`,
  );
  if (filteredFlakeDiagnosticsEnabled()) {
    const dirty = await readDirtyGitStats(src);
    if (dirty) {
      const sample =
        dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
      console.warn(`${opts.logPrefix} dirty-tree entries=${dirty.entryCount}${sample}`);
    }
  }
  const snapshotStart = Date.now();
  const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
  await $({
    stdio: "pipe",
  })`rsync -a --delete ${rsyncExcludes} ${src}/ ${snapDirReal}/`;
  if (filteredFlakeDiagnosticsEnabled()) {
    const stats = await readSnapshotStats(snapDirReal);
    const elapsedMs = Date.now() - snapshotStart;
    emitTimingDetail("filteredFlake snapshotRsync", elapsedMs);
    console.warn(
      `${opts.logPrefix} snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
    );
  }
  return {
    flakeRef: `path:${snapDirReal}#${opts.attr}`,
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
