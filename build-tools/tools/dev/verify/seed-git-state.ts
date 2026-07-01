import crypto from "node:crypto";
import "zx/globals";

async function gitOutput(root: string, cmd: string[]): Promise<string> {
  const res = await $({ cwd: root, stdio: "pipe", reject: false })`${cmd}`.quiet();
  if (res.exitCode !== 0) throw new Error(`verify seed: git ${cmd.join(" ")} failed`);
  return String(res.stdout || "").trimEnd();
}

async function gitOutputMaybe(root: string, cmd: string[]): Promise<string | null> {
  const res = await $({ cwd: root, stdio: "pipe", reject: false, nothrow: true })`${cmd}`.quiet();
  if (res.exitCode !== 0) return null;
  return String(res.stdout || "").trimEnd();
}

export async function computeGitState(root: string): Promise<{
  head: string;
  statusEntries: string[];
  diffHash: string;
  diffCachedHash: string;
}> {
  const head = (await gitOutputMaybe(root, ["git", "rev-parse", "--verify", "HEAD"])) || "UNBORN";
  const statusRaw = await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`git status --porcelain=v1 -z`;
  if (statusRaw.exitCode !== 0) {
    throw new Error("verify seed: git status --porcelain=v1 -z failed");
  }
  const status = String(statusRaw.stdout || "");
  const statusEntries = status ? status.split("\0").filter(Boolean) : [];
  let diffHash = "";
  let diffCachedHash = "";
  if (statusEntries.length > 0) {
    const diff = await gitOutputMaybe(root, ["git", "diff", "--no-ext-diff", "--binary"]);
    if (diff !== null) {
      diffHash = crypto.createHash("sha256").update(diff).digest("hex");
    }
    const diffCached = await gitOutputMaybe(root, [
      "git",
      "diff",
      "--cached",
      "--no-ext-diff",
      "--binary",
    ]);
    if (diffCached !== null) {
      diffCachedHash = crypto.createHash("sha256").update(diffCached).digest("hex");
    }
  }
  return { head, statusEntries, diffHash, diffCachedHash };
}
