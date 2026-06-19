#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cppApp template builds a binary via planner", async () => {
  await runInTemp("cpp-app-template", async (tmp, $) => {
    const manifest = {
      enabled: ["cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "viberoots/build-tools/tools/nix/planner/cpp.nix",
            "viberoots/build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["bin"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "viberoots/build-tools/tools/nix/planner/cpp.nix"),
    );
    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "viberoots/build-tools/tools/nix/templates/cpp.nix"),
    );

    // tiny app with main()
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "demo", "src", "main.cpp"),
      '#include <iostream>\nint main(){ std::cout<<"ok\\n"; return 0; }\n',
    );

    const graph = [
      {
        name: "//projects/apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
      },
    ];
    await fs.outputFile(
      path.join(tmp, ".viberoots/workspace/buck/graph.json"),
      JSON.stringify(graph) + "\n",
    );

    const flake = path.join(process.cwd(), "viberoots/build-tools/tools/nix/graph-generator.nix");
    const res = await $({
      cwd: tmp,
    })`nix build --accept-flake-config -f ${flake} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux"} --arg graphJsonPath ./.viberoots/workspace/buck/graph.json --no-link --print-out-paths`.nothrow();
    assert.equal(res.exitCode, 0);
  });
});
