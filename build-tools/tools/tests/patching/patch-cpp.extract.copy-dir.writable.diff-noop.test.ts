#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureOriginAndWorkspace } from "../../patch/cpp/extract";
import { makeUnifiedDiff } from "../../patch/diff";
import { verifyPatchDryRun } from "../../patch/lib/apply";
import { runInTemp } from "../lib/test-helpers";

test("cpp extract: copy dir → workspace is writable; diff noop; patch dry-run OK", async () => {
  await runInTemp("cpp-extract-copy-dir", async (tmp) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    const readme = path.join(storeSrc, "README");
    await fsp.writeFile(readme, "zlib\n", "utf8");
    // Simulate read-only store-style permissions
    try {
      await fsp.chmod(readme, 0o444);
      await fsp.chmod(storeSrc, 0o555);
    } catch {}

    const pre = { pname: "zlib", version: "1.2.13", srcPath: storeSrc };
    const { originPath, workspacePath } = await ensureOriginAndWorkspace("pkgs.zlib", pre);

    // Workspace is writable: create a new file and modify an existing one
    const touch = path.join(workspacePath, "WRITE_TEST");
    await fsp.writeFile(touch, "ok\n", "utf8");
    await fsp.appendFile(path.join(workspacePath, "README"), "patched\n", "utf8");

    // Diff is well-formed and non-empty (README changed); round-trip via patch --dry-run succeeds
    const diff = await makeUnifiedDiff(originPath, workspacePath);
    if (!diff || diff.trim() === "") {
      console.error("expected a non-empty diff after workspace mutation");
      process.exit(2);
    }
    const p = path.join(tmp, "zlib.patch");
    await fsp.writeFile(p, diff, "utf8");

    await verifyPatchDryRun(originPath, p, "cpp");
  });
});
