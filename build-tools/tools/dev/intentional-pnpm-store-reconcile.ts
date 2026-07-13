import path from "node:path";
import { runCommand } from "./filtered-flake-command";

export async function reconcilePnpmStore(opts: {
  repoRoot: string;
  importer: string;
}): Promise<void> {
  const lockfile =
    opts.importer === "." ? "pnpm-lock.yaml" : path.join(opts.importer, "pnpm-lock.yaml");
  await runCommand({
    command: path.resolve(import.meta.dirname, "update-pnpm-hash.ts"),
    args: ["--lockfile", lockfile],
    cwd: opts.repoRoot,
    env: { ...process.env, WORKSPACE_ROOT: opts.repoRoot },
  });
}
