#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseUpdateCommandArgs, UPDATE_COMMAND_HELP } from "../../dev/update-command/args";
import { languageUpdateTimeoutMs } from "../../dev/update-command/languages";
import { runUpdateCommand, type UpdateOperations } from "../../dev/update-command/run";
import { pnpmLockArgs, updatePnpmLock } from "../../dev/update-command/pnpm";

function operations(events: string[]): UpdateOperations {
  return {
    importers: async () => [".", "projects/apps/web"],
    repairPnpmLock: async (_root, importer) => {
      events.push(`repair:${importer}`);
    },
    upgradePnpm: async (_root, importer) => {
      events.push(`upgrade:${importer}`);
    },
    reconcilePnpm: async (_root, importer) => {
      events.push(`reconcile:${importer}`);
    },
    enabledLanguages: async () => ["go", "python", "cpp"],
    languageUpdates: {
      go: async (_root, _verbose, upgrade) => {
        events.push(`go:${upgrade ? "upgrade" : "repair"}`);
        return 1;
      },
      python: async (_root, _verbose, upgrade) => {
        events.push(`python:${upgrade ? "upgrade" : "repair"}`);
        return 1;
      },
      cpp: async () => 0,
    },
    repairWorkspaceLock: async () => {
      events.push("workspace-lock");
    },
    repairGeneratedMetadata: async () => {
      events.push("cpp");
    },
  };
}

test("plain u conservatively repairs each importer before shared metadata", async () => {
  const events: string[] = [];
  await runUpdateCommand({
    root: "/repo",
    upgrade: false,
    verbose: false,
    operations: operations(events),
  });
  assert.deepEqual(events, [
    "repair:.",
    "reconcile:.",
    "repair:projects/apps/web",
    "reconcile:projects/apps/web",
    "go:repair",
    "python:repair",
    "workspace-lock",
    "cpp",
  ]);
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
  assert.deepEqual(events.slice(0, 3), [
    "repair:projects/apps/web",
    "reconcile:projects/apps/web",
    "reconcile:viberoots",
  ]);
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
    "upgrade:.",
    "reconcile:.",
    "upgrade:projects/apps/web",
    "reconcile:projects/apps/web",
    "go:upgrade",
    "python:upgrade",
    "workspace-lock",
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
  assert.equal(events[0], "reconcile:viberoots");
  assert.ok(!events.includes("upgrade:viberoots"));
});

test("help documents the edit workflow and does not advertise u deps", () => {
  assert.deepEqual(parseUpdateCommandArgs(["--upgrade"]), { upgrade: true, verbose: false });
  assert.equal(parseUpdateCommandArgs(["--help"]), "help");
  assert.match(UPDATE_COMMAND_HELP, /u --upgrade/);
  assert.match(UPDATE_COMMAND_HELP, /i && b && v/);
  assert.doesNotMatch(UPDATE_COMMAND_HELP, /u deps/);
  assert.throws(() => parseUpdateCommandArgs(["--unexpected"]), /unknown argument/);
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

test("pnpm lock modes are explicit and use a bounded ephemeral store", () => {
  const conservative = pnpmLockArgs(false, "/tmp/ephemeral-store");
  const upgrade = pnpmLockArgs(true, "/tmp/ephemeral-store");
  assert.deepEqual(conservative.slice(0, 2), ["install", "--prefer-offline"]);
  assert.deepEqual(upgrade.slice(0, 2), ["update", "--latest"]);
  assert.ok(conservative.includes("--lockfile-only"));
  assert.ok(upgrade.includes("--lockfile-only"));
  assert.deepEqual(
    upgrade.slice(upgrade.indexOf("--store-dir"), upgrade.indexOf("--store-dir") + 2),
    ["--store-dir", "/tmp/ephemeral-store"],
  );
  assert.ok(!conservative.includes("fetch"));
  assert.ok(conservative.includes("--child-concurrency"));
  assert.ok(!upgrade.includes("--child-concurrency"));
  assert.ok(conservative.includes("--prod=false"));
  assert.ok(!upgrade.includes("--prod=false"));
});

test("pnpm lock repair removes its ephemeral store and restores local state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-pnpm-test-"));
  const fakePnpm = path.join(root, "fake-pnpm.sh");
  const capture = path.join(root, "capture.txt");
  const envCapture = path.join(root, "capture.env.txt");
  const priorBin = process.env.UPDATE_PNPM_BIN;
  const priorNodeOptions = process.env.NODE_OPTIONS;
  try {
    await fsp.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fsp.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fsp.mkdir(path.join(root, "node_modules"));
    await fsp.writeFile(path.join(root, "node_modules/sentinel"), "present\n");
    await fsp.writeFile(
      fakePnpm,
      `#!/usr/bin/env bash
	set -euo pipefail
	printf '%s\\n' "$@" > ${JSON.stringify(capture)}
	printf '%s' "\${NODE_OPTIONS-}" > ${JSON.stringify(envCapture)}
	`,
    );
    await fsp.chmod(fakePnpm, 0o755);
    process.env.UPDATE_PNPM_BIN = fakePnpm;
    process.env.NODE_OPTIONS = [
      "--max-old-space-size=256",
      "--import /tmp/viberoots/build-tools/tools/dev/zx-init.mjs",
      "--trace-warnings",
    ].join(" ");
    await updatePnpmLock({ root, importer: ".", upgrade: false });

    const args = (await fsp.readFile(capture, "utf8")).trim().split("\n");
    const store = args[args.indexOf("--store-dir") + 1] || "";
    await assert.rejects(fsp.access(store), { code: "ENOENT" });
    assert.equal(await fsp.readFile(path.join(root, "node_modules/sentinel"), "utf8"), "present\n");
    await assert.rejects(fsp.access(path.join(root, "pnpm-workspace.yaml")), { code: "ENOENT" });
    assert.equal(
      await fsp.readFile(envCapture, "utf8"),
      "--max-old-space-size=256 --trace-warnings",
    );
  } finally {
    if (priorBin === undefined) delete process.env.UPDATE_PNPM_BIN;
    else process.env.UPDATE_PNPM_BIN = priorBin;
    if (priorNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = priorNodeOptions;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

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
