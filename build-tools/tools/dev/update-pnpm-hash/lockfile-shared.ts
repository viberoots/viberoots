import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { workspaceFlakeRef } from "../install/common";

export function preferredPnpmStoreDir(defaultStoreDir: string): {
  storeDir: string;
  usesSharedPrefetch: boolean;
} {
  const localPrefetch = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (localPrefetch) {
    return { storeDir: localPrefetch, usesSharedPrefetch: true };
  }
  return { storeDir: defaultStoreDir, usesSharedPrefetch: false };
}

function pnpmWorkspaceMarker(packages: string[]): string {
  const packageLines = Array.from(new Set(["./", ...packages]))
    .sort()
    .map((pkg) => `  - ${pkg}`);
  return [
    "packages:",
    ...packageLines,
    "supportedArchitectures:",
    "  os:",
    "    - darwin",
    "    - linux",
    "    - win32",
    "  cpu:",
    "    - x64",
    "    - arm64",
    "    - arm",
    "  libc:",
    "    - glibc",
    "    - musl",
    "",
  ].join("\n");
}

export function narrowedPnpmWorkspaceMarker(source: string): string {
  const lines = source.split(/\r?\n/);
  const preserved: string[] = [];
  const skipped = new Set(["packages", "supportedArchitectures"]);
  for (let index = 0; index < lines.length; ) {
    const line = lines[index] || "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1] || "";
    const start = index;
    index += 1;
    while (index < lines.length && !/^[A-Za-z0-9_.-]+:(?:\s|$)/.test(lines[index] || "")) {
      index += 1;
    }
    if (!skipped.has(key)) preserved.push(...lines.slice(start, index));
  }
  return [
    "packages:",
    "  - ./",
    ...preserved,
    pnpmWorkspaceMarker([]).split("\n").slice(2).join("\n"),
  ]
    .join("\n")
    .replace(/\n+$/, "\n");
}

async function copyIfPresent(source: string, destination: string): Promise<void> {
  try {
    await fsp.copyFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function nearestWorkspaceMarker(importerAbs: string, repoRoot: string): Promise<string> {
  let current = importerAbs;
  const boundary = path.resolve(repoRoot);
  while (current === boundary || current.startsWith(`${boundary}${path.sep}`)) {
    const candidate = path.join(current, "pnpm-workspace.yaml");
    try {
      return await fsp.readFile(candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current === boundary) break;
    current = path.dirname(current);
  }
  return "";
}

export async function prepareTemporaryPnpmFetchImporter(opts: {
  repoRoot: string;
  importer: string;
  importerAbs: string;
  tempRoot: string;
}): Promise<string> {
  const normalizedImporter = opts.importer === "." ? "" : opts.importer;
  const tempWorkspaceRoot = path.join(opts.tempRoot, "importer-source");
  const tempImporterAbs = path.join(tempWorkspaceRoot, normalizedImporter);
  await fsp.mkdir(tempImporterAbs, { recursive: true });

  await copyIfPresent(path.join(opts.repoRoot, ".npmrc"), path.join(tempWorkspaceRoot, ".npmrc"));
  if (path.resolve(opts.importerAbs) !== path.resolve(opts.repoRoot)) {
    await copyIfPresent(
      path.join(opts.importerAbs, ".npmrc"),
      path.join(tempImporterAbs, ".npmrc"),
    );
  }
  await fsp.copyFile(
    path.join(opts.importerAbs, "pnpm-lock.yaml"),
    path.join(tempImporterAbs, "pnpm-lock.yaml"),
  );

  const packageJson = path.join(opts.importerAbs, "package.json");
  try {
    const parsed = JSON.parse(await fsp.readFile(packageJson, "utf8")) as Record<string, unknown>;
    delete parsed.packageManager;
    await fsp.writeFile(
      path.join(tempImporterAbs, "package.json"),
      JSON.stringify(parsed, null, 2) + "\n",
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const workspaceSource = await nearestWorkspaceMarker(opts.importerAbs, opts.repoRoot);
  await fsp.writeFile(
    path.join(tempImporterAbs, "pnpm-workspace.yaml"),
    narrowedPnpmWorkspaceMarker(workspaceSource),
    "utf8",
  );
  return tempImporterAbs;
}

export function pnpmFlakeRef(repoRoot: string): string {
  // Keep path: so newly scaffolded/untracked files are visible to flake evaluation.
  return `${workspaceFlakeRef(repoRoot)}#pnpm`;
}

export async function ensureLocalWorkspaceMarker(
  importerAbs: string,
  packages: string[] = [],
): Promise<{
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}> {
  const workspaceFileAbs = path.join(importerAbs, "pnpm-workspace.yaml");
  const hadLocalWorkspaceFile = fs.existsSync(workspaceFileAbs);
  try {
    if (!hadLocalWorkspaceFile) {
      await fsp.mkdir(importerAbs, { recursive: true });
      await fsp.writeFile(workspaceFileAbs, pnpmWorkspaceMarker(packages), "utf8");
    }
  } catch {}
  return { workspaceFileAbs, hadLocalWorkspaceFile };
}

export async function cleanupLocalWorkspaceMarker(opts: {
  workspaceFileAbs: string;
  hadLocalWorkspaceFile: boolean;
}) {
  try {
    if (!opts.hadLocalWorkspaceFile && fs.existsSync(opts.workspaceFileAbs)) {
      await fsp.rm(opts.workspaceFileAbs).catch(() => {});
    }
  } catch {}
}
