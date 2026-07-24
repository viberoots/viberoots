#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { UPDATE_COMMAND_HELP } from "../../dev/update-command/args";
import { globalNixInputFingerprint } from "../../dev/global-nix-input-fingerprint";
import { languageUpdateTimeoutMs } from "../../dev/update-command/languages";
import { runUpdateCommand } from "../../dev/update-command/run";
import { operations, repairedAuthority } from "./update-command.fixture";
import { registerUpdateCommandPnpmContracts } from "./update-command-pnpm-contracts";

test("plain u conservatively repairs each importer before shared metadata", async () => {
  const events: string[] = [];
  await runUpdateCommand({
    root: "/repo",
    upgrade: false,
    verbose: false,
    operations: operations(events),
  });
  assert.deepEqual(events, [
    "toolchain",
    "workspace-lock",
    "repair:.",
    "reconcile:.",
    "repair:projects/apps/web",
    "reconcile:projects/apps/web",
    "go:repair",
    "python:repair",
    "rust:repair",
    "cpp",
  ]);
});

test("u forwards the global input fingerprint captured before repair", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-global-inputs-"));
  try {
    const hashes = path.join(root, "projects", "config", "node-modules.hashes.json");
    await fsp.mkdir(path.dirname(hashes), { recursive: true });
    await fsp.writeFile(hashes, "{}\n");
    const before = await globalNixInputFingerprint(root);
    let forwarded = "";
    const configured = operations([]);
    configured.repairToolchainAuthority = async () => {
      await fsp.writeFile(hashes, '{"projects/apps/demo/pnpm-lock.yaml":"sha256-test"}\n');
      return repairedAuthority;
    };
    configured.repairGeneratedMetadata = async (_root, _verbose, priorGlobalInputs) => {
      forwarded = priorGlobalInputs;
    };

    await runUpdateCommand({ root, upgrade: false, verbose: false, operations: configured });

    assert.equal(forwarded, before);
    assert.notEqual(await globalNixInputFingerprint(root), before);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("plain u reconciles the nested tool importer without rewriting its lockfile", async () => {
  const events: string[] = [];
  const nested = operations(events);
  nested.importers = async () => ["projects/apps/web", "viberoots"];
  await runUpdateCommand({
    root: "/repo",
    upgrade: false,
    verbose: false,
    operations: nested,
  });
  assert.deepEqual(events.slice(0, 4), [
    "toolchain",
    "workspace-lock",
    "repair:projects/apps/web",
    "reconcile:projects/apps/web",
  ]);
  assert.equal(events[4], "reconcile:viberoots");
  assert.ok(!events.includes("repair:viberoots"));
});

test("u --upgrade upgrades supported languages and reconciles C++ metadata", async () => {
  const upgraded: string[] = [];
  await runUpdateCommand({
    root: "/repo",
    upgrade: true,
    verbose: false,
    operations: operations(upgraded),
  });
  assert.deepEqual(upgraded, [
    "toolchain",
    "workspace-lock",
    "upgrade:.",
    "reconcile:.",
    "upgrade:projects/apps/web",
    "reconcile:projects/apps/web",
    "go:upgrade",
    "python:upgrade",
    "rust:upgrade",
    "cpp",
  ]);
});

test("u --upgrade reconciles but never upgrades the nested tool importer", async () => {
  const events: string[] = [];
  const nested = operations(events);
  nested.importers = async () => ["viberoots"];
  await runUpdateCommand({
    root: "/repo",
    upgrade: true,
    verbose: false,
    operations: nested,
  });
  assert.equal(events[0], "toolchain");
  assert.equal(events[1], "workspace-lock");
  assert.equal(events[2], "reconcile:viberoots");
  assert.ok(!events.includes("upgrade:viberoots"));
});

test("u gives generated metadata a non-owning pnpm scope and restores its caller", async () => {
  const prior = process.env.INSTALL_GLUE_SKIP_PNPM_HASH;
  process.env.INSTALL_GLUE_SKIP_PNPM_HASH = "caller";
  try {
    const success = operations([]);
    success.repairGeneratedMetadata = async () => {
      assert.equal(process.env.INSTALL_GLUE_SKIP_PNPM_HASH, "1");
    };
    await runUpdateCommand({ root: "/repo", upgrade: false, verbose: false, operations: success });
    assert.equal(process.env.INSTALL_GLUE_SKIP_PNPM_HASH, "caller");

    const failure = operations([]);
    failure.repairGeneratedMetadata = async () => {
      assert.equal(process.env.INSTALL_GLUE_SKIP_PNPM_HASH, "1");
      throw new Error("glue failed");
    };
    await assert.rejects(
      runUpdateCommand({ root: "/repo", upgrade: false, verbose: false, operations: failure }),
      /glue failed/,
    );
    assert.equal(process.env.INSTALL_GLUE_SKIP_PNPM_HASH, "caller");
  } finally {
    if (prior === undefined) delete process.env.INSTALL_GLUE_SKIP_PNPM_HASH;
    else process.env.INSTALL_GLUE_SKIP_PNPM_HASH = prior;
  }
});

test("u adopts repaired artifact authority for reconciliation and restores its caller", async () => {
  const prior = process.env.VBR_ARTIFACT_TOOLS_ROOT;
  const priorPath = process.env.PATH;
  const callerRoot = "/nix/store/cccccccccccccccccccccccccccccccc-caller-tools";
  const repairedRoot = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-artifact-tools";
  const repairedPath = [
    "/nix/store/dddddddddddddddddddddddddddddddd-go/bin",
    "/nix/store/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-python/bin",
    `${repairedRoot}/bin`,
  ].join(path.delimiter);
  process.env.VBR_ARTIFACT_TOOLS_ROOT = callerRoot;
  process.env.PATH = "/hostile/bin";
  try {
    const success = operations([]);
    success.importers = async () => ["."];
    success.reconcilePnpm = async () => {
      assert.equal(process.env.VBR_ARTIFACT_TOOLS_ROOT, repairedRoot);
      assert.equal(process.env.PATH, repairedPath);
    };
    await runUpdateCommand({ root: "/repo", upgrade: false, verbose: false, operations: success });
    assert.equal(process.env.VBR_ARTIFACT_TOOLS_ROOT, callerRoot);
    assert.equal(process.env.PATH, "/hostile/bin");

    const failure = operations([]);
    failure.importers = async () => ["."];
    failure.reconcilePnpm = async () => {
      assert.equal(process.env.VBR_ARTIFACT_TOOLS_ROOT, repairedRoot);
      assert.equal(process.env.PATH, repairedPath);
      throw new Error("reconcile failed");
    };
    await assert.rejects(
      runUpdateCommand({ root: "/repo", upgrade: false, verbose: false, operations: failure }),
      /reconcile failed/,
    );
    assert.equal(process.env.VBR_ARTIFACT_TOOLS_ROOT, callerRoot);
    assert.equal(process.env.PATH, "/hostile/bin");
  } finally {
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    if (prior === undefined) delete process.env.VBR_ARTIFACT_TOOLS_ROOT;
    else process.env.VBR_ARTIFACT_TOOLS_ROOT = prior;
  }
});

test("devshell completion exposes the documented u options", async () => {
  const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
  const devshell = await fsp.readFile(
    path.join(sourceRoot, "build-tools/tools/nix/devshell.nix"),
    "utf8",
  );
  assert.match(devshell, /complete -F _vbr_u u/);
  assert.match(devshell, /compdef _u u/);
  for (const option of ["--upgrade", "--verbose", "--help"]) {
    assert.match(UPDATE_COMMAND_HELP, new RegExp(option));
    assert.match(devshell, new RegExp(option));
  }
});

registerUpdateCommandPnpmContracts(test);

test("language timeout is bounded and defaults to ten minutes", () => {
  assert.equal(languageUpdateTimeoutMs({}), 600_000);
  assert.equal(languageUpdateTimeoutMs({ VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS: "30" }), 30_000);
  assert.throws(
    () => languageUpdateTimeoutMs({ VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS: "0" }),
    /integer from 1 to 3600/,
  );
  assert.throws(
    () => languageUpdateTimeoutMs({ VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS: "3601" }),
    /integer from 1 to 3600/,
  );
});

test("ordinary Go and uv resolution cannot fall through to host PATH", async () => {
  const source = await fsp.readFile(
    path.join(
      path.resolve(process.env.VIBEROOTS_ROOT || process.cwd()),
      "build-tools/tools/dev/update-command/languages.ts",
    ),
    "utf8",
  );
  assert.match(source, /goBin = ensureNixStoreToolPathSync\("go"\)/);
  assert.match(source, /ensureNixStoreToolPathSync\("uv"\)/);
  assert.doesNotMatch(source, /UPDATE_GO_BIN/);
  assert.doesNotMatch(source, /UPDATE_UV_BIN/);
});
