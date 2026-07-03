import * as crypto from "node:crypto";
import { runNodeWithZx } from "../../lib/node-run";
import { buildToolPath } from "../dev-build/paths";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function zxTestNodeModulesImporter(root: string): Promise<string> {
  try {
    await Promise.all([
      fsp.access(path.join(root, ".viberoots", "current", "build-tools")),
      fsp.access(path.join(root, "viberoots", "pnpm-lock.yaml")),
    ]);
    return "viberoots";
  } catch {}
  try {
    await fsp.access(path.join(root, "pnpm-lock.yaml"));
    return ".";
  } catch {}
  try {
    await fsp.access(path.join(root, "viberoots", "pnpm-lock.yaml"));
    return "viberoots";
  } catch {}
  return ".";
}

async function linkedNodeModulesOut(root: string, importer: string): Promise<string> {
  const lockRel = importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
  const markerKey =
    importer === "." ? "root" : importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  try {
    const [lockBuf, markerRaw] = await Promise.all([
      fsp.readFile(path.join(root, lockRel)),
      fsp.readFile(
        path.join(
          root,
          ".viberoots",
          "workspace",
          "buck",
          "tmp",
          `node-modules-link.${markerKey}.json`,
        ),
        "utf8",
      ),
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
      marker.importer !== importer ||
      marker.lockfile !== lockRel ||
      marker.lockHash !== lockHash ||
      !outPath.startsWith("/nix/store/")
    ) {
      return "";
    }
    await fsp.access(path.join(outPath, "node_modules"));
    return outPath;
  } catch {
    return "";
  }
}

export async function computeZxTestNodeModulesOut(
  root: string,
  zxInitPath: string,
): Promise<string> {
  const importer = await zxTestNodeModulesImporter(root);
  if (importer === ".") {
    try {
      await fsp.access(path.join(root, "pnpm-lock.yaml"));
    } catch {
      return "";
    }
  }
  const linkedOut = await linkedNodeModulesOut(root, importer);
  if (linkedOut) return linkedOut;
  const { stdout } = await runNodeWithZx({
    cwd: root,
    script: buildToolPath(root, "tools/dev/node-modules-build.ts"),
    args: ["--print-out-paths", "--importer", importer],
    zxInitPath,
    stdio: "pipe",
    env: {
      ...process.env,
      REPO_ROOT: root,
      WORKSPACE_ROOT: root,
    },
  });
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || ""
  );
}
