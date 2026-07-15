import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";
import { withGitAutoMaintenanceDisabledEnv } from "../../lib/git-auto-maintenance-env";
import { writeFreshCloneShims } from "./fresh-clone-post-clone-shims";

export const execFileAsync = promisify(execFile);
export const requiredTrackedInputs = [".buckroot", ".buckconfig", ".envrc", ".gitignore"] as const;

export async function git(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { stdout } = await execFileAsync(env.VBR_REAL_GIT || "git", ["-C", root, ...args], {
    encoding: "utf8",
    env,
  });
  return String(stdout || "").trim();
}

export async function commitAll(
  root: string,
  message: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await git(root, ["add", "."], env);
  await git(
    root,
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", message],
    env,
  );
}

async function underlyingGitPath(): Promise<string> {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(dir, "git");
    if (candidate.includes(`${path.sep}build-tools${path.sep}tools${path.sep}bin${path.sep}git`)) {
      continue;
    }
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("could not find an underlying Git binary for the fixture");
}

export async function createFreshCloneFixture(t: TestContext) {
  const sourceRoot = VIBEROOTS_SOURCE_ROOT;
  const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-fresh-clone-")));
  const submoduleSource = path.join(tmp, "submodule-source");
  const consumerSource = path.join(tmp, "consumer-source");
  const fakeBin = path.join(tmp, "fake-bin");
  const nixLog = path.join(tmp, "nix.log");
  const realGitPath = await underlyingGitPath();
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));
  const localGitEnv = withGitAutoMaintenanceDisabledEnv({
    ...process.env,
    VBR_REAL_GIT: realGitPath,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
  });
  await Promise.all(
    [submoduleSource, consumerSource, fakeBin].map((dir) => fsp.mkdir(dir, { recursive: true })),
  );
  await execFileAsync("rsync", [
    "-a",
    "--chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r",
    "--exclude=.git",
    "--exclude=.direnv",
    "--exclude=.viberoots",
    "--exclude=buck-out",
    "--exclude=node_modules",
    `${sourceRoot}/`,
    `${submoduleSource}/`,
  ]);
  await fsp.chmod(submoduleSource, 0o755);
  await git(submoduleSource, ["init", "-q", "--initial-branch=main"], localGitEnv);
  await commitAll(submoduleSource, "fixture: staged viberoots source", localGitEnv);
  const submoduleRev = await git(submoduleSource, ["rev-parse", "HEAD"], localGitEnv);
  const immutableSubmodule = await materializeFilteredViberootsSource(submoduleSource);
  await git(consumerSource, ["init", "-q", "--initial-branch=main"], localGitEnv);
  await git(
    consumerSource,
    ["submodule", "add", "-q", `file://${submoduleSource}`, "viberoots"],
    localGitEnv,
  );
  const consumerImporter = path.join("projects", "apps", "viberoots-site");
  const checkedInImporter = path.join(path.dirname(sourceRoot), consumerImporter);
  await fsp.mkdir(path.join(consumerSource, consumerImporter), { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml"]) {
    await fsp.copyFile(
      path.join(checkedInImporter, file),
      path.join(consumerSource, consumerImporter, file),
    );
  }
  await fsp.copyFile(
    path.join(path.dirname(sourceRoot), "projects", "node-modules.hashes.json"),
    path.join(consumerSource, "projects", "node-modules.hashes.json"),
  );
  await writeFreshCloneShims(fakeBin);
  const devToolsRoot = path.join(sourceRoot, "build-tools", "tools", "dev");
  const commandEnv = {
    ...localGitEnv,
    PATH: `${fakeBin}:${process.env.PATH || ""}`,
    NO_DEV_SHELL: "1",
    WORKSPACE_ROOT: consumerSource,
    VBR_NIX_BIN: path.join(fakeBin, "nix"),
    NIX_BIN: path.join(fakeBin, "nix"),
    VBR_FAKE_NIX_LOG: nixLog,
    VBR_EXPECTED_REV: submoduleRev,
    VBR_FAKE_PREFETCH_STORE: immutableSubmodule.storePath,
    VBR_FAKE_PREFETCH_NAR_HASH: String(immutableSubmodule.locked.narHash || ""),
    VBR_REAL_GIT: realGitPath,
    VBR_REAL_NODE: process.execPath,
    VBR_REAL_ZX_INIT: path.join(devToolsRoot, "zx-init.mjs"),
    VBR_REAL_COMMAND: path.join(devToolsRoot, "viberoots.ts"),
    VBR_REAL_UPDATE_PNPM: path.join(devToolsRoot, "update-pnpm-hash.ts"),
    VBR_STALE_PNPM_LOCK: "projects/apps/viberoots-site/pnpm-lock.yaml",
  };
  const runCommand = (args: string[], cwd: string, env: NodeJS.ProcessEnv = commandEnv) =>
    execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        commandEnv.VBR_REAL_ZX_INIT!,
        commandEnv.VBR_REAL_COMMAND!,
        ...args,
      ],
      { cwd, env, maxBuffer: 1024 * 1024 * 16 },
    );
  await runCommand(
    [
      "init-consumer",
      "--mode",
      "submodule",
      "--workspace-root",
      consumerSource,
      "--workspace-name",
      "fresh-clone-fixture",
      "--viberoots-url",
      `path:${path.join(consumerSource, "viberoots")}`,
      "--source",
      path.join(consumerSource, "viberoots"),
      "--no-direnv",
      "--setup-direnv",
      "never",
    ],
    consumerSource,
  );
  await commitAll(consumerSource, "fixture: current consumer metadata", localGitEnv);
  return {
    commandEnv,
    consumerSource,
    localGitEnv,
    nixLog,
    submoduleRev,
    runCommand,
    async clone(name: string) {
      const root = path.join(tmp, name);
      await execFileAsync(realGitPath, ["clone", "-q", "--recursive", consumerSource, root], {
        env: localGitEnv,
      });
      return root;
    },
    async cleanupClone(root: string) {
      const relative = path.relative(tmp, root);
      if (!relative || relative.startsWith("..") || path.dirname(relative) !== ".") {
        throw new Error(`refusing to clean clone outside fixture root: ${root}`);
      }
      if (["submodule-source", "consumer-source", "fake-bin"].includes(relative)) {
        throw new Error(`refusing to clean fixture authority as a clone: ${root}`);
      }
      await fsp.rm(root, { recursive: true, force: true });
    },
    postClone(
      root: string,
      options: { failureMode?: string; runInstall?: boolean; lockfile?: string } = {},
    ) {
      return execFileAsync("bash", [path.join(sourceRoot, "bootstrap"), "--workspace-root", root], {
        cwd: root,
        env: {
          ...commandEnv,
          WORKSPACE_ROOT: root,
          VBR_POST_CLONE: "1",
          VBR_RUN_INSTALL: options.runInstall ? "1" : "0",
          VBR_DIRENV_ALLOW: "0",
          VBR_INSTALL_NIX: "0",
          VBR_TRUST_NIX_USER: "0",
          VIBEROOTS_TRUST_SUBMODULE_URL: "1",
          VBR_FAIL_NETWORK_LOCK_RESOLUTION: "1",
          ...(options.lockfile ? { VBR_STALE_PNPM_LOCK: options.lockfile } : {}),
          ...(options.failureMode ? { VBR_FAKE_GIT_FAILURE: options.failureMode } : {}),
        },
        maxBuffer: 1024 * 1024 * 16,
      });
    },
  };
}
