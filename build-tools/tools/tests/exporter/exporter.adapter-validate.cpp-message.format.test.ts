#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp adapter validation message uses consistent classification wording (warn-only)", async () => {
  await runInTemp("exp-cpp-validate-message", async (tmp, $) => {
    const pkg = path.join(tmp, "viberoots", "build-tools", "cpp", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.cpp"), "int main(){return 0;}\n", "utf8");

    const nodes = [
      {
        name: "//viberoots/build-tools/cpp/app:bin",
        srcs: ["viberoots/build-tools/cpp/app/main.cpp"],
        labels: [],
      },
    ];
    const graph = path.join(tmp, "build-tools/tools/buck", "graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --validation warn`;
    const out = String(res.stdout || "") + String(res.stderr || "");
    const code = res.exitCode || 0;
    assert.equal(code, 0, "exporter should succeed in warn mode for cpp");
    assert.match(out, /validation warnings/i);
    assert.match(
      out,
      /\[exporter\]\[cpp\] targets include C\+\+-looking sources but lack both cxx_\* rule_type and 'lang:cpp' label:/,
    );
    assert.match(out, /-\s*\/\/viberoots\/build-tools\/cpp\/app:bin/);
    assert.match(out, /Guidance: stamp 'lang:cpp' in macros or use cxx_\* rules/i);
  });
});
