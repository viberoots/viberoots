#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
  redactMaterializationManifest,
  renderMaterializationCommand,
} from "../../remote-exec/nix-store-materialize";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import {
  artifactToolsRoot,
  assertMaterializationRemotePolicy,
  manifest,
} from "./nix-store-materialize-test-fixture";

test("Nix store materialization manifest validates schema and store paths", () => {
  assert.deepEqual(parseMaterializationManifest(manifest), manifest);
  assert.deepEqual(
    parseMaterializationManifest({ ...manifest, substituter: { trustedPublicKeys: [] } })
      .substituter,
    { trustedPublicKeys: [] },
  );
  assert.throws(
    () => parseMaterializationManifest({ ...manifest, tools: { nix: "/usr/bin/nix" } }),
    /tools\.nix must be a \/nix\/store path/,
  );
  assert.throws(
    () =>
      parseMaterializationManifest({
        ...manifest,
        substituter: {
          endpointIdentity: "https://cache.example.invalid",
          trustedPublicKeys: [REVIEWED_PUBLIC_KEYS[0]],
        },
      }),
    /not a reviewed artifact cache/,
  );
  assert.throws(
    () => parseMaterializationManifest({ ...manifest, storePaths: [] }),
    /storePaths must list/,
  );
  assert.throws(
    () => parseMaterializationManifest({ ...manifest, sourceSnapshot: "./live-worktree" }),
    /sourceSnapshot must be a \/nix\/store path/,
  );
  assert.throws(
    () => parseMaterializationManifest({ ...manifest, flakeDir: "../workspace" }),
    /flakeDir must be a normalized relative path/,
  );
});

test("Nix store materialization redacts endpoint credentials and public key bodies", () => {
  const redacted = redactMaterializationManifest(manifest);
  assert.equal(redacted.substituter.endpointIdentity, REVIEWED_SUBSTITUTERS[0]);
  assert.match(redacted.substituter.trustedPublicKeys[0] || "", /:<redacted>$/);
});

test("Nix store materialization renders substituter copy commands without global config writes", () => {
  const command = renderMaterializationCommand(manifest, manifest.storePaths[0]!);
  assert.deepEqual(command.slice(0, 4), [
    `${artifactToolsRoot}/bin/nix`,
    "copy",
    "--from",
    REVIEWED_SUBSTITUTERS[0],
  ]);
  assert.ok(!command.includes("--builders"));
  assert.ok(!command.includes("--extra-substituters"));
});

test("Nix store materialization renders remote-safe build commands without a substituter", () => {
  const noSubstituter = {
    ...manifest,
    substituter: { endpointIdentity: "", trustedPublicKeys: [] },
  };
  const command = renderMaterializationCommand(noSubstituter, manifest.storePaths[1]!);
  assert.deepEqual(command.slice(0, 3), [
    `${artifactToolsRoot}/bin/nix`,
    "build",
    "/nix/store/source-snapshot#test-seed",
  ]);
  assert.ok(command.includes("--no-link"));
  assert.ok(command.includes("--print-out-paths"));
});

test("Nix store materialization addresses a reviewed flake subdirectory explicitly", () => {
  const noSubstituter = parseMaterializationManifest({
    ...manifest,
    flakeDir: "source/.viberoots/workspace",
    substituter: { trustedPublicKeys: [] },
  });
  const command = renderMaterializationCommand(noSubstituter, manifest.storePaths[2]!);
  assert.equal(
    command[2],
    "path:/nix/store/source-snapshot?dir=source/.viberoots/workspace#graph-generator-selected",
  );
});

test("Nix store materialization realizes no-substituter manifests through nix build", async () => {
  const noSubstituter = parseMaterializationManifest({
    ...manifest,
    substituter: { trustedPublicKeys: [] },
    storePaths: [manifest.storePaths[1]!],
  });
  const commands: string[][] = [];
  const reports = await materializeNixStorePaths({
    manifest: noSubstituter,
    artifactToolsRoot,
    runner: async (command) => {
      commands.push(command);
      return { stdout: "/nix/store/test-seed\n", stderr: "" };
    },
  });
  assert.equal(reports[0]?.cache, "miss");
  assert.deepEqual(commands[0]?.slice(0, 3), [
    `${artifactToolsRoot}/bin/nix`,
    "build",
    "/nix/store/source-snapshot#test-seed",
  ]);
});

test("Nix store materialization dry-run reports required remote worker and seed attrs", async () => {
  const reports = await materializeNixStorePaths({ manifest, artifactToolsRoot, dryRun: true });
  assert.deepEqual(
    reports.map((entry) => entry.attr),
    ["remote-worker-tools", "test-seed", "graph-generator-selected"],
  );
  assert.equal(
    reports.every((entry) => entry.cache === "dry-run"),
    true,
  );
  assert.equal(
    reports.every((entry) => !JSON.stringify(entry.command).includes("<redacted>@")),
    true,
  );
});

test("Nix store materialization rejects mismatched realized paths", async () => {
  await assert.rejects(
    materializeNixStorePaths({
      manifest,
      artifactToolsRoot,
      runner: async () => ({ stdout: "/nix/store/wrong-output\n", stderr: "" }),
    }),
    /expected \/nix\/store\/remote-worker-tools/,
  );
});

test("Nix store materialization rejects a manifest-selected Nix outside canonical authority", async () => {
  await assert.rejects(
    materializeNixStorePaths({
      manifest: {
        ...manifest,
        tools: { nix: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-host-nix" },
      },
      artifactToolsRoot,
      runner: async () => ({ stdout: "", stderr: "" }),
    }),
    /Nix authority is unavailable|does not match the canonical tool closure/,
  );
});

test("Nix store materialization uses bounded canonical command execution", () => {
  const source = fs.readFileSync(
    viberootsSourcePath("viberoots/build-tools/tools/remote-exec/nix-store-materialize.ts"),
    "utf8",
  );
  assert.match(source, /buildCanonicalArtifactEnvironment/);
  assert.match(source, /ensureNixStoreToolPathSync\("nix"/);
  assert.match(source, /artifactNixIndependentPolicyArgs/);
  assert.match(source, /runBoundedArtifactCommand/);
  assert.doesNotMatch(source, /from "node:child_process"|\bspawn\(/);
});

test("Nix store materialization verifies copied paths when nix copy prints no output", async () => {
  const commands: string[][] = [];
  const reports = await materializeNixStorePaths({
    manifest: { ...manifest, storePaths: [manifest.storePaths[0]!] },
    artifactToolsRoot,
    runner: async (command) => {
      commands.push(command);
      if (command.includes("path-info")) {
        return { stdout: "/nix/store/remote-worker-tools\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(reports[0]?.cache, "hit");
  assert.equal(commands.length, 2);
  assert.equal(commands[1]?.[0], `${artifactToolsRoot}/bin/nix`);
  assert.ok(commands[1]?.includes("path-info"));
  assert.equal(commands[1]?.at(-1), "/nix/store/remote-worker-tools");
});

test("Nix store materialization rejects copied paths that cannot be verified", async () => {
  await assert.rejects(
    materializeNixStorePaths({
      manifest: { ...manifest, storePaths: [manifest.storePaths[0]!] },
      artifactToolsRoot,
      runner: async (command) =>
        command.includes("path-info")
          ? { stdout: "/nix/store/other\n", stderr: "" }
          : { stdout: "", stderr: "" },
    }),
    /did not verify expected/,
  );
});

test("remote policy rejects undeclared Nix store references in remote-ready commands", () => {
  assertMaterializationRemotePolicy();
});

test("Starlark materialization helpers emit path labels consumed by policy parser", () => {
  const helper = fs.readFileSync(
    viberootsSourcePath("viberoots/build-tools/lang/nix_store_materialize.bzl"),
    "utf8",
  );
  const policy = fs.readFileSync(
    viberootsSourcePath("viberoots/build-tools/lang/remote_action_policy.bzl"),
    "utf8",
  );
  assert.match(helper, /materialization-manifest:path=%s/);
  assert.match(helper, /storePaths/);
  assert.match(policy, /materialization-manifest:path=%s/);
  assert.match(policy, /storePaths/);
});

test("materialization helper CLI reads manifest files for dry-run", async () => {
  const file = `${process.cwd()}/buck-out/tmp/nix-store-materialize-test.json`;
  fs.mkdirSync("buck-out/tmp", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest), "utf8");
  const result = await $({
    stdio: "pipe",
  })`zx-wrapper ${viberootsSourcePath("build-tools/tools/remote-exec/nix-store-materialize.ts")} --manifest ${file} --dry-run`;
  assert.match(String(result.stdout), /remote-worker-tools/);
  assert.doesNotMatch(String(result.stdout), /token@/);
});
