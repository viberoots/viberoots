#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("exporter: identical batch reuses cached go-list JSON without rewrite", async () => {
  await runInTemp("exporter-cache-reuse", async (tmp, $) => {
    const mod = path.join(tmp, "mod");
    await fs.mkdirp(mod);
    await fs.outputFile(path.join(mod, "go.mod"), "module example.com/mod\n\ngo 1.22\n", "utf8");
    await fs.outputFile(
      path.join(mod, "main.go"),
      'package main\nimport "fmt"\nfunc main(){fmt.Println("hi")}\n',
      "utf8",
    );

    // Simulated nodes that still force authoritative go-list path
    const nodes = [
      {
        name: "//mod:bin",
        rule_type: "go_binary",
        labels: ["lang:go"],
        srcs: ["main.go"],
      },
    ];
    const sim = path.join(tmp, "nodes.json");
    await fs.outputFile(sim, JSON.stringify(nodes, null, 2), "utf8");

    const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    const metrics1 = path.join(tmp, "metrics1.json");
    const metrics2 = path.join(tmp, "metrics2.json");
    const cacheDir = path.join(tmp, ".export-cache");

    // First run: expect a miss and cache file creation
    await $({
      cwd: tmp,
      env: { ...process.env, FORCE_AUTHORITATIVE: "1" },
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${graph} --metrics-out ${metrics1} --cache-dir ${cacheDir}`;
    const m1 = JSON.parse(await fs.readFile(metrics1, "utf8"));
    const files1 = (await fs.pathExists(cacheDir))
      ? (await fs.readdir(cacheDir)).filter((entry) => entry.endsWith(".json"))
      : [];
    if (!(files1.length === 1 && m1.cacheMisses >= 1)) {
      console.error("expected one cache miss and one cache file on first run", m1, files1);
      process.exit(2);
    }
    const cacheFile = path.join(cacheDir, files1[0]);
    const st1 = await fs.stat(cacheFile);

    // Second run: identical inputs — expect a cache hit, same file mtime
    await $({
      cwd: tmp,
      env: { ...process.env, FORCE_AUTHORITATIVE: "1" },
    })`viberoots/build-tools/tools/buck/export-graph.ts --simulate ${sim} --out ${graph} --metrics-out ${metrics2} --cache-dir ${cacheDir}`;
    const m2 = JSON.parse(await fs.readFile(metrics2, "utf8"));
    const files2 = (await fs.readdir(cacheDir)).filter((entry) => entry.endsWith(".json"));
    const st2 = await fs.stat(cacheFile);
    if (!(m2.cacheHits >= 1 && files2.length === 1 && st2.mtimeMs === st1.mtimeMs)) {
      console.error("expected cache hit with unchanged cache file mtime", {
        m1,
        m2,
        files1,
        files2,
        st1,
        st2,
      });
      process.exit(2);
    }
  });
});
