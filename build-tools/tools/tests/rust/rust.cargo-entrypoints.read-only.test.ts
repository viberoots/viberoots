#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { installCanonicalArtifactToolsAuthority } from "../../lib/artifact-tool-authority";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInTemp } from "../lib/test-helpers/run-in-temp";
import { createFreshCloneFixture } from "../viberoots/fresh-clone-post-clone.fixture";
import {
  addStaleRustRoot,
  commitAll,
  expectStale,
  git,
  trackedState,
} from "./rust.cargo-entrypoints.read-only.fixture";

const execFileAsync = promisify(execFile);

test("real i, devshell entry, and b reject stale Cargo metadata without changing bytes", async () => {
  await runInTemp("rust-stale-entrypoints", async (root) => {
    await fsp.appendFile(
      path.join(root, ".git/info/exclude"),
      "\n.viberoots/\nviberoots/.viberoots/\n",
    );
    await git(root, [
      "rm",
      "-r",
      "--cached",
      "--ignore-unmatch",
      ".viberoots",
      "viberoots/.viberoots",
    ]);
    await fsp.rm(path.join(root, "viberoots/.viberoots"), { recursive: true, force: true });
    await fsp.appendFile(
      path.join(root, "viberoots/.git/info/exclude"),
      "\n.viberoots/\nprelude\n",
    );

    const bootstrap = path.join(root, "viberoots/bootstrap");
    const command = path.join(root, "viberoots/build-tools/tools/bin/viberoots");
    const fakeBin = path.join(root, ".test-bin");
    await fsp.mkdir(fakeBin, { recursive: true });
    for (const tool of ["xcode-select", "xcrun"]) {
      await fsp.writeFile(path.join(fakeBin, tool), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });
    }
    const artifactToolsRoot = canonicalArtifactToolsRoot(root);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      NO_DEV_SHELL: "1",
      VBR_RUN_INSTALL: "0",
      VBR_DIRENV_ALLOW: "0",
      VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
      VBR_GC_MODE: "off",
      WORKSPACE_ROOT: root,
    };
    delete env.VBR_BOOTSTRAP_PNPM_GENERATE;
    delete env.VBR_DEVSHELL_RECONCILE;
    delete env.VBR_INSTALL_REFRESH_PNPM_HASHES;
    const trackedLocks = (await git(root, ["ls-files", "*pnpm-lock.yaml"]))
      .trim()
      .split("\n")
      .filter(Boolean);
    await Promise.all(
      trackedLocks.map(async (lockfile) => await fsp.rm(path.join(root, lockfile))),
    );
    await execFileAsync(bootstrap, [], { cwd: root, env: { ...env, VBR_WORKSPACE_ROOT: root } });
    await commitAll(root, "test: initialized consumer baseline");
    const lock = await addStaleRustRoot(root, env, undefined, async () => {
      await execFileAsync(path.join(root, "viberoots/build-tools/tools/bin/u"), [], {
        cwd: root,
        env,
        maxBuffer: 16 * 1024 * 1024,
      });
    });
    const repairedArtifactToolsRoot = canonicalArtifactToolsRoot(root);
    env.VBR_ARTIFACT_TOOLS_ROOT = repairedArtifactToolsRoot;
    const entrypointEnv: NodeJS.ProcessEnv = {
      ...withoutArtifactEnvironmentInfluence(
        buildCanonicalArtifactEnvironment(root, {
          artifactToolsRoot: repairedArtifactToolsRoot,
        }),
      ),
      NO_DEV_SHELL: "1",
      VBR_DIRENV_ALLOW: "0",
      VBR_GC_MODE: "off",
      VBR_NIX_CACHE_POLICY: "off",
      VBR_RUN_INSTALL: "0",
    };
    const direnv = ensureNixStoreToolPathSync("direnv", {
      PATH: path.join(repairedArtifactToolsRoot, "bin"),
    });
    await execFileAsync(direnv, ["allow", "."], { cwd: root, env: entrypointEnv });
    const beforeLock = await fsp.readFile(lock);
    const beforeStatus = await trackedState(root);
    assert.equal(beforeStatus, "", await git(path.join(root, "viberoots"), ["status", "--short"]));

    const entrypoints: Array<[string, () => Promise<unknown>]> = [
      [
        "i",
        () =>
          execFileAsync(
            path.join(root, "viberoots/build-tools/tools/bin/i"),
            ["--without-secrets", "--skip-glue", "--skip-go-tidy"],
            { cwd: root, env },
          ),
      ],
      [
        "devshell entry",
        () =>
          execFileAsync(
            command,
            [
              "init-workspace",
              "--workspace-root",
              root,
              "--source",
              path.join(root, "viberoots"),
              "--shell-entry",
            ],
            { cwd: root, env },
          ),
      ],
      [
        "b",
        async () =>
          await execFileAsync(path.join(root, "viberoots/build-tools/tools/bin/b"), ["//..."], {
            cwd: root,
            env: entrypointEnv,
          }),
      ],
    ];
    for (const [label, run] of entrypoints) {
      await expectStale(label, run);
      assert.deepEqual(await fsp.readFile(lock), beforeLock);
      assert.equal(await trackedState(root), beforeStatus);
    }
  });
});

test("real fresh-clone post-clone rejects stale Cargo metadata without changing bytes", async (t) => {
  const fixture = await createFreshCloneFixture(t, {
    includeNodeImporter: false,
    sourceMode: "flake",
  });
  const cargo = ensureNixStoreToolPathSync("cargo", {
    PATH: path.join(String(fixture.commandEnv.VBR_ARTIFACT_TOOLS_ROOT), "bin"),
  });
  await addStaleRustRoot(fixture.consumerSource, fixture.commandEnv, cargo);
  const clone = await fixture.clone("stale-rust-clone");
  await installCanonicalArtifactToolsAuthority(
    clone,
    String(fixture.commandEnv.VBR_ARTIFACT_TOOLS_ROOT),
  );
  const lock = path.join(clone, "projects/apps/stale-rust/Cargo.lock");
  const beforeLock = await fsp.readFile(lock);
  const beforeStatus = await trackedState(clone);
  assert.equal(beforeStatus, "");
  await expectStale("post-clone", async () => await fixture.postClone(clone));
  assert.deepEqual(await fsp.readFile(lock), beforeLock);
  assert.equal(await trackedState(clone), beforeStatus);
});
