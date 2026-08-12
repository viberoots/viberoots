import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nixEnv } from "./pnpm-fixed-store-native-fixture";
import {
  assertOwnedStorePathWithinKib,
  NATIVE_PNPM_COMMAND_TIMEOUT_MS,
  parseOwnedStorePathSize,
  parseNonnegativeKib,
  runGuardedCommand,
} from "./pnpm-fixed-store-native-run";

test("native reconciliation uses the production cold command budget", () => {
  assert.equal(NATIVE_PNPM_COMMAND_TIMEOUT_MS, 600_000);
});

test("native reconciliation fixture preserves degraded reviewed Nix cache config", () => {
  const previousConfig = process.env.NIX_CONFIG;
  const previousReviewed = process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  try {
    process.env.NIX_CONFIG = [
      "substituters = https://cache.nixos.org/",
      "extra-substituters = https://cache.home.kilty.io/main",
    ].join("\n");
    process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = [
      "substituters = https://cache.nixos.org/",
      "extra-substituters =",
      "connect-timeout = 3",
      "stalled-download-timeout = 10",
      "fallback = true",
    ].join("\n");

    const env = nixEnv("/tmp/vbr-native-reconcile-home");
    assert.match(String(env.NIX_CONFIG), /experimental-features = nix-command flakes/);
    assert.match(String(env.NIX_CONFIG), /substituters = https:\/\/cache\.nixos\.org\//);
    assert.match(String(env.NIX_CONFIG), /extra-substituters =(?:\n|$)/);
    assert.doesNotMatch(String(env.NIX_CONFIG), /cache\.home\.kilty\.io/);
    assert.equal(env.NIX_CONF_DIR?.includes("viberoots-empty-nix-conf"), true);
  } finally {
    if (previousConfig === undefined) delete process.env.NIX_CONFIG;
    else process.env.NIX_CONFIG = previousConfig;
    if (previousReviewed === undefined) delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
    else process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = previousReviewed;
  }
});

test("owned size measurements fail closed on malformed output", () => {
  assert.equal(parseNonnegativeKib("2048", "du"), 2048);
  assert.throws(() => parseNonnegativeKib("not-a-size", "du"), /nonnegative KiB value/);
  const storePath = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-owned";
  assert.deepEqual(
    parseOwnedStorePathSize(
      JSON.stringify({ [storePath]: { narSize: 2049, closureSize: 4097 } }),
      storePath,
    ),
    { narKib: 3, closureKib: 5 },
  );
  assert.throws(
    () => parseOwnedStorePathSize(JSON.stringify({ [storePath]: {} }), storePath),
    /omitted owned size evidence/,
  );
});

test("owned output guard rejects an oversized reconciled path", () => {
  assert.throws(
    () =>
      assertOwnedStorePathWithinKib(
        "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-owned",
        { narKib: 512, closureKib: 2048 },
        1024,
      ),
    /owned reconciled output exceeded 1024KiB guard/,
  );
});

test("guarded command preserves the guard error after child shutdown", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-guarded-command-"));
  const stoppedMarker = path.join(root, "stopped");
  try {
    await assert.rejects(
      runGuardedCommand(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          `trap 'sleep 0.1; printf stopped > "${stoppedMarker}"; exit 0' TERM; dd if=/dev/zero of=guard-input bs=2048k count=1 2>/dev/null; while true; do sleep 10; done`,
        ],
        {
          cwd: root,
          fixtureRoot: root,
          maxKib: 1024,
          sampleIntervalMs: 10,
        },
      ),
      /native reconcile exceeded 1024KiB guard/,
    );
    assert.equal(await fsp.readFile(stoppedMarker, "utf8"), "stopped");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("unrelated container growth cannot fail an owned fixture guard", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-owned-usage-"));
  let externalContainerKib = 0;
  try {
    const result = await runGuardedCommand("bash", ["--noprofile", "--norc", "-c", "sleep 0.03"], {
      cwd: root,
      fixtureRoot: root,
      maxKib: 1024,
      measureUsage: async () => {
        externalContainerKib += 1024 * 1024;
        return { fixtureKib: 1 };
      },
      sampleIntervalMs: 1,
    });
    assert.equal(result.status, 0);
    assert.ok(externalContainerKib > 1024);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("guarded command preserves an in-flight sample failure observed during child close", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-guarded-close-race-"));
  let samples = 0;
  try {
    await assert.rejects(
      runGuardedCommand("bash", ["--noprofile", "--norc", "-c", "sleep 0.02"], {
        cwd: root,
        fixtureRoot: root,
        maxKib: 1024,
        measureUsage: async () => {
          samples++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { fixtureKib: 2048 };
        },
        sampleIntervalMs: 1,
      }),
      /native reconcile exceeded 1024KiB guard/,
    );
    assert.equal(samples, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
