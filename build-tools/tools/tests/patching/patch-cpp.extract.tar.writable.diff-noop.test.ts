#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureOriginAndWorkspace } from "../../patch/cpp/extract";
import { makeUnifiedDiff } from "../../patch/diff";
import { verifyPatchDryRun } from "../../patch/lib/apply";
import { runInTemp } from "../lib/test-helpers";

test("cpp extract: tar archive → workspace is writable; diff noop; patch dry-run OK", async () => {
  await runInTemp("cpp-extract-tar", async (tmp, $) => {
    // Build a small tar archive
    const srcTree = path.join(tmp, "src-tree");
    await fsp.mkdir(srcTree, { recursive: true });
    const header = path.join(srcTree, "zlib.h");
    await fsp.writeFile(header, "#pragma once\n// zlib header\n", "utf8");
    try {
      await fsp.chmod(header, 0o444);
      await fsp.chmod(srcTree, 0o555);
    } catch {}
    const tarPath = path.join(tmp, "zlib-src.tar");
    await $`tar -cf ${tarPath} -C ${srcTree} .`;

    const pre = { pname: "zlib", version: "1.2.13", srcPath: tarPath };
    const { originPath, workspacePath } = await ensureOriginAndWorkspace("pkgs.zlib", pre);

    // Workspace is writable
    await fsp.writeFile(path.join(workspacePath, "WRITE_TEST"), "ok\n", "utf8");
    await fsp.appendFile(path.join(workspacePath, "zlib.h"), "// patched\n", "utf8");

    // Diff formed and applies with patch -p1 --dry-run
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
