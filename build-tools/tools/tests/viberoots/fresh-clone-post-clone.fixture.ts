import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";
import { execManaged } from "../lib/test-helpers/managed-exec";
import { withGitAutoMaintenanceDisabledEnv } from "../../lib/git-auto-maintenance-env";
import { writeFreshCloneShims } from "./fresh-clone-post-clone-shims";

export const requiredTrackedInputs = [".buckroot", ".buckconfig", ".envrc", ".gitignore"] as const;

export async function git(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const { stdout } = await execManaged(env.VBR_REAL_GIT || "git", ["-C", root, ...args], {
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

export async function createFreshCloneFixture(
  t: TestContext,
  options: { sourceMode?: "flake" | "submodule" } = {},
) {
  const sourceMode = options.sourceMode || "submodule";
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
  await execManaged(
    "rsync",
    [
      "-a",
      "--chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r",
      "--exclude=.git",
      "--exclude=.direnv",
      "--exclude=.viberoots",
      "--exclude=buck-out",
      "--exclude=node_modules",
      `${sourceRoot}/`,
      `${submoduleSource}/`,
    ],
    { env: localGitEnv },
  );
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
  await fsp.mkdir(path.join(consumerSource, consumerImporter), { recursive: true });
  await fsp.writeFile(
    path.join(consumerSource, consumerImporter, "package.json"),
    `${JSON.stringify({ name: "fresh-clone-importer", private: true }, null, 2)}\n`,
  );
  await fsp.writeFile(
    path.join(consumerSource, consumerImporter, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n",
  );
  await fsp.writeFile(path.join(consumerSource, "projects", "node-modules.hashes.json"), "{}\n");
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
    execManaged(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        commandEnv.VBR_REAL_ZX_INIT!,
        commandEnv.VBR_REAL_COMMAND!,
        ...args,
      ],
      { cwd, env },
    );
  const sourceArgs =
    sourceMode === "submodule"
      ? [
          "--viberoots-url",
          `path:${path.join(consumerSource, "viberoots")}`,
          "--source",
          path.join(consumerSource, "viberoots"),
        ]
      : ["--viberoots-url", `git+https://github.com/viberoots/viberoots.git?rev=${submoduleRev}`];
  await runCommand(
    [
      "init-consumer",
      "--mode",
      sourceMode,
      "--workspace-root",
      consumerSource,
      "--workspace-name",
      "fresh-clone-fixture",
      ...sourceArgs,
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
    sourceMode,
    submoduleRev,
    runCommand,
    async clone(name: string) {
      const root = path.join(tmp, name);
      await execManaged(realGitPath, ["clone", "-q", "--recursive", consumerSource, root], {
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
      return execManaged("bash", [path.join(sourceRoot, "bootstrap"), "--workspace-root", root], {
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
      });
    },
  };
}
