#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp registry-first path equals onlyCpp fast-path", async () => {
  await runInTemp("cpp-registry-first-cohesion", async (tmp, $) => {
    // Synthesize a tiny C++ app in a temp repo
    const appDir = path.join(tmp, "apps", "demo");
    const srcDir = path.join(appDir, "src");
    await fs.mkdirp(srcDir);
    await fs.writeFile(
      path.join(srcDir, "main.cpp"),
      [
        "#include <iostream>",
        "int main() {",
        '  std::cout << "ok" << std::endl;',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    // Minimal Buck graph describing the C++ binary target
    const graph = [
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
      },
    ];
    const toolsBuck = path.join(tmp, "tools", "buck");
    await fs.mkdirp(toolsBuck);
    await fs.writeFile(
      path.join(toolsBuck, "graph.json"),
      JSON.stringify(graph, null, 2) + "\n",
      "utf8",
    );

    const envBase = { ...process.env, BUCK_TARGET: "//apps/demo:demo" };

    const a = await $({
      cwd: tmp,
      env: envBase,
      stdio: "pipe",
    })`nix build ${`path:${tmp}#graph-generator-selected`} --print-out-paths --accept-flake-config`;
    const pathDefault = String(a.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop();

    const b = await $({
      cwd: tmp,
      env: { ...envBase, PLANNER_ONLY_CPP: "1" },
      stdio: "pipe",
    })`nix build ${`path:${tmp}#graph-generator-selected`} --print-out-paths --accept-flake-config`;
    const pathOnlyCpp = String(b.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop();

    if (!pathDefault || !pathOnlyCpp) {
      console.error("missing output paths", { pathDefault, pathOnlyCpp });
      process.exit(2);
    }
    if (pathDefault !== pathOnlyCpp) {
      console.error("derivation paths differ between default and onlyCpp", {
        pathDefault,
        pathOnlyCpp,
      });
      process.exit(2);
    }
  });
});
