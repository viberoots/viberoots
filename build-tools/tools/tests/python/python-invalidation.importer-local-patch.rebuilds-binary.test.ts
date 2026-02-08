#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python binary wiring includes importer-local patches in srcs (cquery)", async () => {
  await runInTemp("py-binary-importer-patches-synthetic-dep", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    const patchDir = path.join(appDir, "patches", "python");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.py"), "print('ok')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "hello"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );

    const patchRel = "projects/apps/demo/patches/python/base@0.0.0.patch";
    await fsp.writeFile(path.join(tmp, patchRel), "# baseline\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "python_library")',
        'load("//build-tools/python:defs.bzl", "nix_python_binary")',
        "",
        "python_library(",
        '  name = "lib",',
        '  srcs = ["src/main.py"],',
        ")",
        "",
        "nix_python_binary(",
        '  name = "bin",',
        '  lockfile_label = "lockfile:projects/apps/demo/uv.lock#projects/apps/demo",',
        '  main = "src/main.py",',
        '  deps = [":lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const srcsQ = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/demo:bin`;
    if (srcsQ.exitCode !== 0) {
      return;
    }
    const resourcesOut = String(srcsQ.stdout || "");
    assert.ok(
      resourcesOut.includes(patchRel),
      "expected importer-local patch path present in binary srcs",
    );
  });
});
