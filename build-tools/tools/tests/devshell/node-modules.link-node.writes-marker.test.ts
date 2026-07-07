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
    await fsp.writeFile(
      lockfile,
      [
        "lockfileVersion: '9.0'",
        "",
        "settings:",
        "  autoInstallPeers: true",
        "  excludeLinksFromLockfile: false",
        "",
        "importers:",
        "  .: {}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "flake.nix"),
      "{ outputs = _: {}; }\n",
      "utf8",
    );
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
        'if [[ "$*" == store\\ add-path* ]]; then',
        '  echo "/nix/store/fixture-pnpm-exact-store"',
        "  exit 0",
        "fi",
        `echo "${fakeOut}"`,
      ].join("\n"),
    );

    const script = path.join(tmp, "viberoots/build-tools/tools/dev/install/link-node.ts");
    const zxInitPath = path.join(tmp, "viberoots/build-tools/tools/dev/zx-init.mjs");
    const env = {
      ...process.env,
      VBR_LINK_NODE_FAKE_NIX: "1",
      VBR_NIX_BIN: nixPath,
      NIX_BIN: nixPath,
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

    const markerPath = path.join(
      tmp,
      ".viberoots",
      "workspace",
      "buck",
      "tmp",
      "node-modules-link.root.json",
    );
    const marker = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    const lockHash = crypto
      .createHash("sha256")
      .update(await fsp.readFile(lockfile))
      .digest("hex");
    assert.equal(marker.importer, ".");
    assert.equal(marker.lockfile, "pnpm-lock.yaml");
    assert.equal(marker.lockHash, lockHash);
    assert.equal(marker.outPath, fakeOut);

    const logged = await fsp.readFile(nixArgsLog, "utf8");
    assert.ok(
      logged.includes(`${path.join(tmp, ".viberoots", "workspace")}#node-modules.default`),
      "expected root importer to use hidden workspace flake ref in strict consumer layout",
    );
    assert.ok(
      logged.includes("--no-write-lock-file"),
      "expected root importer build to avoid rewriting temp workspace flake.lock",
    );
  });
});
