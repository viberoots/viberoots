import * as fsp from "node:fs/promises";
import path from "node:path";

export async function makeFilteredFlakeRef(opts: {
  repoRoot: string;
  attr: string;
}): Promise<{ flakeRef: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "scaf-flake-"));
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const src = path.resolve(opts.repoRoot);
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules --exclude buck-out --exclude .direnv --exclude .pnpm-store --exclude .pnpm-home --exclude coverage --exclude .clinic --exclude .turbo --exclude .cache --exclude dist --exclude build --exclude .vite --exclude .next --exclude .wasm-producer --exclude pnpm-workspace.yaml --exclude .node_modules.lockfile-guard.* --exclude result --exclude result-* ${src}/ ${snapDir}/`;
  return {
    flakeRef: `path:${snapDir}#${opts.attr}`,
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
