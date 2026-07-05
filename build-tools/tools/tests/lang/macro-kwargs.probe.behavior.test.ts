#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function buildOutPath(tmp: string, $: any, target: string): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`buck2 build --target-platforms //:no_cgo --show-output ${target}`;
  assert.equal(
    res.exitCode,
    0,
    `buck2 build failed for ${target}:\n${String(res.stderr || res.stdout)}`,
  );
  const out = String(res.stdout || "")
    .trim()
    .split("\n");
  const line = out.find((l) => l.includes(target)) || out[out.length - 1] || "";
  const last = line.trim().split(/\s+/).pop() || "";
  assert.ok(
    last.startsWith("/") || last.includes("buck-out"),
    `unable to parse output path from: ${line}`,
  );
  // In temp repos, buck2 may print a path relative to the repo root (e.g. "buck-out/...").
  // Resolve these against the temp repo so reads are deterministic and don’t depend on the
  // caller’s process.cwd().
  return path.isAbsolute(last) ? last : path.resolve(tmp, last);
}

function lines(txt: string): string[] {
  return txt
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

test("macro kwargs helper probe: defaults, overrides, and tolerant nixpkg_deps parsing", async () => {
  await runInTemp("macro-kwargs-probe", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "macro_kwargs_probe")',
        "",
        'macro_kwargs_probe(name = "default_go", lang = "go", append_labels = False)',
        "",
        "macro_kwargs_probe(",
        '  name = "custom_cpp",',
        '  lang = "cpp",',
        '  local_patch_dirs = ["patches/custom"],',
        '  nixpkg_deps = ["zlib", "pkgs.openssl"],',
        "  append_labels = True,",
        ")",
        "",
        "macro_kwargs_probe(",
        '  name = "bad_nixpkg_shape",',
        '  lang = "go",',
        '  nixpkg_deps = "pkgs.zlib",  # non-list: ignored deterministically',
        "  append_labels = True,",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const pDefault = await buildOutPath(tmp, $, "//projects/apps/demo:default_go");
    const pCustom = await buildOutPath(tmp, $, "//projects/apps/demo:custom_cpp");
    const pBad = await buildOutPath(tmp, $, "//projects/apps/demo:bad_nixpkg_shape");

    const d = lines(await fsp.readFile(pDefault, "utf8"));
    assert.deepEqual(d, ["patch_dir:patches/go", "nixpkgs_profile:default", "nixpkg_pins:0"]);

    const c = lines(await fsp.readFile(pCustom, "utf8"));
    assert.ok(c.includes("patch_dir:patches/custom"));
    assert.ok(c.includes("nixpkg_dep:zlib"));
    assert.ok(c.includes("nixpkg_dep:pkgs.openssl"));
    assert.ok(
      c.includes("label:nixpkg:pkgs.zlib"),
      `expected zlib label present; got:\n${c.join("\n")}`,
    );
    assert.ok(
      c.includes("label:nixpkg:pkgs.openssl"),
      `expected openssl label present; got:\n${c.join("\n")}`,
    );

    const b = lines(await fsp.readFile(pBad, "utf8"));
    // Non-list nixpkg_deps is ignored deterministically, so no nixpkg labels should be emitted.
    assert.deepEqual(b, ["patch_dir:patches/go", "nixpkgs_profile:default", "nixpkg_pins:0"]);
  });
});

test("macro kwargs helper rejects raw source refs in nixpkgs profile fields", async () => {
  await runInTemp("macro-kwargs-raw-source-refs", async (tmp, $) => {
    const rawCommitDir = path.join(tmp, "projects", "apps", "raw_commit");
    const rawFlakeDir = path.join(tmp, "projects", "apps", "raw_flake");
    const rawProfileFlakeDir = path.join(tmp, "projects", "apps", "raw_profile_flake");
    const rawPinCommitDir = path.join(tmp, "projects", "apps", "raw_pin_commit");
    await fsp.mkdir(rawCommitDir, { recursive: true });
    await fsp.mkdir(rawFlakeDir, { recursive: true });
    await fsp.mkdir(rawProfileFlakeDir, { recursive: true });
    await fsp.mkdir(rawPinCommitDir, { recursive: true });
    await fsp.writeFile(
      path.join(rawCommitDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "macro_kwargs_probe")',
        "",
        "macro_kwargs_probe(",
        '  name = "raw_commit_profile",',
        '  lang = "cpp",',
        '  nixpkgs_profile = "0123456789abcdef0123456789abcdef01234567",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(rawFlakeDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "macro_kwargs_probe")',
        "",
        "macro_kwargs_probe(",
        '  name = "raw_flake_pin",',
        '  lang = "cpp",',
        "  nixpkg_pins = {",
        '    "zlib": {',
        '      "nixpkgs_profile": "github:NixOS/nixpkgs/0123456789abcdef",',
        '      "rationale": "Exercise raw source validation.",',
        "    },",
        "  },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(rawProfileFlakeDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "macro_kwargs_probe")',
        "",
        "macro_kwargs_probe(",
        '  name = "raw_flake_profile",',
        '  lang = "cpp",',
        '  nixpkgs_profile = "github:NixOS/nixpkgs/0123456789abcdef",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(rawPinCommitDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:defs_common.bzl", "macro_kwargs_probe")',
        "",
        "macro_kwargs_probe(",
        '  name = "raw_commit_pin",',
        '  lang = "cpp",',
        "  nixpkg_pins = {",
        '    "zlib": {',
        '      "nixpkgs_profile": "0123456789abcdef0123456789abcdef01234567",',
        '      "rationale": "Exercise raw source validation.",',
        "    },",
        "  },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const rawCommit = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo //projects/apps/raw_commit:raw_commit_profile`.nothrow();
    assert.notEqual(rawCommit.exitCode, 0);
    assert.match(
      `${String(rawCommit.stderr || "")}\n${String(rawCommit.stdout || "")}`,
      /nixpkgs_profile must name a nixpkgs profile, not a raw commit/,
    );

    const rawFlakePin = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo //projects/apps/raw_flake:raw_flake_pin`.nothrow();
    assert.notEqual(rawFlakePin.exitCode, 0);
    assert.match(
      `${String(rawFlakePin.stderr || "")}\n${String(rawFlakePin.stdout || "")}`,
      /nixpkg_pins\[pkgs\.zlib\]\.nixpkgs_profile must name a nixpkgs profile, not a raw flake URL/,
    );

    const rawProfileFlake = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo //projects/apps/raw_profile_flake:raw_flake_profile`.nothrow();
    assert.notEqual(rawProfileFlake.exitCode, 0);
    assert.match(
      `${String(rawProfileFlake.stderr || "")}\n${String(rawProfileFlake.stdout || "")}`,
      /nixpkgs_profile must name a nixpkgs profile, not a raw flake URL/,
    );

    const rawPinCommit = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo //projects/apps/raw_pin_commit:raw_commit_pin`.nothrow();
    assert.notEqual(rawPinCommit.exitCode, 0);
    assert.match(
      `${String(rawPinCommit.stderr || "")}\n${String(rawPinCommit.stdout || "")}`,
      /nixpkg_pins\[pkgs\.zlib\]\.nixpkgs_profile must name a nixpkgs profile, not a raw commit/,
    );
  });
});
