import path from "node:path";
import { runNodeWithZx } from "../lib/node-run";

export async function reconcilePnpmStore(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  const lockfile =
    opts.importer === "." ? "pnpm-lock.yaml" : path.join(opts.importer, "pnpm-lock.yaml");
  await runNodeWithZx({
    script: path.resolve(import.meta.dirname, "update-pnpm-hash.ts"),
    args: ["--lockfile", lockfile],
    cwd: opts.repoRoot,
    env: { ...process.env, WORKSPACE_ROOT: opts.repoRoot },
    zxInitPath: path.resolve(import.meta.dirname, "zx-init.mjs"),
  });
}
