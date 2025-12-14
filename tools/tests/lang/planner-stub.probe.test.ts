#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function readFirstBuckOutputPath(stdout: unknown): Promise<string> {
  const line = String(stdout || "")
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  assert.ok(line, "expected at least one buck output line");
  const outPath = line.split(/\s+/).slice(1).join(" ").trim();
  assert.ok(outPath, "expected output path in buck output line");
  return outPath;
}

test("planner_stub: deterministic stamp with deps-only and srcs+deps+labels", async () => {
  await runInTemp("planner-stub-probe", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "probe");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "in.txt"), "hello\n", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        "",
        "# test: planner-stub.probe.test.ts",
        'load("@prelude//:rules.bzl", "genrule")',
        'load("//lang:planner_stub.bzl", "planner_stub")',
        "",
        'genrule(name="dep", out="dep.out", cmd="echo dep > $OUT", visibility=["PUBLIC"])',
        "",
        "planner_stub(",
        '  name = "deps_only",',
        '  deps = [":dep"],',
        '  labels = ["z", "a"],',
        ")",
        "",
        "planner_stub(",
        '  name = "srcs_and_deps",',
        '  deps = [":dep"],',
        '  srcs = ["in.txt", ":dep"],',
        '  labels = ["b", "a"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const depsOnly = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //apps/probe:deps_only`;
    const depsOnlyOut = await readFirstBuckOutputPath(depsOnly.stdout);
    const depsOnlyTxt = await fsp.readFile(path.join(tmp, depsOnlyOut), "utf8");
    assert.equal(
      depsOnlyTxt,
      ["planner_stub", "labels=a,z", "srcs=0", "deps=1", ""].join("\n"),
      "deps-only stamp content mismatch",
    );

    const srcsAndDeps = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 build --target-platforms //:no_cgo --show-output //apps/probe:srcs_and_deps`;
    const srcsAndDepsOut = await readFirstBuckOutputPath(srcsAndDeps.stdout);
    const srcsAndDepsTxt = await fsp.readFile(path.join(tmp, srcsAndDepsOut), "utf8");
    assert.equal(
      srcsAndDepsTxt,
      ["planner_stub", "labels=a,b", "srcs=2", "deps=1", ""].join("\n"),
      "srcs+deps stamp content mismatch",
    );
  });
});
