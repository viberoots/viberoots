#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("go macros: legacy nix_cgo_deps fails with an actionable error", async () => {
  await runInTemp("go-nixpkg-alias", async (tmp, $) => {
    // Minimal Go package
    const pkg = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(pkg, "pkg", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(pkg, "pkg", "demo", "demo.go"),
      "package demo\nfunc X(){}\n",
      "utf8",
    );
    // Bring macros into temp repo
    await fsp.writeFile(
      path.join(tmp, "go", "defs.bzl"),
      await fsp.readFile("go/defs.bzl", "utf8"),
    );
    // TARGETS: legacy kwarg should fail deterministically
    await fsp.writeFile(
      path.join(pkg, "TARGETS"),
      [
        'load("//go:defs.bzl", "nix_go_library")',
        "",
        "nix_go_library(",
        '  name = "legacy",',
        '  srcs = glob(["pkg/**/*.go"]),',
        '  nix_cgo_deps = ["pkgs.openssl"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels "deps(//apps/demo:legacy,0)"`;
    assert.notEqual(probe.exitCode, 0);
    const out = String(probe.stdout || "") + "\n" + String(probe.stderr || "");
    assert.match(out, /nix_cgo_deps is no longer supported; use nixpkg_deps instead/);
  });
});
