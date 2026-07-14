import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";
import { withGitAutoMaintenanceDisabledEnv } from "../../lib/git-auto-maintenance-env";

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

async function writeShims(fakeBin: string): Promise<void> {
  await Promise.all([
    fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'nix %s\n' "$*" >> "$VBR_FAKE_NIX_LOG"
if [[ "\${1:-}" == "--version" ]]; then exit 0; fi
if [[ "\${1:-}" == "run" ]]; then
  while [[ "\${1:-}" != "--" ]]; do shift; done
  shift
  exec "$VBR_REAL_NODE" --experimental-strip-types --import "$VBR_REAL_ZX_INIT" "$VBR_REAL_COMMAND" "$@"
fi
if [[ "\${1:-}" == "flake" && "\${2:-}" == "metadata" ]]; then
  input_path="$PWD/.viberoots/workspace/viberoots-flake-input"
  printf '{"locks":{"nodes":{"root":{"inputs":{"viberoots":"viberoots"}},"viberoots":{"locked":{"path":"%s","type":"path"},"original":{"path":"%s","type":"path"}}},"root":"root","version":7}}\n' "$input_path" "$input_path"
  exit 0
fi
if [[ "\${1:-}" == "flake" && ("\${2:-}" == "lock" || "\${2:-}" == "update") ]]; then
  mkdir -p .viberoots/workspace
  override=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "viberoots" ]]; then override="$arg"; break; fi
    prev="$arg"
  done
  rev="\${override##*rev=}"
  if [[ ! "$rev" =~ ^[0-9a-fA-F]{40}$ ]]; then rev="$VBR_EXPECTED_REV"; fi
  printf '{"nodes":{"root":{"inputs":{"viberoots":"viberoots"}},"viberoots":{"locked":{"rev":"%s","type":"git","url":"https://github.com/viberoots/viberoots.git"},"original":{"rev":"%s","type":"git","url":"https://github.com/viberoots/viberoots.git"}}},"root":"root","version":7}\n' "$rev" "$rev" > .viberoots/workspace/flake.lock
  exit 0
fi
printf 'unexpected nix invocation: %s\n' "$*" >&2
exit 92
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "direnv"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then exit 0; fi
if [[ "\${1:-}" == "exec" && "\${3:-}" == "i" ]]; then
  exec "$VBR_REAL_NODE" --experimental-strip-types --import "$VBR_REAL_ZX_INIT" "$VBR_REAL_UPDATE_PNPM" --lockfile "$VBR_STALE_PNPM_LOCK" --read-only
fi
printf 'unexpected direnv invocation: %s\n' "$*" >&2
exit 93
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "repo-proof" && "$*" == "rev-parse --show-toplevel" ]]; then exit 91; fi
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "status" && "$*" == *"status --short --untracked-files=normal --ignored=no" ]]; then exit 92; fi
exec "$VBR_REAL_GIT" "$@"
`,
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "xcode-select"),
      '#!/usr/bin/env bash\nif [[ "${1:-}" == "-p" ]]; then printf "/Applications/Xcode.app/Contents/Developer\\n"; exit 0; fi\nexit 1\n',
      { mode: 0o755 },
    ),
    fsp.writeFile(
      path.join(fakeBin, "xcrun"),
      '#!/usr/bin/env bash\ncase "$*" in\n  "--find clang") printf "/usr/bin/clang\\n" ;;\n  "--sdk macosx --show-sdk-path") printf "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk\\n" ;;\n  *) exit 1 ;;\nesac\n',
      { mode: 0o755 },
    ),
  ]);
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
  await git(consumerSource, ["init", "-q", "--initial-branch=main"], localGitEnv);
  await git(
    consumerSource,
    ["submodule", "add", "-q", `file://${submoduleSource}`, "viberoots"],
    localGitEnv,
  );
  await writeShims(fakeBin);
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
    VBR_REAL_GIT: realGitPath,
    VBR_REAL_NODE: process.execPath,
    VBR_REAL_ZX_INIT: path.join(devToolsRoot, "zx-init.mjs"),
    VBR_REAL_COMMAND: path.join(devToolsRoot, "viberoots.ts"),
    VBR_REAL_UPDATE_PNPM: path.join(devToolsRoot, "update-pnpm-hash.ts"),
    VBR_STALE_PNPM_LOCK: "projects/apps/stale-pnpm/pnpm-lock.yaml",
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
    postClone(root: string, options: { failureMode?: string; runInstall?: boolean } = {}) {
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
          ...(options.failureMode ? { VBR_FAKE_GIT_FAILURE: options.failureMode } : {}),
        },
        maxBuffer: 1024 * 1024 * 16,
      });
    },
  };
}
