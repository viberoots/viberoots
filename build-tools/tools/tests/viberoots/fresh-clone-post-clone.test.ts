#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);
const requiredTrackedInputs = [".buckroot", ".buckconfig", ".envrc", ".gitignore"] as const;

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

async function git(root: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env,
  });
  return String(stdout || "").trim();
}

async function commitAll(root: string, message: string, env: NodeJS.ProcessEnv) {
  await git(root, ["add", "."], env);
  await git(
    root,
    ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", message],
    env,
  );
}

async function runCommand(sourceRoot: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return await execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      path.join(sourceRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
      path.join(sourceRoot, "build-tools", "tools", "dev", "viberoots.ts"),
      ...args,
    ],
    { cwd, env, maxBuffer: 1024 * 1024 * 16 },
  );
}

async function writeNixShim(fakeBin: string): Promise<void> {
  await fsp.writeFile(
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
  );
}

async function writeDirenvShim(fakeBin: string): Promise<void> {
  await fsp.writeFile(
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
  );
}

async function writeGitShim(fakeBin: string): Promise<void> {
  await fsp.writeFile(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "repo-proof" && "$*" == "rev-parse --show-toplevel" ]]; then
  exit 91
fi
if [[ "\${VBR_FAKE_GIT_FAILURE:-}" == "status" && "$*" == *"status --short --untracked-files=normal --ignored=no" ]]; then
  exit 92
fi
exec "$VBR_REAL_GIT" "$@"
`,
    { mode: 0o755 },
  );
}

async function writeMacosDeveloperToolsShims(fakeBin: string): Promise<void> {
  await Promise.all([
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

test("fresh recursive clone runs real post-clone initialization without tracked mutation", async (t) => {
  const sourceRoot = VIBEROOTS_SOURCE_ROOT;
  const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-fresh-clone-")));
  const submoduleSource = path.join(tmp, "submodule-source");
  const consumerSource = path.join(tmp, "consumer-source");
  const clone = path.join(tmp, "clone");
  const staleClone = path.join(tmp, "stale-clone");
  const staleLegacyClone = path.join(tmp, "stale-legacy-clone");
  const stalePnpmClone = path.join(tmp, "stale-pnpm-clone");
  const mismatchedPinsClone = path.join(tmp, "mismatched-pins-clone");
  const failedRepoProofClone = path.join(tmp, "failed-repo-proof-clone");
  const failedStatusClone = path.join(tmp, "failed-status-clone");
  const fakeBin = path.join(tmp, "fake-bin");
  const nixLog = path.join(tmp, "nix.log");
  const realGitPath = await underlyingGitPath();
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));

  const localGitEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
  };
  await Promise.all([
    fsp.mkdir(submoduleSource, { recursive: true }),
    fsp.mkdir(consumerSource, { recursive: true }),
    fsp.mkdir(fakeBin, { recursive: true }),
  ]);
  await execFileAsync("git", ["checkout-index", "--all", `--prefix=${submoduleSource}/`], {
    cwd: sourceRoot,
  });
  await git(submoduleSource, ["init", "-q", "--initial-branch=main"], localGitEnv);
  await commitAll(submoduleSource, "fixture: staged viberoots source", localGitEnv);
  const submoduleRev = await git(submoduleSource, ["rev-parse", "HEAD"], localGitEnv);

  await git(consumerSource, ["init", "-q", "--initial-branch=main"], localGitEnv);
  await git(
    consumerSource,
    ["submodule", "add", "-q", `file://${submoduleSource}`, "viberoots"],
    localGitEnv,
  );
  await Promise.all([
    writeNixShim(fakeBin),
    writeDirenvShim(fakeBin),
    writeGitShim(fakeBin),
    writeMacosDeveloperToolsShims(fakeBin),
  ]);
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
    VBR_REAL_ZX_INIT: path.join(sourceRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
    VBR_REAL_COMMAND: path.join(sourceRoot, "build-tools", "tools", "dev", "viberoots.ts"),
    VBR_REAL_UPDATE_PNPM: path.join(
      sourceRoot,
      "build-tools",
      "tools",
      "dev",
      "update-pnpm-hash.ts",
    ),
    VBR_STALE_PNPM_LOCK: "projects/apps/stale-pnpm/pnpm-lock.yaml",
  };
  await runCommand(
    sourceRoot,
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
    commandEnv,
  );
  assert.equal(
    JSON.parse(await fsp.readFile(path.join(consumerSource, "flake.lock"), "utf8")).nodes.viberoots
      .locked.rev,
    submoduleRev,
  );
  await commitAll(consumerSource, "fixture: current consumer metadata", localGitEnv);

  await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, clone], {
    env: localGitEnv,
  });
  assert.equal(await git(path.join(clone, "viberoots"), ["rev-parse", "HEAD"]), submoduleRev);
  const { stdout } = await execFileAsync(
    "bash",
    [path.join(sourceRoot, "bootstrap"), "--workspace-root", clone],
    {
      cwd: clone,
      env: {
        ...commandEnv,
        WORKSPACE_ROOT: clone,
        VBR_POST_CLONE: "1",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        VBR_INSTALL_NIX: "0",
        VBR_TRUST_NIX_USER: "0",
        VIBEROOTS_TRUST_SUBMODULE_URL: "1",
      },
      maxBuffer: 1024 * 1024 * 16,
    },
  );

  assert.match(stdout, /status bootstrapped/);
  assert.match(stdout, /workspace initialized/);
  assert.equal(await fsp.readlink(path.join(clone, ".viberoots", "current")), "../viberoots");
  for (const rel of ["flake.nix", "flake.lock", "TARGETS"]) {
    await fsp.access(path.join(clone, ".viberoots", "workspace", rel));
  }
  const { stdout: statusText } = await runCommand(sourceRoot, ["status", "--json"], clone, {
    ...commandEnv,
    WORKSPACE_ROOT: clone,
  });
  assert.equal(JSON.parse(statusText).sourceMode, "local");
  assert.equal(await git(clone, ["diff", "--name-only"]), "");
  assert.equal(await git(clone, ["status", "--short"]), "");

  const canonicalTrackedInputs = new Map(
    await Promise.all(
      requiredTrackedInputs.map(
        async (rel) => [rel, await fsp.readFile(path.join(consumerSource, rel), "utf8")] as const,
      ),
    ),
  );
  await fsp.writeFile(path.join(consumerSource, ".envrc"), "stale generated envrc\n", "utf8");
  await commitAll(consumerSource, "fixture: stale generated metadata", localGitEnv);
  await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, staleClone], {
    env: localGitEnv,
  });
  const staleEnvrc = await fsp.readFile(path.join(staleClone, ".envrc"), "utf8");
  await assert.rejects(
    execFileAsync("bash", [path.join(sourceRoot, "bootstrap"), "--workspace-root", staleClone], {
      cwd: staleClone,
      env: {
        ...commandEnv,
        WORKSPACE_ROOT: staleClone,
        VBR_POST_CLONE: "1",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        VBR_INSTALL_NIX: "0",
        VBR_TRUST_NIX_USER: "0",
        VIBEROOTS_TRUST_SUBMODULE_URL: "1",
      },
      maxBuffer: 1024 * 1024 * 16,
    }),
    /post-clone found stale tracked generated file \.envrc[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.equal(await fsp.readFile(path.join(staleClone, ".envrc"), "utf8"), staleEnvrc);
  assert.equal(await git(staleClone, ["diff", "--name-only"]), "");
  assert.equal(await git(staleClone, ["status", "--short"]), "");
  await assert.rejects(fsp.lstat(path.join(staleClone, ".viberoots", "workspace", "backups")), {
    code: "ENOENT",
  });

  for (const [rel, content] of canonicalTrackedInputs) {
    await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
  }
  const staleLegacyBuckconfig = canonicalTrackedInputs
    .get(".buckconfig")!
    .replace("prelude = ./.viberoots/workspace/prelude", "prelude = ./.viberoots/current/prelude");
  assert.notEqual(staleLegacyBuckconfig, canonicalTrackedInputs.get(".buckconfig"));
  await fsp.writeFile(path.join(consumerSource, ".buckconfig"), staleLegacyBuckconfig, "utf8");
  await commitAll(consumerSource, "fixture: stale legacy buckconfig", localGitEnv);
  await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, staleLegacyClone], {
    env: localGitEnv,
  });
  const staleLegacyBefore = await fsp.readFile(path.join(staleLegacyClone, ".buckconfig"));
  await assert.rejects(
    execFileAsync(
      "bash",
      [path.join(sourceRoot, "bootstrap"), "--workspace-root", staleLegacyClone],
      {
        cwd: staleLegacyClone,
        env: {
          ...commandEnv,
          WORKSPACE_ROOT: staleLegacyClone,
          VBR_POST_CLONE: "1",
          VBR_RUN_INSTALL: "0",
          VBR_DIRENV_ALLOW: "0",
          VBR_INSTALL_NIX: "0",
          VBR_TRUST_NIX_USER: "0",
          VIBEROOTS_TRUST_SUBMODULE_URL: "1",
        },
        maxBuffer: 1024 * 1024 * 16,
      },
    ),
    /post-clone found stale tracked generated file \.buckconfig[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.deepEqual(
    await fsp.readFile(path.join(staleLegacyClone, ".buckconfig")),
    staleLegacyBefore,
  );
  assert.equal(await git(staleLegacyClone, ["diff", "--name-only"]), "");
  assert.equal(await git(staleLegacyClone, ["status", "--short"]), "");

  for (const [rel, content] of canonicalTrackedInputs) {
    await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
  }
  const stalePnpmRoot = path.join(consumerSource, "projects", "apps", "stale-pnpm");
  await fsp.mkdir(stalePnpmRoot, { recursive: true });
  await fsp.writeFile(
    path.join(stalePnpmRoot, "package.json"),
    `${JSON.stringify({ name: "stale-pnpm", private: true, dependencies: { "left-pad": "1.3.0" } }, null, 2)}\n`,
    "utf8",
  );
  await fsp.writeFile(
    path.join(stalePnpmRoot, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
    "utf8",
  );
  await commitAll(consumerSource, "fixture: stale pnpm importer metadata", localGitEnv);
  await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, stalePnpmClone], {
    env: localGitEnv,
  });
  const stalePackageBefore = await fsp.readFile(
    path.join(stalePnpmClone, "projects", "apps", "stale-pnpm", "package.json"),
  );
  const staleLockBefore = await fsp.readFile(
    path.join(stalePnpmClone, "projects", "apps", "stale-pnpm", "pnpm-lock.yaml"),
  );
  await assert.rejects(
    execFileAsync(
      "bash",
      [path.join(sourceRoot, "bootstrap"), "--workspace-root", stalePnpmClone],
      {
        cwd: stalePnpmClone,
        env: {
          ...commandEnv,
          WORKSPACE_ROOT: stalePnpmClone,
          VBR_POST_CLONE: "1",
          VBR_RUN_INSTALL: "1",
          VBR_DIRENV_ALLOW: "0",
          VBR_INSTALL_NIX: "0",
          VBR_TRUST_NIX_USER: "0",
          VIBEROOTS_TRUST_SUBMODULE_URL: "1",
        },
        maxBuffer: 1024 * 1024 * 16,
      },
    ),
    /tracked metadata is stale: projects\/apps\/stale-pnpm\/pnpm-lock\.yaml[\s\S]*no tracked files were modified[\s\S]*repair: run u/,
  );
  assert.deepEqual(
    await fsp.readFile(path.join(stalePnpmClone, "projects", "apps", "stale-pnpm", "package.json")),
    stalePackageBefore,
  );
  assert.deepEqual(
    await fsp.readFile(
      path.join(stalePnpmClone, "projects", "apps", "stale-pnpm", "pnpm-lock.yaml"),
    ),
    staleLockBefore,
  );
  assert.equal(await git(stalePnpmClone, ["diff", "--name-only"]), "");
  assert.equal(await git(stalePnpmClone, ["status", "--short"]), "");

  const mismatchedRev = "89abcdef0123456789abcdef0123456789abcdef";
  const mismatchedLock = JSON.parse(
    await fsp.readFile(path.join(consumerSource, "flake.lock"), "utf8"),
  );
  mismatchedLock.nodes.viberoots.locked.rev = mismatchedRev;
  await fsp.writeFile(
    path.join(consumerSource, "flake.lock"),
    `${JSON.stringify(mismatchedLock, null, 2)}\n`,
    "utf8",
  );
  await commitAll(consumerSource, "fixture: mismatched root pins", localGitEnv);
  await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, mismatchedPinsClone], {
    env: localGitEnv,
  });
  const mismatchedLockBefore = await fsp.readFile(path.join(mismatchedPinsClone, "flake.lock"));
  await assert.rejects(
    execFileAsync(
      "bash",
      [path.join(sourceRoot, "bootstrap"), "--workspace-root", mismatchedPinsClone],
      {
        cwd: mismatchedPinsClone,
        env: {
          ...commandEnv,
          WORKSPACE_ROOT: mismatchedPinsClone,
          VBR_POST_CLONE: "1",
          VBR_RUN_INSTALL: "0",
          VBR_DIRENV_ALLOW: "0",
          VBR_INSTALL_NIX: "0",
          VBR_TRUST_NIX_USER: "0",
          VIBEROOTS_TRUST_SUBMODULE_URL: "1",
        },
        maxBuffer: 1024 * 1024 * 16,
      },
    ),
    /post-clone found mismatched viberoots pins[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.deepEqual(
    await fsp.readFile(path.join(mismatchedPinsClone, "flake.lock")),
    mismatchedLockBefore,
  );
  assert.equal(await git(mismatchedPinsClone, ["diff", "--name-only"]), "");
  assert.equal(await git(mismatchedPinsClone, ["status", "--short"]), "");

  mismatchedLock.nodes.viberoots.locked.rev = submoduleRev;
  await fsp.writeFile(
    path.join(consumerSource, "flake.lock"),
    `${JSON.stringify(mismatchedLock, null, 2)}\n`,
    "utf8",
  );
  for (const missingRel of requiredTrackedInputs) {
    for (const [rel, content] of canonicalTrackedInputs) {
      await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
    }
    await fsp.rm(path.join(consumerSource, missingRel));
    await git(
      consumerSource,
      ["add", "-A", "--", "flake.lock", ...requiredTrackedInputs],
      localGitEnv,
    );
    await git(
      consumerSource,
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        `fixture: missing tracked input ${missingRel}`,
      ],
      localGitEnv,
    );
    const missingInputClone = path.join(tmp, `missing-${missingRel.slice(1)}-clone`);
    await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, missingInputClone], {
      env: localGitEnv,
    });
    const beforeBytes = new Map(
      await Promise.all(
        requiredTrackedInputs.map(
          async (rel) =>
            [
              rel,
              await fsp.readFile(path.join(missingInputClone, rel)).catch(() => undefined),
            ] as const,
        ),
      ),
    );
    const statusBefore = await git(missingInputClone, ["status", "--short"]);
    await assert.rejects(
      execFileAsync(
        "bash",
        [path.join(sourceRoot, "bootstrap"), "--workspace-root", missingInputClone],
        {
          cwd: missingInputClone,
          env: {
            ...commandEnv,
            WORKSPACE_ROOT: missingInputClone,
            VBR_POST_CLONE: "1",
            VBR_RUN_INSTALL: "0",
            VBR_DIRENV_ALLOW: "0",
            VBR_INSTALL_NIX: "0",
            VBR_TRUST_NIX_USER: "0",
            VIBEROOTS_TRUST_SUBMODULE_URL: "1",
          },
          maxBuffer: 1024 * 1024 * 16,
        },
      ),
      new RegExp(
        `post-clone found stale tracked generated file ${missingRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*no tracked files were modified[\\s\\S]*repair: run viberoots update`,
      ),
    );
    for (const rel of requiredTrackedInputs) {
      assert.deepEqual(
        await fsp.readFile(path.join(missingInputClone, rel)).catch(() => undefined),
        beforeBytes.get(rel),
      );
    }
    await assert.rejects(fsp.access(path.join(missingInputClone, missingRel)), { code: "ENOENT" });
    assert.equal(await git(missingInputClone, ["diff", "--name-only"]), "");
    assert.equal(await git(missingInputClone, ["status", "--short"]), statusBefore);
  }

  for (const [rel, content] of canonicalTrackedInputs) {
    await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
  }
  await git(consumerSource, ["add", "-A", "--", ...requiredTrackedInputs], localGitEnv);
  await git(
    consumerSource,
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture: restore required tracked inputs",
    ],
    localGitEnv,
  );
  for (const [failureMode, failureClone, detail] of [
    ["repo-proof", failedRepoProofClone, "Git could not prove the workspace root"],
    ["status", failedStatusClone, "Git could not read workspace status"],
  ] as const) {
    await execFileAsync("git", ["clone", "-q", "--recursive", consumerSource, failureClone], {
      env: localGitEnv,
    });
    await assert.rejects(
      execFileAsync(
        "bash",
        [path.join(sourceRoot, "bootstrap"), "--workspace-root", failureClone],
        {
          cwd: failureClone,
          env: {
            ...commandEnv,
            WORKSPACE_ROOT: failureClone,
            VBR_POST_CLONE: "1",
            VBR_RUN_INSTALL: "0",
            VBR_DIRENV_ALLOW: "0",
            VBR_INSTALL_NIX: "0",
            VBR_TRUST_NIX_USER: "0",
            VIBEROOTS_TRUST_SUBMODULE_URL: "1",
            VBR_FAKE_GIT_FAILURE: failureMode,
          },
          maxBuffer: 1024 * 1024 * 16,
        },
      ),
      new RegExp(
        `post-clone could not verify workspace cleanliness[\\s\\S]*environment failure: ${detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*no tracked files were modified[\\s\\S]*repair: restore Git worktree access and rerun viberoots post-clone`,
      ),
    );
    assert.equal(await git(failureClone, ["diff", "--name-only"]), "");
    assert.equal(await git(failureClone, ["status", "--short"]), "");
  }
  assert.match(await fsp.readFile(nixLog, "utf8"), /nix run .*#viberoots -- init-consumer/);
});
