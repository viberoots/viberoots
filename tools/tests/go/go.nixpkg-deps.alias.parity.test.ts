#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("go macros: nixpkg_deps alias parity with nix_cgo_deps (labels)", async () => {
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
    // TARGETS with two libs: one uses legacy kwarg, the other the alias
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
        "nix_go_library(",
        '  name = "alias",',
        '  srcs = glob(["pkg/**/*.go"]),',
        '  nixpkg_deps = ["pkgs.openssl"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = async (name: string) => {
      const probe = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo --json --output-attributes labels "deps(//apps/demo:${name}, 0)"`;
      if (probe.exitCode !== 0) return null;
      const json = JSON.parse(String(probe.stdout || "[]")) as Array<{ labels?: string[] }>;
      const labs = (json[0]?.labels || []).slice().sort();
      return labs;
    };
    const legacy = await q("legacy");
    const alias = await q("alias");
    if (!legacy || !alias) return;
    assert.deepEqual(alias, legacy, "labels should be identical for nixpkg_deps vs nix_cgo_deps");
  });
});
