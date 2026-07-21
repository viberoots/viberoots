import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNodeWithZx } from "../../lib/node-run";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function tryNodeModulesOutFromMarker(root: string): Promise<string> {
  const markerPath = path.join(
    root,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    "node-modules-link.root.json",
  );
  const lockPath = path.join(root, "pnpm-lock.yaml");
  try {
    const [markerRaw, lockBuf] = await Promise.all([
      fsp.readFile(markerPath, "utf8"),
      fsp.readFile(lockPath),
    ]);
    const marker = JSON.parse(markerRaw) as {
      importer?: string;
      lockfile?: string;
      lockHash?: string;
      outPath?: string;
    };
    const lockHash = crypto.createHash("sha256").update(lockBuf).digest("hex");
    const outPath = String(marker.outPath || "").trim();
    if (
      marker.importer !== "." ||
      marker.lockfile !== "pnpm-lock.yaml" ||
      marker.lockHash !== lockHash ||
      !outPath
    ) {
      return "";
    }
    await fsp.access(path.join(outPath, "node_modules"));
    return outPath;
  } catch {
    return "";
  }
}

async function hasBrokenGitFile(root: string): Promise<boolean> {
  let raw = "";
  try {
    raw = await fsp.readFile(path.join(root, ".git"), "utf8");
  } catch {
    return false;
  }
  const match = raw.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!match) return false;
  return !(await pathExists(path.resolve(root, match[1]!)));
}

async function resolveNodeModulesOut(root: string): Promise<string> {
  const markerOut = await tryNodeModulesOutFromMarker(root);
  if (markerOut) return markerOut;
  if (await hasBrokenGitFile(root)) return "";
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: root,
    })`nix eval --raw .#node-modules.default.outPath --accept-flake-config`;
    const out = String(stdout || "").trim();
    if (out) return out;
  } catch {}
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: root,
    })`nix build .#node-modules.default --no-link --no-write-lock-file --accept-flake-config --print-out-paths`;
    return (
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || ""
    );
  } catch {}
  return "";
}

async function resolveToolingNodeModulesRoot(root: string): Promise<string> {
  if (await pathExists(path.join(root, "pnpm-lock.yaml"))) return root;
  for (const candidate of [
    path.join(root, ".viberoots", "current"),
    path.join(root, "viberoots"),
    root,
  ]) {
    if (
      (await pathExists(path.join(candidate, "pnpm-lock.yaml"))) &&
      (await pathExists(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return candidate;
    }
  }
  return root;
}

async function resolveStartupCheckEntrypoints(
  root: string,
): Promise<{ startupCheck: string; zxInit: string }> {
  const localBase = "build-tools/tools/dev";
  try {
    await fsp.access(path.join(root, localBase, "startup-check.ts"));
    return {
      startupCheck: path.join(root, localBase, "startup-check.ts"),
      zxInit: path.join(root, localBase, "zx-init.mjs"),
    };
  } catch {}
  const submoduleBase = ".viberoots/current/build-tools/tools/dev";
  return {
    startupCheck: path.join(root, submoduleBase, "startup-check.ts"),
    zxInit: path.join(root, submoduleBase, "zx-init.mjs"),
  };
}

export async function runStartupCheck(root: string): Promise<void> {
  const toolingNodeModulesRoot = await resolveToolingNodeModulesRoot(root);
  const rootNmOut = await resolveNodeModulesOut(toolingNodeModulesRoot);
  const { startupCheck, zxInit } = await resolveStartupCheckEntrypoints(root);
  const envStartup = {
    ...process.env,
    ...(rootNmOut
      ? {
          NODE_PATH: [path.join(rootNmOut, "node_modules"), process.env.NODE_PATH || ""]
            .filter(Boolean)
            .join(process.platform === "win32" ? ";" : ":"),
        }
      : {}),
  } as any;
  await runNodeWithZx({
    script: startupCheck,
    zxInitPath: zxInit,
    nodeBin: process.execPath,
    cwd: root,
    env: envStartup,
    stdio: "inherit",
  });
}
