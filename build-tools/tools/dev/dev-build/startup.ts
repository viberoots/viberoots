import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function tryRootNodeModulesOutFromMarker(root: string): Promise<string> {
  const markerPath = path.join(root, "buck-out", "tmp", "node-modules-link.root.json");
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

async function resolveRootNodeModulesOut(root: string): Promise<string> {
  const markerOut = await tryRootNodeModulesOutFromMarker(root);
  if (markerOut) return markerOut;
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

export async function runStartupCheck(root: string): Promise<void> {
  const rootNmOut = await resolveRootNodeModulesOut(root);
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
  await $({
    stdio: "inherit",
    cwd: root,
    env: envStartup,
  })`zx-wrapper build-tools/tools/dev/startup-check.ts`;
}
