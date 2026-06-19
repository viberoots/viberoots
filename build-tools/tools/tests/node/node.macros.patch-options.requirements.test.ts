#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros infer patch requirements and honor patch_options optional override", async () => {
  await runInTemp("node-patch-options-infer", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    const patchDir = path.join(libDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# test\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "debug@4.3.4.patch"), "# test\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
        '  patch_options = {"debug@4.3.4": {"optional": True}},',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode !== 0) {
      return;
    }
    const out = String(probe.stdout || "");
    assert.match(out, /"node_patch_required:lodash@4\.17\.21"/);
    assert.match(out, /"node_patch_optional:debug@4\.3\.4"/);
  });
});

test("node macros fail on unknown patch_options ids", async () => {
  await runInTemp("node-patch-options-unknown-id", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    const patchDir = path.join(libDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# test\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
        '  patch_options = {"left-pad@1.3.0": {"optional": False}},',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode === 0) {
      throw new Error("expected cquery to fail for unknown patch_options id");
    }
    const all = String(probe.stdout || "") + String(probe.stderr || "");
    assert.match(all, /contains unknown patch id/);
  });
});

test("node macros warn on stale optional patch_options ids", async () => {
  await runInTemp("node-patch-options-stale-optional", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    const patchDir = path.join(libDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# test\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
        '  patch_options = {"debug@4.3.4": {"optional": True}},',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode !== 0) {
      throw new Error("expected cquery to pass for stale optional override");
    }
    const all = String(probe.stdout || "") + String(probe.stderr || "");
    assert.match(all, /stale optional patch_options ids ignored/);
  });
});

test("node macros keep deterministic ordering and dedupe normalized patch ids", async () => {
  await runInTemp("node-patch-options-order-dedupe", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    const patchDir = path.join(libDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "zlib@1.2.13.patch"), "# test\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "debug@4.3.4.patch"), "# test\n", "utf8");
    await fsp.writeFile(
      path.join(patchDir, "DEBUG@4.3.4.patch"),
      "# duplicate by canonical id\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode !== 0) {
      throw new Error("expected cquery to pass for deterministic ordering test");
    }
    const out = String(probe.stdout || "");
    const debugLabel = '"node_patch_required:debug@4.3.4"';
    const zlibLabel = '"node_patch_required:zlib@1.2.13"';
    assert.equal(
      (out.match(new RegExp(debugLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
      1,
    );
    assert.ok(out.indexOf(debugLabel) >= 0 && out.indexOf(zlibLabel) >= 0);
    assert.ok(out.indexOf(debugLabel) < out.indexOf(zlibLabel));
  });
});

test("node macros fail on unknown patch_options keys", async () => {
  await runInTemp("node-patch-options-unknown-key", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    const patchDir = path.join(libDir, "patches", "node");
    await fsp.mkdir(patchDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(patchDir, "lodash@4.17.21.patch"), "# test\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
        '  patch_options = {"lodash@4.17.21": {"unexpected": True}},',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode === 0) {
      throw new Error("expected cquery to fail for unknown patch_options key");
    }
    const all = String(probe.stdout || "") + String(probe.stderr || "");
    assert.match(all, /unknown option key 'unexpected'/);
  });
});

test("node macros tolerate missing importer patches/node directory", async () => {
  await runInTemp("node-patch-options-missing-patch-dir", async (tmp, $) => {
    const libDir = path.join(tmp, "projects", "libs", "foo");
    await fsp.mkdir(libDir, { recursive: true });
    await fsp.writeFile(path.join(libDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "foo",',
        '  out = "foo.txt",',
        '  cmd = ": > $OUT",',
        '  labels = ["lockfile:projects/libs/foo/pnpm-lock.yaml#projects/libs/foo"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/libs/foo:foo`;
    if (probe.exitCode !== 0) {
      throw new Error("expected cquery to pass when patches/node is missing");
    }
    const out = String(probe.stdout || "");
    assert.ok(!out.includes("node_patch_required:"));
    assert.ok(!out.includes("node_patch_optional:"));
  });
});
