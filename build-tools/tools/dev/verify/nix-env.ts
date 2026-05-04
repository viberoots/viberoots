import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { nixEvalTempDirOutsideWorkspace, pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";

export async function ensureVerifyPinnedNixpkgs(root: string): Promise<void> {
  const nixEvalTmp = nixEvalTempDirOutsideWorkspace(root);
  await fsp.mkdir(nixEvalTmp, { recursive: true }).catch(() => {});
  const nixpkgsPath = await $({
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      TMPDIR: nixEvalTmp,
    },
  })`nix eval --impure --accept-flake-config --raw --expr ${pinnedNixpkgsOutPathExpr(path.join(root, "flake.lock"))}`
    .then((res) => String(res.stdout || "").trim())
    .catch(() => "");
  if (!nixpkgsPath) return;
  const entries = String(process.env.NIX_PATH || "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith("nixpkgs="));
  process.env.NIX_PATH = [`nixpkgs=${nixpkgsPath}`, ...entries].join(":");
}
