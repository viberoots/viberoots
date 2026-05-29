#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
  redactMaterializationManifest,
  renderMaterializationCommand,
  type NixStoreMaterializationManifest,
} from "../../remote-exec/nix-store-materialize";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";

const manifest: NixStoreMaterializationManifest = {
  schemaVersion: "viberoots.nix-store-materialization.v1",
  sourceRevision: "abc123",
  sourceSnapshot: "/nix/store/source-snapshot",
  flakeLockFingerprint: "sha256-lock",
  substituter: {
    endpointIdentity: "https://token@cache.example.invalid",
    trustedPublicKeys: ["cache.example.invalid-1:abcdef1234567890"],
  },
  tools: {
    nix: "/nix/store/nix-tool",
  },
  storePaths: [
    {
      attr: "remote-worker-tools",
      path: "/nix/store/remote-worker-tools",
      narHash: "sha256-worker",
      expectedOutputIdentity: "remote-worker-tools",
    },
    {
      attr: "test-seed",
      path: "/nix/store/test-seed",
      expectedOutputIdentity: "test-seed",
    },
    {
      attr: "graph-generator-selected",
      path: "/nix/store/selected-output",
      expectedOutputIdentity: "selected-target-output",
    },
  ],
};

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
    () => parseMaterializationManifest({ ...manifest, storePaths: [] }),
    /storePaths must list/,
  );
});

test("Nix store materialization redacts endpoint credentials and public key bodies", () => {
  const redacted = redactMaterializationManifest(manifest);
  assert.equal(redacted.substituter.endpointIdentity, "https://<redacted>@cache.example.invalid");
  assert.deepEqual(redacted.substituter.trustedPublicKeys, ["cache.example.invalid-1:<redacted>"]);
});

test("Nix store materialization renders substituter copy commands without global config writes", () => {
  const command = renderMaterializationCommand(manifest, manifest.storePaths[0]!);
  assert.deepEqual(command.slice(0, 4), [
    "/nix/store/nix-tool/bin/nix",
    "copy",
    "--from",
    "https://token@cache.example.invalid",
  ]);
  assert.ok(!command.includes("--builders"));
  assert.ok(!command.includes("--extra-substituters"));
});

test("Nix store materialization renders remote-safe build commands without a substituter", () => {
  const noSubstituter = {
    ...manifest,
    substituter: { endpointIdentity: "", trustedPublicKeys: [] },
  };
  assert.deepEqual(renderMaterializationCommand(noSubstituter, manifest.storePaths[1]!), [
    "/nix/store/nix-tool/bin/nix",
    "build",
    "/nix/store/source-snapshot#test-seed",
    "--no-link",
    "--print-out-paths",
  ]);
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
    runner: async (command) => {
      commands.push(command);
      return { stdout: "/nix/store/test-seed\n", stderr: "" };
    },
  });
  assert.equal(reports[0]?.cache, "miss");
  assert.deepEqual(commands[0], [
    "/nix/store/nix-tool/bin/nix",
    "build",
    "/nix/store/source-snapshot#test-seed",
    "--no-link",
    "--print-out-paths",
  ]);
});

test("Nix store materialization dry-run reports required remote worker and seed attrs", async () => {
  const reports = await materializeNixStorePaths({ manifest, dryRun: true });
  assert.deepEqual(
    reports.map((entry) => entry.attr),
    ["remote-worker-tools", "test-seed", "graph-generator-selected"],
  );
  assert.equal(
    reports.every((entry) => entry.cache === "dry-run"),
    true,
  );
  assert.equal(
    reports.every((entry) => !JSON.stringify(entry.command).includes("token@")),
    true,
  );
});

test("Nix store materialization rejects mismatched realized paths", async () => {
  await assert.rejects(
    materializeNixStorePaths({
      manifest,
      runner: async () => ({ stdout: "/nix/store/wrong-output\n", stderr: "" }),
    }),
    /expected \/nix\/store\/remote-worker-tools/,
  );
});

test("Nix store materialization verifies copied paths when nix copy prints no output", async () => {
  const commands: string[][] = [];
  const reports = await materializeNixStorePaths({
    manifest: { ...manifest, storePaths: [manifest.storePaths[0]!] },
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
  assert.deepEqual(commands[1], [
    "/nix/store/nix-tool/bin/nix",
    "path-info",
    "/nix/store/remote-worker-tools",
  ]);
});

test("Nix store materialization rejects copied paths that cannot be verified", async () => {
  await assert.rejects(
    materializeNixStorePaths({
      manifest: { ...manifest, storePaths: [manifest.storePaths[0]!] },
      runner: async (command) =>
        command.includes("path-info")
          ? { stdout: "/nix/store/other\n", stderr: "" }
          : { stdout: "", stderr: "" },
    }),
    /did not verify expected/,
  );
});

test("remote policy rejects undeclared Nix store references in remote-ready commands", () => {
  const base = {
    target: "//pkg:t",
    ruleFamily: "go_nix_test",
    labels: ["remote:ready"],
    runFromProjectRoot: true,
    useProjectRelativePaths: true,
    commandInputsDeclared: true,
    nixBuilderPolicy: "inherit_config",
    remoteBuilderSmokePolicy: "inherit_config",
  };
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [{ ...base, referencedNixStorePaths: ["/nix/store/plain-tool"] }],
    })
      .map((f) => f.message)
      .join("\n"),
    /materialization manifest/,
  );
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [
        {
          ...base,
          materializationManifestDeclared: true,
          materializationManifestPaths: ["/nix/store/plain-tool"],
          referencedNixStorePaths: ["/nix/store/plain-tool"],
        },
      ],
    }),
    [],
  );
  assert.match(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [
        {
          ...base,
          materializationManifestDeclared: true,
          materializationManifestPaths: ["/nix/store/other-tool"],
          referencedNixStorePaths: ["/nix/store/plain-tool"],
        },
      ],
    })
      .map((f) => f.message)
      .join("\n"),
    /missing from materialization manifest/,
  );
});

test("Starlark materialization helpers emit path labels consumed by policy parser", () => {
  const helper = fs.readFileSync("build-tools/lang/nix_store_materialize.bzl", "utf8");
  const policy = fs.readFileSync("build-tools/lang/remote_action_policy.bzl", "utf8");
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
  })`zx-wrapper build-tools/tools/remote-exec/nix-store-materialize.ts --manifest ${file} --dry-run`;
  assert.match(String(result.stdout), /remote-worker-tools/);
  assert.doesNotMatch(String(result.stdout), /token@/);
});
