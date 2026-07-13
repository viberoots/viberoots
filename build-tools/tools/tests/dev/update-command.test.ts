#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseUpdateCommandArgs, UPDATE_COMMAND_HELP } from "../../dev/update-command/args";
import { runUpdateCommand, type UpdateOperations } from "../../dev/update-command/run";
import { pnpmLockArgs, updatePnpmLock } from "../../dev/update-command/pnpm";
import { unsupportedUpgradeSurfaces } from "../../dev/update-command/surfaces";

function operations(events: string[], unsupported: string[] = []): UpdateOperations {
  return {
    importers: async () => [".", "projects/apps/web"],
    unsupportedUpgrades: async () => unsupported,
    repairPnpmLock: async (_root, importer) => {
      events.push(`repair:${importer}`);
    },
    upgradePnpm: async (_root, importer) => {
      events.push(`upgrade:${importer}`);
    },
    reconcilePnpm: async (_root, importer) => {
      events.push(`reconcile:${importer}`);
    },
    repairGo: async () => {
      events.push("go");
    },
    repairPython: async () => {
      events.push("python");
    },
    repairWorkspaceLock: async () => {
      events.push("workspace-lock");
    },
    repairCpp: async () => {
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
    "go",
    "python",
    "workspace-lock",
    "cpp",
  ]);
});

test("u --upgrade upgrades pnpm and fails closed before mixed-language mutation", async () => {
  const upgraded: string[] = [];
  await runUpdateCommand({
    root: "/repo",
    upgrade: true,
    verbose: false,
    operations: operations(upgraded),
  });
  assert.deepEqual(upgraded.slice(0, 4), [
    "upgrade:.",
    "reconcile:.",
    "upgrade:projects/apps/web",
    "reconcile:projects/apps/web",
  ]);

  const blocked: string[] = [];
  await assert.rejects(
    runUpdateCommand({
      root: "/repo",
      upgrade: true,
      verbose: false,
      operations: operations(blocked, ["Go", "C++"]),
    }),
    /unsupported.*Go, C\+\+.*no files were modified/s,
  );
  assert.deepEqual(blocked, []);
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
});

test("pnpm lock repair removes its ephemeral store and restores local state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-pnpm-test-"));
  const fakePnpm = path.join(root, "fake-pnpm.sh");
  const capture = path.join(root, "capture.txt");
  const priorBin = process.env.UPDATE_PNPM_BIN;
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
`,
    );
    await fsp.chmod(fakePnpm, 0o755);
    process.env.UPDATE_PNPM_BIN = fakePnpm;
    await updatePnpmLock({ root, importer: ".", upgrade: false });

    const args = (await fsp.readFile(capture, "utf8")).trim().split("\n");
    const store = args[args.indexOf("--store-dir") + 1] || "";
    await assert.rejects(fsp.access(store), { code: "ENOENT" });
    assert.equal(await fsp.readFile(path.join(root, "node_modules/sentinel"), "utf8"), "present\n");
    await assert.rejects(fsp.access(path.join(root, "pnpm-workspace.yaml")), { code: "ENOENT" });
  } finally {
    if (priorBin === undefined) delete process.env.UPDATE_PNPM_BIN;
    else process.env.UPDATE_PNPM_BIN = priorBin;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("upgrade surface discovery is limited to actual project inputs", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-surfaces-"));
  try {
    await fsp.mkdir(path.join(root, "projects/apps/mixed"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "projects/apps/mixed/go.mod"),
      "module example.test/mixed\n",
    );
    await fsp.writeFile(
      path.join(root, "projects/apps/mixed/pyproject.toml"),
      "[project]\nname='mixed'\n",
    );
    await fsp.writeFile(
      path.join(root, "projects/apps/mixed/main.cpp"),
      "int main() { return 0; }\n",
    );
    await $({ cwd: root })`git init -q`;
    await $({ cwd: root })`git add projects`;
    assert.deepEqual(await unsupportedUpgradeSurfaces(root), ["Go", "Python/uv", "C++"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
