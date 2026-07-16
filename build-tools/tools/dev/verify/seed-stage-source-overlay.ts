import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { mkdtempNoindex } from "../../lib/macos-metadata";
import { isGeneratedRepoStateRelPath } from "./generated-state-excludes";

function parseGitStatusRel(line: string): { rel: string; deleted: boolean } | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const raw = line.slice(3).trim();
  if (!raw) return null;
  const renameSep = raw.indexOf(" -> ");
  const rel = (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
  if (!rel || rel.startsWith(".git/") || rel === ".git") return null;
  return { rel, deleted: status.includes("D") };
}

async function activeViberootsRoot(workspaceRoot: string): Promise<string> {
  const nested = path.join(workspaceRoot, "viberoots");
  const nestedOk = await fsp
    .access(path.join(nested, "build-tools", "tools", "dev", "zx-init.mjs"))
    .then(() => true)
    .catch(() => false);
  return nestedOk ? nested : workspaceRoot;
}

async function listActiveSourceOverlayFiles(source: string): Promise<{
  changed: string[];
  deleted: string[];
}> {
  const out = await $({
    stdio: "pipe",
    cwd: source,
  })`git status --porcelain=v1 --untracked-files=all`
    .nothrow()
    .quiet();
  if (out.exitCode !== 0) return { changed: [], deleted: [] };
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of String(out.stdout || "").split(/\r?\n/)) {
    const entry = parseGitStatusRel(line);
    if (!entry) continue;
    if (isGeneratedRepoStateRelPath(entry.rel)) continue;
    if (entry.deleted) deleted.push(entry.rel);
    else {
      const st = await fsp.lstat(path.join(source, entry.rel)).catch(() => null);
      if (st && !st.isDirectory()) changed.push(entry.rel);
    }
  }
  return {
    changed: Array.from(new Set(changed)).sort((a, b) => a.localeCompare(b)),
    deleted: Array.from(new Set(deleted)).sort((a, b) => a.localeCompare(b)),
  };
}

export async function overlayActiveViberootsIntoStage(
  stageDir: string,
  workspaceRoot: string,
): Promise<string[]> {
  const source = await activeViberootsRoot(workspaceRoot);
  const overlay = await listActiveSourceOverlayFiles(source);
  const touched = [...overlay.changed, ...overlay.deleted].map((rel) =>
    path.join("viberoots", rel),
  );
  const stageViberoots = path.join(stageDir, "viberoots");
  for (const rel of overlay.deleted) {
    await fsp.rm(path.join(stageViberoots, rel), { recursive: true, force: true });
  }
  if (overlay.changed.length > 0) {
    const fileList = await mkdtempNoindex(".seed-viberoots-overlay-", {
      baseName: ".seed-viberoots-overlay",
      tmpBase: stageDir,
    });
    const listPath = path.join(fileList, "files.txt");
    await fsp.writeFile(listPath, overlay.changed.join("\n") + "\n", "utf8");
    try {
      await $({ cwd: source })`rsync -a --relative --files-from ${listPath} ./ ${stageViberoots}/`;
    } finally {
      await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
    }
  }
  return touched;
}
