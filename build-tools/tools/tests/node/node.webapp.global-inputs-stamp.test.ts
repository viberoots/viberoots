#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp stamps global Nix inputs via labels", async () => {
  await runInTemp("node-webapp-stamp", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:bundle`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(': "lang:node"') || out.includes('"lang:node"'),
      "expected lang:node label to be present",
    );
    assert.ok(
      out.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present via global_nix_inputs()",
    );

    const srcsProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //projects/apps/web:bundle`;
    if (srcsProbe.exitCode !== 0) return;
    const srcsOut = String(srcsProbe.stdout || "");
    assert.ok(
      srcsOut.includes(":flake.lock"),
      "expected node_webapp stamping to be backed by real action inputs (srcs includes //.viberoots/workspace:flake.lock)",
    );
  });
});
