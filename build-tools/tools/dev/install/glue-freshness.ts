import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  prebuildFingerprintFresh,
  writePrebuildFingerprint,
  type FingerprintFreshness,
} from "../../buck/prebuild/fingerprint";
import { listFreshnessOutputs, listOutputs } from "../../buck/prebuild/scan";
import { buildToolPath } from "../dev-build/paths";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import {
  discoverPrebuildInputs,
  isPrebuildInputRelPath,
} from "../../buck/prebuild/input-discovery";

const execFileAsync = promisify(execFile);

async function enclosingGitlinksHaveCommittedAuthority(
  git: string,
  repo: string,
): Promise<boolean> {
  let childRepo = repo;
  for (;;) {
    let parentRepo: string;
    try {
      const { stdout } = await execFileAsync(git, [
        "-C",
        path.dirname(childRepo),
        "rev-parse",
        "--show-toplevel",
      ]);
      parentRepo = String(stdout).trim();
    } catch {
      return true;
    }
    if (!parentRepo || parentRepo === childRepo) return true;
    const rel = path.relative(parentRepo, childRepo).replace(/\\/g, "/");
    if (!rel || rel === ".." || rel.startsWith("../")) return false;
    try {
      const { stdout } = await execFileAsync(git, [
        "-C",
        parentRepo,
        "ls-files",
        "--stage",
        "--",
        rel,
      ]);
      const exactGitlink = String(stdout)
        .trimEnd()
        .split("\n")
        .some((line) => line.startsWith("160000 ") && line.endsWith(`\t${rel}`));
      if (!exactGitlink) return false;
      await execFileAsync(git, ["-C", parentRepo, "diff", "--quiet", "HEAD", "--", rel]);
    } catch {
      return false;
    }
    childRepo = parentRepo;
  }
}

export function glueFreshnessOutputs(workspaceRoot: string): string[] {
  return [
    ...listFreshnessOutputs(listOutputs()),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "lang/importer_roots.bzl")),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "tools/nix/langs.nix")),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "lang/nix_attr_aliases.bzl")),
  ].map((p) => p.replace(/\\/g, "/"));
}

export async function glueFingerprintFresh(workspaceRoot: string): Promise<FingerprintFreshness> {
  const freshness = await prebuildFingerprintFresh({
    root: workspaceRoot,
    outputs: glueFreshnessOutputs(workspaceRoot),
  });
  if (
    !freshness.fresh &&
    (freshness.reason === "missing-or-invalid-fingerprint" || freshness.reason === "missing-output")
  ) {
    const committedOutputs = glueFreshnessOutputs(workspaceRoot).filter(
      (rel) => rel !== ".viberoots" && !rel.startsWith(".viberoots/"),
    );
    if (!(await glueBaselineHasCommittedAuthority(workspaceRoot, committedOutputs))) {
      return { fresh: false, reason: "uncommitted-or-deleted-baseline" };
    }
  }
  return freshness;
}

export async function writeGlueFingerprint(workspaceRoot: string): Promise<void> {
  await writePrebuildFingerprint({
    root: workspaceRoot,
    outputs: glueFreshnessOutputs(workspaceRoot),
  });
}

export async function glueBaselineHasCommittedAuthority(
  workspaceRoot: string,
  requiredOutputs: string[],
): Promise<boolean> {
  const git = ensureNixStoreToolPathSync("git");
  const inputs = await discoverPrebuildInputs(workspaceRoot);
  const repos = new Set<string>();
  try {
    const { stdout } = await execFileAsync(git, [
      "-C",
      workspaceRoot,
      "rev-parse",
      "--show-toplevel",
    ]);
    repos.add(String(stdout).trim());
  } catch {}
  for (const candidate of [...inputs, ...requiredOutputs]) {
    const lexical = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
    const file = await fsp.realpath(lexical).catch(() => lexical);
    if (/^\/nix\/store\/[a-z0-9]{32}-/.test(file)) continue;
    try {
      const { stdout } = await execFileAsync(git, [
        "-C",
        path.dirname(file),
        "rev-parse",
        "--show-toplevel",
      ]);
      const repo = String(stdout).trim();
      repos.add(repo);
      const rel = path.relative(repo, file).replace(/\\/g, "/");
      if (!rel || rel.startsWith("../") || rel === "..") return false;
      await execFileAsync(git, ["-C", repo, "ls-files", "--error-unmatch", "--", rel]);
      await execFileAsync(git, ["-C", repo, "diff", "--quiet", "HEAD", "--", rel]);
      if (!(await enclosingGitlinksHaveCommittedAuthority(git, repo))) return false;
    } catch {
      return false;
    }
  }
  for (const repo of repos) {
    try {
      const { stdout } = await execFileAsync(git, [
        "-C",
        repo,
        "diff",
        "--name-only",
        "--diff-filter=D",
        "HEAD",
        "--",
      ]);
      for (const rel of String(stdout).split("\n").filter(Boolean)) {
        const workspaceRel = path.relative(workspaceRoot, path.join(repo, rel)).replace(/\\/g, "/");
        if (isPrebuildInputRelPath(workspaceRel)) return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
