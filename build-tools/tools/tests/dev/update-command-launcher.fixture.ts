import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { derivePostCloneWorkspaceLock } from "../../lib/post-clone-workspace-lock";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { workspaceFlakeInputs } from "../../lib/workspace-flake-inputs";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";
import { UPDATE_COMMAND_PROTECTED_PATHS } from "./update-command-launcher-protected-paths";

const execFileAsync = promisify(execFile);
let immutableSourcePromise: Promise<string> | undefined;

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
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-u-filtered-source-"));
    const filtered = path.join(tmp, "input");
    await fsp.mkdir(filtered);
    try {
      const consumerRoot = path.dirname(VIBEROOTS_SOURCE_ROOT);
      const rootLock = JSON.parse(
        await fsp.readFile(path.join(consumerRoot, "flake.lock"), "utf8"),
      );
      const nodeName = rootLock.nodes?.[rootLock.root]?.inputs?.viberoots;
      const locked = nodeName ? rootLock.nodes?.[nodeName]?.locked : undefined;
      const revision = String(locked?.rev || "");
      const expectedNarHash = String(locked?.narHash || "");
      if (
        !/^[a-f0-9]{40}$/.test(revision) ||
        !/^sha256-[A-Za-z0-9+/]{43}=$/.test(expectedNarHash)
      ) {
        throw new Error("launcher fixture requires a locked committed viberoots revision");
      }
      const archive = path.join(tmp, "source.tar");
      await execFileAsync(
        resolveToolPathSync("git", process.env),
        ["archive", "--format=tar", `--output=${archive}`, revision],
        { cwd: VIBEROOTS_SOURCE_ROOT },
      );
      await execFileAsync(resolveToolPathSync("tar", process.env), [
        "-xf",
        archive,
        "-C",
        filtered,
      ]);
      const env = buildCanonicalArtifactEnvironment(process.cwd(), {
        artifactToolsRoot: canonicalArtifactToolsRoot(
          process.cwd(),
          String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
        ),
      });
      const materialized = await materializeFilteredViberootsSource(filtered, env);
      if (materialized.locked.narHash !== expectedNarHash) {
        throw new Error("launcher fixture committed source does not match the root lock authority");
      }
      return materialized.storePath;
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
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

export async function runUpdateCommand(root: string, args: string[] = []) {
  const immutableSource = await immutableViberootsSource();
  const timeoutSecs = Number(
    process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200",
  );
  return await execFileAsync(path.join(VIBEROOTS_SOURCE_ROOT, "build-tools/tools/bin/u"), args, {
    cwd: root,
    env: {
      ...process.env,
      NO_DEV_SHELL: "1",
      WORKSPACE_ROOT: root,
      VIBEROOTS_SOURCE_ROOT: immutableSource,
      VIBEROOTS_FLAKE_INPUT_ROOT: immutableSource,
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
  const immutableSource = await immutableViberootsSource();
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
  });
  await fsp.writeFile(
    path.join(root, ".viberoots/workspace/flake.lock"),
    `${JSON.stringify(workspaceLock, null, 2)}\n`,
    "utf8",
  );
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
