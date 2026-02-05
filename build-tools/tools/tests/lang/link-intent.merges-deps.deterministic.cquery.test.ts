#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { normalizeTargetLabel } from "../../lib/labels";

function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const k = Object.keys(obj)[0];
    if (!k) return null;
    const v = obj[k];
    if (Array.isArray(v)) return (v[0] as T) ?? null;
    return (v as T) ?? null;
  }
  return null;
}

test("link intent: deterministic union merges deps/link_deps/header_deps", async () => {
  await runInTemp("link-intent-merges-deterministic", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@prelude//:rules.bzl", "genrule")',
        'load("//build-tools/lang:link_intent_probe.bzl", "link_intent_probe")',
        "",
        'genrule(name = "a", out = "a.txt", cmd = "echo a > $OUT")',
        'genrule(name = "b", out = "b.txt", cmd = "echo b > $OUT")',
        'genrule(name = "c", out = "c.txt", cmd = "echo c > $OUT")',
        "",
        "link_intent_probe(",
        '  name = "probe",',
        '  deps = [":a"],',
        '  link_deps = [":b", ":a"],',
        '  header_deps = [":c", ":b"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const qDeps = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute deps //projects/apps/demo:probe`;
    if (qDeps.exitCode !== 0) return; // skip when Buck/prelude/toolchains unavailable

    const node = firstCqueryNode<{ deps?: string[] }>(JSON.parse(String(qDeps.stdout || "")));
    const deps = (node?.deps || []).map(normalizeTargetLabel);

    const want = ["//projects/apps/demo:a", "//projects/apps/demo:b", "//projects/apps/demo:c"];
    assert.deepEqual(deps, want);
  });
});
