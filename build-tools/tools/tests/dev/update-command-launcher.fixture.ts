import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { buckconfig } from "../../lib/consumer-bootstrap";
import { derivePostCloneWorkspaceLock } from "../../lib/post-clone-workspace-lock";
import { workspaceFlakeInputs } from "../../lib/workspace-flake-inputs";
import { sharedCargoFixedSourceCacheRoot } from "../../dev/install/cargo-fixed-source-cache";
import { sharedPnpmStoreHashCacheRoot } from "../../dev/update-pnpm-hash/verified-marker";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";
import { writeGlobalNixInputTargetFixtures } from "../lib/test-helpers/buck-config";
import { prepareFilteredViberootsInput } from "../lib/test-helpers/run-in-temp/filtered-inputs";
import { UPDATE_COMMAND_PROTECTED_PATHS } from "./update-command-launcher-protected-paths";

const execFileAsync = promisify(execFile);
let immutableSourcePromise: Promise<string> | undefined;
let immutableSourceNarHash = "";

function generatedWorkspaceFlake(immutableSource: string): string {
  return `{
${workspaceFlakeInputs(`path:${immutableSource}`)}

  outputs = inputs: inputs.viberoots.lib.mkWorkspace {
    workspaceSrc = ../..;
    viberootsInput = inputs.viberoots;
    workspaceName = "launcher-fixture";
  };
}
`;
}

async function immutableViberootsSource(): Promise<string> {
  immutableSourcePromise ||= (async () => {
    const materialized = await prepareFilteredViberootsInput(VIBEROOTS_SOURCE_ROOT);
    immutableSourceNarHash = materialized.locked.narHash;
    return materialized.storePath;
  })();
  return await immutableSourcePromise;
}

async function makeCheckoutWritable(root: string): Promise<void> {
  const stat = await fsp.lstat(root);
  if (stat.isSymbolicLink()) return;
  await fsp.chmod(root, stat.mode | (stat.isDirectory() ? 0o700 : 0o600));
  if (!stat.isDirectory()) return;
  for (const entry of await fsp.readdir(root)) {
    await makeCheckoutWritable(path.join(root, entry));
  }
}

export async function runUpdateCommand(
  root: string,
  args: string[] = [],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  const immutableSource = await immutableViberootsSource();
  const artifactToolsRoot = canonicalArtifactToolsRoot(
    root,
    String(envOverrides.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const artifactEnv = buildCanonicalArtifactEnvironment(root, { artifactToolsRoot });
  const timeoutSecs = Number(
    process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200",
  );
  // Every temp consumer must inherit the single canonical shared pnpm hash
  // authority so the launcher does not fall back to a fixture-local cache root
  // and recompute recursive timestamp normalization for every run.
  const sharedHashCacheRoot = sharedPnpmStoreHashCacheRoot(process.env, os.homedir());
  const sharedCargoCacheRoot = sharedCargoFixedSourceCacheRoot(process.env, os.homedir());
  return await execFileAsync(path.join(immutableSource, "build-tools/tools/bin/u"), args, {
    cwd: root,
    env: {
      ...withoutArtifactEnvironmentInfluence({ ...process.env, ...envOverrides }),
      ...artifactEnv,
      NO_DEV_SHELL: "1",
      WORKSPACE_ROOT: root,
      VIBEROOTS_SOURCE_ROOT: immutableSource,
      VIBEROOTS_FLAKE_INPUT_ROOT: immutableSource,
      VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT:
        String(envOverrides.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT || "").trim() ||
        sharedHashCacheRoot,
      VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT:
        String(envOverrides.VBR_SHARED_CARGO_FIXED_SOURCE_CACHE_ROOT || "").trim() ||
        sharedCargoCacheRoot,
    },
    timeout: timeoutSecs * 1000,
    maxBuffer: 1024 * 1024 * 32,
  });
}

export async function snapshotUpdateCommandFixture(root: string) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-s", "viberoots"], { cwd: root });
  return {
    gitlink: stdout.trim(),
    files: await Promise.all(
      UPDATE_COMMAND_PROTECTED_PATHS.map(
        async (rel) => [rel, await fsp.readFile(path.join(root, rel))] as const,
      ),
    ),
  };
}

export async function createUpdateCommandFixture(name: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `vbr-u-launcher-${name}-`));
  await fsp.mkdir(path.join(root, ".viberoots/bootstrap/transactions"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true });
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n");
  await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig("submodule"), "utf8");
  await fsp.writeFile(
    path.join(root, ".gitmodules"),
    '[submodule "viberoots"]\n\tpath = viberoots\n\turl = https://example.invalid/viberoots.git\n',
  );
  const consumerRoot = path.dirname(VIBEROOTS_SOURCE_ROOT);
  const prelude = await fsp.realpath(path.join(consumerRoot, ".viberoots/workspace/prelude"));
  if (!/^\/nix\/store\/[a-z0-9]{32}-/.test(prelude)) {
    throw new Error(`launcher fixture requires canonical Prelude authority: ${prelude}`);
  }
  await fsp.symlink(prelude, path.join(root, ".viberoots/workspace/prelude"));
  await fsp.copyFile(path.join(consumerRoot, "flake.nix"), path.join(root, "flake.nix"));
  await fsp.copyFile(path.join(consumerRoot, "flake.lock"), path.join(root, "flake.lock"));
  await fsp.copyFile(
    path.join(consumerRoot, ".viberoots/workspace/toolchain-paths.json"),
    path.join(root, ".viberoots/workspace/toolchain-paths.json"),
  );
  const immutableSource = await immutableViberootsSource();
  const rootLockPath = path.join(root, "flake.lock");
  const rootLock = JSON.parse(await fsp.readFile(rootLockPath, "utf8"));
  const viberootsNode = rootLock.nodes[rootLock.nodes[rootLock.root].inputs.viberoots];
  viberootsNode.locked = {
    narHash: immutableSourceNarHash,
    path: immutableSource,
    type: "path",
  };
  viberootsNode.original = { path: immutableSource, type: "path" };
  await fsp.writeFile(rootLockPath, `${JSON.stringify(rootLock, null, 2)}\n`, "utf8");
  await fsp.cp(immutableSource, path.join(root, "viberoots"), { recursive: true });
  await makeCheckoutWritable(path.join(root, "viberoots"));
  await fsp.symlink("../viberoots", path.join(root, ".viberoots/current"));
  await fsp.writeFile(
    path.join(root, ".viberoots/workspace/flake.nix"),
    generatedWorkspaceFlake(immutableSource),
    "utf8",
  );
  const rootLockText = await fsp.readFile(path.join(root, "flake.lock"), "utf8");
  const workspaceLock = derivePostCloneWorkspaceLock({
    rootLockText,
    workspaceFlakeDir: path.join(root, ".viberoots/workspace"),
    localInputPath: immutableSource,
    sourceLockText: await fsp.readFile(path.join(immutableSource, "flake.lock"), "utf8"),
  });
  await fsp.writeFile(
    path.join(root, ".viberoots/workspace/flake.lock"),
    `${JSON.stringify(workspaceLock, null, 2)}\n`,
    "utf8",
  );
  await fsp.mkdir(path.join(root, "projects/config"), { recursive: true });
  await fsp.writeFile(path.join(root, "projects/config/node-modules.hashes.json"), "{}\n");
  await fsp.writeFile(
    path.join(root, ".viberoots/workspace/nixpkgs-source-registry-extension.nix"),
    "{ inputs }: { profiles = { }; }\n",
  );
  await writeGlobalNixInputTargetFixtures(root);
  await fsp.writeFile(
    path.join(root, ".viberoots/bootstrap/transactions/source-mode.json"),
    '{"mode":"submodule","status":"completed"}\n',
  );
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync(
    "git",
    [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000,0123456789012345678901234567890123456789,viberoots",
    ],
    { cwd: root },
  );
  await execFileAsync("git", ["add", ...UPDATE_COMMAND_PROTECTED_PATHS], { cwd: root });
  return root;
}
