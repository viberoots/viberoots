#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("CI forces error severity regardless of --validation=warn", async () => {
  await runInTemp("exp-ci-error", async (tmp, $) => {
    const pkg = path.join(tmp, "build-tools", "go", "app");
    await fs.mkdirp(pkg);
    await fs.outputFile(path.join(pkg, "main.go"), "package main\nfunc main(){}\n", "utf8");

    const nodes = [
      { name: "//build-tools/go/app:bin", srcs: ["build-tools/go/app/main.go"], labels: [] },
    ];
    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.outputFile(graph, JSON.stringify(nodes, null, 2));

    let out = "";
    let code = 0;
    try {
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        env: { ...process.env, CI: "true" },
      })`build-tools/tools/buck/export-graph.ts --simulate ${graph} --out ${graph} --validation warn`;
      out = String(res.stdout || "") + String(res.stderr || "");
      code = res.exitCode || 0;
    } catch (e: any) {
      out = String(e?.stdout || "") + String(e?.stderr || "");
      code = typeof e?.exitCode === "number" ? e.exitCode : 1;
    }
    if (code === 0) {
      console.error("expected exporter to fail in CI despite warn mode", out);
      process.exit(2);
    }
    if (!out.includes("validation errors") || !out.includes("[exporter][go]")) {
      console.error("expected aggregated errors including go adapter message", out);
      process.exit(2);
    }
  });
});
