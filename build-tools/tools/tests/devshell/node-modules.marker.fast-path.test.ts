#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runNodeWithZx } from "../../lib/node-run";
import { runInTemp } from "../lib/test-helpers/run-in-temp";

async function writeExecutable(file: string, data: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, data, { mode: 0o755 });
}

async function readLines(file: string): Promise<string[]> {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

test("devshell marker avoids nix eval", async () => {
  await runInTemp("devshell-marker", async (tmp) => {
    const lockfile = path.join(tmp, "pnpm-lock.yaml");
    const initialLockText = "lockfileVersion: 1\n";
    await fsp.writeFile(lockfile, initialLockText, "utf8");

    const fakeOut1 = path.join(tmp, "fake-out-1");
    await fsp.mkdir(path.join(fakeOut1, "node_modules"), { recursive: true });

    const callsFile = path.join(tmp, "nix-calls");
    const binDir = path.join(tmp, "fake-bin");
    const nixPath = path.join(binDir, "nix");
    await writeExecutable(
      nixPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo call >> "${callsFile}"`,
        `echo "${fakeOut1}"`,
      ].join("\n"),
    );

    const script = path.join(tmp, "build-tools/tools/dev/devshell-link-node-modules.ts");
    const zxInitPath = path.join(tmp, "build-tools/tools/dev/zx-init.mjs");
    const baseEnv = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      VBR_DEVSHELL_ALLOW_TMP: "1",
      WORKSPACE_ROOT: tmp,
      NO_NODE_MODULES_LINK: "",
    };

    await runNodeWithZx({ script, cwd: tmp, env: baseEnv, zxInitPath, stdio: "pipe" });
    assert.equal(await pathExists(path.join(tmp, "node_modules")), false);

    const lockHash = crypto.createHash("sha256").update(initialLockText).digest("hex");
    const markerPath = path.join(tmp, "buck-out", "tmp", "node-modules-link.root.json");
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(
      markerPath,
      JSON.stringify(
        {
          importer: ".",
          lockfile: "pnpm-lock.yaml",
          lockHash,
          outPath: fakeOut1,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await runNodeWithZx({ script, cwd: tmp, env: baseEnv, zxInitPath, stdio: "pipe" });

    const nm = path.join(tmp, "node_modules");
    const st = await fsp.lstat(nm);
    assert.ok(st.isSymbolicLink());
    const target = await fsp.readlink(nm);
    assert.equal(target, path.join(fakeOut1, "node_modules"));

    const marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    assert.equal(marker.importer, ".");
    assert.equal(marker.lockfile, "pnpm-lock.yaml");
    assert.equal(marker.outPath, fakeOut1);

    const calls1 = await readLines(callsFile);
    assert.equal(calls1.length, 0);

    await fsp.writeFile(lockfile, "lockfileVersion: 2\n", "utf8");
    await runNodeWithZx({ script, cwd: tmp, env: baseEnv, zxInitPath, stdio: "pipe" });

    const target2 = await fsp.readlink(nm);
    assert.equal(target2, path.join(fakeOut1, "node_modules"));
    const calls2 = await readLines(callsFile);
    assert.equal(calls2.length, 0);
    const marker2 = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    assert.equal(marker2.outPath, fakeOut1);
  });
});
