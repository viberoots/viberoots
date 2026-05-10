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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

test("link-node writes marker at repo root", async () => {
  await runInTemp("link-node-marker", async (tmp) => {
    const lockfile = path.join(tmp, "pnpm-lock.yaml");
    await fsp.writeFile(lockfile, "lockfileVersion: 1\n", "utf8");
    const lockHash = crypto
      .createHash("sha256")
      .update(await fsp.readFile(lockfile))
      .digest("hex");

    const fakeOut = path.join(tmp, "fake-out");
    await fsp.mkdir(path.join(fakeOut, "node_modules"), { recursive: true });
    const nixArgsLog = path.join(tmp, "nix-args.log");

    const binDir = path.join(tmp, "fake-bin");
    const nixPath = path.join(binDir, "nix");
    await writeExecutable(
      nixPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo "$*" >> "${nixArgsLog}"`,
        `echo "${fakeOut}"`,
      ].join("\n"),
    );

    const script = path.join(tmp, "build-tools/tools/dev/install/link-node.ts");
    const zxInitPath = path.join(tmp, "build-tools/tools/dev/zx-init.mjs");
    const env = {
      ...process.env,
      BNX_LINK_NODE_FAKE_NIX: "1",
      PATH: `${binDir}:${process.env.PATH || ""}`,
      WORKSPACE_ROOT: tmp,
    };

    try {
      await runNodeWithZx({ script, cwd: tmp, env, zxInitPath, stdio: "pipe" });
    } catch (err) {
      const e = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
      throw new Error(
        [
          String(e?.message || err),
          "--- link-node stdout ---",
          String(e?.stdout || ""),
          "--- link-node stderr ---",
          String(e?.stderr || ""),
        ].join("\n"),
      );
    }

    const nm = path.join(tmp, "node_modules");
    assert.ok(await pathExists(nm));
    const st = await fsp.lstat(nm);
    assert.ok(st.isSymbolicLink());
    assert.equal(await fsp.readlink(nm), path.join(fakeOut, "node_modules"));

    const markerPath = path.join(tmp, "buck-out", "tmp", "node-modules-link.root.json");
    const marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    assert.equal(marker.importer, ".");
    assert.equal(marker.lockfile, "pnpm-lock.yaml");
    assert.equal(marker.lockHash, lockHash);
    assert.equal(marker.outPath, fakeOut);

    const logged = await fsp.readFile(nixArgsLog, "utf8");
    assert.ok(
      logged.includes(`${tmp}#node-modules.default`),
      "expected root importer to use bare workspace flake ref for fast git-backed resolution",
    );
  });
});
