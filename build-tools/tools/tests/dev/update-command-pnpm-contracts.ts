import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { test } from "node:test";
import { pnpmLockArgs, updatePnpmLock } from "../../dev/update-command/pnpm";

export function registerUpdateCommandPnpmContracts(register: typeof test): void {
  register("pnpm lock modes are explicit and use a bounded ephemeral store", () => {
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

  register("pnpm lock repair removes its ephemeral store and restores local state", async () => {
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
      assert.equal(
        await fsp.readFile(path.join(root, "node_modules/sentinel"), "utf8"),
        "present\n",
      );
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

  register(
    "real registry lock repair exits after pnpm worker teardown on the canonical runtime",
    async () => {
      const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-pnpm-worker-"));
      const priorBin = process.env.UPDATE_PNPM_BIN;
      try {
        delete process.env.UPDATE_PNPM_BIN;
        await fsp.writeFile(
          path.join(root, "package.json"),
          '{"name":"worker-teardown","private":true,"dependencies":{"nanoid":"3.3.11"}}\n',
        );
        await fsp.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

        await updatePnpmLock({ root, importer: ".", upgrade: false });

        const lock = await fsp.readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
        assert.match(lock, /nanoid:/);
        assert.match(lock, /3\.3\.11/);
      } finally {
        if (priorBin === undefined) delete process.env.UPDATE_PNPM_BIN;
        else process.env.UPDATE_PNPM_BIN = priorBin;
        await fsp.rm(root, { recursive: true, force: true });
      }
    },
  );
}
