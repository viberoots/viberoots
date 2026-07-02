import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getImporterRootsContract } from "../../lib/importer-roots";
import { findPnpmLockfiles } from "../../lib/lockfiles";

function isWorkspaceImporter(importer: string, workspaceRoots: readonly string[]): boolean {
  return workspaceRoots.some((base) => importer.startsWith(`${base}/`));
}

async function hasLock(root: string, importer: string): Promise<boolean> {
  try {
    await fsp.access(
      path.join(root, importer === "." ? "pnpm-lock.yaml" : importer, "pnpm-lock.yaml"),
    );
    return true;
  } catch {
    return false;
  }
}

async function nearestImporterFromCwd(root: string, cwd: string): Promise<string | null> {
  const rootAbs = path.resolve(root);
  let current = path.resolve(cwd);
  while (current === rootAbs || current.startsWith(`${rootAbs}${path.sep}`)) {
    const lockfile = path.join(current, "pnpm-lock.yaml");
    try {
      await fsp.access(lockfile);
      const rel = path.relative(rootAbs, current).replace(/\\/g, "/");
      return rel === "" ? "." : rel;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function trackedImporterCandidates(
  root: string,
  workspaceRoots: readonly string[],
): string[] | null {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const importers = new Set<string>();
  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const rel of lines) {
    if (rel === "pnpm-lock.yaml") {
      importers.add(".");
      continue;
    }
    if (!rel.endsWith("/pnpm-lock.yaml")) continue;
    const importer = rel.slice(0, -"pnpm-lock.yaml".length - 1);
    if (isWorkspaceImporter(importer, workspaceRoots)) {
      importers.add(importer);
    }
  }
  return [...importers].sort((left, right) => left.localeCompare(right));
}

async function workspaceImporterCandidates(
  root: string,
  workspaceRoots: readonly string[],
): Promise<string[]> {
  const importers = new Set<string>();
  const lockfiles = await findPnpmLockfiles({ baseRoot: root, roots: [...workspaceRoots] });
  for (const lockfile of lockfiles) {
    if (!lockfile.endsWith("/pnpm-lock.yaml")) continue;
    const importer = lockfile.slice(0, -"pnpm-lock.yaml".length - 1);
    if (isWorkspaceImporter(importer, workspaceRoots)) {
      importers.add(importer);
    }
  }
  return [...importers].sort((left, right) => left.localeCompare(right));
}

export async function discoverImportersWithLock(
  root: string,
  opts?: { cwd?: string },
): Promise<string[]> {
  const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
  const tracked = trackedImporterCandidates(root, workspaceRoots);
  const out = new Set<string>();
  if (tracked) {
    for (const importer of tracked) {
      if (importer === "." && !allowDotImporter) continue;
      if (!(await hasLock(root, importer))) continue;
      out.add(importer);
    }
    for (const importer of await workspaceImporterCandidates(root, workspaceRoots)) {
      if (await hasLock(root, importer)) out.add(importer);
    }
    if (!out.has(".") && (await hasLock(root, "viberoots"))) {
      out.add("viberoots");
    }
  } else {
    if (allowDotImporter) {
      try {
        await fsp.access(path.join(root, "pnpm-lock.yaml"));
        out.add(".");
      } catch {}
    }
    for (const base of workspaceRoots) {
      const baseAbs = path.join(root, base);
      try {
        const entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
        for (const d of entries) {
          const p = path.join(baseAbs, d);
          try {
            const st = await fsp.stat(p);
            if (!st.isDirectory()) continue;
            try {
              await fsp.access(path.join(p, "pnpm-lock.yaml"));
              out.add(path.relative(root, p) || ".");
            } catch {}
          } catch {}
        }
      } catch {}
    }
  }

  const includeFromCwd = String(opts?.cwd || "").trim();
  if (includeFromCwd) {
    const importer = await nearestImporterFromCwd(root, includeFromCwd);
    if (
      importer &&
      (importer === "." ? allowDotImporter : isWorkspaceImporter(importer, workspaceRoots))
    ) {
      try {
        await fsp.access(
          path.join(root, importer === "." ? "pnpm-lock.yaml" : importer, "pnpm-lock.yaml"),
        );
      } catch {
        return [...out].sort((left, right) => left.localeCompare(right));
      }
      out.add(importer);
    }
  }

  return [...out].sort((left, right) => left.localeCompare(right));
}

export async function sharedUnifiedStorePath(root: string): Promise<string> {
  try {
    const marker = path.join(root, ".viberoots", "workspace", "buck", "unified-pnpm-store", "path");
    const p = String(await fsp.readFile(marker, "utf8")).trim();
    if (!p) return "";
    await fsp.access(p);
    return p;
  } catch {
    return "";
  }
}
