import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import { findRepoRoot } from "../../lib/repo";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";

let immutableInputPromise: Promise<string> | undefined;
const execFileAsync = promisify(execFile);

export async function immutableViberootsInput(viberootsRoot: string): Promise<string> {
  immutableInputPromise ??= (async () => {
    const artifactToolsRoot = canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    );
    const env = buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot });
    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: viberootsRoot,
      attr: "viberoots",
      logPrefix: "[registry-extension]",
      env,
      selectorEnv: {},
    });
    try {
      return (await materializeFilteredViberootsSource(filtered.workspaceRoot, env)).storePath;
    } finally {
      await filtered.cleanup();
    }
  })();
  return immutableInputPromise;
}

export async function findViberootsRoot(): Promise<string> {
  for (const candidate of [path.join(process.cwd(), "viberoots"), process.cwd()]) {
    try {
      await fsp.access(path.join(candidate, "build-tools", "tools", "bin", "viberoots"));
      return candidate;
    } catch {}
  }
  throw new Error("could not find viberoots root");
}

export async function seedWorkspaceLockFromCommittedAuthority(workspace: string): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--error-unmatch", "--", "flake.lock"],
    { cwd: repoRoot },
  );
  if (String(stdout).trim() !== "flake.lock") {
    throw new Error(`expected committed root flake.lock authority in ${repoRoot}`);
  }
  await fsp.copyFile(
    path.join(repoRoot, "flake.lock"),
    path.join(workspace, ".viberoots", "workspace", "flake.lock"),
  );
}

export async function writeFixtureFile(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}
