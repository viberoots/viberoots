#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go adapter validation message uses consistent classification wording", async () => {
  await runInTemp("exp-go-validate-message", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(path.join(mod, "main.go"), "package main\nfunc main(){}\n", "utf8");

    const nodes = [{ name: "//mod:bin", srcs: ["main.go"] }];
    const graph = path.join(tmp, "tools/buck", "graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
    })`tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --validation warn`;
    const out = String(res.stdout || "") + String(res.stderr || "");
    const code = res.exitCode || 0;
    assert.equal(code, 0, "exporter should succeed in warn mode");
    assert.match(out, /validation warnings/i);
    assert.match(
      out,
      /\[exporter\]\[go\] targets include \.go sources but lack both go_\* rule_type and 'lang:go' label:/,
    );
    assert.match(out, /-\s*\/\/mod:bin/);
    assert.match(out, /Fix: ensure macros stamp 'lang:go'/);
  });
});
