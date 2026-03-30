import * as fsp from "node:fs/promises";
import path from "node:path";

export async function makeFilteredFlakeRef(opts: {
  workspaceRoot: string;
  attr: string;
  logPrefix: string;
}): Promise<{ flakeRef: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "bnx-flake-"));
  const snapDir = path.join(workDir, "src");
  await fsp.mkdir(snapDir, { recursive: true });
  const src = path.resolve(opts.workspaceRoot);
  console.warn(
    `${opts.logPrefix} creating filtered source snapshot (excludes node_modules, buck-out, etc.)`,
  );
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules --exclude buck-out --exclude .direnv --exclude .pnpm-store --exclude .pnpm-home --exclude coverage --exclude .clinic --exclude .turbo --exclude .cache --exclude dist --exclude build --exclude .vite --exclude .next --exclude .wasm-producer ${src}/ ${snapDir}/`;
  return {
    flakeRef: `path:${snapDir}#${opts.attr}`,
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
