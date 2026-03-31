import * as fsp from "node:fs/promises";
import path from "node:path";
import { prepareExactPnpmStore, withExactPrefetchedStore } from "./exact-store.ts";
import {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
} from "./importer-lockfile.ts";
import { pnpmFlakeRef } from "./lockfile-shared.ts";
import { withResolvedExactPrefetchedStore } from "./realized-store.ts";

export async function makeFilteredFlakeRef(repoRoot: string): Promise<{
  flakeRef: string;
  cleanup: () => Promise<void>;
}> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "scaf-flake-"));
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const src = path.resolve(repoRoot);
  // Keep untracked scaffold outputs while excluding large generated directories.
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules --exclude buck-out --exclude .direnv --exclude .pnpm-store --exclude .pnpm-home --exclude coverage --exclude .clinic --exclude .turbo --exclude .cache ${src}/ ${snapDir}/`;
  return {
    flakeRef: pnpmFlakeRef(snapDir),
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export {
  ensureImporterLockfileFresh,
  ensureImporterLockfileFreshIfAllowed,
  generateImporterLockfile,
  prepareExactPnpmStore,
  withExactPrefetchedStore,
  withResolvedExactPrefetchedStore,
};
