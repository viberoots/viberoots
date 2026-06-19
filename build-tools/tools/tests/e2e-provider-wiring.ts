#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("provider wiring: Go module labels do not map to providers (Node-only mapping)", async () => {
  await runInTemp("e2e-provider-wiring", async (tmp, $) => {
    // Build a tiny Go module with one binary and one test-only dep
    const modDir = path.join(tmp, "goproj");
    await fs.mkdirp(modDir);
    await fs.outputFile(
      path.join(modDir, "go.mod"),
      [
        "module example.com/goproj\n",
        "go 1.22\n",
        // Add a common test-only dep
        "require github.com/stretchr/testify v1.9.0\n",
      ].join(""),
    );
    await fs.outputFile(
      path.join(modDir, "main.go"),
      'package main\nimport "fmt"\nfunc main(){fmt.Println("ok")}\n',
    );
    await fs.outputFile(
      path.join(modDir, "main_test.go"),
      'package main\nimport "github.com/stretchr/testify/require"\nimport "testing"\nfunc TestX(t *testing.T){ require.True(t, true) }\n',
    );

    // No provider syncing for Go modules; mapping is Node-only in provider-migration.

    // Build graph.json directly with module label only on test target
    const graphPath = path.join(tmp, ".viberoots/workspace/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    const nodes = [
      { name: "//goproj:bin", rule_type: "go_binary", labels: ["lang:go"], srcs: ["main.go"] },
      {
        name: "//goproj:bin_test",
        rule_type: "go_test",
        labels: ["lang:go", `module:github.com/stretchr/testify@v1.9.0`],
        srcs: ["main_test.go"],
      },
    ];
    await fs.outputFile(graphPath, JSON.stringify(nodes, null, 2), "utf8");
    await $({
      cwd: tmp,
    })`viberoots/build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out .viberoots/workspace/providers/auto_map.bzl`;

    // Inspect auto_map: expect no providers for Go module labels on any target
    const amap = await fs.readFile(
      path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl"),
      "utf8",
    );
    function blockFor(target: string): string {
      const key = `"${target}":`;
      const idx = amap.indexOf(key);
      if (idx < 0) return "";
      const start = amap.indexOf("[", idx);
      if (start < 0) return "";
      const end = amap.indexOf("]", start);
      if (end < 0) return "";
      return amap.slice(start + 1, end);
    }
    const testBlock = blockFor("//goproj:bin_test");
    const binBlock = blockFor("//goproj:bin");
    if (testBlock.includes("//third_party/providers:")) {
      console.error("did not expect any provider entries for Go module labels (test target)", amap);
      process.exit(2);
    }
    if (binBlock.includes("//third_party/providers:")) {
      console.error("did not expect any provider entries for Go module labels (bin target)", amap);
      process.exit(2);
    }
  });
});
