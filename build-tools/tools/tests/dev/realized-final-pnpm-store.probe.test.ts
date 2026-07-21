import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  inspectFinalPnpmStore,
  realizedFinalStoreProbeTimeoutMs,
} from "../../dev/update-pnpm-hash/realized-store";
import { existingStorePath, probe, withFakeNix } from "./realized-final-pnpm-store.probe.fixture";

test("final store probes inherit the bounded pnpm Nix timeout", () => {
  assert.equal(realizedFinalStoreProbeTimeoutMs({ NIX_PNPM_FETCH_TIMEOUT: "1800" }), 1_800_000);
  assert.equal(realizedFinalStoreProbeTimeoutMs({ NIX_PNPM_FETCH_TIMEOUT: "5" }), 30_000);
  assert.equal(realizedFinalStoreProbeTimeoutMs({}), 600_000);
});

test("probe propagates authoritative Nix evaluation failure", async () => {
  await withFakeNix("eval-failure", "/nix/store/unused", async () => {
    await assert.rejects(probe("/nix/store/unused"), /authoritative eval failure/);
  });
});

test("probe maps only a physically absent evaluated FOD to a repair diagnostic", async () => {
  const missing = `/nix/store/${"0".repeat(32)}-missing-final-pnpm-store`;
  await withFakeNix("missing", missing, async (log) => {
    await assert.rejects(
      probe(missing),
      /final pnpm store is not realized[\s\S]*no tracked files were modified/,
    );
    assert.doesNotMatch(await fsp.readFile(log, "utf8"), /args=path-info/);
  });
});

test("rebuild inspection reports physical absence without hiding eval failures", async () => {
  const missing = `/nix/store/${"0".repeat(32)}-missing-final-pnpm-store`;
  await withFakeNix("missing", missing, async () => {
    assert.deepEqual(
      await inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: missing,
      }),
      { status: "absent", path: missing },
    );
  });
  await withFakeNix("eval-failure", missing, async () => {
    await assert.rejects(
      inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: missing,
      }),
      /authoritative eval failure/,
    );
  });
});

test("rebuild inspection separates immutable metadata authority from command cwd", async () => {
  const missing = `/nix/store/${"0".repeat(32)}-missing-final-pnpm-store`;
  await withFakeNix("missing", missing, async (log) => {
    const commandCwd = path.dirname(log);
    await inspectFinalPnpmStore({
      repoRoot: process.cwd(),
      commandCwd,
      importer: "projects/apps/demo",
      flakeRef: "path:/tmp/filtered#pnpm",
      attrPath: "pnpm-store.projects-apps-demo",
      expectedPath: missing,
    });
    assert.match(await fsp.readFile(log, "utf8"), new RegExp(`cwd=${commandCwd} args=eval`));
  });
});

test("probe propagates literal path validation failure", async () => {
  const present = existingStorePath();
  await withFakeNix("validation-failure", present, async () => {
    await assert.rejects(probe(present), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        message.includes("literal path validation failure") &&
        !message.includes("no tracked files were modified")
      );
    });
  });
});

test("rebuild inspection reports a physically present invalid path", async () => {
  const present = existingStorePath();
  await withFakeNix("invalid", present, async (log) => {
    assert.deepEqual(
      await inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: present,
      }),
      { status: "invalid", path: present },
    );
    const commands = await fsp.readFile(log, "utf8");
    assert.match(commands, /store-args=--check-validity --print-invalid \/nix\/store\//);
    assert.doesNotMatch(commands, /args=path-info/);
  });
});

test("ordinary probe maps a physically present invalid path to repair", async () => {
  const present = existingStorePath();
  await withFakeNix("invalid", present, async () => {
    await assert.rejects(probe(present), /final pnpm store is not realized[\s\S]*repair: run u/);
  });
});

for (const [mode, expected] of [
  ["validity-command-failure", /literal validity command failure/],
  ["validity-malformed", /validity check returned unexpected output/],
] as const) {
  test(`probe propagates ${mode}`, async () => {
    const present = existingStorePath();
    await withFakeNix(mode, present, async () => {
      await assert.rejects(probe(present), (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return expected.test(message) && !message.includes("no tracked files were modified");
      });
    });
  });
}

test("probe validates the literal evaluated path with a sanitized environment", async () => {
  const present = existingStorePath();
  await withFakeNix("success", present, async (log) => {
    assert.equal(await probe(present), present);
    const commands = await fsp.readFile(log, "utf8");
    assert.match(
      commands,
      /args=eval --override-input viberoots path:[^ ]+ --raw --no-write-lock-file --accept-flake-config path:\/tmp\/filtered#pnpm-store\.projects-apps-demo\.outPath/,
    );
    assert.match(
      commands,
      new RegExp(
        `store-args=--check-validity --print-invalid ${present.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    assert.match(
      commands,
      new RegExp(`args=path-info ${present.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.doesNotMatch(commands, /forbidden-(?:exact|index|lock)|generate=1|materialize=1/);
  });
});

test("filtered consumer probe uses only its marked bounded snapshot root", async () => {
  const present = existingStorePath();
  await withFakeNix("success", present, async (log) => {
    const previous = {
      workspace: process.env.WORKSPACE_ROOT,
      filtered: process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT,
    };
    try {
      process.env.WORKSPACE_ROOT = "/tmp/filtered";
      process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT = "/tmp/filtered";
      assert.equal(await probe(present), present);
      assert.match(
        await fsp.readFile(log, "utf8"),
        /args=eval --impure --override-input viberoots path:[^ ]+ --raw .*path:\/tmp\/filtered#pnpm-store/,
      );
    } finally {
      if (previous.workspace === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previous.workspace;
      if (previous.filtered === undefined) delete process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT;
      else process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT = previous.filtered;
    }
  });
});
