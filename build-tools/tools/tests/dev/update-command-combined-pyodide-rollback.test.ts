#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runUpdateCommand, type UpdateOperations } from "../../dev/update-command/run";

type FailureMode = "timeout" | "interruption" | "prior-lock-absence";

async function writeCombinedWorkspace(mode: FailureMode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `vbr-update-pyodide-${mode}-`));
  const app = path.join(root, "projects/apps/rust_pyodide_combined");
  await fs.mkdir(path.join(app, "src"), { recursive: true });
  await fs.mkdir(path.join(root, ".viberoots/workspace/toolchains"), { recursive: true });
  await fs.mkdir(path.join(root, ".nix-gcroots"), { recursive: true });
  await fs.mkdir(path.join(root, "source-before"), { recursive: true });
  await fs.mkdir(path.join(root, "source-after"), { recursive: true });
  await fs.symlink("../source-before", path.join(root, ".viberoots/current"));
  await fs.symlink(
    "/nix/store/00000000000000000000000000000000-artifact-tools-before",
    path.join(root, ".nix-gcroots/artifact-tools"),
  );
  await fs.writeFile(path.join(root, "flake.lock"), "flake-before\n");
  await fs.writeFile(path.join(root, ".viberoots/workspace/flake.lock"), "workspace-before\n");
  await fs.writeFile(path.join(root, ".viberoots/workspace/flake.nix"), "{ inputs = {}; }\n");
  await fs.writeFile(path.join(root, ".viberoots/workspace/toolchain-paths.json"), "{}\n");
  await fs.writeFile(
    path.join(root, ".viberoots/workspace/toolchains/toolchain_paths.bzl"),
    "before\n",
  );
  await fs.writeFile(
    path.join(app, "pyproject.toml"),
    "[project]\nname='rust-pyodide-combined'\nversion='0.1.0'\n",
  );
  await fs.writeFile(
    path.join(app, "Cargo.toml"),
    "[package]\nname='rust-pyodide-combined'\nversion='0.1.0'\nedition='2021'\n",
  );
  await fs.writeFile(path.join(app, "src/lib.rs"), "pub fn answer() -> u8 { 42 }\n");
  if (mode !== "prior-lock-absence") {
    await fs.writeFile(path.join(app, "uv.lock"), "uv-before\n");
    await fs.writeFile(path.join(app, "Cargo.lock"), "cargo-before\n");
  }
  return { root, app };
}

function operationsFor(
  root: string,
  app: string,
  mode: FailureMode,
  artifactToolsRoot: string,
): UpdateOperations {
  const fail = () =>
    mode === "timeout"
      ? new Error("combined Rust Pyodide update timed out")
      : mode === "interruption"
        ? new Error("combined Rust Pyodide update was interrupted")
        : new Error("combined Rust Pyodide metadata repair failed");
  return {
    repairToolchainAuthority: async () => {
      await fs.rm(path.join(root, ".nix-gcroots/artifact-tools"), { force: true });
      await fs.symlink(artifactToolsRoot, path.join(root, ".nix-gcroots/artifact-tools"));
      return {
        artifactToolsRoot,
        goBin: path.join(artifactToolsRoot, "bin/go"),
        pythonBin: path.join(artifactToolsRoot, "bin/python3"),
        viberootsSource: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
      };
    },
    validateTransactionTools: () => {},
    importers: async () => [],
    repairPnpmLock: async () => {},
    upgradePnpm: async () => {},
    reconcilePnpm: async () => {},
    enabledLanguages: async () => ["python", "rust"],
    languageUpdates: {
      go: async () => 0,
      cpp: async () => 0,
      python: async () => {
        await fs.writeFile(path.join(app, "uv.lock"), "uv-mutated\n");
        return 1;
      },
      rust: async () => {
        await fs.writeFile(path.join(app, "Cargo.lock"), "cargo-mutated\n");
        if (mode !== "prior-lock-absence") throw fail();
        return 1;
      },
    },
    repairWorkspaceLock: async () => {
      await fs.writeFile(path.join(root, "flake.lock"), "flake-mutated\n");
      await fs.rm(path.join(root, ".viberoots/current"));
      await fs.symlink("../source-after", path.join(root, ".viberoots/current"));
    },
    repairGeneratedMetadata: async () => {
      await fs.writeFile(path.join(root, ".viberoots/workspace/toolchain-paths.json"), "mutated\n");
      throw fail();
    },
  };
}

for (const mode of ["timeout", "interruption", "prior-lock-absence"] as const) {
  test(`combined Rust Pyodide update rolls back ${mode}`, async () => {
    const { root, app } = await writeCombinedWorkspace(mode);
    const artifactToolsRoot = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "").trim();
    assert.match(artifactToolsRoot, /^\/nix\/store\//);
    try {
      await assert.rejects(
        runUpdateCommand({
          root,
          upgrade: false,
          verbose: false,
          operations: operationsFor(root, app, mode, artifactToolsRoot),
        }),
        mode === "timeout" ? /timed out/ : mode === "interruption" ? /interrupted/ : /failed/,
      );
      assert.equal(await fs.readFile(path.join(root, "flake.lock"), "utf8"), "flake-before\n");
      assert.equal(await fs.readlink(path.join(root, ".viberoots/current")), "../source-before");
      if (mode === "prior-lock-absence") {
        await assert.rejects(fs.access(path.join(app, "uv.lock")));
        await assert.rejects(fs.access(path.join(app, "Cargo.lock")));
      } else {
        assert.equal(await fs.readFile(path.join(app, "uv.lock"), "utf8"), "uv-before\n");
        assert.equal(await fs.readFile(path.join(app, "Cargo.lock"), "utf8"), "cargo-before\n");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
