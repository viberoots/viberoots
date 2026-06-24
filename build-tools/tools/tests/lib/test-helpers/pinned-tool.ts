import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveToolPathSync } from "../../../lib/tool-paths";
import {
  nixEvalTempDirOutsideWorkspace,
  pinnedNixpkgsPackageExpr,
} from "../../../lib/pinned-nixpkgs";

const pinnedToolCache = new Map<string, Promise<string>>();

function packageExprForTool(tool: string): { packageExpr: string; binRel: string } {
  switch (tool) {
    case "buildifier":
      return { packageExpr: "pkgs.buildifier", binRel: path.join("bin", "buildifier") };
    case "zip":
      return { packageExpr: "pkgs.zip", binRel: path.join("bin", "zip") };
    default:
      throw new Error(`unsupported pinned test tool: ${tool}`);
  }
}

export async function resolvePinnedTestToolPath(tool: string, $: any): Promise<string> {
  try {
    return resolveToolPathSync(tool);
  } catch {}

  const cached = pinnedToolCache.get(tool);
  if (cached) return await cached;

  const pending = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await fsp.mkdir(nixEvalTmp, { recursive: true }).catch(() => {});
    const hiddenLock = path.join(repoRoot, ".viberoots", "workspace", "flake.lock");
    const lockPath = (await fsp
      .access(hiddenLock)
      .then(() => true)
      .catch(() => false))
      ? hiddenLock
      : path.join(repoRoot, "flake.lock");
    const { packageExpr, binRel } = packageExprForTool(tool);
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
        TMPDIR: nixEvalTmp,
      },
    })`nix build --impure --accept-flake-config --expr ${pinnedNixpkgsPackageExpr(lockPath, packageExpr)} --no-link --print-out-paths`;
    const outPath = String((out as any).stdout || "")
      .trim()
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .find(Boolean);
    const resolved = outPath ? path.join(outPath, binRel) : "";
    if (!resolved) throw new Error(`failed to resolve pinned test tool: ${tool}`);
    return resolved;
  })();

  pinnedToolCache.set(tool, pending);
  return await pending;
}
