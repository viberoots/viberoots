#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  defaultUpdateOperations,
  runUpdateCommand,
  type UpdateOperations,
} from "../../dev/update-command/run";
import { repairRustDependencies } from "../../dev/install/cargo";
import { repairGoDependencies } from "../../dev/update-command/languages";
import { reconcileWorkspaceGlobalNixInputTargets } from "../../dev/install/glue";
import { generatedGlobalInputMarker } from "../../lib/global-nix-input-targets";

test("combined production transaction restores files, modes, source link, and created metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vbr-update-combined-"));
  const app = path.join(root, "projects/apps/combined");
  const originals = new Map<string, string>([
    ["flake.lock", "flake-before\n"],
    [".viberoots/workspace/flake.lock", "workspace-flake-before\n"],
    [".viberoots/workspace/flake.nix", "{ inputs = {}; }\n"],
    [
      ".viberoots/workspace/nixpkgs-source-registry-extension.nix",
      "{ inputs }: { profiles = {}; }\n",
    ],
    [".viberoots/workspace/toolchain-paths.json", '{"root":"before"}\n'],
    [
      ".viberoots/workspace/toolchains/toolchain_paths.bzl",
      'NIX_ARTIFACT_TOOLS_ROOT = "/nix/store/before"\n',
    ],
    [".viberoots/workspace/toolchains/extra.json", '{"before":true}\n'],
    [".viberoots/workspace/toolchains/nested/keep.txt", "nested-before\n"],
    ["toolchains/toolchain_paths.bzl", 'NIX_ARTIFACT_TOOLS_ROOT = "/nix/store/legacy"\n'],
    ["projects/TARGETS", `# ${generatedGlobalInputMarker}\nlegacy generated target\n`],
    ["projects/config/node-modules.hashes.json", "{}\n"],
    ["projects/apps/combined/package.json", '{"name":"combined"}\n'],
    ["projects/apps/combined/pnpm-lock.yaml", "pnpm-before\n"],
    [
      "projects/apps/combined/uv.lock",
      'version = 1\nrevision = 3\nrequires-python = ">=3.8"\n\n[[package]]\nname = "combined"\nversion = "0.1.0"\nsource = { virtual = "." }\n',
    ],
    [
      "projects/apps/combined/Cargo.lock",
      'version = 3\n\n[[package]]\nname = "combined"\nversion = "0.1.0"\n',
    ],
  ]);
  try {
    await fs.mkdir(app, { recursive: true });
    await fs.mkdir(path.join(root, ".viberoots/workspace/toolchains"), { recursive: true });
    await fs.mkdir(path.join(root, ".viberoots/workspace/toolchains/nested"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, ".nix-gcroots"), { recursive: true });
    await fs.mkdir(path.join(root, "projects/config"), { recursive: true });
    await fs.mkdir(path.join(root, "toolchains"), { recursive: true });
    await fs.mkdir(path.join(root, "source-before"), { recursive: true });
    await fs.mkdir(path.join(root, "source-after"), { recursive: true });
    await fs.symlink("../source-before", path.join(root, ".viberoots/current"));
    await fs.symlink(
      "/nix/store/00000000000000000000000000000000-artifact-tools-before",
      path.join(root, ".nix-gcroots/artifact-tools"),
    );
    await fs.writeFile(
      path.join(app, "pyproject.toml"),
      "[project]\nname='combined'\nversion='0.1.0'\n",
    );
    await fs.writeFile(
      path.join(app, "Cargo.toml"),
      "[package]\nname='combined'\nversion='0.1.0'\nedition='2021'\n",
    );
    await fs.mkdir(path.join(app, "src"));
    await fs.writeFile(path.join(app, "src/lib.rs"), "pub fn answer() -> u8 { 42 }\n");
    await fs.writeFile(path.join(app, "go.mod"), "module example.com/combined\n");
    for (const [file, value] of originals) await fs.writeFile(path.join(root, file), value);
    await fs.chmod(path.join(app, "Cargo.lock"), 0o640);
    const artifactToolsRoot = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "").trim();
    assert.match(artifactToolsRoot, /^\/nix\/store\//);
    const toolDir = path.join(root, "transaction-tool-shims");
    await fs.mkdir(toolDir);
    for (const tool of ["go", "python3"]) {
      const executable = path.join(toolDir, tool);
      await fs.writeFile(executable, "#!/bin/sh\nexit 0\n");
      await fs.chmod(executable, 0o755);
    }
    const operations: UpdateOperations = {
      repairToolchainAuthority: async () => {
        await fs.rm(path.join(root, ".nix-gcroots/artifact-tools"));
        await fs.symlink(artifactToolsRoot, path.join(root, ".nix-gcroots/artifact-tools"));
        await fs.symlink(
          artifactToolsRoot,
          path.join(root, ".nix-gcroots/.artifact-tools.candidate"),
        );
        await fs.writeFile(path.join(root, ".viberoots/workspace/toolchain-paths.json"), "{}\n");
        await fs.writeFile(
          path.join(root, ".viberoots/workspace/toolchains/toolchain_paths.bzl"),
          "mutated-before-handler\n",
        );
        await fs.rm(path.join(root, ".viberoots/workspace/toolchains/extra.json"));
        await fs.writeFile(
          path.join(root, ".viberoots/workspace/toolchains/nested/keep.txt"),
          "nested-mutated\n",
        );
        await fs.mkdir(path.join(root, ".viberoots/workspace/toolchains/created"));
        await fs.writeFile(
          path.join(root, ".viberoots/workspace/toolchains/created/new.txt"),
          "created-before-handler\n",
        );
        return {
          artifactToolsRoot,
          goBin: path.join(toolDir, "go"),
          pythonBin: path.join(toolDir, "python3"),
          viberootsSource: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
        };
      },
      validateTransactionTools: () => {},
      importers: async () => ["projects/apps/combined"],
      repairPnpmLock: async () =>
        await fs.writeFile(path.join(app, "pnpm-lock.yaml"), "pnpm-mutated\n"),
      upgradePnpm: async () => {},
      reconcilePnpm: async () => {},
      enabledLanguages: async () => ["go", "python", "rust"],
      languageUpdates: {
        go: async (workspace, verbose, upgrade) =>
          await repairGoDependencies(workspace, verbose, upgrade, path.join(toolDir, "go")),
        python: defaultUpdateOperations.languageUpdates.python,
        cpp: async () => 0,
        rust: async (workspace, verbose, upgrade) =>
          await repairRustDependencies(
            workspace,
            verbose,
            upgrade,
            path.join(artifactToolsRoot, "bin/cargo"),
          ),
      },
      repairWorkspaceLock: async () => {
        await fs.writeFile(path.join(root, "flake.lock"), "flake-mutated\n");
        await fs.rm(path.join(root, ".viberoots/current"));
        await fs.symlink("../source-after", path.join(root, ".viberoots/current"));
      },
      repairGeneratedMetadata: async () => {
        await reconcileWorkspaceGlobalNixInputTargets("", root);
        await assert.rejects(fs.access(path.join(root, "projects/TARGETS")));
        await fs.writeFile(path.join(root, ".viberoots/workspace/toolchain-paths.json"), "{}\n");
        await fs.writeFile(
          path.join(root, ".viberoots/workspace/toolchains/toolchain_paths.bzl"),
          "mutated\n",
        );
        await fs.writeFile(path.join(root, "toolchains/toolchain_paths.bzl"), "mutated\n");
        await fs.writeFile(path.join(app, "gomod2nix.toml"), "created-gomod2nix\n");
        throw new Error("later metadata repair failed");
      },
    };
    await assert.rejects(
      runUpdateCommand({ root, upgrade: false, verbose: false, operations }),
      /later metadata repair failed/,
    );
    for (const [file, value] of originals) {
      assert.equal(await fs.readFile(path.join(root, file), "utf8"), value);
    }
    assert.equal((await fs.stat(path.join(app, "Cargo.lock"))).mode & 0o777, 0o640);
    assert.equal(await fs.readlink(path.join(root, ".viberoots/current")), "../source-before");
    assert.equal(
      await fs.readlink(path.join(root, ".nix-gcroots/artifact-tools")),
      "/nix/store/00000000000000000000000000000000-artifact-tools-before",
    );
    await assert.rejects(fs.access(path.join(root, ".nix-gcroots/.artifact-tools.candidate")));
    await assert.rejects(
      fs.access(path.join(root, ".viberoots/workspace/toolchains/created/new.txt")),
    );
    await assert.rejects(fs.access(path.join(app, "go.sum")));
    await assert.rejects(fs.access(path.join(app, "gomod2nix.toml")));
    await assert.rejects(fs.access(path.join(root, "projects/config/cargo-fixed-sources.json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("combined Rust Pyodide update reconciliation stays transactional with Python metadata", async () => {
  const source = await fs.readFile(
    new URL("../../dev/update-command/run.ts", import.meta.url),
    "utf8",
  );
  const fixture = await fs.readFile(
    new URL("./update-command-combined-rollback.test.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /projectLanguageSurfaces/);
  assert.match(source, /operations\.languageUpdates\[surface\.id\]/);
  assert.match(source, /withFileRollback/);
  assert.match(source, /repairGeneratedMetadata/);
  assert.match(fixture, /projects\/apps\/combined\/uv\.lock/);
  assert.match(fixture, /projects\/apps\/combined\/Cargo\.lock/);
  assert.match(fixture, /source-before/);
  assert.match(fixture, /source-after/);
  assert.match(fixture, /gomod2nix\.toml/);
});
