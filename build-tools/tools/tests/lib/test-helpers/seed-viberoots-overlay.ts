import * as fsp from "node:fs/promises";
import path from "node:path";
import { mkdtempNoindex } from "../../../lib/macos-metadata";
import { isGeneratedRepoStateRelPath } from "../../../dev/verify/generated-state-excludes";
import { PREPARED_SEED_MARKER } from "./seed-store-config";

function parseGitStatusRel(line: string): { rel: string; deleted: boolean } | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  const raw = line.slice(3).trim();
  const renameSep = raw.indexOf(" -> ");
  const rel = (renameSep >= 0 ? raw.slice(renameSep + 4) : raw).trim();
  if (!rel || rel.startsWith(".git/") || rel === ".git") return null;
  return { rel, deleted: status.includes("D") };
}

async function listActiveSourceOverlayFiles(
  source: string,
): Promise<{ changed: string[]; deleted: string[] }> {
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
    if (!entry || isGeneratedRepoStateRelPath(entry.rel)) continue;
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

async function activeViberootsSource(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(cwd, "viberoots"),
    cwd,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const [hasFlake, hasTool] = await Promise.all([
      fsp
        .access(path.join(root, "flake.nix"))
        .then(() => true)
        .catch(() => false),
      fsp
        .access(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))
        .then(() => true)
        .catch(() => false),
    ]);
    if (hasFlake && hasTool) return root;
  }
  return "";
}

export async function overlayActiveViberootsIntoTempRepo(tmpDir: string): Promise<string[]> {
  const prepared = await fsp
    .access(path.join(tmpDir, PREPARED_SEED_MARKER))
    .then(() => true)
    .catch(() => false);
  if (prepared) return [];
  const source = await activeViberootsSource();
  if (!source) return [];
  const tmpViberoots = path.join(tmpDir, "viberoots");
  const overlay = await listActiveSourceOverlayFiles(source);
  const touched = [...overlay.changed, ...overlay.deleted].map((rel) =>
    path.join("viberoots", rel),
  );
  for (const rel of overlay.deleted) {
    await fsp.rm(path.join(tmpViberoots, rel), { recursive: true, force: true });
  }
  if (overlay.changed.length === 0) return touched;
  const fileList = await mkdtempNoindex(".seed-viberoots-overlay-", {
    baseName: ".seed-viberoots-overlay",
    tmpBase: tmpDir,
  });
  const listPath = path.join(fileList, "files.txt");
  await fsp.writeFile(listPath, overlay.changed.join("\n") + "\n", "utf8");
  try {
    await $({ cwd: source })`rsync -a --relative --files-from ${listPath} ./ ${tmpViberoots}/`;
  } finally {
    await fsp.rm(fileList, { recursive: true, force: true }).catch(() => {});
  }
  return touched;
}
