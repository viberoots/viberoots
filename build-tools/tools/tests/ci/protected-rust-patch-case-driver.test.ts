#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  protectedRustPatchCaseDefinitions,
  protectedRustPatchCaseIds,
} from "../../ci/protected-rust-patch-case-driver";
import { ARTIFACT_REPRODUCIBILITY_MATRIX } from "../../lib/artifact-reproducibility-matrix";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { prepareProtectedTauriPnpmAuthority } from "../../ci/protected-tauri-pnpm-authority";
import { materializeProtectedRustDependency } from "../../ci/protected-rust-dependency-authority";
import { assertRemoteCiToolsSourceIdentity } from "../../ci/remote-ci-tools-source-identity";

test("protected patch cases are the complete production Rust matrix for each system", () => {
  for (const system of ["x86_64-linux", "aarch64-linux", "aarch64-darwin"]) {
    const expected = ARTIFACT_REPRODUCIBILITY_MATRIX.filter(
      (entry) => entry.artifactFamily === "rust" && entry.systems.includes(system),
    );
    const definitions = protectedRustPatchCaseDefinitions(system);
    assert.deepEqual(
      definitions.map(({ id }) => id),
      expected.map(({ id }) => id),
    );
    assert.deepEqual(
      protectedRustPatchCaseIds(system),
      expected.map(({ id }) => id),
    );
    for (const [index, definition] of definitions.entries()) {
      assert.equal(definition.matrixCase, expected[index]);
      assert.match(definition.cargoRoot, /^projects\//u);
      assert.match(definition.targetsFile, /TARGETS$/u);
    }
  }
  const pyodide = protectedRustPatchCaseDefinitions("aarch64-darwin").find(
    ({ id }) => id === "rust-pyodide-extension-pr14",
  )!;
  assert.equal(pyodide.targetName, "repro-rust-pyodide-ext");
  assert.equal(
    pyodide.matrixCase.graphSelection.target,
    "//projects/apps/repro-rust-pyodide:repro-rust-pyodide",
  );
});

test("protected patch driver uses production workflow, immutable bundles, and observed store bytes", () => {
  const driverSource = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/ci/protected-rust-patch-case-driver.ts"),
    "utf8",
  );
  const source = [
    "protected-rust-patch-case-driver.ts",
    "protected-rust-patch-consumer.ts",
    "protected-rust-patch-phase.ts",
    "protected-rust-patch-pyodide-phase.ts",
    "protected-rust-patch-workflow.ts",
  ]
    .map((name) => fs.readFileSync(viberootsSourcePath(`build-tools/tools/ci/${name}`), "utf8"))
    .join("\n");
  assert.match(source, /withArtifactReproducibilityTempConsumer/u);
  assert.match(source, /rustPatchHandler\.start/u);
  assert.match(source, /rustPatchHandler\.apply/u);
  assert.match(source, /rustPatchHandler\.remove/u);
  assert.match(source, /resolveArtifactReproducibilityMatrixBinding/u);
  assert.match(source, /graph-generator-selected/u);
  assert.match(source, /readArtifactSemanticManifest/u);
  assert.match(source, /observed-behavior/u);
  assert.match(driverSource, /Pick<ActiveReviewedRemoteNix, "runNix" \| "runWithRemoteStore">/u);
  assert.match(source, /runWithRemoteStore/u);
  assert.match(source, /bin", "run\.mjs"/u);
  assert.match(
    source,
    /definition\.id === "rust-pyodide-extension-pr14"[\s\S]*\? \[\][\s\S]*: \["behavior_probe = True,"\]/u,
  );
  assert.match(source, /evaluationBundleDigest/u);
  assert.match(source, /patchDigest/u);
  assert.doesNotMatch(source, /behavior:\s*expectedBehavior|replaceExact|runCommand|localSource/u);
  assert.match(source, /protected Rust CI forbids test fixed-source authority/u);
});

test("protected dependency requires identical immutable local and reviewed store authority", async () => {
  const ownerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-authority-"));
  const storePath = `/nix/store/${"a".repeat(32)}-viberoots-protected-behavior`;
  const narHash = `sha256-${"A".repeat(43)}=`;
  const local = async (args: string[]) => ({
    stdout: args[0] === "store" ? `${storePath}\n` : `${narHash}\n`,
    stderr: "",
  });
  try {
    const authority = await materializeProtectedRustDependency({
      ownerRoot,
      artifactToolsRoot: `/nix/store/${"b".repeat(32)}-remote-ci-tools`,
      localRunNix: local,
      active: {
        runNix: async (args) => ({
          stdout:
            args[0] === "path-info"
              ? JSON.stringify({ [storePath]: { narHash } })
              : args[0] === "hash"
                ? `${narHash}\n`
                : "",
          stderr: "",
        }),
      },
    });
    assert.equal(authority.storePath, storePath);
    assert.equal(authority.narHash, narHash);
    await assert.rejects(
      materializeProtectedRustDependency({
        ownerRoot,
        artifactToolsRoot: `/nix/store/${"b".repeat(32)}-remote-ci-tools`,
        localRunNix: local,
        active: {
          runNix: async (args) => ({
            stdout:
              args[0] === "path-info"
                ? JSON.stringify({
                    [`/nix/store/${"c".repeat(32)}-wrong-protected-source`]: {},
                  })
                : "",
            stderr: "",
          }),
        },
      }),
      /differs|reviewed remote dependency/u,
    );
  } finally {
    await fsp.rm(ownerRoot, { recursive: true, force: true });
  }
});

test("remote CI tools closure rejects a stale frozen-checkout revision", () => {
  assert.throws(
    () =>
      assertRemoteCiToolsSourceIdentity(
        {
          schema: "viberoots.remote-ci-tools-source-identity.v2",
          toolSourceRevision: "a".repeat(40),
          sourceTreeDigest: `sha256-${"A".repeat(43)}=`,
          sourceStorePath: `/nix/store/${"b".repeat(32)}-source`,
        },
        "c".repeat(40),
      ),
    /does not match the frozen checkout/u,
  );
});

test("production temp consumer pins the reviewed lock without update or refresh commands", () => {
  const source = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/ci/artifact-reproducibility-temp-consumer.ts"),
    "utf8",
  );
  assert.match(source, /"--no-lock"/u);
  assert.match(source, /immutableSource, "flake\.lock"/u);
  assert.doesNotMatch(source, /flake", "update"|flake update|"--refresh"/u);
});

test("Darwin Tauri production scaffold and runtime matrix bind every desktop dependency", () => {
  const target = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/scaffolding/templates/rust/tauri-app/TARGETS.jinja"),
    "utf8",
  );
  for (const surface of [
    "node_webapp(",
    "node_asset_stage(",
    "rust_wasm_library(",
    "tauri_app(",
    "nix_cpp_binary(",
  ]) {
    assert.match(target, new RegExp(surface.replace("(", "\\("), "u"));
  }
  assert.match(target, /assets = \[\{"src": ":frontend_wasm"/u);
  assert.match(target, /frontend_dist = ":frontend"/u);
  const matrix = ARTIFACT_REPRODUCIBILITY_MATRIX.find(({ id }) => id === "rust-tauri-darwin-pr12")!;
  assert.deepEqual(
    matrix.languageProofs.map(({ target: proofTarget }) => proofTarget),
    [
      "//projects/apps/repro-rust-tauri:frontend_raw",
      "//projects/apps/repro-rust-tauri:frontend",
      "//projects/apps/repro-rust-tauri:frontend_wasm",
      "//projects/apps/repro-rust-tauri:repro-rust-tauri-sidecar",
    ],
  );
});

test("local-daemon integration rejects garbage-collected derivations from Nix's eval cache", () => {
  const fixture = fs.readFileSync(
    viberootsSourcePath(
      "build-tools/tools/tests/ci/protected-rust-patch-local-daemon.integration.fixture.ts",
    ),
    "utf8",
  );
  assert.match(fixture, /"--option",\s*"eval-cache",\s*"false"/u);
});

test("Tauri pnpm authority uploads the exact update result to an empty reviewed store", async () => {
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-tauri-pnpm-contract-"));
  const storePath = `/nix/store/${"a".repeat(32)}-pnpm-store-lock-${"b".repeat(64)}`;
  const calls: string[][] = [];
  try {
    const gcRootDirectory = path.join(workspaceRoot, ".nix-gcroots");
    const pnpmGcRoot = path.join(gcRootDirectory, "pnpm-store.projects-apps-repro-rust-tauri");
    const unrelatedGcRoot = path.join(gcRootDirectory, "artifact-tools");
    await fsp.mkdir(gcRootDirectory, { recursive: true });
    await fsp.symlink(storePath, pnpmGcRoot);
    await fsp.symlink(`/nix/store/${"d".repeat(32)}-artifact-tools`, unrelatedGcRoot);
    const result = await prepareProtectedTauriPnpmAuthority({
      workspaceRoot,
      artifactToolsRoot: `/nix/store/${"c".repeat(32)}-remote-ci-tools`,
      updateRunner: async (args) => {
        calls.push(args);
        return args.includes("--materialize-committed")
          ? `pnpm-store: materialized from committed metadata at ${storePath}`
          : "pnpm-store: reconciled";
      },
      active: {
        runNix: async (args) => {
          calls.push(args);
          if (args[0] === "copy") return { stdout: "", stderr: "" };
          return { stdout: JSON.stringify({ [storePath]: { valid: true } }), stderr: "" };
        },
      },
    });
    assert.equal(result.storePath, storePath);
    assert.deepEqual(calls, [
      ["--lockfile", "projects/apps/repro-rust-tauri/pnpm-lock.yaml"],
      ["--materialize-committed", "--lockfile", "projects/apps/repro-rust-tauri/pnpm-lock.yaml"],
      ["copy", "--from", "daemon", storePath],
      ["path-info", "--json", storePath],
    ]);
    await assert.rejects(fsp.lstat(pnpmGcRoot));
    assert((await fsp.lstat(unrelatedGcRoot)).isSymbolicLink());
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  }
});
