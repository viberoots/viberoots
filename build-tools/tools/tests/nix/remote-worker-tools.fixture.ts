import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceFlakeRef } from "../lib/test-helpers";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const rsyncSourceRoot = path.resolve(process.env.TEST_RSYNC_SOURCE_ROOT || process.cwd());
const viberootsRsyncPrefix = path.relative(rsyncSourceRoot, VIBEROOTS_SOURCE_ROOT);

export const REMOTE_WORKER_TEST_RSYNC_ROOTS = [
  "build-tools/tools/nix",
  "build-tools/tools/lib",
  "build-tools/tools/remote-exec",
  "build-tools/tools/tests/defs.bzl",
  "build-tools/tools/tests/dev/canonical-artifact-reviewed-config-handoff.fixture.ts",
  "build-tools/tools/tests/template_taxonomy_adapter.bzl",
]
  .map((root) => path.join(viberootsRsyncPrefix, root))
  .join(" ");

export async function buildNixAttr(root: string, $: any, attr: string): Promise<string> {
  const flakeRoot = await workspaceFlakeRef(root);
  const res = await $({
    cwd: root,
    stdio: "pipe",
  })`nix build ${`path:${flakeRoot}#${attr}`} --impure --no-link --print-out-paths --accept-flake-config`;
  const out = String(res.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!out) throw new Error(`missing output path for ${attr}`);
  return out;
}

export async function expectBin(root: string, bin: string): Promise<void> {
  await fs.access(path.join(root, "bin", bin));
}

export async function execFileResult(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    execFile(file, args, opts, (error, stdout, stderr) => {
      const code =
        error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
          ? ((error as NodeJS.ErrnoException & { code: number }).code as number)
          : 0;
      resolve({ code, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}
