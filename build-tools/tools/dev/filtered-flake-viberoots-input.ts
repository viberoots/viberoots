import * as fsp from "node:fs/promises";
import path from "node:path";
import { envWithResolvedNixBin, resolveToolPathSync } from "../lib/tool-paths";
import { runCommand } from "./filtered-flake-command";

export async function repairSnapshotViberootsInput(opts: {
  snapDir: string;
  flakeDir: string;
}): Promise<void> {
  const snapshotRoot = path.join(opts.snapDir, "viberoots");
  try {
    await fsp.access(path.join(snapshotRoot, "flake.nix"));
  } catch {
    return;
  }
  const localRoot = path.join(opts.flakeDir, "viberoots");
  if (path.resolve(localRoot) !== path.resolve(snapshotRoot)) {
    await fsp.rm(localRoot, { recursive: true, force: true }).catch(() => {});
    await runCommand({
      command: "rsync",
      args: [
        "-a",
        "--delete",
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        `${snapshotRoot}/`,
        `${localRoot}/`,
      ],
    });
  }
  await rewriteViberootsInput(opts.flakeDir, "./viberoots");
}

async function rewriteViberootsInput(flakeDir: string, inputPath: string): Promise<void> {
  const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(flakeDir, inputPath);
  const lockedInput = await lockPathInput(resolved);
  const originalPath = path.isAbsolute(inputPath) ? resolved : inputPath;
  const flakePath = path.join(flakeDir, "flake.nix");
  const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
  const next = text.replace(
    /(\bviberoots\.url\s*=\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"path:${inputPath}"`,
  );
  if (next !== text) await fsp.writeFile(flakePath, next, "utf8");
  const lockPath = path.join(flakeDir, "flake.lock");
  try {
    const lock = JSON.parse(await fsp.readFile(lockPath, "utf8")) as {
      nodes?: Record<string, Record<string, unknown>>;
    };
    const node = lock.nodes?.viberoots;
    if (node) {
      node.locked = { ...lockedInput, path: originalPath };
      node.original = { type: "path", path: originalPath };
      await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
  } catch {}
}

async function lockPathInput(inputPath: string): Promise<Record<string, unknown>> {
  const nixEnv = envWithResolvedNixBin(process.env);
  const nixBin = resolveToolPathSync("nix", nixEnv);
  const canonical = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await runCommand({
    command: nixBin,
    args: ["flake", "prefetch", "--json", `path:${canonical}`],
    env: nixEnv,
    allowFailure: true,
  });
  if (prefetched.exitCode === 0) {
    try {
      const locked = JSON.parse(String(prefetched.stdout || "{}"))?.locked || {};
      const narHash = typeof locked.narHash === "string" ? locked.narHash : "";
      if (/^sha256-[A-Za-z0-9+/=_-]+$/.test(narHash)) {
        return {
          ...(typeof locked.lastModified === "number" ? { lastModified: locked.lastModified } : {}),
          narHash,
          path: canonical,
          type: "path",
        };
      }
    } catch {}
  }
  const hashed = await runCommand({
    command: nixBin,
    args: ["hash", "path", "--sri", canonical],
    env: nixEnv,
  });
  const narHash = String(hashed.stdout || "").trim();
  if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(narHash)) {
    throw new Error(`[filtered-flake] failed to lock path input ${canonical}`);
  }
  return { narHash, path: canonical, type: "path" };
}
