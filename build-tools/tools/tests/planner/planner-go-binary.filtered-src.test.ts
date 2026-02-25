#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// This test verifies base-contract: planner uses filtered apps/libs source and still builds a bin
// It creates a tiny Go app under apps/ in a temp repo, generates a simple gomod2nix.toml,
// writes a graph.json with a go_binary node, then builds the graph-generator
// and asserts the manifest lists the binary.

test("planner builds go_binary with filtered srcRoot", async () => {
  await runInTemp("planner-go-binary-filtered", async (tmp, $) => {
    // Create minimal repo structure
    const appDir = path.join(tmp, "projects", "apps", "tcli");
    const cmdDir = path.join(appDir, "cmd", "tcli");
    await fs.mkdirp(cmdDir);
    await fs.writeFile(
      path.join(cmdDir, "main.go"),
      ["package main", 'import "fmt"', 'func main() { fmt.Println("ok") }', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "go.mod"),
      ["module example.com/tcli", "", "go 1.22", ""].join("\n"),
      "utf8",
    );
    // Minimal gomod2nix toml (no deps)
    await fs.writeFile(path.join(appDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n", "utf8");

    // Minimal Buck graph with a go_binary target
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: "//projects/apps/tcli:tcli",
      rule_type: "go_binary",
      labels: ["lang:go", "kind:bin"],
      srcs: ["projects/apps/tcli/cmd/tcli/main.go"],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );

    // Build planner and inspect manifest
    // Ensure previous link is removed if present
    await fs.remove(path.join(tmp, "buck-go")).catch(() => {});
    // Point flake src at the temp repo so the planner uses the filtered snapshot from tmp
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_TEST_SRC: tmp },
    })`nix build --impure ${`path:${tmp}#graph-generator`} --no-link --accept-flake-config --print-out-paths`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    const manifest = path.join(outPath, "manifest.json");
    const txt = await fs.readFile(manifest, "utf8").catch(() => "");
    if (!txt) {
      console.error("missing manifest.json");
      process.exit(2);
    }
    const entries = JSON.parse(txt) as Array<any>;
    const hasBin = entries.some(
      (e) =>
        String(e?.label || "").includes("//projects/apps/tcli:tcli") &&
        Array.isArray(e?.bins) &&
        e.bins.length > 0,
    );
    if (!hasBin) {
      console.error("expected binary entry in manifest for //projects/apps/tcli:tcli");
      console.error(txt);
      process.exit(2);
    }
  });
});
